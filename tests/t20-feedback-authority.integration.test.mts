import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT20FeedbackFixture,t20Object} from './helpers/t20-feedback-fixture.mjs';
import {browser,login,post,origin} from './helpers/yxx-ss-009-http-fixture.mjs';
import {createYxxProfile} from '../app/server/src/p2-g2-yixiaoxiu-profile.mjs';
import {createWeComWebOAuth} from '../app/server/src/p2-g2-wecom-web-oauth.mjs';
import {mapping,oauthOptions} from './helpers/yxx-ss-009-http-fixture.mjs';

test('ordinary thanks and supplementary material keep the completed Ticket and round closed',async()=>{
 await withT20FeedbackFixture(async f=>{
  const facts=await f.context.pool.query<{status:string;version:number;cycle:string}>(`SELECT status,version,current_handling_cycle_id::text AS cycle FROM pilot_ticket.ticket WHERE id=$1::uuid`,[f.ticketId]);
  assert.deepEqual(facts.rows[0],{status:'CLOSED',version:f.completed.version,cycle:f.completed.handling_cycle?.id});
  assert.equal((await f.context.pool.query<{n:number}>('SELECT count(*)::int AS n FROM pilot_ticket.ticket_cycle_reopen WHERE ticket_id=$1::uuid',[f.ticketId])).rows[0]?.n,0);
 },{beforeCompletion:async({member,path,csrf})=>{
  const before=t20Object((await member.request(path)).json());assert.equal(before.can_supplement,true);
  const supplement={schema_version:1,client_command_id:randomUUID(),expected_input_revision:before.input_revision,text:'谢谢，补充故障发生时的界面说明'};
  const result=await member.request(path+'/supplements',post(supplement,csrf));assert.equal(result.status,202,result.text);
 }});
});

test('feedback HTTP input, Origin, CSRF, UUID, round and Ticket version fail independently without a new fact',async()=>{
 await withT20FeedbackFixture(async f=>{
  const snapshot=async()=> (await f.context.pool.query(`SELECT t.status,t.version,t.assignee_id::text,t.current_handling_cycle_id::text,
    (SELECT count(*)::int FROM pilot_ticket.ticket_event e WHERE e.ticket_id=t.id) AS events,
    (SELECT count(*)::int FROM pilot_ticket.ticket_handling_cycle c WHERE c.ticket_id=t.id) AS cycles,
    (SELECT count(*)::int FROM intake.web_command_receipt WHERE command_kind='FEEDBACK') AS feedback FROM pilot_ticket.ticket t WHERE t.id=$1::uuid`,[f.ticketId])).rows[0];
  const before=await snapshot();
  for(const [patch,status] of [[{actor:'ADMIN'},400],[{ticket_id:f.ticketId},400],[{feedback:'THANKS'},400],[{expected_ticket_version:'1'},400],[{expected_ticket_version:2147483648},400],[{completed_round_ref:'bad'},400],[{completed_round_ref:'A'.repeat(32)},409],[{expected_ticket_version:f.command.expected_ticket_version+1},409]] as const){
   const body={...f.command,...patch},response=await f.member.request(f.path+'/feedback',{...post(body,f.csrf),headers:{...post(body,f.csrf).headers,'if-match':'"'+body.expected_ticket_version+'"'}});
   assert.equal(response.status,status,response.text);assert.deepEqual(await snapshot(),before);
  }
  for(const [headers,status] of [[{origin:'https://other.invalid'},403],[{'x-csrf-token':'different'},403],[{'idempotency-key':randomUUID()},400],[{'if-match':'"0"'},409]] as const){const response=await f.send(f.command,headers);assert.equal(response.status,status,response.text);assert.deepEqual(await snapshot(),before);}
  assert.equal((await f.member.request(f.path+'/feedback',{...post({...f.command,extra:'x'.repeat(2100)},f.csrf),headers:{...post(f.command,f.csrf).headers,'if-match':'"'+f.command.expected_ticket_version+'"'}})).status,413);
  assert.deepEqual(await snapshot(),before);
 });
});

