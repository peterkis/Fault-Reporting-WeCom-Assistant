import type { BinaryLike } from 'node:crypto';
export interface ProviderReceiptBinding {delivery_id:string;outbox_id:string;attempt_no:number}
export type ProviderReceipt = {transport:'WECOM_AIBOT_WSS';delivery_ref_hash:string;outbox_id:string;attempt_no:number;physical_epoch_ms:string} &
 ({provider_errcode:0;outcome:'ACKED'}|{provider_errcode:null;outcome:'UNKNOWN'}|{provider_errcode:number;outcome:'REJECTED'});
export interface ProviderReceiptRow {binding:string;previous:string|null;record:ProviderReceipt;hash:string}
type RowInput = {binding?:unknown;previous?:unknown;record?:unknown;hash?:unknown};
type ProviderInput = {errcode?:unknown;body?:{errcode?:unknown}};
import { AsyncLocalStorage } from 'node:async_hooks';
import { openSync, closeSync, writeSync, fsyncSync, lstatSync, readFileSync } from 'node:fs';
import { g2Hash, validateG2Manifest, failG2 } from './p2-g2-validation-config.mjs';

const context=new AsyncLocalStorage<ProviderReceiptBinding>();
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const outcome=(code: unknown)=>code===0?'ACKED':code===null?'UNKNOWN':'REJECTED';
export function withG2ProviderReceipt<T>(binding: ProviderReceiptBinding,send: ()=>T): T{return context.run(binding,send);}
function validateRecord(r: unknown): asserts r is ProviderReceipt{
  const keys=['transport','delivery_ref_hash','outbox_id','attempt_no','physical_epoch_ms','provider_errcode','outcome'];
  if(!r||Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k))
    ||(r as Partial<Record<keyof ProviderReceipt,unknown>>).transport!=='WECOM_AIBOT_WSS'||!/^[a-f0-9]{64}$/u.test((r as Partial<Record<keyof ProviderReceipt,unknown>>).delivery_ref_hash as string)||!uuid.test((r as Partial<Record<keyof ProviderReceipt,unknown>>).outbox_id as string)
    ||!Number.isSafeInteger((r as Partial<Record<keyof ProviderReceipt,unknown>>).attempt_no)||((r as Partial<Record<keyof ProviderReceipt,unknown>>).attempt_no as number)<1||!/^\d{13}$/u.test((r as Partial<Record<keyof ProviderReceipt,unknown>>).physical_epoch_ms as string)
    ||(r as Partial<Record<keyof ProviderReceipt,unknown>>).provider_errcode!==null&&!Number.isSafeInteger((r as Partial<Record<keyof ProviderReceipt,unknown>>).provider_errcode)||(r as Partial<Record<keyof ProviderReceipt,unknown>>).outcome!==outcome((r as Partial<Record<keyof ProviderReceipt,unknown>>).provider_errcode))failG2('PROVIDER_RECEIPT_INVALID');
}
// The single Gateway owns this append-only journal. Neither target values nor
// message bodies, request IDs, exception text or credentials enter it.
export function readG2ProviderReceipts({file,manifest}: {file:string;manifest:unknown}): ProviderReceiptRow[]{
  const binding=g2Hash(JSON.stringify(validateG2Manifest(manifest)));
  try{
    const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024)failG2('PROVIDER_RECEIPT_CORRUPT');
    const text=readFileSync(file,'utf8');if(text&&!text.endsWith('\n'))failG2('PROVIDER_RECEIPT_CORRUPT');
    let previous:unknown=null;
    return text.trimEnd().split('\n').filter(Boolean).map(line=>{
      const row:RowInput=JSON.parse(line);validateRecord(row.record);
      if(Object.keys(row).length!==4||row.binding!==binding||row.previous!==previous
        ||row.hash!==g2Hash(JSON.stringify({binding:row.binding,previous:row.previous,record:row.record})))failG2('PROVIDER_RECEIPT_CORRUPT');
      previous=row.hash;return row as ProviderReceiptRow;
    });
  }catch(error){if((error as {code?:string}).code==='ENOENT')return [];failG2('PROVIDER_RECEIPT_CORRUPT');}
}
export async function captureG2ProviderReceipt<T>({file,manifest,send}: {file:string;manifest:unknown;send:()=>T|Promise<T>}): Promise<T>{
  const c=context.getStore();
  if(!c||!uuid.test(c.delivery_id)||!uuid.test(c.outbox_id)||!Number.isSafeInteger(c.attempt_no)||c.attempt_no<1)failG2('PROVIDER_RECEIPT_CONTEXT_REQUIRED');
  readG2ProviderReceipts({file,manifest});
  let receipt:T|undefined,error:unknown,threw=false;
  try{receipt=await send();}catch(e){error=e;threw=true;}
  const raw=threw?(error as ProviderInput | null)?.errcode:(receipt as ProviderInput | undefined)?.errcode??(receipt as ProviderInput | undefined)?.body?.errcode;
  // An exception with errcode 0 is not a successful Provider receipt.
  const code=Number.isSafeInteger(raw)&&(!threw||raw!==0)?raw:null;
  const record={transport:'WECOM_AIBOT_WSS',delivery_ref_hash:g2Hash(c.delivery_id),outbox_id:c.outbox_id,
    attempt_no:c.attempt_no,physical_epoch_ms:String(Date.now()),provider_errcode:code,outcome:outcome(code)};
  validateRecord(record);
  const rows=readG2ProviderReceipts({file,manifest});
  const payload={binding:g2Hash(JSON.stringify(validateG2Manifest(manifest))),previous:rows.at(-1)?.hash??null,record};
  const bytes=Buffer.from(JSON.stringify({...payload,hash:g2Hash(JSON.stringify(payload))})+'\n');
  const fd=openSync(file,'a',0o600);
  try{let offset=0;while(offset<bytes.length)offset+=writeSync(fd,bytes,offset,bytes.length-offset);fsyncSync(fd);}
  finally{closeSync(fd);}
  if(threw)throw error;
  return receipt as T;
}
