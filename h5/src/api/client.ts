import {acceptedReceipt} from '../lib/command';
import {decoders,InvalidResponse,record,type Decoder} from './decode';
import type {H5EntryInput,H5RequestInput,YxxSupplementInput,FeedbackInput,H5UrgeInput,H5EvaluationInput,UploadInput,UploadReceipt,ReportsFilter,RequestDetail} from './types';

export const V2_ACCEPT='application/vnd.yixiaoxiu.v2+json';
export class ApiError extends Error {constructor(public readonly status:number,public readonly code:string){super(code);this.name='ApiError';}}
export const authLost=new EventTarget();
let authGeneration=0;
const responseGenerations=new WeakMap<Response,number>();
export const captureAuthGeneration=():number=>authGeneration;
export function advanceAuthGeneration():void{authGeneration+=1;}
function assertGeneration(generation:number,signal?:AbortSignal|null):void{if(generation!==authGeneration||signal?.aborted)throw new DOMException('Member request superseded','AbortError');}
export {assertGeneration as assertAuthGeneration};
export class AuthFailureEvent extends Event {constructor(public readonly status:401|403){super('lost');}}
export function reportAuthLost(generation:number,signal?:AbortSignal|null,status:401|403=403):void{if(generation===authGeneration&&!signal?.aborted)authLost.dispatchEvent(new AuthFailureEvent(status));}
function assertResponse(response:Response,signal?:AbortSignal|null):void{const generation=responseGenerations.get(response);if(generation===undefined)throw new ApiError(502,'INVALID_RESPONSE');assertGeneration(generation,signal);}
async function checkedResponse(path:string,options:RequestInit={}):Promise<Response>{
 const generation=authGeneration;
 const headers=new Headers(options.headers);headers.set('accept',V2_ACCEPT);
 const response=await fetch('/api/yixiaoxiu'+path,{...options,headers,credentials:'same-origin',cache:'no-store',redirect:'error'});
 assertGeneration(generation,options.signal);responseGenerations.set(response,generation);
 if(response.ok||response.status===304)return response;
 let code='REQUEST_FAILED';
 try{const value:unknown=await response.json();if(record(value)&&typeof value.code==='string')code=value.code;else if(record(value)&&record(value.error)&&typeof value.error.code==='string')code=value.error.code;else if(response.status===404&&record(value)&&(value.error==='Not Found'||value.error==='NOT_FOUND'))code='HTTP_NOT_FOUND';}catch{if(response.status===404)code='HTTP_NOT_FOUND';}
 assertGeneration(generation,options.signal);if(response.status===401||response.status===403)reportAuthLost(generation,options.signal,response.status);
 throw new ApiError(response.status,code);
}
export async function request<T>(path:string,decode:Decoder<T>,options:RequestInit={}):Promise<T>{
 const response=await checkedResponse(path,options);
 if(response.status===304)throw new ApiError(502,'UNEXPECTED_NOT_MODIFIED');
 try{const value:unknown=response.status===204?undefined:await response.json();assertResponse(response,options.signal);return decode(value);}catch(error){if(error instanceof InvalidResponse||error instanceof SyntaxError)throw new ApiError(502,'INVALID_RESPONSE');throw error;}
}
export const jsonHeaders=(csrf:string,id:string)=>({'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':id});
const post=<T>(path:string,input:{client_command_id:string},csrf:string,decode:Decoder<T>,version?:number,signal?:AbortSignal)=>request(path,decode,{method:'POST',headers:{...jsonHeaders(csrf,input.client_command_id),...(version===undefined?{}:{'if-match':'"'+version+'"'})},body:JSON.stringify(input),signal:signal??null});
const requestOptions=(signal?:AbortSignal):RequestInit=>({signal:signal??null});
function filters(params:URLSearchParams,value:ReportsFilter){if(value.q)params.set('search',value.q);if(value.status)params.set('status',value.status);if(value.source)params.set('source',value.source);}
const detailEtags=new WeakMap<RequestDetail,{etag:string;generation:number}>();
let recheckHandler:(()=>Promise<void>)|null=null;
let rechecking:Promise<void>|null=null;
/** A page-owned action, with no identity or authorization result cached here. */
export function registerSessionRecheck(handler:()=>Promise<void>):()=>void{recheckHandler=handler;return()=>{if(recheckHandler===handler)recheckHandler=null;};}
function recheckSession():Promise<void>{
 if(rechecking)return rechecking;
 const work=recheckHandler?recheckHandler():request('/bootstrap',decoders.bootstrap).then(()=>undefined);
 rechecking=work.finally(()=>{rechecking=null;});return rechecking;
}
export function entryUnavailable(error:unknown):boolean{return error instanceof ApiError&&error.status===404&&error.code==='YXX_H5_ENTRY_DISABLED';}
export const api={
 bootstrap:(signal?:AbortSignal)=>request('/bootstrap',decoders.bootstrap,requestOptions(signal)),
 entry:(input:H5EntryInput,signal?:AbortSignal)=>{
  const params=new URLSearchParams({view:input.view});if(input.view==='request')params.set('request_ref',input.request_ref);
  if(input.view==='reports'||input.view==='department'){if(input.search)params.set('search',input.search);if(input.status)params.set('status',input.status);if(input.view==='reports'&&input.source)params.set('source',input.source);}
  return request('/h5/entry?'+params,decoders.entry,requestOptions(signal));
 },
 reports:(value:ReportsFilter,cursor:string|null,signal?:AbortSignal,limit=20)=>{const params=new URLSearchParams({limit:String(limit)});filters(params,value);if(cursor)params.set('cursor',cursor);return request('/my-reports?'+params,decoders.reports,requestOptions(signal));},
 detail:async(ref:string,signal?:AbortSignal,previous?:RequestDetail)=>{
  const cached=previous&&previous.request_ref===ref?detailEtags.get(previous):undefined,etag=cached?.generation===authGeneration?cached.etag:null;const response=await checkedResponse('/requests/'+encodeURIComponent(ref),{...requestOptions(signal),...(etag?{headers:{'if-none-match':etag}}:{})});
  if(response.status===304){assertResponse(response,signal);if(previous&&etag&&cached?.generation===authGeneration)return previous;throw new ApiError(502,'INVALID_NOT_MODIFIED');}
  const body:unknown=await response.json();assertResponse(response,signal);let value:RequestDetail;try{value=decoders.detail(body);}catch{throw new ApiError(502,'INVALID_RESPONSE');}
  const nextTag=response.headers.get('etag');if(nextTag)detailEtags.set(value,{etag:nextTag,generation:authGeneration});return value;
 },
 timeline:(ref:string,cursor:string|null,signal?:AbortSignal)=>request('/requests/'+encodeURIComponent(ref)+'/timeline'+(cursor?'?cursor='+encodeURIComponent(cursor):''),decoders.timeline,requestOptions(signal)),
 supplements:(ref:string,cursor:string|null,signal?:AbortSignal)=>request('/requests/'+encodeURIComponent(ref)+'/supplements'+(cursor?'?cursor='+encodeURIComponent(cursor):''),decoders.supplements,requestOptions(signal)),
 submit:async(input:H5RequestInput,csrf:string)=>{const result=await post('/requests',input,csrf,decoders.receipt);if(!acceptedReceipt(result,input.client_command_id))throw new ApiError(502,'INVALID_RECEIPT');return result;},
 supplement:async(ref:string,input:YxxSupplementInput,csrf:string)=>{const result=await post('/requests/'+encodeURIComponent(ref)+'/supplements',input,csrf,decoders.receipt);if(!acceptedReceipt(result,input.client_command_id))throw new ApiError(502,'INVALID_RECEIPT');return result;},
 feedback:(ref:string,input:FeedbackInput,csrf:string)=>post('/requests/'+encodeURIComponent(ref)+'/feedback',input,csrf,decoders.feedback,input.expected_ticket_version),
 command:(id:string)=>request('/commands/'+encodeURIComponent(id),decoders.command),
 feedbackCommand:(ref:string,id:string)=>request('/requests/'+encodeURIComponent(ref)+'/feedback/commands/'+encodeURIComponent(id),decoders.feedbackReceipt),
 urge:(ref:string,input:H5UrgeInput,csrf:string)=>post('/requests/'+encodeURIComponent(ref)+'/urge',input,csrf,decoders.lifecycle,input.expected_ticket_version),
 evaluate:(ref:string,input:H5EvaluationInput,csrf:string)=>post('/requests/'+encodeURIComponent(ref)+'/evaluation',input,csrf,decoders.lifecycle,input.expected_ticket_version),
 memberCommand:(ref:string,id:string,purpose:'URGE'|'EVALUATION')=>request('/requests/'+encodeURIComponent(ref)+'/member-commands/'+encodeURIComponent(id)+'?purpose='+purpose,decoders.lifecycleReceipt),
 department:(cursor:string|null,signal?:AbortSignal)=>request('/department-reports'+(cursor?'?cursor='+encodeURIComponent(cursor):''),decoders.department,requestOptions(signal)),
 departmentSummary:(signal?:AbortSignal)=>request('/h5/department-summary',decoders.departmentSummary,requestOptions(signal)),
 reserve:(input:UploadInput,csrf:string,signal?:AbortSignal)=>post('/media/uploads',input,csrf,decoders.upload,undefined,signal),
 upload:async(ref:string,blob:Blob,csrf:string,id:string,signal:AbortSignal,onProgress:(progress:number)=>void):Promise<UploadReceipt>=>{
  const generation=captureAuthGeneration();assertGeneration(generation,signal);
  const{rawUpload}=await import('./raw-upload');assertGeneration(generation,signal);
  return rawUpload({ref,blob,csrf,id,signal,onProgress,generation,runtime:{accept:V2_ACCEPT,assertGeneration,reportAuthLost,error:(status,code)=>new ApiError(status,code)}});
 },
 importWecom:(ref:string,serverId:string,csrf:string,id:string,signal?:AbortSignal)=>request('/media/uploads/'+encodeURIComponent(ref)+'/wecom',decoders.upload,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':id},body:JSON.stringify({server_id:serverId}),signal:signal??null}),
 cancelUpload:(ref:string,csrf:string,id:string)=>request('/media/uploads/'+encodeURIComponent(ref),value=>{if(value!==undefined&&!(record(value)&&value.ok===true))throw new InvalidResponse();},{method:'DELETE',headers:{'x-csrf-token':csrf,'idempotency-key':id}}),
 signature:(url:string,kind:'CORP'|'AGENT',csrf:string,signal?:AbortSignal)=>request('/js-sdk/signature',decoders.signature,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({url,kind}),signal:signal??null}),
 recheckSession
};
export const isUnknownResult=(error:unknown):boolean=>!(error instanceof ApiError)||error.status===0||error.status>=500||error.status===408;
export const isConflict=(error:unknown):boolean=>error instanceof ApiError&&error.status===409;
