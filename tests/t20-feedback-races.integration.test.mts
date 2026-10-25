import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT20FeedbackFixture,t20Object} from './helpers/t20-feedback-fixture.mjs';
import {createP2016Runtime} from '../app/server/src/p2-016-runtime.mjs';
import {createYxxSelfServiceFeedback} from '../app/server/src/yxx-self-service-feedback.mjs';
import type {YxxMemberScope} from '../app/server/src/yxx-self-service-authorization.mjs';
import {browser,login,post,origin,secret,config,oauthOptions,mapping} from './helpers/yxx-ss-009-http-fixture.mjs';

test('same UUID concurrent own-member HTTP feedback commits one shared round and stable replay',async()=>{
 await withT20FeedbackFixture(async f=>{
  const responses=await Promise.all([f.send(),f.send()]);assert.deepEqual(responses.map(r=>r.status),[200,200]);
  const values=responses.map(r=>t20Object(r.json()));assert.deepEqual(values.map(v=>v.replayed).sort(),[false,true]);
  assert.deepEqual(values[0]?.ticket,values[1]?.ticket);
  assert.equal((await f.context.pool.query<{n:number}>('SELECT count(*)::int AS n FROM pilot_ticket.ticket_cycle_reopen WHERE ticket_id=$1::uuid',[f.ticketId])).rows[0]?.n,1);
  assert.equal((await f.send({...f.command,expected_ticket_version:f.command.expected_ticket_version+1})).status,409);
  assert.equal((await f.member.request('/api/yixiaoxiu/commands/'+f.command.client_command_id)).status,404,'generic SUBMIT/SUPPLEMENT receipt cannot claim FEEDBACK purpose');
 });
});

test('different UUID own-member HTTP commands for one completed round have exactly one semantic winner',async()=>{
 await withT20FeedbackFixture(async f=>{
  const responses=await Promise.all([f.send(),f.send({...f.command,client_command_id:randomUUID()})]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const facts=await f.context.pool.query<{cycles:number;reopened:number;feedback:number}>(`SELECT (SELECT count(*)::int FROM pilot_ticket.ticket_handling_cycle WHERE ticket_id=$1::uuid) AS cycles,(SELECT count(*)::int FROM pilot_ticket.ticket_cycle_reopen WHERE ticket_id=$1::uuid) AS reopened,(SELECT count(*)::int FROM intake.web_command_receipt WHERE command_kind='FEEDBACK') AS feedback`,[f.ticketId]);
  assert.deepEqual(facts.rows[0],{cycles:2,reopened:1,feedback:1});
 });
});

test('independent staff W reopen and own-member feedback compete on one App and one completed-round basis',async()=>{
 await withT20FeedbackFixture(async f=>{
  await f.app.stop();const full=createP2016Runtime({pool:f.context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true,REPORTER_TIMELINE_ENABLED:true},publicOrigin:origin,
   principalIds:[f.context.principals[0]?.id??''],externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketReopenRoundsEnabled:true,
   wecomWebOAuth:oauthOptions,reporterPolicy:'MEMBER_REQUIRED',reporterMemberEntry:config,identityMapping:await mapping(),reporterHmacSecret:secret,
   yxxSelfService:{featureFlags:f.options.featureFlags,reporterFeedbackEnabled:true}});
  if('disabled' in full)throw Error('T20_RACE_FULL_DISABLED');
  try{
   const started=await full.start();assert.ok(started.cookies);const cookie=started.cookies[0];assert.ok(cookie);
   const staff=browser(full.server),member=browser(full.server);staff.cookies.set(cookie.name,cookie.value);await login(member);
   const staffBootstrap=t20Object((await staff.request('/api/lifecycle/bootstrap')).json()),memberBootstrap=t20Object((await member.request('/api/yixiaoxiu/bootstrap')).json());
   const staffBody={client_command_id:randomUUID(),expected_version:f.completed.version,reason_code:'STAFF_REOPEN',note:'独立工作人员与本人反馈竞争'};
   const responses=await Promise.all([staff.request('/api/tickets/'+f.ticketId+'/reopen',post(staffBody,staffBootstrap.csrf_token)),member.request(f.path+'/feedback',{...post(f.command,memberBootstrap.csrf_token),headers:{...post(f.command,memberBootstrap.csrf_token).headers,'if-match':'"'+f.completed.version+'"'}})]);
   assert.deepEqual(responses.map(r=>r.status).sort(),[200,409],responses.map(r=>r.text).join('\n'));
   const facts=(await f.context.pool.query<{status:string;version:number;assignee_id:string|null;cycles:number;reopened:number}>(`SELECT t.status,t.version,t.assignee_id::text,(SELECT count(*)::int FROM pilot_ticket.ticket_handling_cycle c WHERE c.ticket_id=t.id) AS cycles,(SELECT count(*)::int FROM pilot_ticket.ticket_cycle_reopen r WHERE r.ticket_id=t.id) AS reopened FROM pilot_ticket.ticket t WHERE t.id=$1::uuid`,[f.ticketId])).rows[0];
   assert.deepEqual(facts,{status:'REOPENED',version:f.completed.version+1,assignee_id:null,cycles:2,reopened:1});
  }finally{await full.stop();assert.equal(full.server.listening,false);}
 });
});

test('public feedback transaction port leaves caller rollback, cycles, events and receipt wholly uncommitted',async()=>{
 await withT20FeedbackFixture(async f=>{
  const binding=(await f.context.pool.query<{scopeHash:string;sourceCorpScope:string;sourceAppScope:string;proofRef:string}>('SELECT canonical_reporter_binding AS "scopeHash",source_corp_scope AS "sourceCorpScope",source_app_scope AS "sourceAppScope",proof_ref AS "proofRef" FROM intake.web_request_binding WHERE request_ref=$1',[f.requestRef])).rows[0];assert.ok(binding);assert.match(binding.scopeHash,/^[a-f0-9]{64}$/u);assert.ok(binding.sourceCorpScope&&binding.sourceAppScope&&binding.proofRef);
  // Actual authorized owner source established above; the branding assertion only describes that checked persisted scope for this port test.
  const scope=Object.freeze(binding) as YxxMemberScope,store=createYxxSelfServiceFeedback({pool:f.context.pool,scopeSecret:secret}),tx=await f.context.pool.connect();
  try{await tx.query('BEGIN');const result=await store.acceptInTransaction({scope,requestRef:f.requestRef,input:f.command,transaction:tx});assert.equal(result.ticket.status,'REOPENED');await tx.query('ROLLBACK');}
  finally{await tx.query('ROLLBACK');tx.release();}
  assert.equal((await f.member.request(f.path+'/feedback/commands/'+f.command.client_command_id)).status,200);
  assert.equal(t20Object((await f.member.request(f.path+'/feedback/commands/'+f.command.client_command_id)).json()).state,'UNKNOWN');
  assert.equal((await f.context.pool.query<{status:string}>('SELECT status FROM pilot_ticket.ticket WHERE id=$1::uuid',[f.ticketId])).rows[0]?.status,'CLOSED');
  assert.equal((await f.context.pool.query<{n:number}>('SELECT count(*)::int AS n FROM pilot_ticket.ticket_cycle_reopen WHERE ticket_id=$1::uuid',[f.ticketId])).rows[0]?.n,0);
  assert.equal((await f.send()).status,200,'the original UUID remains lawful after a caller rollback');
 });
});
