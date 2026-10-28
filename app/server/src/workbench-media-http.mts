import {once} from 'node:events';
import {finished} from 'node:stream/promises';
import type {WorkbenchHttpOptions,WorkbenchHttpAuthContext} from './p2-006-workbench-http.mjs';
import type {AttachmentStore} from '../../../contracts/workbench_attachment_contracts.js';
import type {H5MediaEmployeeRead,H5MediaLease,H5MediaVariant} from '../../../contracts/yxx_h5_media_contracts.js';
import type {YxxH5Media} from './yxx-h5-media.mjs';
import {H5MediaError,H5_MEDIA_LIMITS,mediaUuid} from './yxx-h5-media-format.mjs';
import {AttachmentError,ATTACHMENT_DEADLINE_MS} from './workbench-attachment-store.mjs';
import {parseYxxH5ByteRange} from './yxx-h5-http.mjs';
import {WorkbenchError} from './p2-006-workbench-query.mjs';
import {awaitYxxH5MediaRead} from './yxx-h5-media-budget.mjs';

type Context=Parameters<NonNullable<WorkbenchHttpOptions['authenticatedHandler']>>[0];
type FileLease=Awaited<ReturnType<AttachmentStore['open']>>;
const HEADERS={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"sandbox; default-src 'none'"};

