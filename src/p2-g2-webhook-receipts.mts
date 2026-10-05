export interface WebhookReceipt {event:'p2_016_group_closure_webhook_result';operation:'send_msg';transport:'WECOM_GROUP_WEBHOOK';
 delivery_ref_hash:string;outbox_id:string;attempt_no:number;provider_errcode:number|null;internal_error_code:string|null;
 outcome:'ACKED'|'REJECTED'|'UNKNOWN';retry_class:'NONE'|'MANUAL_REVIEW'}
export type StoredWebhookReceipt = Pick<WebhookReceipt,'transport'|'delivery_ref_hash'|'outbox_id'|'attempt_no'|'provider_errcode'|'outcome'> & {physical_epoch_ms:string};
export interface WebhookReceiptRow {binding:string;previous:string|null;record:StoredWebhookReceipt;hash:string}
type RecordInput = Partial<Record<keyof WebhookReceipt|'physical_epoch_ms',unknown>>;
type RowInput = {binding?:unknown;previous?:unknown;record?:RecordInput;hash?:unknown};
import { openSync,closeSync,writeSync,fsyncSync,lstatSync,readFileSync } from 'node:fs';
import { g2Hash,validateG2Manifest,failG2 } from './p2-g2-validation-config.mjs';

// One Gateway owns appends. The file lives beside the private send-budget
// journal and is preserved across role restart and controller shutdown.
export function appendG2WebhookReceipt({file,manifest,record}: {file:string;manifest:unknown;record:unknown}){
  const binding=g2Hash(JSON.stringify(validateG2Manifest(manifest)));
  const keys=['event','operation','transport','delivery_ref_hash','outbox_id','attempt_no','provider_errcode','internal_error_code','outcome','retry_class'];
  if(!record||Object.keys(record).length!==keys.length||keys.some(k=>!Object.hasOwn(record,k))
    ||(record as RecordInput).event!=='p2_016_group_closure_webhook_result'||(record as RecordInput).operation!=='send_msg'||(record as RecordInput).transport!=='WECOM_GROUP_WEBHOOK'
    ||!/^[a-f0-9]{64}$/u.test((record as RecordInput).delivery_ref_hash as string)||!/^[a-f0-9-]{36}$/u.test((record as RecordInput).outbox_id as string)
    ||!Number.isInteger((record as RecordInput).attempt_no)||((record as RecordInput).attempt_no as number)<1
    ||(record as RecordInput).provider_errcode!==null&&!Number.isSafeInteger((record as RecordInput).provider_errcode)
    ||(record as RecordInput).internal_error_code!==null&&!/^WECOM_[A-Z_]+$/u.test((record as RecordInput).internal_error_code as string)
    ||!['ACKED','REJECTED','UNKNOWN'].includes((record as RecordInput).outcome as string)||!['NONE','MANUAL_REVIEW'].includes((record as RecordInput).retry_class as string))failG2('WEBHOOK_RECEIPT_INVALID');
  let previous:unknown=null;
  try{
    const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024)failG2('WEBHOOK_RECEIPT_CORRUPT');
    const text=readFileSync(file,'utf8');if(text&&!text.endsWith('\n'))failG2('WEBHOOK_RECEIPT_CORRUPT');
    for(const line of text.trimEnd().split('\n').filter(Boolean)){
      const row:RowInput=JSON.parse(line);
      if(row.binding!==binding||row.previous!==previous||row.hash!==g2Hash(JSON.stringify({binding:row.binding,previous:row.previous,record:row.record})))failG2('WEBHOOK_RECEIPT_CORRUPT');
      previous=row.hash;
    }
  }catch(error){if((error as {code?:string}).code!=='ENOENT')failG2('WEBHOOK_RECEIPT_CORRUPT');}
  const payload={binding,previous,record:{...(record as RecordInput),physical_epoch_ms:String(Date.now())}},row={...payload,hash:g2Hash(JSON.stringify(payload))};
  const fd=openSync(file,'a',0o600);
  try{const bytes=Buffer.from(JSON.stringify(row)+'\n');let offset=0;
    while(offset<bytes.length)offset+=writeSync(fd,bytes,offset,bytes.length-offset);fsyncSync(fd);}
  finally{closeSync(fd);}
}

export function readG2WebhookReceipts({file,manifest}: {file:string;manifest:unknown}): WebhookReceiptRow[]{
  const binding=g2Hash(JSON.stringify(validateG2Manifest(manifest)));
  const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024)failG2('WEBHOOK_RECEIPT_CORRUPT');
  const text=readFileSync(file,'utf8');if(!text.endsWith('\n'))failG2('WEBHOOK_RECEIPT_CORRUPT');
  let previous:unknown=null;
  return text.trimEnd().split('\n').filter(Boolean).map(line=>{
    const row:RowInput=JSON.parse(line),r=row.record;
    if(row.binding!==binding||row.previous!==previous||row.hash!==g2Hash(JSON.stringify({binding:row.binding,previous:row.previous,record:r}))
      ||r?.transport!=='WECOM_GROUP_WEBHOOK'||!/^\d{13}$/u.test((r.physical_epoch_ms??'') as string)
      ||!/^[a-f0-9]{64}$/u.test((r.delivery_ref_hash??'') as string)||!/^[a-f0-9-]{36}$/u.test((r.outbox_id??'') as string)
      ||!Number.isSafeInteger(r.attempt_no)||(r.attempt_no as number)<1
      ||r.provider_errcode!==null&&!Number.isSafeInteger(r.provider_errcode)
      ||!['ACKED','REJECTED','UNKNOWN'].includes(r.outcome as string)
      ||r.outcome==='ACKED'&&r.provider_errcode!==0)failG2('WEBHOOK_RECEIPT_CORRUPT');
    previous=row.hash;return row as WebhookReceiptRow;
  });
}
