import {ApiError} from '../../api/client';
import type {AttachmentPage,AttachmentMetadata,AttachmentReason} from '../../../../../contracts/workbench_attachment_contracts';
const MAX=10*1024*1024;
const reasons:readonly string[]=['STORAGE_UNAVAILABLE','EXPIRED','MISSING','OVERSIZED','UNSUPPORTED','UNTRUSTED','INTEGRITY_FAILED','BUSY'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function invalid():never {throw new ApiError(502,'INVALID_RESPONSE');}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))invalid();return value as Record<string,unknown>;}
async function bytes(response:Response,max:number,signal:AbortSignal):Promise<Uint8Array<ArrayBuffer>> {
  if(!response.body)invalid();const reader=response.body.getReader(),parts:Uint8Array[]=[],declared=response.headers.get('content-length');let size=0;
  if(declared!==null&&(!/^[1-9][0-9]*$/u.test(declared)||Number(declared)>max)){await reader.cancel();reader.releaseLock();invalid();}
  try{for(;;){signal.throwIfAborted();const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>max)invalid();parts.push(chunk.value);}
    if(declared!==null&&size!==Number(declared))invalid();const result=new Uint8Array(size);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function value(response:Response,signal:AbortSignal):Promise<unknown>{
  if(!response.headers.get('content-type')?.startsWith('application/json'))invalid();
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(response,32*1024,signal))) as unknown;}catch(error){if(error instanceof ApiError)throw error;invalid();}
}
async function reject(response:Response,signal:AbortSignal):Promise<never>{
  let code='AUTHORIZATION_REJECTED';try{const candidate=object(object(await value(response,signal)).error).code;if(typeof candidate==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/u.test(candidate))code=candidate;}catch{/* Credible HTTP denial still fences authority. */}
  throw new ApiError(response.status,code);
}
function metadata(value:unknown):AttachmentMetadata {
  const v=object(value);if(typeof v.ref!=='string'||!uuid.test(v.ref)||typeof v.mime_type!=='string'||v.mime_type.length>64||typeof v.byte_size!=='number'||!Number.isSafeInteger(v.byte_size)||v.byte_size<=0||typeof v.available!=='boolean')invalid();
  const reason=v.reason;if(reason!==null&&(typeof reason!=='string'||!reasons.includes(reason)))invalid();
  const name=v.mime_type==='image/png'?'报修附件.png':v.mime_type==='image/jpeg'?'报修附件.jpg':'报修附件';
  if(v.display_name!==name||v.available!==(reason===null)||(v.available&&(!['image/png','image/jpeg'].includes(v.mime_type)||v.byte_size>MAX)))invalid();
  return {ref:v.ref,display_name:name,mime_type:v.mime_type,byte_size:v.byte_size,available:v.available,reason:reason as AttachmentReason|null};
}
export function attachmentParentDenied(error:unknown):error is ApiError{return error instanceof ApiError&&[403,404].includes(error.status)&&!error.code.startsWith('ATTACHMENT_');}
export const attachmentApi={
  async list(kind:string,id:string,signal:AbortSignal):Promise<AttachmentPage>{
    const response=await fetch('/api/workbench/items/'+encodeURIComponent(kind)+'/'+encodeURIComponent(id)+'/attachments',{signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:'application/json'}});
    if(!response.ok)return reject(response,signal);const v=object(await value(response,signal));
    if(typeof v.available!=='boolean'||typeof v.truncated!=='boolean'||!Array.isArray(v.items)||v.items.length>20||v.reason!==null&&v.reason!=='STORAGE_UNAVAILABLE')invalid();
    const items=v.items.map(metadata);if(new Set(items.map(item=>item.ref)).size!==items.length||(!v.available&&(v.reason!=='STORAGE_UNAVAILABLE'||items.length||v.truncated))||(v.available&&v.reason!==null))invalid();
    return {available:v.available,reason:v.reason,items,truncated:v.truncated};
  },
  async download(kind:string,id:string,item:AttachmentMetadata,signal:AbortSignal,employeeRead=false):Promise<Blob>{
    if(!item.available||item.byte_size>MAX)invalid();
    const response=await fetch(employeeRead?'/api/workbench/media/attachment/'+encodeURIComponent(item.ref):'/api/attachments/'+encodeURIComponent(item.ref)+'?'+new URLSearchParams({kind,id}),{signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:item.mime_type}});
    if(!response.ok)return reject(response,signal);
    const extension=item.mime_type==='image/png'?'png':'jpg';
    if(response.headers.get('content-type')!==item.mime_type||response.headers.get('content-length')!==String(item.byte_size)||response.headers.get('content-disposition')!=='attachment; filename="report-attachment.'+extension+'"'||response.headers.get('x-content-type-options')!=='nosniff'||response.headers.get('cache-control')!=='no-store'){await response.body?.cancel();invalid();}
    const content=await bytes(response,MAX,signal);if(content.length!==item.byte_size)invalid();return new Blob([content],{type:item.mime_type});
  },
};