/** ADR-0050. Only mounted behind the host's current employee authentication. */
export function createWorkbenchMediaHttp({enabled=false,media=null,attachmentStore=null,verifyLocalEmployee=null}:{
 enabled?:boolean;media?:Pick<YxxH5Media,'prepareEmployeeRead'>|null;attachmentStore?:AttachmentStore|null;
 /** Synthetic signed-cookie host has no official staff authenticator. */
 verifyLocalEmployee?:((auth:WorkbenchHttpAuthContext)=>Promise<void>)|null;
}){
 if(typeof enabled!=='boolean')throw new Error('WORKBENCH_MEDIA_CONFIG_INVALID');
 let stopped=false;const active=new Map<AbortController,Promise<void>>();
 return Object.freeze({
  async handler({request,response,url,authContext,json}:Context){
   const match=/^\/api\/workbench\/media\/(web|attachment)\/([a-f0-9-]{36})$/iu.exec(url.pathname);
   if(!match)return false;
   if(!enabled||stopped){json(response,404,{error:{code:'YXX_MEDIA_EMPLOYEE_READ_DISABLED',retryable:false}});return true;}
   if(active.size>=H5_MEDIA_LIMITS.readLeases+H5_MEDIA_LIMITS.waiting){json(response,429,{error:{code:'YXX_MEDIA_BUSY',retryable:true}});return true;}
   const controller=new AbortController();let done=()=>{};
   active.set(controller,new Promise<void>(resolve=>{done=resolve;}));
   const timer=setTimeout(()=>controller.abort(),match[1]==='attachment'?ATTACHMENT_DEADLINE_MS:H5_MEDIA_LIMITS.deadline);timer.unref();
   const disconnected=()=>controller.abort(),stopOutput=()=>{if(response.headersSent)response.destroy();};
   response.once('close',disconnected);controller.signal.addEventListener('abort',stopOutput,{once:true});
   let prepared:H5MediaEmployeeRead|null=null,preparing:Promise<H5MediaEmployeeRead>|null=null,webLease:H5MediaLease|null=null,fileLease:FileLease|null=null;
   try{
    if(!['GET','HEAD'].includes(request.method??'')||request.headers['transfer-encoding']||request.headers['content-length']&&request.headers['content-length']!=='0')throw new H5MediaError('YXX_MEDIA_INPUT_INVALID',400);
    if(request.headers['sec-fetch-site']==='cross-site'||request.headers.origin&&request.headers.origin!==url.origin)throw new H5MediaError('YXX_MEDIA_FORBIDDEN',403);
    if([...url.searchParams.keys()].some(key=>key!=='variant')||url.searchParams.getAll('variant').length>1)throw new H5MediaError('YXX_MEDIA_INPUT_INVALID',400);
    if(authContext.employee_authenticated!==true){if(!verifyLocalEmployee)throw new H5MediaError('YXX_MEDIA_EMPLOYEE_AUTH_UNAVAILABLE',503);await verifyLocalEmployee(authContext);}controller.signal.throwIfAborted();
    const ref=mediaUuid(match[2]),source=match[1];
    if(source==='attachment'){
     if(request.method!=='GET')throw new AttachmentError('ATTACHMENT_METHOD_NOT_ALLOWED',405);
     if(request.headers.range)throw new AttachmentError('ATTACHMENT_RANGE_NOT_SUPPORTED',416);
     if(url.searchParams.has('variant')&&url.searchParams.get('variant')!=='ORIGINAL')throw new AttachmentError('ATTACHMENT_INPUT_INVALID',400);
     if(!attachmentStore)throw new AttachmentError('ATTACHMENT_STORAGE_UNAVAILABLE',503);
     // open authenticates the immutable manifest once, before reading any bytes.
     fileLease=await attachmentStore.open(ref,controller.signal);controller.signal.throwIfAborted();
     const asset=fileLease.asset;
     response.writeHead(200,{...HEADERS,'content-type':asset.mime_type,'content-length':String(asset.byte_size),'content-disposition':'attachment; filename="report-attachment.'+(asset.mime_type==='image/png'?'png':'jpg')+'"'});
     let sent=0;
     for await(const chunk of fileLease.stream){controller.signal.throwIfAborted();sent+=Buffer.byteLength(chunk);if(sent>asset.byte_size)throw new AttachmentError('ATTACHMENT_INTEGRITY_FAILED');if(!response.write(chunk))await once(response,'drain',{signal:controller.signal});}
     if(sent!==asset.byte_size)throw new AttachmentError('ATTACHMENT_INTEGRITY_FAILED');
    }else{
     if(!media)throw new H5MediaError('YXX_MEDIA_STORAGE_UNAVAILABLE',503);
     const variant=url.searchParams.get('variant')??'PLAYABLE';if(!['ORIGINAL','PLAYABLE','THUMBNAIL'].includes(variant))throw new H5MediaError('YXX_MEDIA_INPUT_INVALID',400);
     const initializing=media.prepareEmployeeRead({ref,variant:variant as H5MediaVariant,signal:controller.signal});preparing=initializing;
     prepared=await awaitYxxH5MediaRead(controller.signal,()=>initializing);
     const description=prepared.description,range=request.headers['if-range']===undefined?parseYxxH5ByteRange(typeof request.headers.range==='string'?request.headers.range:null,description.byte_size):null;
     if(range==='UNSATISFIABLE'){response.setHeader('content-range','bytes */'+description.byte_size);throw new H5MediaError('YXX_MEDIA_RANGE_NOT_SATISFIABLE',416);}
     const headers={...HEADERS,'accept-ranges':'bytes','content-type':description.mime_type,'content-disposition':variant==='ORIGINAL'?'attachment; filename="report-material"':'inline; filename="report-material"'};
     if(request.method==='HEAD'){response.writeHead(200,{...headers,'content-length':String(description.byte_size)});response.end();return true;}
     webLease=await prepared.open(range??undefined);controller.signal.throwIfAborted();
     response.writeHead(range?206:200,{...headers,'content-length':String(webLease.byte_size),...(range?{'content-range':`bytes ${range.start}-${range.end}/${description.byte_size}`}:{})});
     let sent=0;
     for await(const chunk of webLease.stream){controller.signal.throwIfAborted();sent+=Buffer.byteLength(chunk);if(sent>webLease.byte_size)throw new H5MediaError('YXX_MEDIA_INTEGRITY_FAILED',422);if(!response.write(chunk))await once(response,'drain',{signal:controller.signal});}
     if(sent!==webLease.byte_size)throw new H5MediaError('YXX_MEDIA_INTEGRITY_FAILED',422);
    }
    response.end();await finished(response,{cleanup:true,signal:controller.signal});return true;
   }catch(error){
    if(response.headersSent){response.destroy();return true;}
    let status=503,code='YXX_MEDIA_STORAGE_UNAVAILABLE';
    if(error instanceof H5MediaError||error instanceof AttachmentError||error instanceof WorkbenchError){status=error.status;code=error.code;}
    else if(error instanceof Error&&'status' in error&&typeof error.status==='number'&&Number.isInteger(error.status)&&error.status>=400&&error.status<=599&&'code' in error&&typeof error.code==='string'&&/^P2_016_[A-Z_]{1,80}$/u.test(error.code)){status=error.status;code=error.code;}
    if(controller.signal.aborted){status=504;code='YXX_MEDIA_TIMEOUT';}
    json(response,status,{error:{code,retryable:status===429||status>=500}});return true;
   }finally{
    // Keep the bounded admission occupied until a late native query settles,
    // even when its HTTP timeout has already been delivered.
    try{await fileLease?.close();await webLease?.close();if(prepared)await prepared.close();else await preparing?.then(value=>value.close(),()=>{});}
    finally{clearTimeout(timer);response.off('close',disconnected);controller.signal.removeEventListener('abort',stopOutput);active.delete(controller);done();}
   }
  },
  async close(){stopped=true;for(const controller of active.keys())controller.abort();await Promise.allSettled([...active.values()]);},
 });
}
