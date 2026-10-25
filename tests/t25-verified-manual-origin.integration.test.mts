import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {withT25ManualFixture} from './helpers/t25-app-notification-fixture.mjs';
import {createT18Directory} from './helpers/t18-verified-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {createTicketRoundNotifications} from '../app/server/src/workbench-ticket-round-notifications.mjs';
import {assertEpochMsString,formatEpochMsToShanghaiLocal} from '../app/server/src/platform/time-contract.mjs';
import type {TicketAppNotificationAuthority,TicketAppNotificationTargetResolver,EligibleTicketAppNotificationTarget} from '../contracts/workbench_app_notification_contracts.js';
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}

test('verified reachable MANUAL admission retains its origin and creates one application FIRST intent',{timeout:240000},async()=>{
 const source=createT18Directory();
 await withT25ManualFixture(async context=>{
  const actor=context.principals[0];assert.ok(actor);source.setPrincipal(actor.id);
  const http=await t11Http(context),cookie=context.cookies[0];assert.ok(cookie);
  const bootstrap=object(await (await http.get('/api/lifecycle/bootstrap')).json()),csrf=text(bootstrap.csrf_token);
  const candidateResponse=await http.get('/api/workbench/reporter-candidates?q='+encodeURIComponent('合成成员'));assert.equal(candidateResponse.status,200);
  const candidate=rows(object(await candidateResponse.json()).candidates)[0];assert.ok(candidate);
  const command={schema_version:1,client_command_id:randomUUID(),source:'PHONE',description:'打印机无法打印处方，设备发生故障，请协助处理。',location:{text:'合成门诊',unknown:false},
   reporter:{verification:'VERIFIED_SELECTION',candidate_ref:text(candidate.candidate_ref),candidate_version:text(candidate.candidate_version)}};
  const admitted=await fetch(context.origin+'/api/workbench/reports',{method:'POST',headers:{cookie,origin:context.origin,'content-type':'application/json','idempotency-key':command.client_command_id,'x-csrf-token':csrf},body:JSON.stringify(command)});
  assert.equal(admitted.status,202);const report=object(await admitted.json());
  assert.equal(report.source,'PHONE');assert.equal(report.reporter_verification,'VERIFIED');assert.equal(report.manual_contact_required,false);assert.equal(report.external_notification,false);
  const ticket=object(report.ticket),ticketId=text(ticket.id),beforeStart=await http.detail(ticketId);
  const startResponse=await http.post(ticketId,'take-and-start',{client_command_id:randomUUID(),expected_version:beforeStart.version,reason_code:'T11_START',resolver_team_id:beforeStart.resolver_team_id});
  const startBody:unknown=await startResponse.json();assert.equal(startResponse.status,200,JSON.stringify(startBody));const started=await http.detail(ticketId);
  assert.equal(started.status,'IN_PROGRESS');assert.ok(started.handling_cycle?.first_responsibility_event_id);
  const currentMapping=source.directory.verificationAuthority;assert.ok(currentMapping);
  const authority:TicketAppNotificationAuthority={...source.directory.application,channelAccountId:'T25_SYNTHETIC_MANUAL_APP_ACCOUNT',mappingConfigHash:currentMapping.mappingConfigHash,mappingProofRef:currentMapping.mappingProofRef,proofKind:'SYNTHETIC',validationProfile:'ISOLATED_TEST'};
  const memberId='T18_SYNTHETIC_CANONICAL_MEMBER_A',originalScopeHash=createHmac('sha256','T18_ISOLATED_SCOPE_SECRET_NOT_A_LIVE_CREDENTIAL').update(JSON.stringify(['member',authority.sourceCorpScope,authority.sourceAppScope,memberId])).digest('hex');
  let qualified=0;
  const resolver:TicketAppNotificationTargetResolver={localOnly:true,async resolveCurrentTarget(input){
   qualified++;assert.equal(input.source_kind,'VERIFIED_MANUAL_REPORT');assert.equal(input.scope.scopeHash,originalScopeHash);assert.equal(input.scope.proofRef,authority.mappingProofRef);input.signal.throwIfAborted();
   const epoch=assertEpochMsString(String(Date.now()));
   const result:EligibleTicketAppNotificationTarget={schema_version:1,state:'ELIGIBLE',source_kind:'VERIFIED_MANUAL_REPORT',scope:input.scope,checked_at:formatEpochMsToShanghaiLocal(epoch),checked_at_epoch_ms:epoch,
    target:{provider:'WECOM_APP',channel_account_id:authority.channelAccountId,target_type:'PERSON',target_id:memberId},
    verification:{mapping_config_hash:authority.mappingConfigHash,mapping_proof_ref:authority.mappingProofRef,binding_proof_ref:'T18_SYNTHETIC_BINDING_PROOF',proof_kind:'SYNTHETIC',account_status:'ACTIVE',binding_state:'VERIFIED',message_reachability:'REACHABLE'}};
   return result;
  }};
  const worker=createTicketRoundNotifications({pool:context.pool,enabled:true,botId:'T25_SYNTHETIC_UNUSED_BOT_ACCOUNT',reporterAccess:context.runtime.reporterAccess,appNotifications:{enabled:true,authority,targetResolver:resolver}});
  const deliveries=async()=>{const response=await http.get('/api/tickets/'+ticketId+'/deliveries');assert.equal(response.status,200);return object(await response.json());};
  assert.deepEqual(rows((await deliveries()).items),[]);
  await worker.runOnce();const read=await deliveries();
  assert.deepEqual(rows(read.items).map(item=>({node:item.node,route:item.route_kind,status:item.status,type:item.destination_type,cycle:item.cycle_no})),[{node:'FIRST_RESPONSIBILITY',route:'YIXIAOXIU_APP',status:'PENDING',type:'PERSON',cycle:1}]);
  assert.equal(qualified,1);await worker.runOnce();assert.deepEqual(await deliveries(),read);assert.deepEqual(await http.detail(ticketId),started);
  for(const privateValue of [memberId,originalScopeHash,authority.channelAccountId,authority.mappingConfigHash,authority.mappingProofRef,'T18_SYNTHETIC_BINDING_PROOF'])assert.equal(JSON.stringify(read).includes(privateValue),false);
 },source.directory);
});
