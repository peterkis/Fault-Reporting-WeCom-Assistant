import {createPostgresPool} from '../../app/server/src/platform/postgres-pool.mjs';
import {createCommunicationDeliveryWorker} from '../../app/server/src/p2-004-communication-delivery-worker.mjs';
import {createWorkbenchAppNotificationSender} from '../../app/server/src/workbench-app-notification-sender.mjs';
import {assertEpochMsString,formatEpochMsToShanghaiLocal} from '../../app/server/src/platform/time-contract.mjs';
import type {TicketAppNotificationAuthority,EligibleTicketAppNotificationTarget} from '../../contracts/workbench_app_notification_contracts.js';
const connectionString=process.env.T25_CASE_DB,deliveryId=process.env.T25_CASE_DELIVERY,memberId=process.env.T25_CASE_MEMBER,rawAuthority=process.env.T25_CASE_AUTHORITY;
if(!connectionString||!deliveryId||!memberId||!rawAuthority)throw Error('T25_OWNED_CHILD_INPUT_REQUIRED');
// Authority is supplied only by the isolated fixture. Production validates its complete envelope.
const authority:TicketAppNotificationAuthority=JSON.parse(rawAuthority);
const pool=createPostgresPool({connectionString,max:1,application_name:'t25-interrupted-app-worker'});
try{
 const sender=createWorkbenchAppNotificationSender({pool,enabled:true,agentId:Number(authority.sourceAppScope),origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],accessTokenProvider:async()=> 'T25_INTERRUPTION_SYNTHETIC_TOKEN',notifications:{enabled:true,authority,targetResolver:{localOnly:true,async resolveCurrentTarget(input){
  const checked=assertEpochMsString(String(Date.now()));const result:EligibleTicketAppNotificationTarget={schema_version:1,state:'ELIGIBLE',source_kind:input.source_kind,scope:input.scope,checked_at:formatEpochMsToShanghaiLocal(checked),checked_at_epoch_ms:checked,target:{provider:'WECOM_APP',channel_account_id:authority.channelAccountId,target_type:'PERSON',target_id:memberId},verification:{mapping_config_hash:authority.mappingConfigHash,mapping_proof_ref:authority.mappingProofRef,binding_proof_ref:input.scope.proofRef,proof_kind:authority.proofKind,account_status:'ACTIVE',binding_state:'VERIFIED',message_reachability:'REACHABLE'}};return result;
 }}},fetchImpl:async input=>{
  const path=new URL(input instanceof Request?input.url:String(input)).pathname;
  if(path==='/cgi-bin/batch/userid_to_openuserid')return new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:memberId,open_userid:'T25_INTERRUPTION_OPEN_A'}]}));
  if(path!=='/cgi-bin/message/send')throw Error('T25_UNEXPECTED_SDK_LEAF');
  process.send?.('T25_APP_SEND_ENTERED');return new Promise<Response>(()=>{});
 }});
 await createCommunicationDeliveryWorker({pool,enabled:true,sender}).deliver({deliveryId});
}finally{await pool.end();}
