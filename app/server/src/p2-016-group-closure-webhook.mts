import type { PostgresTransaction } from './platform/postgres-pool.mjs';
import type { CommunicationSenderResult } from './p2-004-communication-sender-port.mjs';
type SenderObservation = Omit<CommunicationSenderResult, 'provider_message_id'> & { provider_message_id?: string | null };
export interface WebhookProviderRecord { event: string; operation: string; transport: string; delivery_ref_hash: string; outbox_id: string; attempt_no: number; provider_errcode: number | null; internal_error_code: string | null; outcome: 'ACKED' | 'UNKNOWN' | 'REJECTED'; retry_class: 'MANUAL_REVIEW' | 'NONE' }
interface WebhookOptions { pool: PostgresTransaction; routes?: readonly { botId: string; groupId: string; url: string }[]; fetchImpl?: typeof fetch; beforeSend?: () => unknown | Promise<unknown>; recordProviderResult?: (record: Readonly<WebhookProviderRecord>) => unknown | Promise<unknown> }
interface WebhookBinding { content: Record<string, unknown>; reporter_wecom_userid: string; outbox_id: string; attempt_count: number; group_id: string; source_bot_id: string }

import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { createCommunicationSenderPort } from './p2-004-communication-sender-port.mjs';

const reject: (code: string,retryable?: boolean) => SenderObservation=(code,retryable=false)=>({outcome:'REJECTED_NOT_APPLIED',error_code:code,retryable});
const unknown: () => SenderObservation=()=>({outcome:'UNKNOWN',error_code:'P2_016_WEBHOOK_RECONCILIATION_REQUIRED',retryable:false});

