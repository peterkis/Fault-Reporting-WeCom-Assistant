import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PostgresPool} from '../../src/platform/postgres-pool.mjs';
import type {SupplementFollowUpPage,SupplementFollowUpTarget,SupplementFollowUpReplyCommand} from '../../contracts/workbench_supplement_follow_up_contracts.js';
import {withT35Fixture} from './t35-read-fixture.mjs';
import {ownedHttp} from './t36-supplement-fixture.mjs';
import type {launchSystemBrowser} from './p2-006-browser-harness.mjs';
import {closeBrowserTestResources} from './p2-006-browser-harness.mjs';
import {migrateWorkbenchSupplementFollowUp} from '../../scripts/workbench-supplement-follow-up-migrate.mjs';
import {createP2016Runtime} from '../../src/p2-016-runtime.mjs';
import {createPilotAccessService} from '../../src/p1-009-pilot-access-workbench.mjs';
import type {PilotRole} from '../../src/p1-009-pilot-access-workbench.mjs';
import {createPilotTicketCore} from '../../src/p1-005-pilot-ticket-core.mjs';
import {createRuleFirstOrchestrator} from '../../src/p2-015-rule-first-orchestrator.mjs';
import {createDecisionStore} from '../../src/p2-015-decision-store.mjs';
import {createManualReviewStore} from '../../src/p2-015-manual-review.mjs';
import {createServiceIntakeDecisionPort} from '../../src/p2-015-service-intake-decision-port.mjs';
import {createSafeActionExecutor,createExistingTicketCommandPort,createP2004FixedCommunicationPort} from '../../src/p2-015-safe-action-executor.mjs';

