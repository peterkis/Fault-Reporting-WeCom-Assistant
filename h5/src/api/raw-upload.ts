import {decoders,InvalidResponse} from './decode';
import type {UploadReceipt} from './types';
interface UploadRuntime {accept:string;assertGeneration:(generation:number,signal:AbortSignal)=>void;reportAuthLost:(generation:number,signal:AbortSignal,status:401|403)=>void;error:(status:number,code:string)=>Error}
interface RawUploadInput {ref:string;blob:Blob;csrf:string;id:string;signal:AbortSignal;generation:number;onProgress:(progress:number)=>void;runtime:UploadRuntime}
/** Loaded only on a user's upload, with the caller's original member generation. */
export function rawUpload({ref,blob,csrf,id,signal,onProgress,generation,runtime}:RawUploadInput):Promise<UploadReceipt>{
 return new Promise((resolve,reject)=>{
  runtime.assertGeneration(generation,signal);
  const xhr=new XMLHttpRequest();xhr.open('PUT','/api/yixiaoxiu/media/uploads/'+encodeURIComponent(ref)+'/content');xhr.withCredentials=true;xhr.setRequestHeader('idempotency-key',id);xhr.setRequestHeader('x-csrf-token',csrf);xhr.setRequestHeader('content-type',blob.type||'application/octet-stream');xhr.setRequestHeader('accept',runtime.accept);
  const abort=()=>xhr.abort();signal.addEventListener('abort',abort,{once:true});
  xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress(Math.round(event.loaded/event.total*100));};
  xhr.onload=()=>{signal.removeEventListener('abort',abort);try{runtime.assertGeneration(generation,signal);}catch(error){reject(error);return;}if(xhr.status>=200&&xhr.status<300){try{const value:unknown=JSON.parse(xhr.responseText);const receipt=decoders.upload(value);if(receipt.media_ref!==ref)throw new InvalidResponse();onProgress(100);resolve(receipt);}catch{reject(runtime.error(502,'INVALID_RESPONSE'));}}else{if(xhr.status===401||xhr.status===403)runtime.reportAuthLost(generation,signal,xhr.status);reject(runtime.error(xhr.status,'UPLOAD_FAILED'));}};
  xhr.onerror=()=>{signal.removeEventListener('abort',abort);reject(runtime.error(0,'NETWORK_ERROR'));};xhr.onabort=()=>{signal.removeEventListener('abort',abort);reject(new DOMException('Aborted','AbortError'));};if(signal.aborted){abort();reject(new DOMException('Aborted','AbortError'));return;}xhr.send(blob);
 });
}