test('another member cannot claim the request or feedback receipt; current read can recover after write shutdown',async()=>{
 await withT20FeedbackFixture(async f=>{
  const other=browser(f.app.server);await login(other,'b');const csrf=t20Object((await other.request('/api/yixiaoxiu/bootstrap')).json()).csrf_token;
  assert.equal((await other.request(f.path)).status,404);
  assert.equal((await other.request(f.path+'/feedback',{...post(f.command,csrf),headers:{...post(f.command,csrf).headers,'if-match':'"'+f.command.expected_ticket_version+'"'}})).status,404);
  const committed=await f.send();assert.equal(committed.status,200,committed.text);
  const receiptPath=f.path+'/feedback/commands/'+f.command.client_command_id;
  assert.equal((await other.request(receiptPath)).status,404);
  await f.app.stop();const current=createYxxProfile({...f.options,profile:'MEMBER_SELF_SERVICE',identityMapping:await mapping(),oauth:createWeComWebOAuth(oauthOptions),yxxSelfService:{featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:false,YIXIAOXIU_MY_REPORTS_ENABLED:true},reporterFeedbackEnabled:true}});
  try{
   await current.start();await current.selfService.pump?.stop();const reader=browser(current.server);await login(reader);
   const currentBootstrap=t20Object((await reader.request('/api/yixiaoxiu/bootstrap')).json());assert.equal(currentBootstrap.can_submit,false);
   const receipt=await reader.request(receiptPath);assert.equal(receipt.status,200,receipt.text);assert.equal(t20Object(receipt.json()).state,'COMMITTED');
   assert.equal((await reader.request(f.path+'/feedback',{...post(f.command,currentBootstrap.csrf_token),headers:{...post(f.command,currentBootstrap.csrf_token).headers,'if-match':'"'+f.completed.version+'"'}})).status,403);
   assert.equal((await reader.request(receiptPath+'?purpose=SUBMIT')).status,400);
   assert.equal((await reader.request(receiptPath,{headers:{origin:'https://other.invalid'}})).status,403);
  }finally{await current.stop();assert.equal(current.server.listening,false);}
 });
});

test('source binding proof revocation and retention are checked independently of the original Reporter login',async()=>{
 await withT20FeedbackFixture(async f=>{
  const original=(await f.context.pool.query<{proof_ref:string;source_corp_scope:string;source_app_scope:string}>('SELECT proof_ref,source_corp_scope,source_app_scope FROM intake.web_request_binding WHERE request_ref=$1',[f.requestRef])).rows[0];assert.ok(original);
  for(const field of ['proof_ref','source_corp_scope','source_app_scope'] as const){
   await f.context.pool.query('UPDATE intake.web_request_binding SET '+field+'=$2 WHERE request_ref=$1',[f.requestRef,'different-'+field]);
   try{assert.equal((await f.send()).status,404);assert.equal((await f.member.request(f.path+'/feedback/commands/'+f.command.client_command_id)).status,404);}
   finally{await f.context.pool.query('UPDATE intake.web_request_binding SET '+field+'=$2 WHERE request_ref=$1',[f.requestRef,original[field]]);}
  }
  await f.context.pool.query('UPDATE intake.web_request_binding SET revoked_at=platform.local_now() WHERE request_ref=$1',[f.requestRef]);
  assert.equal((await f.send()).status,404);
  await f.context.pool.query('UPDATE intake.web_request_binding SET revoked_at=NULL,retention_until_epoch_ms=0,retention_until=platform.local_from_epoch_ms(0) WHERE request_ref=$1',[f.requestRef]);
  assert.equal((await f.send()).status,404);
  assert.equal((await f.context.pool.query<{status:string}>('SELECT status FROM pilot_ticket.ticket WHERE id=$1::uuid',[f.ticketId])).rows[0]?.status,'CLOSED');
 });
});
