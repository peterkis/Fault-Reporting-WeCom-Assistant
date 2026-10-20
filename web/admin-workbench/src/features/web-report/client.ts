import {ApiError,UnknownCommandOutcome,captureWorkbenchRead,readWorkbench} from '../../api/client';
import {decodeWebReport,decodeMemberProgressResult,decodeMemberProgressReceipt} from '../../../../../src/workbench-web-report-browser-contracts.mjs';
import type {WorkbenchWebMedia,WorkbenchMemberProgressInput} from '../../../../../contracts/workbench_web_report_contracts';
export class MemberProgressRejected extends ApiError {}
const prefix=(kind:string,id:string)=>'/api/workbench/items/'+encodeURIComponent(kind)+'/'+encodeURIComponent(id)+'/web-report';
function decoded<T>(run:()=>T):T{try{return run();}catch{throw new ApiError(502,'INVALID_RESPONSE');}}
async function rejection(response:Response):Promise<never>{let code='AUTHORIZATION_REJECTED';try{const raw:unknown=await response.json();if(raw&&typeof raw==='object'&&!Array.isArray(raw)){const error=Reflect.get(raw,'error');if(error&&typeof error==='object'&&!Array.isArray(error)){const value=Reflect.get(error,'code');if(typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/u.test(value))code=value;}}}catch{/* A credible HTTP denial still rejects the protected read. */}throw new ApiError(response.status,code);}
export const webReportApi={
 view:(kind:string,id:string,signal:AbortSignal)=>readWorkbench(prefix(kind,id),signal,raw=>decoded(()=>decodeWebReport(raw,{kind,id}))),
 receipt:(ticketId:string,commandId:string,signal:AbortSignal)=>readWorkbench('/api/tickets/'+encodeURIComponent(ticketId)+'/member-progress/commands/'+encodeURIComponent(commandId),signal,raw=>decoded(()=>decodeMemberProgressReceipt(raw,{ticketId,commandId}))),
 async publish(ticketId:string,input:WorkbenchMemberProgressInput,csrf:string|null,signal:AbortSignal){
  const current=captureWorkbenchRead(signal);const response=await fetch('/api/tickets/'+encodeURIComponent(ticketId)+'/member-progress',{method:'POST',signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':input.client_command_id,'if-match':'"'+input.expected_version+'"',...(csrf?{'x-csrf-token':csrf}:{})},body:JSON.stringify(input)});current();
  let raw:unknown;try{raw=await response.json();}catch{throw new UnknownCommandOutcome();}current();
  if(!response.ok){
   if([400,409,422].includes(response.status)&&raw&&typeof raw==='object'&&!Array.isArray(raw)){const error=Reflect.get(raw,'error');if(error&&typeof error==='object'&&!Array.isArray(error)){const code=Reflect.get(error,'code');if(typeof code==='string'&&['YXX_INPUT_INVALID','YXX_VERSION_CONFLICT','YXX_COMMAND_CONFLICT','P2_016_INPUT_INVALID','P2_016_VERSION_CONFLICT'].includes(code)&&Reflect.get(error,'retryable')===false)throw new MemberProgressRejected(response.status,code);}}
   if([401,403,404].includes(response.status))throw new ApiError(response.status,'AUTHORIZATION_REJECTED');throw new UnknownCommandOutcome();
  }
  try{return decodeMemberProgressResult(raw,{ticketId,commandId:input.client_command_id,input});}catch{throw new UnknownCommandOutcome();}
 },
 async media(kind:string,id:string,item:WorkbenchWebMedia,variant:'PLAYABLE'|'ORIGINAL',signal:AbortSignal):Promise<Blob>{
  const current=captureWorkbenchRead(signal),mime=variant==='ORIGINAL'?item.mime_type:item.playback_mime_type;if(!mime||variant==='PLAYABLE'&&item.playback_status!=='READY')throw new ApiError(503,'YXX_MEDIA_UNAVAILABLE');
  const response=await fetch(prefix(kind,id)+'/media/'+encodeURIComponent(item.media_ref)+'?'+new URLSearchParams({variant}),{signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:mime}});current();if(!response.ok)return rejection(response);
  const declared=response.headers.get('content-length'),type=response.headers.get('content-type');
  if(type!==mime||declared===null||!/^[1-9][0-9]*$/u.test(declared)||Number(declared)>20*1024*1024||response.headers.get('cache-control')!=='no-store'||response.headers.get('x-content-type-options')!=='nosniff'||!response.body){await response.body?.cancel();throw new ApiError(502,'INVALID_RESPONSE');}
  const reader=response.body.getReader(),parts:Uint8Array[]=[],max=Number(declared);let size=0;
  try{for(;;){current();const chunk=await reader.read();current();if(chunk.done)break;size+=chunk.value.byteLength;if(size>max)throw new ApiError(502,'INVALID_RESPONSE');parts.push(chunk.value);}if(size!==max||variant==='ORIGINAL'&&size!==item.byte_size)throw new ApiError(502,'INVALID_RESPONSE');const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}return new Blob([bytes],{type:mime});}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 },
};
