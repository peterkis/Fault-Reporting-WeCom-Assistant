import { AsyncLocalStorage } from 'node:async_hooks';
import { openSync, closeSync, writeSync, fsyncSync, lstatSync, readFileSync } from 'node:fs';
import { g2Hash, validateG2Manifest, failG2 } from './p2-g2-validation-config.mjs';

const context=new AsyncLocalStorage();
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const outcome=code=>code===0?'ACKED':code===null?'UNKNOWN':'REJECTED';
export function withG2ProviderReceipt(binding,send){return context.run(binding,send);}
function validateRecord(r){
  const keys=['transport','delivery_ref_hash','outbox_id','attempt_no','physical_epoch_ms','provider_errcode','outcome'];
  if(!r||Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k))
    ||r.transport!=='WECOM_AIBOT_WSS'||!/^[a-f0-9]{64}$/u.test(r.delivery_ref_hash)||!uuid.test(r.outbox_id)
    ||!Number.isSafeInteger(r.attempt_no)||r.attempt_no<1||!/^\d{13}$/u.test(r.physical_epoch_ms)
    ||r.provider_errcode!==null&&!Number.isSafeInteger(r.provider_errcode)||r.outcome!==outcome(r.provider_errcode))failG2('PROVIDER_RECEIPT_INVALID');
}
// The single Gateway owns this append-only journal. Neither target values nor
// message bodies, request IDs, exception text or credentials enter it.
export function readG2ProviderReceipts({file,manifest}){
  const binding=g2Hash(JSON.stringify(validateG2Manifest(manifest)));
  try{
    const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024)failG2('PROVIDER_RECEIPT_CORRUPT');
    const text=readFileSync(file,'utf8');if(text&&!text.endsWith('\n'))failG2('PROVIDER_RECEIPT_CORRUPT');
    let previous=null;
    return text.trimEnd().split('\n').filter(Boolean).map(line=>{
      const row=JSON.parse(line);validateRecord(row.record);
      if(Object.keys(row).length!==4||row.binding!==binding||row.previous!==previous
        ||row.hash!==g2Hash(JSON.stringify({binding:row.binding,previous:row.previous,record:row.record})))failG2('PROVIDER_RECEIPT_CORRUPT');
      previous=row.hash;return row;
    });
  }catch(error){if(error.code==='ENOENT')return [];failG2('PROVIDER_RECEIPT_CORRUPT');}
}
export async function captureG2ProviderReceipt({file,manifest,send}){
  const c=context.getStore();
  if(!c||!uuid.test(c.delivery_id)||!uuid.test(c.outbox_id)||!Number.isSafeInteger(c.attempt_no)||c.attempt_no<1)failG2('PROVIDER_RECEIPT_CONTEXT_REQUIRED');
  readG2ProviderReceipts({file,manifest});
  let receipt,error,threw=false;
  try{receipt=await send();}catch(e){error=e;threw=true;}
  const raw=threw?error?.errcode:receipt?.errcode??receipt?.body?.errcode;
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
  return receipt;
}
