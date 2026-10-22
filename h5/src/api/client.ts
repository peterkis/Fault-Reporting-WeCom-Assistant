import {readDecoders as decoders} from './read-decode';
import {ApiError,captureAuthGeneration,checkedResponse,assertResponse,request,loadActionModule,assertAuthGeneration} from './transport';
import type {H5EntryInput,H5RequestInput,YxxSupplementInput,FeedbackInput,H5UrgeInput,H5EvaluationInput,UploadInput,UploadReceipt,ReportsFilter,RequestDetail} from './types';
import type {ActionPayload} from './action-client';

export {ApiError,ActionLoadError,V2_ACCEPT,authLost,captureAuthGeneration,advanceAuthGeneration,assertAuthGeneration,AuthFailureEvent,reportAuthLost,request,jsonHeaders,isUnknownResult,isConflict} from './transport';
type Actions=typeof import('./action-client').actions;
function payload(input:{client_command_id:string},version?:number):ActionPayload{return{id:input.client_command_id,body:JSON.stringify(input),version};}
async function action<T>(run:(loaded:Actions,generation:number)=>Promise<T>,signal?:AbortSignal):Promise<T>{
 const generation=captureAuthGeneration(),{actions}=await loadActionModule(()=>import('./action-client'),generation,signal);
 assertAuthGeneration(generation,signal);return run(actions,generation);
}
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
  const generation=captureAuthGeneration(),cached=previous&&previous.request_ref===ref?detailEtags.get(previous):undefined,etag=cached?.generation===generation?cached.etag:null;const response=await checkedResponse('/requests/'+encodeURIComponent(ref),{...requestOptions(signal),...(etag?{headers:{'if-none-match':etag}}:{})},generation);
  if(response.status===304){assertResponse(response,signal);if(previous&&etag&&cached?.generation===generation)return previous;throw new ApiError(502,'INVALID_NOT_MODIFIED');}
  const body:unknown=await response.json();assertResponse(response,signal);let value:RequestDetail;try{value=decoders.detail(body);}catch{throw new ApiError(502,'INVALID_RESPONSE');}
  const nextTag=response.headers.get('etag');if(nextTag)detailEtags.set(value,{etag:nextTag,generation});return value;
 },
 timeline:(ref:string,cursor:string|null,signal?:AbortSignal)=>request('/requests/'+encodeURIComponent(ref)+'/timeline'+(cursor?'?cursor='+encodeURIComponent(cursor):''),decoders.timeline,requestOptions(signal)),
 supplements:(ref:string,cursor:string|null,signal?:AbortSignal)=>request('/requests/'+encodeURIComponent(ref)+'/supplements'+(cursor?'?cursor='+encodeURIComponent(cursor):''),decoders.supplements,requestOptions(signal)),
 submit:async(input:H5RequestInput,csrf:string)=>{const value=payload(input);return action((loaded,generation)=>loaded.submit(value,csrf,generation));},
 supplement:async(ref:string,input:YxxSupplementInput,csrf:string)=>{const value=payload(input);return action((loaded,generation)=>loaded.supplement(ref,value,csrf,generation));},
 feedback:(ref:string,input:FeedbackInput,csrf:string)=>{const value=payload(input,input.expected_ticket_version);return action((loaded,generation)=>loaded.feedback(ref,value,csrf,generation));},
 command:(id:string)=>action((loaded,generation)=>loaded.command(id,generation)),
 feedbackCommand:(ref:string,id:string)=>action((loaded,generation)=>loaded.feedbackCommand(ref,id,generation)),
 urge:(ref:string,input:H5UrgeInput,csrf:string)=>{const value=payload(input,input.expected_ticket_version);return action((loaded,generation)=>loaded.urge(ref,value,csrf,generation));},
 evaluate:(ref:string,input:H5EvaluationInput,csrf:string)=>{const value=payload(input,input.expected_ticket_version);return action((loaded,generation)=>loaded.evaluate(ref,value,csrf,generation));},
 memberCommand:(ref:string,id:string,purpose:'URGE'|'EVALUATION')=>action((loaded,generation)=>loaded.memberCommand(ref,id,purpose,generation)),
 department:(cursor:string|null,signal?:AbortSignal)=>request('/department-reports'+(cursor?'?cursor='+encodeURIComponent(cursor):''),decoders.department,requestOptions(signal)),
 departmentSummary:(signal?:AbortSignal)=>request('/h5/department-summary',decoders.departmentSummary,requestOptions(signal)),
 reserve:(input:UploadInput,csrf:string,signal?:AbortSignal)=>{const value=payload(input);return action((loaded,generation)=>loaded.reserve(value,csrf,signal,generation),signal);},
 upload:(ref:string,blob:Blob,csrf:string,id:string,signal:AbortSignal,onProgress:(progress:number)=>void):Promise<UploadReceipt>=>action((loaded,generation)=>loaded.upload(ref,blob,csrf,id,signal,onProgress,generation),signal),
 importWecom:(ref:string,serverId:string,csrf:string,id:string,signal?:AbortSignal)=>action((loaded,generation)=>loaded.importWecom(ref,serverId,csrf,id,signal,generation),signal),
 cancelUpload:(ref:string,csrf:string,id:string)=>action((loaded,generation)=>loaded.cancelUpload(ref,csrf,id,generation)),
 signature:(url:string,kind:'CORP'|'AGENT',csrf:string,signal?:AbortSignal)=>action((loaded,generation)=>loaded.signature(url,kind,csrf,signal,generation),signal),
 recheckSession
};
