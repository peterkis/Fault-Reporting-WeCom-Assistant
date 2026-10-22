import {InvalidResponse,record,type Decoder} from './guards';

export const V2_ACCEPT='application/vnd.yixiaoxiu.v2+json';
export class ApiError extends Error {constructor(public readonly status:number,public readonly code:string){super(code);this.name='ApiError';}}
/** Only a failed local module load can create this proof that nothing was sent. */
export class ActionLoadError extends ApiError {constructor(){super(503,'ACTION_LOAD_FAILED');}}
export const authLost=new EventTarget();
let authGeneration=0;
const responseGenerations=new WeakMap<Response,number>();
export const captureAuthGeneration=():number=>authGeneration;
export function advanceAuthGeneration():void{authGeneration+=1;}
export function assertAuthGeneration(generation:number,signal?:AbortSignal|null):void{if(generation!==authGeneration||signal?.aborted)throw new DOMException('Aborted','AbortError');}
export class AuthFailureEvent extends Event {constructor(public readonly status:401|403){super('lost');}}
export function reportAuthLost(generation:number,signal?:AbortSignal|null,status:401|403=403):void{if(generation===authGeneration&&!signal?.aborted)authLost.dispatchEvent(new AuthFailureEvent(status));}
export function assertResponse(response:Response,signal?:AbortSignal|null):void{const generation=responseGenerations.get(response);if(generation===undefined)throw new ApiError(502,'INVALID_RESPONSE');assertAuthGeneration(generation,signal);}
export async function checkedResponse(path:string,options:RequestInit={},generation=captureAuthGeneration()):Promise<Response>{
 assertAuthGeneration(generation,options.signal);
 const headers=new Headers(options.headers);headers.set('accept',V2_ACCEPT);
 const response=await fetch('/api/yixiaoxiu'+path,{...options,headers,credentials:'same-origin',cache:'no-store',redirect:'error'});
 assertAuthGeneration(generation,options.signal);responseGenerations.set(response,generation);
 if(response.ok||response.status===304)return response;
 let code='REQUEST_FAILED';
 try{const value:unknown=await response.json();if(record(value)&&typeof value.code==='string')code=value.code;else if(record(value)&&record(value.error)&&typeof value.error.code==='string')code=value.error.code;else if(response.status===404&&record(value)&&(value.error==='Not Found'||value.error==='NOT_FOUND'))code='HTTP_NOT_FOUND';}catch{if(response.status===404)code='HTTP_NOT_FOUND';}
 assertAuthGeneration(generation,options.signal);if(response.status===401||response.status===403)reportAuthLost(generation,options.signal,response.status);
 throw new ApiError(response.status,code);
}
export async function request<T>(path:string,decode:Decoder<T>,options:RequestInit={},generation=captureAuthGeneration()):Promise<T>{
 const response=await checkedResponse(path,options,generation);
 if(response.status===304)throw new ApiError(502,'UNEXPECTED_NOT_MODIFIED');
 try{const value:unknown=response.status===204?undefined:await response.json();assertResponse(response,options.signal);return decode(value);}catch(error){if(error instanceof InvalidResponse||error instanceof SyntaxError)throw new ApiError(502,'INVALID_RESPONSE');throw error;}
}
export const jsonHeaders=(csrf:string,id:string)=>({'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':id});
/** Loading is reversible; every actual request still receives its original scope. */
export async function loadActionModule<T>(load:()=>Promise<T>,generation:number,signal?:AbortSignal):Promise<T>{
 assertAuthGeneration(generation,signal);let value:T;
 try{value=await load();}catch{assertAuthGeneration(generation,signal);throw new ActionLoadError();}
 assertAuthGeneration(generation,signal);return value;
}
export const isUnknownResult=(error:unknown):boolean=>!(error instanceof ActionLoadError)&&(!(error instanceof ApiError)||error.status===0||error.status>=500||error.status===408);
export const isConflict=(error:unknown):boolean=>error instanceof ApiError&&error.status===409;
