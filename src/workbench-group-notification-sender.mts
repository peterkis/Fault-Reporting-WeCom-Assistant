import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import type {CommunicationSenderResult} from './p2-004-communication-sender-port.mjs';
import {isDeepStrictEqual} from 'node:util';
import {createCommunicationSenderPort} from './p2-004-communication-sender-port.mjs';
import {readOriginalBotSource} from './workbench-ticket-round-notifications.mjs';
import {localP2016,textHashP2016} from './p2-016-domain-contracts.mjs';
export interface WorkbenchGroupNotificationOptions {
  pool:PostgresTransaction;enabled?:boolean;mvpPolicy?:boolean;routes?:readonly {botId:string;groupId:string;url:string}[];fetchImpl?:typeof fetch;
  /** Trusted namespace qualification; absence never guesses a Webhook userid. */
  resolveMentionUserId?:((source:{botId:string;groupId:string;reporterUserId:string})=>string|null|Promise<string|null>)|null;
  beforeSend?:()=>unknown|Promise<unknown>;
}
interface Basis {source_intake_id:string;node:'FIRST_RESPONSIBILITY'|'STAFF_COMPLETED';ticket_no:string;new_status:string;created_at:string;content:unknown;recipient_binding_hash:string}
const reject=(code:string):CommunicationSenderResult=>({outcome:'REJECTED_NOT_APPLIED',provider_message_id:null,error_code:code,retryable:false});
const unknown=():CommunicationSenderResult=>({outcome:'UNKNOWN',provider_message_id:null,error_code:'GROUP_PUSH_RECONCILIATION_REQUIRED',retryable:false});
export function createWorkbenchGroupNotificationSender({pool,enabled=false,mvpPolicy=false,routes=[],fetchImpl=fetch,resolveMentionUserId=null,beforeSend=()=>{}}:WorkbenchGroupNotificationOptions){
  if(typeof enabled!=='boolean'||!Array.isArray(routes)||routes.length>32||typeof fetchImpl!=='function'||typeof beforeSend!=='function'
    ||resolveMentionUserId!==null&&typeof resolveMentionUserId!=='function')throw new TypeError('GROUP_PUSH_CONFIGURATION_INVALID');
  const endpoints=new Map<string,string>();
  for(const route of routes){
    let url:URL;try{url=new URL(route.url);}catch{throw new TypeError('GROUP_PUSH_CONFIGURATION_INVALID');}
    if(typeof route.botId!=='string'||!route.botId||route.botId.length>128||typeof route.groupId!=='string'||!route.groupId||route.groupId.length>512
      ||url.protocol!=='https:'||url.hostname!=='qyapi.weixin.qq.com'||url.port||url.username||url.password||url.hash
      ||url.pathname!=='/cgi-bin/webhook/send'||url.searchParams.size!==1||!url.searchParams.get('key')||url.href.length>2048)throw new TypeError('GROUP_PUSH_CONFIGURATION_INVALID');
    const key=JSON.stringify([route.botId,route.groupId]);if(endpoints.has(key))throw new TypeError('GROUP_PUSH_CONFIGURATION_INVALID');endpoints.set(key,url.href);
  }
  return createCommunicationSenderPort(async request=>{
    if(!enabled)return reject('GROUP_PUSH_DISABLED');
    if(request.provider!=='WECOM_AIBOT'||request.target_type!=='GROUP'||request.message.message_type!=='template_card')return reject('GROUP_PUSH_BINDING_INVALID');
    const endpoint=endpoints.get(JSON.stringify([request.channel_account_id,request.target_id]));if(!endpoint)return reject('GROUP_PUSH_ROUTE_MISSING');
    if(!resolveMentionUserId)return reject('GROUP_PUSH_MENTION_UNQUALIFIED');
    if(request.signal.aborted)return reject('GROUP_PUSH_ABORTED_BEFORE_SEND');
    const readBasis=()=>pool.query<Basis>(`SELECT c.source_intake_id::text,r.node,t.ticket_no,e.new_status,e.created_at,m.content,b.recipient_binding_hash
      FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id JOIN communication.message m ON m.id=o.message_id
      JOIN communication.ticket_notification_binding b ON b.delivery_id=d.id AND b.message_id=m.id AND b.outbox_id=o.id
      JOIN communication.ticket_round_notification_binding r ON r.notification_binding_id=b.id AND r.ticket_id=b.ticket_id AND r.destination_type=b.destination_type
      JOIN pilot_ticket.ticket_handling_cycle c ON c.id=r.cycle_id AND c.ticket_id=r.ticket_id
      JOIN pilot_ticket.ticket t ON t.id=c.ticket_id AND t.source_intake_id=c.source_intake_id
      JOIN pilot_ticket.ticket_handling_cycle_event ce ON ce.cycle_id=c.id AND ce.ticket_id=c.ticket_id AND ce.ticket_event_id=b.ticket_event_id
      JOIN pilot_ticket.ticket_event e ON e.event_id=b.ticket_event_id AND e.ticket_id=b.ticket_id AND e.operator_type='PILOT_USER'
      WHERE d.id=$1::uuid AND d.status='SENDING' AND d.provider=$2 AND d.channel_account_id=$3 AND d.target_type='GROUP' AND d.target_id=$4 AND d.idempotency_key=$5
        AND b.destination_type='GROUP' AND r.recipient_binding_hash=b.recipient_binding_hash
        AND m.sender_kind='SYSTEM' AND m.sender_system_code='TICKET_LIFECYCLE' AND m.purpose='SYSTEM_NOTIFICATION' AND m.visibility='EXTERNAL'
        AND m.message_type='template_card' AND o.route_policy='P2_016_ORIGIN_GROUP_ROUND' AND m.retention_until_epoch_ms>platform.physical_epoch_ms()
        AND ((r.node='FIRST_RESPONSIBILITY' AND e.event_id=c.first_responsibility_event_id AND b.notification_type='TICKET_ACCEPTED'
          AND ((e.event_type='ticket.accepted' AND e.new_status='ACCEPTED') OR (e.event_type='ticket.assignment_transferred' AND e.old_status='QUEUED' AND e.new_status='QUEUED'
            AND e.assignment_metadata->>'old_assignee_id' IS NULL AND lower(e.assignment_metadata->>'new_assignee_id')=c.first_responsibility_principal_id::text
            AND e.assignment_metadata->>'new_team_id'=c.first_responsibility_team_id)))
          OR (r.node='STAFF_COMPLETED' AND e.event_id=c.staff_completion_event_id AND b.notification_type='TICKET_CLOSED' AND e.event_type='ticket.closed'
            AND e.old_status='IN_PROGRESS' AND e.new_status='CLOSED' AND e.reason_code='STAFF_COMPLETED' AND EXISTS(
              SELECT 1 FROM pilot_ticket.staff_completion_notification_commitment p WHERE p.cycle_id=c.id AND p.ticket_id=c.ticket_id AND p.source_intake_id=c.source_intake_id AND p.ticket_event_id=e.event_id)))`,
      [request.delivery_id,request.provider,request.channel_account_id,request.target_id,request.idempotency_key]);
    const q=await readBasis(),row=q.rows[0];if(q.rowCount!==1||!row)return reject('GROUP_PUSH_BINDING_INVALID');
    if(mvpPolicy&&row.node!=='STAFF_COMPLETED')return reject('GROUP_PUSH_NODE_SUPPRESSED');
    const source=await readOriginalBotSource(pool,row.source_intake_id,request.channel_account_id);
    if(!source||source.group_id!==request.target_id||row.recipient_binding_hash!==textHashP2016(JSON.stringify(['WECOM_AIBOT',source.bot_id,source.group_id,source.reporter_user_id])))return reject('GROUP_PUSH_BINDING_INVALID');
    const model={transport:'WECOM_MESSAGE_PUSH',node:row.node,suffix:row.ticket_no.slice(-4),status:row.new_status,occurred_at:localP2016(row.created_at)};
    if(!/^[0-9]{4}$/u.test(model.suffix)||!isDeepStrictEqual(row.content,model)||!isDeepStrictEqual(row.content,request.message.content))return reject('GROUP_PUSH_BINDING_INVALID');
    let mention:unknown;
    try{mention=await resolveMentionUserId({botId:source.bot_id,groupId:source.group_id,reporterUserId:source.reporter_user_id});await beforeSend();}
    catch{return reject('GROUP_PUSH_NOT_AUTHORIZED');}
    if(typeof mention!=='string'||!mention||mention==='@all'||mention.length>256)return reject('GROUP_PUSH_MENTION_UNQUALIFIED');
    // Authorization may await external qualification or a caller fence. Re-read
    // the current sending commitment and retained original source afterwards.
    const current=await readBasis();
    if(current.rowCount!==1||!isDeepStrictEqual(current.rows[0],row))return reject('GROUP_PUSH_BINDING_INVALID');
    const currentSource=await readOriginalBotSource(pool,row.source_intake_id,request.channel_account_id);
    if(!currentSource||!isDeepStrictEqual(currentSource,source))return reject('GROUP_PUSH_BINDING_INVALID');
    if(request.signal.aborted||BigInt(currentSource.retention_epoch)<=BigInt(Date.now()))return reject('GROUP_PUSH_ABORTED_BEFORE_SEND');
    const text=mvpPolicy?'工单#'+row.ticket_no+'小修已完成，麻烦您验收一下，有问题随时@医小修～':'工单尾号 '+model.suffix+(row.node==='FIRST_RESPONSIBILITY'?' 已有人员处理。':' 处理完成。');
    try{
      const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},signal:AbortSignal.any([request.signal,AbortSignal.timeout(5000)]),body:JSON.stringify({msgtype:'text',text:{content:text,mentioned_list:[mention]}})});
      const reader=response.body?.getReader();if(!reader)return unknown();const chunks:Uint8Array[]=[];let bytes=0;
      for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>8192){await reader.cancel();return unknown();}chunks.push(part.value);}
      const reply:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      // Nonzero provider codes have no currently verified no-side-effect guarantee.
      if(response.ok&&reply!==null&&typeof reply==='object'&&!Array.isArray(reply)&&Object.getOwnPropertyDescriptor(reply,'errcode')?.value===0)return {outcome:'ACKNOWLEDGED',provider_message_id:null,error_code:null,retryable:false};
      return unknown();
    }catch{return unknown();}
  });
}
