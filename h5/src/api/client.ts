import {acceptedReceipt} from '../lib/command';
import type { Bootstrap, ReportPage, RequestDetail, YxxTimeline, H5RequestInput, YxxSupplementInput, FeedbackInput, H5UrgeInput, H5EvaluationInput, H5LifecycleResult, H5LifecycleReceipt, H5DepartmentPage, UploadInput, UploadReceipt, CommandResult, ReportsFilter } from './types';
export const V2_ACCEPT = 'application/vnd.yixiaoxiu.v2+json';
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {super(code); this.name='ApiError';}
}
export const authLost = new EventTarget();
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers); headers.set('accept',V2_ACCEPT);
  const response = await fetch('/api/yixiaoxiu' + path, {...options,headers,credentials:'same-origin',cache:'no-store',redirect:'error'});
  if (!response.ok) {
    let code = 'REQUEST_FAILED';
    try {const body:unknown = await response.json();if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string') code=body.code;else if(body&&typeof body==='object'&&'error'in body&&body.error&&typeof body.error==='object'&&'code'in body.error&&typeof body.error.code==='string')code=body.error.code;} catch { /* no private response text is exposed */ }
    if (response.status === 401 || response.status === 403) authLost.dispatchEvent(new Event('lost'));
    throw new ApiError(response.status,code);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}
export const jsonHeaders = (csrf: string, id: string) => ({'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':id});
const post = <T>(path: string, input: {client_command_id:string}, csrf: string, version?: number) => request<T>(path,{method:'POST',headers:{...jsonHeaders(csrf,input.client_command_id),...(version === undefined ? {} : {'if-match':'"' + version + '"'})},body:JSON.stringify(input)});
export const api = {
  bootstrap: (signal?:AbortSignal) => request<Bootstrap>('/bootstrap',{signal:signal??null}),
  reports: (filters:ReportsFilter,cursor:string|null,signal?:AbortSignal) => {
    const q=new URLSearchParams({limit:'20'}); if(filters.q) q.set('search',filters.q);if(filters.status)q.set('status',filters.status);if(filters.source)q.set('source',filters.source);if(cursor)q.set('cursor',cursor);
    return request<ReportPage>('/my-reports?' + q,{signal:signal??null});
  },
  detail: (ref:string,signal?:AbortSignal) => request<RequestDetail>('/requests/' + encodeURIComponent(ref),{signal:signal??null}),
  timeline: (ref:string,cursor:string|null,signal?:AbortSignal) => request<YxxTimeline>('/requests/' + encodeURIComponent(ref) + '/timeline' + (cursor?'?cursor='+encodeURIComponent(cursor):''),{signal:signal??null}),
  submit: async(input:H5RequestInput,csrf:string) => {const result=await post<unknown>('/requests',input,csrf);if(!acceptedReceipt(result,input.client_command_id))throw new ApiError(502,'INVALID_RECEIPT');return result;},
  supplement: async(ref:string,input:YxxSupplementInput,csrf:string) => {const result=await post<unknown>('/requests/'+encodeURIComponent(ref)+'/supplements',input,csrf);if(!acceptedReceipt(result,input.client_command_id))throw new ApiError(502,'INVALID_RECEIPT');return result;},
  feedback: (ref:string,input:FeedbackInput,csrf:string) => post<unknown>('/requests/'+encodeURIComponent(ref)+'/feedback',input,csrf,input.expected_ticket_version),
  command: (id:string) => request<CommandResult>('/commands/'+encodeURIComponent(id)),
  feedbackCommand: (ref:string,id:string) => request<CommandResult>('/requests/'+encodeURIComponent(ref)+'/feedback/commands/'+encodeURIComponent(id)),
  urge: (ref:string,input:H5UrgeInput,csrf:string) => post<H5LifecycleResult>('/requests/'+encodeURIComponent(ref)+'/urge',input,csrf,input.expected_ticket_version),
  evaluate: (ref:string,input:H5EvaluationInput,csrf:string) => post<H5LifecycleResult>('/requests/'+encodeURIComponent(ref)+'/evaluation',input,csrf,input.expected_ticket_version),
  memberCommand: (ref:string,id:string,purpose:'URGE'|'EVALUATION') => request<H5LifecycleReceipt>('/requests/'+encodeURIComponent(ref)+'/member-commands/'+encodeURIComponent(id)+'?purpose='+purpose),
  department: (cursor:string|null,signal?:AbortSignal) => request<H5DepartmentPage>('/department-reports'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{signal:signal??null}),
  reserve: (input:UploadInput,csrf:string) => post<UploadReceipt>('/media/uploads',input,csrf),
  upload: (ref:string,blob:Blob,csrf:string,id:string,signal:AbortSignal,onProgress:(progress:number)=>void) => new Promise<UploadReceipt>((resolve,reject)=>{
    const xhr = new XMLHttpRequest(); xhr.open('PUT','/api/yixiaoxiu/media/uploads/'+encodeURIComponent(ref)+'/content'); xhr.withCredentials=true;xhr.setRequestHeader('idempotency-key',id);xhr.setRequestHeader('x-csrf-token',csrf);xhr.setRequestHeader('content-type',blob.type || 'application/octet-stream');xhr.setRequestHeader('accept',V2_ACCEPT);
    const abort = () => xhr.abort();signal.addEventListener('abort',abort,{once:true});
    xhr.upload.onprogress = event => {if(event.lengthComputable)onProgress(Math.round(event.loaded/event.total*100));};
    xhr.onload = () => {signal.removeEventListener('abort',abort);if(xhr.status>=200&&xhr.status<300){try{resolve(xhr.responseText?JSON.parse(xhr.responseText) as UploadReceipt:{media_ref:ref,kind:'IMAGE'});}catch{reject(new ApiError(502,'INVALID_RESPONSE'));}}else{if(xhr.status===401||xhr.status===403)authLost.dispatchEvent(new Event('lost'));reject(new ApiError(xhr.status,'UPLOAD_FAILED'));}};
    xhr.onerror=()=>{signal.removeEventListener('abort',abort);reject(new ApiError(0,'NETWORK_ERROR'));};xhr.onabort=()=>{signal.removeEventListener('abort',abort);reject(new DOMException('Aborted','AbortError'));};xhr.send(blob);
  }),
  importWecom: (ref:string,serverId:string,csrf:string,id:string) => request<UploadReceipt>('/media/uploads/'+encodeURIComponent(ref)+'/wecom',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':id},body:JSON.stringify({server_id:serverId})}),
  cancelUpload: (ref:string,csrf:string,id:string) => request<void>('/media/uploads/'+encodeURIComponent(ref),{method:'DELETE',headers:{'x-csrf-token':csrf,'idempotency-key':id}}),
  signature: (url:string,kind:'CORP'|'AGENT',csrf:string) => request<{timestamp:number;nonceStr:string;signature:string}>('/js-sdk/signature',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({url,kind})})
};
export const isUnknownResult = (error: unknown): boolean => !(error instanceof ApiError) || error.status === 0 || error.status >= 500 || error.status === 408;
export const isConflict = (error:unknown):boolean => error instanceof ApiError && error.status === 409;