function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
export interface T36BoundReplyFixture {
 setup_mode:'REAL_BOT_INGRESS_SINGLE_APP_MANUAL_ORIGINAL_WORKER';
 origin:string;browserCookie:NonNullable<Parameters<typeof launchSystemBrowser>[0]['cookies']>[number];
 setActorRoles(roles:PilotRole[]):Promise<void>;
 pool:PostgresPool;sessionId:string;ticketId:string;actorId:string;reporterId:string;
 r2:SupplementFollowUpTarget;rowVersion:number;internalCanary:string;
 postReply(body:SupplementFollowUpReplyCommand):Promise<Response>;
 page():Promise<SupplementFollowUpPage>;
 appendR3():Promise<SupplementFollowUpTarget>;
 independentFacts():Promise<unknown>;
 get(path:string):Promise<Response>;
 read<T>(path:string):Promise<T>;
}
export function withT36BoundReplyFixture(run:(f:T36BoundReplyFixture)=>Promise<void>){return withT35Fixture(async base=>{
 await base.runtime.stop();await migrateWorkbenchSupplementFollowUp({databaseUrl:base.databaseUrl,mode:'apply'});
 const admin=base.principals[0];assert.ok(admin);
 const runtime=createP2016Runtime({pool:base.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:base.origin,
  listenPort:Number(new URL(base.origin).port),principalIds:[admin.id],externalSendEnabled:false,
  workbenchManualReportsEnabled:true,workbenchManualReviewEnabled:true,workbenchConversationsEnabled:true,
  workbenchPersonalReadEnabled:true,workbenchSupplementFollowUpEnabled:true});
 if('disabled' in runtime)throw Error('T36_REAL_RUNTIME_REQUIRED');let primaryError:unknown;
 try{
  const [cookie]=(await runtime.start()).cookies??[];assert.ok(cookie);const cookieHeader=cookie.name+'='+cookie.value;
  const get=(path:string)=>ownedHttp(base.origin+path,{headers:{cookie:cookieHeader}});
  const read=async<T,>(path:string):Promise<T>=>{const response=await get(path);assert.equal(response.status,200,path);return await response.json() as T;};
  const csrf=(await read<{csrf_token:string}>('/api/lifecycle/bootstrap')).csrf_token;assert.ok(csrf);
  const decisions=createDecisionStore(),orchestrator=createRuleFirstOrchestrator({pool:base.pool,
   identityHmacKey:'t36-real-bot-journey-synthetic-key',decisionStore:decisions,
   safeActionExecutor:createSafeActionExecutor({decisionStore:decisions,intakeDecisionPort:createServiceIntakeDecisionPort(),
    manualReviewStore:createManualReviewStore(),ticketCommandPort:createExistingTicketCommandPort({ticketCore:createPilotTicketCore({pool:base.pool})}),communicationPort:createP2004FixedCommunicationPort()})});
  const nonce=randomUUID(),reporterId='t36-reporter-'+nonce,bot='t36-bot-'+nonce;
  const accept=async(text:string)=>{
   const msgid='t36-'+randomUUID(),accepted=await runtime.assembly.handleFrame({cmd:'aibot_msg_callback',headers:{req_id:msgid},
    body:{msgid,aibotid:bot,chattype:'single',from:{userid:reporterId},msgtype:'text',text:{content:text}}});
   assert.equal(accepted.ok,true);const intakeId=object(object(object(accepted).result).intake).id;assert.equal(typeof intakeId,'string');
   for(let attempt=0;attempt<20;attempt++){await runtime.coordinator.runOnce();if(object(await runtime.coordinator.backlog()).channel_messages===0)break;}
   assert.equal(object(await runtime.coordinator.backlog()).channel_messages,0);
   const evaluated=await orchestrator.processPersistedIntake({service_intake_id:String(intakeId),feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true},trace_id:'t36-'+msgid});
   const material=object(object(accepted).result),message=object(material.message);assert.equal(typeof message.channel_message_id,'string');assert.equal(typeof message.sequence_no,'number');
   return {intakeId:String(intakeId),evaluated:object(evaluated),sourceRef:'channel:'+String(message.channel_message_id),revision:String(message.sequence_no)};
  };
  const initial=await accept('3楼护士站HIS登录报错'),actions=initial.evaluated.action_results;assert.ok(Array.isArray(actions));
  const ticket=actions.map(object).find(a=>a.result_ref_type==='TICKET');assert.ok(ticket);assert.equal(typeof ticket.result_ref_id,'string');
  const ticketId=String(ticket.result_ref_id),itemPath='/api/workbench/items/ticket/'+ticketId,ticketPath='/api/tickets/'+ticketId;
  const followPath=ticketPath+'/supplement-follow-up';
  const related=await read<{items:{session:{session_id:string}}[]}>(itemPath+'/conversations');assert.equal(related.items.length,1);
  const sessionId=related.items[0]?.session.session_id;assert.ok(sessionId);
  const sessionPath='/api/workbench/conversations/'+sessionId;
  const target=async(text:string):Promise<SupplementFollowUpTarget>=>{
   const next=await accept(text);assert.equal(next.intakeId,initial.intakeId);
   const detail=await read<{records:{text:string|null;audience:string;read_material?:SupplementFollowUpTarget}[]}>(itemPath);
   const found=detail.records.find(r=>r.audience==='REPORT'&&r.read_material?.source_ref===next.sourceRef&&r.read_material.revision===next.revision)?.read_material;assert.ok(found);assert.match(found.source_ref,/^channel:[1-9][0-9]*$/u);return found;
  };
  const r2=await target('补充：T36同一主题当前错误提示403。');assert.equal(r2.revision,'2');
  const internalCanary='T36_INTERNAL_ONLY_'+randomUUID();
  const currentSession=async()=>read<{session:{row_version:number};capabilities:string[]}>(sessionPath);
  const beforeNote=await currentSession();assert.ok(beforeNote.capabilities.includes('REPLY'));
  const note={client_command_id:randomUUID(),expected_row_version:beforeNote.session.row_version,text:internalCanary};
  const noted=await ownedHttp(base.origin+sessionPath+'/internal-notes',{method:'POST',headers:{cookie:cookieHeader,origin:base.origin,
   'content-type':'application/json','idempotency-key':note.client_command_id,'x-csrf-token':csrf,'if-match':'"'+note.expected_row_version+'"'},body:JSON.stringify(note)});
  assert.equal(noted.status,201);await noted.arrayBuffer();
  const rowVersion=(await currentSession()).session.row_version;
  const page=()=>read<SupplementFollowUpPage>(followPath);assert.equal((await page()).items.find(x=>x.source_ref===r2.source_ref)?.follow_up_state,'PENDING','read and internal note do not clear a supplement');
  const postReply=(body:SupplementFollowUpReplyCommand)=>ownedHttp(base.origin+sessionPath+'/messages',{method:'POST',headers:{cookie:cookieHeader,
   origin:base.origin,'content-type':'application/json','idempotency-key':body.client_command_id,'x-csrf-token':csrf,'if-match':'"'+body.expected_row_version+'"'},body:JSON.stringify(body)});
  await run({setup_mode:'REAL_BOT_INGRESS_SINGLE_APP_MANUAL_ORIGINAL_WORKER',pool:base.pool,sessionId,ticketId,actorId:admin.id,reporterId,r2,rowVersion,internalCanary,
   setActorRoles:async roles=>{const actor=(await base.pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[admin.id])).rows[0];assert.ok(actor);const changed=await createPilotAccessService({pool:base.pool}).upsertPrincipal({wecomUserId:actor.wecom_user_id,displayName:actor.display_name,roles,resolverTeamIds:[]});assert.equal(changed.id,admin.id);},
   origin:base.origin,browserCookie:{name:cookie.name,value:cookie.value,url:base.origin+'/',httpOnly:true,secure:false,sameSite:'Strict'},
   postReply,page,appendR3:()=>target('补充：T36发送在途以后新收到的材料。'),get,read,
   independentFacts:async()=>({ticket:await read(ticketPath),responsibility:await read(ticketPath+'/responsibility'),events:await read(ticketPath+'/events'),read:await read(itemPath+'/read-position')})});
 }catch(error){primaryError=error;}
 finally{await closeBrowserTestResources([async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);}],primaryError);}
});}