// The logical enterprise account/group remains the Delivery destination. Only
// this fixed closure template uses the separately configured webhook transport.
export function createP2016GroupClosureWebhookSender({pool,routes=[],fetchImpl=fetch,beforeSend=()=>{},
  recordProviderResult=record=>process.stdout.write(JSON.stringify(record)+'\n')}: WebhookOptions={} as WebhookOptions){
  if(!Array.isArray(routes)||routes.length>32||typeof fetchImpl!=='function'||typeof beforeSend!=='function'||typeof recordProviderResult!=='function')throw new TypeError('P2_016_WEBHOOK_CONFIG_INVALID');
  const endpoints=new Map<string, string>();
  for(const route of routes){
    let url;try{url=new URL(route.url);}catch{throw new TypeError('P2_016_WEBHOOK_CONFIG_INVALID');}
    if(typeof route.botId!=='string'||!route.botId||typeof route.groupId!=='string'||!route.groupId
      ||url.protocol!=='https:'||url.hostname!=='qyapi.weixin.qq.com'||url.port||url.username||url.password||url.hash
      ||url.pathname!=='/cgi-bin/webhook/send'||url.searchParams.size!==1||!url.searchParams.get('key'))throw new TypeError('P2_016_WEBHOOK_CONFIG_INVALID');
    const key=JSON.stringify([route.botId,route.groupId]);
    if(endpoints.has(key))throw new TypeError('P2_016_WEBHOOK_CONFIG_INVALID');
    endpoints.set(key,url.href);
  }
  return createCommunicationSenderPort(async request=>{
    if(request.provider!=='WECOM_AIBOT'||request.target_type!=='GROUP'||request.message.message_type!=='text'
      ||(request.message.content as { transport?: unknown }).transport!=='WECOM_GROUP_WEBHOOK')return reject('P2_016_WEBHOOK_BINDING_INVALID');
    const endpoint=endpoints.get(JSON.stringify([request.channel_account_id,request.target_id]));
    if(!endpoint)return reject('P2_016_WEBHOOK_ROUTE_MISSING');
    if(request.signal.aborted)return reject('P2_016_WEBHOOK_ABORTED',true);
    const result=await pool.query<WebhookBinding>(`SELECT m.content,i.reporter_wecom_userid,o.id::text AS outbox_id,d.attempt_count,
      CASE WHEN origin.source_chat_type='group' THEN origin.source_chat_id ELSE i.source_chat_id END AS group_id,
      i.source_bot_id FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id
      JOIN communication.message m ON m.id=o.message_id
      JOIN communication.ticket_notification_binding b ON b.delivery_id=d.id AND b.message_id=m.id
      JOIN pilot_ticket.ticket_event e ON e.event_id=b.ticket_event_id AND e.ticket_id=b.ticket_id
      JOIN pilot_ticket.ticket t ON t.id=e.ticket_id JOIN intake.service_intake i ON i.id=t.source_intake_id
      LEFT JOIN intake.channel_leg leg ON leg.source_intake_id=i.id
      LEFT JOIN intake.contact_journey j ON j.id=leg.journey_id
      LEFT JOIN intake.service_intake origin ON origin.id=j.origin_intake_id
        AND origin.source_bot_id=i.source_bot_id AND origin.reporter_wecom_userid=i.reporter_wecom_userid
      WHERE d.id=$1::uuid AND d.status='SENDING' AND d.provider=$2 AND d.channel_account_id=$3
        AND d.target_type='GROUP' AND d.target_id=$4 AND d.idempotency_key=$5
        AND b.notification_type='TICKET_CLOSED' AND b.destination_type='GROUP'
        AND e.event_type='ticket.closed' AND e.new_status='CLOSED'
        AND m.sender_kind='SYSTEM' AND m.sender_system_code='TICKET_LIFECYCLE'
        AND m.purpose='SYSTEM_NOTIFICATION' AND m.visibility='EXTERNAL'
        AND o.route_policy='P2_016_GROUP_CLOSURE_WEBHOOK'
        AND m.retention_until_epoch_ms>platform.physical_epoch_ms()`,
    [request.delivery_id,request.provider,request.channel_account_id,request.target_id,request.idempotency_key]);
    const row=result.rows[0] as WebhookBinding;
    if(result.rowCount!==1||row.source_bot_id!==request.channel_account_id||row.group_id!==request.target_id
      ||!isDeepStrictEqual(row.content,request.message.content)||typeof row.reporter_wecom_userid!=='string'
      ||!row.reporter_wecom_userid||row.reporter_wecom_userid==='@all'||row.reporter_wecom_userid.length>256
      ||typeof row.content.text!=='string'||Buffer.byteLength(row.content.text,'utf8')>2048)return reject('P2_016_WEBHOOK_BINDING_INVALID');
    // Count persisted attempts, including failed ones and the current attempt,
    // so process restarts cannot reset the conservative per-group minute limit.
    const rate=await pool.query<{ n: number }>(`SELECT count(*)::integer AS n FROM communication.delivery_attempt a
      JOIN communication.delivery d ON d.id=a.delivery_id JOIN communication.outbox o ON o.id=d.outbox_id
      WHERE d.channel_account_id=$1 AND d.target_type='GROUP' AND d.target_id=$2
        AND o.route_policy='P2_016_GROUP_CLOSURE_WEBHOOK'
        AND a.started_epoch_ms>platform.physical_epoch_ms()-60000`,[request.channel_account_id,request.target_id]);
    if((rate.rows[0] as { n: number }).n>20)return reject('P2_016_WEBHOOK_RATE_LIMIT',true);
    if(request.signal.aborted)return reject('P2_016_WEBHOOK_ABORTED',true);
    try{await beforeSend();}catch{return reject('P2_016_WEBHOOK_SEND_NOT_AUTHORIZED');}
    if(request.signal.aborted)return reject('P2_016_WEBHOOK_ABORTED',true);
    const observed=async(result: SenderObservation,providerErrcode: number | null=null)=>{
      try{await recordProviderResult(Object.freeze({event:'p2_016_group_closure_webhook_result',operation:'send_msg',
        transport:'WECOM_GROUP_WEBHOOK',delivery_ref_hash:createHash('sha256').update(request.delivery_id).digest('hex'),
        outbox_id:row.outbox_id,attempt_no:row.attempt_count,
        provider_errcode:providerErrcode,internal_error_code:result.error_code?.replace('P2_016_','WECOM_')??null,
        outcome:result.outcome==='ACKNOWLEDGED'?'ACKED':result.outcome==='UNKNOWN'?'UNKNOWN':'REJECTED',
        retry_class:result.outcome==='UNKNOWN'?'MANUAL_REVIEW':'NONE'}));}
      catch{return unknown();}
      return result;
    };
    try{
      const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},
        signal:AbortSignal.any([request.signal,AbortSignal.timeout(5000)]),
        body:JSON.stringify({msgtype:'text',text:{content:row.content.text,mentioned_list:[row.reporter_wecom_userid]}})});
      const reader=response.body?.getReader();if(!reader)return observed(unknown());
      const chunks: Uint8Array[]=[];let bytes=0;
      for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;
        if(bytes>8192){await reader.cancel();return observed(unknown());}chunks.push(part.value);}
      const reply=JSON.parse(Buffer.concat(chunks).toString('utf8')) as { errcode?: unknown };
      const providerErrcode=Number.isSafeInteger(reply.errcode)?reply.errcode as number:null;
      if(!response.ok)return observed(unknown(),providerErrcode);
      if(providerErrcode===0)return observed({outcome:'ACKNOWLEDGED',provider_message_id:null,error_code:null,retryable:false},providerErrcode);
      return observed(providerErrcode!==null?reject('P2_016_WEBHOOK_PROVIDER_REJECTED'):unknown(),providerErrcode);
    }catch{return observed(unknown());}
  });
}
