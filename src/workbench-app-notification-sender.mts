import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import type {TicketAppNotificationOptions} from '../contracts/workbench_app_notification_contracts.js';
import type {WeComAccessTokenProvider} from './p2-g2-wecom-oauth-provider.mjs';
import type {CommunicationSenderResult} from './p2-004-communication-sender-port.mjs';
import {isDeepStrictEqual} from 'node:util';
import {createCommunicationSenderPort} from './p2-004-communication-sender-port.mjs';
import {normalizeAppNotificationOptions,resolveOriginalAppTarget,readOriginalAppNotificationSource} from './workbench-app-notification-target.mjs';
import {buildP2016TemplateCard} from './p2-016-template-card-builder.mjs';
import {exactP2016,localP2016,textHashP2016,versionP2016} from './p2-016-domain-contracts.mjs';

export interface WorkbenchAppNotificationSenderOptions {
 pool:PostgresTransaction;notifications:TicketAppNotificationOptions;agentId:number;accessTokenProvider:WeComAccessTokenProvider;
 enabled?:boolean;fetchImpl?:typeof fetch;origin:string;allowedHosts:readonly string[];allowLocalHttp?:boolean;
}
interface Basis {source_intake_id:string;node:'FIRST_RESPONSIBILITY'|'STAFF_COMPLETED';ticket_no:string;status:'QUEUED'|'ACCEPTED'|'CLOSED';created_at:string;version:number;public_ref:string;content:unknown;recipient_binding_hash:string;external_summary:string|null}
const reject=(code:string):CommunicationSenderResult=>({outcome:'REJECTED_NOT_APPLIED',provider_message_id:null,error_code:code,retryable:false});
const unknown=():CommunicationSenderResult=>({outcome:'UNKNOWN',provider_message_id:null,error_code:'APP_NOTIFICATION_RECONCILIATION_REQUIRED',retryable:false});
// Neither the generic Sender Port nor a PERSON label rules out bulk syntax.
function singleMember(value:unknown):value is string{return typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.@-]{0,255}$/u.test(value)&&value!=='@all';}
async function sdkReply(response:Response,signal:AbortSignal):Promise<unknown>{
 if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});throw Error('APP_SDK_RESPONSE_INVALID');}
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
 try{for(;;){signal.throwIfAborted();const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>8192)throw Error('APP_SDK_RESPONSE_TOO_LARGE');chunks.push(part.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 signal.throwIfAborted();return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/** Existing App HTTP SDK leaf; no Bot SDK, browser call, credential persistence or second Outbox. */
export function createWorkbenchAppNotificationSender({pool,notifications,agentId,accessTokenProvider,enabled=false,fetchImpl=fetch,origin,allowedHosts,allowLocalHttp=false}:WorkbenchAppNotificationSenderOptions){
 const app=normalizeAppNotificationOptions(notifications);
 if(typeof enabled!=='boolean'||!app||!Number.isSafeInteger(agentId)||agentId<1||String(agentId)!==app.authority.sourceAppScope||typeof accessTokenProvider!=='function'||typeof fetchImpl!=='function')throw TypeError('APP_NOTIFICATION_CONFIGURATION_INVALID');
 return createCommunicationSenderPort(async request=>{
  if(!enabled||!app.enabled)return reject('APP_NOTIFICATION_DISABLED');
  if(request.provider!=='WECOM_APP'||request.channel_account_id!==app.authority.channelAccountId||request.target_type!=='PERSON'||!singleMember(request.target_id)||request.message.message_type!=='template_card')return reject('APP_NOTIFICATION_TARGET_INVALID');
  if(request.signal.aborted)return reject('APP_NOTIFICATION_ABORTED_BEFORE_SEND');
  const readBasis=()=>pool.query<Basis>(`SELECT c.source_intake_id::text,r.node,t.ticket_no,e.new_status AS status,e.created_at,e.aggregate_version AS version,
    ref.public_ref,m.content,b.recipient_binding_hash,CASE WHEN r.node='STAFF_COMPLETED' THEN e.external_note ELSE NULL END AS external_summary
    FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id JOIN communication.message m ON m.id=o.message_id
    JOIN communication.ticket_notification_binding b ON b.delivery_id=d.id AND b.message_id=m.id AND b.outbox_id=o.id
    JOIN communication.ticket_round_notification_binding r ON r.notification_binding_id=b.id AND r.ticket_id=b.ticket_id AND r.destination_type=b.destination_type
    JOIN pilot_ticket.ticket_handling_cycle c ON c.id=r.cycle_id AND c.ticket_id=r.ticket_id
    JOIN pilot_ticket.ticket t ON t.id=c.ticket_id AND t.source_intake_id=c.source_intake_id
    JOIN pilot_ticket.reporter_public_ref ref ON ref.ticket_id=t.id AND ref.reporter_binding_hash=b.recipient_binding_hash AND ref.status='ACTIVE'
    JOIN pilot_ticket.ticket_handling_cycle_event ce ON ce.cycle_id=c.id AND ce.ticket_id=c.ticket_id AND ce.ticket_event_id=b.ticket_event_id
    JOIN pilot_ticket.ticket_event e ON e.event_id=b.ticket_event_id AND e.ticket_id=b.ticket_id AND e.operator_type='PILOT_USER'
    WHERE d.id=$1::uuid AND d.status='SENDING' AND d.provider='WECOM_APP' AND d.channel_account_id=$2 AND d.target_type='PERSON' AND d.target_id=$3 AND d.idempotency_key=$4
      AND b.destination_type='PERSON' AND r.recipient_binding_hash=b.recipient_binding_hash
      AND m.sender_kind='SYSTEM' AND m.sender_system_code='TICKET_LIFECYCLE' AND m.purpose='SYSTEM_NOTIFICATION' AND m.visibility='EXTERNAL'
      AND m.message_type='template_card' AND o.route_policy='P2_016_ORIGINAL_APP_ROUND' AND m.retention_until_epoch_ms>platform.physical_epoch_ms()
      AND ((r.node='FIRST_RESPONSIBILITY' AND e.event_id=c.first_responsibility_event_id AND b.notification_type='TICKET_ACCEPTED'
        AND ((e.event_type='ticket.accepted' AND e.new_status='ACCEPTED') OR (e.event_type='ticket.assignment_transferred' AND e.old_status='QUEUED' AND e.new_status='QUEUED'
          AND e.assignment_metadata->>'old_assignee_id' IS NULL AND lower(e.assignment_metadata->>'new_assignee_id')=c.first_responsibility_principal_id::text AND e.assignment_metadata->>'new_team_id'=c.first_responsibility_team_id)))
        OR (r.node='STAFF_COMPLETED' AND e.event_id=c.staff_completion_event_id AND b.notification_type='TICKET_CLOSED' AND e.event_type='ticket.closed'
          AND e.old_status='IN_PROGRESS' AND e.new_status='CLOSED' AND e.reason_code='STAFF_COMPLETED' AND e.internal_note IS NOT NULL
          AND char_length(btrim(e.external_note)) BETWEEN 1 AND 500 AND EXISTS(SELECT 1 FROM pilot_ticket.staff_completion_notification_commitment p
            WHERE p.cycle_id=c.id AND p.ticket_id=c.ticket_id AND p.source_intake_id=c.source_intake_id AND p.ticket_event_id=e.event_id)))`,
    [request.delivery_id,request.channel_account_id,request.target_id,request.idempotency_key]);
  let row:Basis,original:NonNullable<Awaited<ReturnType<typeof resolveOriginalAppTarget>>>;
  try{
   const basis=await readBasis(),value=basis.rows[0];if(basis.rowCount!==1||!value)return reject('APP_NOTIFICATION_BINDING_INVALID');row=value;
   const target=await resolveOriginalAppTarget(pool,row.source_intake_id,app);if(!target||target.target.target_id!==request.target_id)return reject('APP_NOTIFICATION_NOT_AUTHORIZED');original=target;
   const binding=textHashP2016(JSON.stringify(['WECOM_APP',request.channel_account_id,target.source.scope.sourceCorpScope,target.source.scope.sourceAppScope,target.source.scope.scopeHash,request.target_id]));
   if(binding!==row.recipient_binding_hash)return reject('APP_NOTIFICATION_BINDING_INVALID');
   const expected={transport:'WECOM_APP',public_ref:row.public_ref,request_ref:target.source.request_ref,source_kind:target.source.source_kind,node:row.node,suffix:row.ticket_no.slice(-4),status:row.status,
    occurred_at:localP2016(row.created_at),version:versionP2016(row.version),notification_type:row.node==='FIRST_RESPONSIBILITY'?'TICKET_ACCEPTED':'TICKET_CLOSED'};
   if(!isDeepStrictEqual(row.content,expected)||!isDeepStrictEqual(request.message.content,expected))return reject('APP_NOTIFICATION_BINDING_INVALID');
  }catch{return reject('APP_NOTIFICATION_BINDING_UNAVAILABLE');}
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(5000)]);let token:string,recipient:string;
  try{
   const credential=await accessTokenProvider({signal});signal.throwIfAborted();if(typeof credential!=='string'||!credential||credential.length>4096||/[\r\n]/u.test(credential))return reject('APP_NOTIFICATION_CREDENTIAL_UNAVAILABLE');token=credential;
   const endpoint=new URL('https://qyapi.weixin.qq.com/cgi-bin/batch/userid_to_openuserid');endpoint.searchParams.set('access_token',token);
   const converted=exactP2016(await sdkReply(await fetchImpl(endpoint,{method:'POST',redirect:'error',signal,headers:{'content-type':'application/json'},body:JSON.stringify({userid_list:[request.target_id]})}),signal),['errcode','errmsg','open_userid_list','invalid_userid_list'],['errcode','open_userid_list']);
   if(converted.errcode!==0||!Array.isArray(converted.open_userid_list)||converted.open_userid_list.length!==1||converted.invalid_userid_list!==undefined&&(!Array.isArray(converted.invalid_userid_list)||converted.invalid_userid_list.length))return reject('APP_NOTIFICATION_RECIPIENT_UNQUALIFIED');
   const pair=exactP2016(converted.open_userid_list[0],['userid','open_userid']);if(pair.userid!==request.target_id||!singleMember(pair.open_userid))return reject('APP_NOTIFICATION_RECIPIENT_UNQUALIFIED');recipient=pair.open_userid;
  }catch{return reject('APP_NOTIFICATION_RECIPIENT_UNQUALIFIED');}
  let body:unknown;
  try{
   // Qualification/token/namespace conversion may wait. Never retarget the stored intent.
   const currentTarget=await resolveOriginalAppTarget(pool,row.source_intake_id,app);if(!isDeepStrictEqual(currentTarget,original))return reject('APP_NOTIFICATION_NOT_AUTHORIZED');
   const current=await readBasis();if(current.rowCount!==1||!isDeepStrictEqual(current.rows[0],row))return reject('APP_NOTIFICATION_BINDING_INVALID');
   const currentSource=await readOriginalAppNotificationSource(pool,row.source_intake_id);if(!isDeepStrictEqual(currentSource,original.source))return reject('APP_NOTIFICATION_NOT_AUTHORIZED');
   const model={public_ref:row.public_ref,suffix:row.ticket_no.slice(-4),status:row.status,occurred_at:localP2016(row.created_at),version:versionP2016(row.version),notification_type:row.node==='FIRST_RESPONSIBILITY'?'TICKET_ACCEPTED':'TICKET_CLOSED',source:'DIRECT'};
   const card=buildP2016TemplateCard({model,origin,allowedHosts,allowLocalHttp,linkMode:'MEMBER_REQUIRED'});
   const url=original.source.source_kind==='WEB_REQUEST'?new URL('/wecom/yixiaoxiu/reports/'+original.source.request_ref,origin).href:new URL('/wecom/yixiaoxiu/tickets/'+row.public_ref,origin).href;
   if(original.source.source_kind==='WEB_REQUEST'&&!/^[A-Za-z0-9_-]{32}$/u.test(original.source.request_ref??''))return reject('APP_NOTIFICATION_CARD_INVALID');
   body={touser:recipient,msgtype:'template_card',agentid:agentId,template_card:{...card.template_card,source:{desc:original.source.source_kind==='WEB_REQUEST'?'医小修网页报修':'工作人员代录',desc_color:0},
    sub_title_text:row.external_summary===null?'处理进度请通过下方本人入口查看。':'本轮处理结果：'+row.external_summary,
    jump_list:[{type:1,title:'查看处理进度',url}],card_action:{type:1,url},task_id:'delivery_'+request.delivery_id.replaceAll('-','')}};
   signal.throwIfAborted();
  }catch{return reject('APP_NOTIFICATION_CARD_INVALID');}
  try{
   const endpoint=new URL('https://qyapi.weixin.qq.com/cgi-bin/message/send');endpoint.searchParams.set('access_token',token);
   const receipt=exactP2016(await sdkReply(await fetchImpl(endpoint,{method:'POST',redirect:'error',signal,headers:{'content-type':'application/json'},body:JSON.stringify(body)}),signal),['errcode','errmsg','msgid','invaliduser','invalidparty','invalidtag','unlicenseduser','response_code'],['errcode']);
   if(receipt.errcode!==0||['invaliduser','invalidparty','invalidtag','unlicenseduser'].some(key=>receipt[key]!==undefined&&receipt[key]!==''))return unknown();
   if(typeof receipt.msgid!=='string'||!receipt.msgid.trim()||receipt.msgid.length>512||/[\u0000-\u001f\u007f]/u.test(receipt.msgid))return unknown();
   return {outcome:'ACKNOWLEDGED',provider_message_id:'app_ack_'+textHashP2016(receipt.msgid).slice(0,32),error_code:null,retryable:false};
  }catch{return unknown();}
 });
}
