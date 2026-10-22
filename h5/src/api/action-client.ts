import {acceptedReceipt} from '../lib/command';
import {actionDecoders} from './action-decode';
import {InvalidResponse,record,type Decoder} from './guards';
import {ApiError,V2_ACCEPT,assertAuthGeneration,jsonHeaders,loadActionModule,reportAuthLost,request} from './transport';
import type {UploadReceipt} from './types';

export interface ActionPayload {readonly id:string;readonly body:string;readonly version:number|undefined}
const post=<T>(generation:number,path:string,input:ActionPayload,csrf:string,decode:Decoder<T>,signal?:AbortSignal)=>request(path,decode,{method:'POST',headers:{...jsonHeaders(csrf,input.id),...(input.version===undefined?{}:{'if-match':'"'+input.version+'"'})},body:input.body,signal:signal??null},generation);
/** Imported only by a user action or explicit command recovery, never by a read. */
export const actions={
 submit:async(input:ActionPayload,csrf:string,generation:number)=>{const result=await post(generation,'/requests',input,csrf,actionDecoders.receipt);if(!acceptedReceipt(result,input.id))throw new ApiError(502,'INVALID_RECEIPT');return result;},
 supplement:async(ref:string,input:ActionPayload,csrf:string,generation:number)=>{const result=await post(generation,'/requests/'+encodeURIComponent(ref)+'/supplements',input,csrf,actionDecoders.receipt);if(!acceptedReceipt(result,input.id))throw new ApiError(502,'INVALID_RECEIPT');return result;},
 feedback:(ref:string,input:ActionPayload,csrf:string,generation:number)=>post(generation,'/requests/'+encodeURIComponent(ref)+'/feedback',input,csrf,actionDecoders.feedback),
 command:(id:string,generation:number)=>request('/commands/'+encodeURIComponent(id),actionDecoders.command,{},generation),
 feedbackCommand:(ref:string,id:string,generation:number)=>request('/requests/'+encodeURIComponent(ref)+'/feedback/commands/'+encodeURIComponent(id),actionDecoders.feedbackReceipt,{},generation),
 urge:(ref:string,input:ActionPayload,csrf:string,generation:number)=>post(generation,'/requests/'+encodeURIComponent(ref)+'/urge',input,csrf,actionDecoders.lifecycle),
 evaluate:(ref:string,input:ActionPayload,csrf:string,generation:number)=>post(generation,'/requests/'+encodeURIComponent(ref)+'/evaluation',input,csrf,actionDecoders.lifecycle),
 memberCommand:(ref:string,id:string,purpose:'URGE'|'EVALUATION',generation:number)=>request('/requests/'+encodeURIComponent(ref)+'/member-commands/'+encodeURIComponent(id)+'?purpose='+purpose,actionDecoders.lifecycleReceipt,{},generation),
 reserve:(input:ActionPayload,csrf:string,signal:AbortSignal|undefined,generation:number)=>post(generation,'/media/uploads',input,csrf,actionDecoders.upload,signal),
 upload:async(ref:string,blob:Blob,csrf:string,id:string,signal:AbortSignal,onProgress:(progress:number)=>void,generation:number):Promise<UploadReceipt>=>{
  const{rawUpload}=await loadActionModule(()=>import('./raw-upload'),generation,signal);assertAuthGeneration(generation,signal);
  return rawUpload({ref,blob,csrf,id,signal,onProgress,generation,runtime:{accept:V2_ACCEPT,assertGeneration:assertAuthGeneration,reportAuthLost,error:(status,code)=>new ApiError(status,code)}});
 },
 importWecom:(ref:string,serverId:string,csrf:string,id:string,signal:AbortSignal|undefined,generation:number)=>request('/media/uploads/'+encodeURIComponent(ref)+'/wecom',actionDecoders.upload,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':id},body:JSON.stringify({server_id:serverId}),signal:signal??null},generation),
 cancelUpload:(ref:string,csrf:string,id:string,generation:number)=>request('/media/uploads/'+encodeURIComponent(ref),value=>{if(value!==undefined&&!(record(value)&&value.ok===true))throw new InvalidResponse();},{method:'DELETE',headers:{'x-csrf-token':csrf,'idempotency-key':id}},generation),
 signature:(url:string,kind:'CORP'|'AGENT',csrf:string,signal:AbortSignal|undefined,generation:number)=>request('/js-sdk/signature',actionDecoders.signature,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({url,kind}),signal:signal??null},generation)
};
