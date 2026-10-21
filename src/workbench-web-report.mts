import {once} from 'node:events';
import {finished} from 'node:stream/promises';
import type {Readable} from 'node:stream';
import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery} from './p2-016-ticket-query.mjs';
import type {createWeb01WorkbenchQuery} from './web01-workbench-query.mjs';
import type {WorkbenchHttpOptions,WorkbenchHttpAuthContext} from './p2-006-workbench-http.mjs';
import type {createWeComWorkbenchAuthentication} from './p2-016-workbench-wecom-auth.mjs';
import type {WorkbenchWebReportView,WorkbenchWebUrge,WorkbenchWebMedia,WorkbenchMemberProgress,WorkbenchMemberProgressInput,WorkbenchMemberProgressResult,WorkbenchMemberProgressReceipt} from '../contracts/workbench_web_report_contracts.js';
import {failP2016,uuidP2016,versionP2016,exactP2016} from './p2-016-domain-contracts.mjs';
import {WorkbenchError} from './p2-006-workbench-query.mjs';
import {ticketPredicateP2016} from './p2-016-ticket-query.mjs';
import {workbenchSearchCardsSql} from './web01-workbench-query.mjs';
import {assertLocalDateTime} from './platform/time-contract.mjs';
import {decodeWebMedia} from './workbench-web-report-browser-contracts.mjs';
import {awaitYxxH5MediaRead} from './yxx-h5-media-budget.mjs';

type Context=Parameters<NonNullable<WorkbenchHttpOptions['authenticatedHandler']>>[0];
type Item=Awaited<ReturnType<ReturnType<typeof createWeb01WorkbenchQuery>['authorizedItem']>>;
type SessionPredicate=ReturnType<typeof createWeComWorkbenchAuthentication>['currentSessionPredicate'];
export interface WorkbenchWebReportLifecyclePort {
 activeForAuthorizedTickets(ticketIds:readonly string[]):Promise<ReadonlyMap<string,WorkbenchWebUrge>>;
 publicForAuthorizedTicket(ticketId:string):Promise<{public_progress:WorkbenchMemberProgress|null;evaluation:{rating:number;comment:string|null;occurred_at:string;occurred_epoch_ms:string}|null;urge:WorkbenchWebUrge}>;
 publishPublicProgress(input:{ticketId:string;actorPrincipalId:string;input:WorkbenchMemberProgressInput;onAuthorize:(tx:PostgresTransaction)=>Promise<boolean>}):Promise<WorkbenchMemberProgressResult>;
 publicProgressReceipt(input:{ticketId:string;actorPrincipalId:string;clientCommandId:string;onAuthorize:(tx:PostgresTransaction)=>Promise<boolean>}):Promise<WorkbenchMemberProgressReceipt>;
}
export interface WorkbenchWebReportMediaPort {
 listForIntake(input:{intakeId:string;verifyCurrentRead:()=>Promise<void>}):Promise<readonly WorkbenchWebMedia[]>;
 readForIntake(input:{intakeId:string;ref:string;verifyCurrentRead:()=>Promise<void>;variant?:'ORIGINAL'|'PLAYABLE';signal?:AbortSignal}):Promise<{asset:WorkbenchWebMedia;mime_type:string;byte_size:number;stream:Readable;signal?:AbortSignal;close():Promise<void>}>;
}
const EMPTY_URGE:WorkbenchWebUrge={active:false,count:0,last_urged_at:null};
const OPEN=new Set(['NEW','QUEUED','ACCEPTED','IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR','REOPENED']);
export function normalizeWorkbenchMemberProgress(input:unknown):WorkbenchMemberProgressInput{
 const v=exactP2016(input,['client_command_id','expected_version','summary','estimated_at']);
 if(typeof v.summary!=='string'||!v.summary.trim()||[...v.summary.trim()].length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v.summary))failP2016();
 let estimated:string|null=null;if(v.estimated_at!==null){try{estimated=assertLocalDateTime(v.estimated_at);}catch{failP2016();}}
 return {client_command_id:uuidP2016(v.client_command_id),expected_version:versionP2016(v.expected_version),summary:v.summary.trim(),estimated_at:estimated};
}
function externalError(error:unknown):never{
 if(error instanceof WorkbenchError)throw error;
 if(error&&typeof error==='object'){
  const status=Reflect.get(error,'status'),code=Reflect.get(error,'code');
  if(typeof status==='number'&&Number.isInteger(status)&&status>=400&&status<=599&&typeof code==='string'&&/^(?:YXX|P2_016)_[A-Z_]{1,80}$/u.test(code))throw new WorkbenchError(code,status);
 }
 throw error;
}

/** Web source adapter. Bot manifest authorization remains independent and unchanged. */
export function createWorkbenchWebReport({pool,query,ticketQuery,lifecycle=null,media=null,enabled=false,progressEnabled=false,currentSessionPredicate,localTestProfile=false}:{
 pool:PostgresPool;query:Pick<ReturnType<typeof createWeb01WorkbenchQuery>,'authorizedItem'>;ticketQuery:Pick<P2016TicketQuery,'principal'|'authorizedTicket'>;
 lifecycle?:WorkbenchWebReportLifecyclePort|null;media?:WorkbenchWebReportMediaPort|null;enabled?:boolean;progressEnabled?:boolean;currentSessionPredicate?:SessionPredicate|undefined;localTestProfile?:boolean;
}){
 if(typeof enabled!=='boolean'||typeof progressEnabled!=='boolean')failP2016('FLAG_INVALID',503);
 const active=new Set<AbortController>(),settling=new Set<Promise<void>>();let stopped=false,reading=false;
 async function verifySession(auth:WorkbenchHttpAuthContext,principalId:string,tx:PostgresTransaction=pool){
  let predicate={sql:'TRUE',values:[] as unknown[]};
  if(currentSessionPredicate)predicate=currentSessionPredicate(auth,principalId,2);
  else if(!localTestProfile||'session_id' in auth)failP2016('ACTION_FAILED',503);
  const current=await tx.query<{current:boolean}>(`SELECT ($1::bigint>platform.physical_epoch_ms() AND ${predicate.sql}) AS current`,[auth.expires_epoch_ms,...predicate.values]);
  if(current.rows[0]?.current!==true)throw new WorkbenchError('WORKBENCH_UNAUTHENTICATED',401);
 }
 async function verifyRead(auth:WorkbenchHttpAuthContext,item:Item){
  const principal=await ticketQuery.principal(auth),scope=ticketPredicateP2016(principal);
  // Repeat the original canonical READ in the final statement, after any source/store wait.
  let session={sql:'TRUE',values:[] as unknown[]};if(currentSessionPredicate)session=currentSessionPredicate(auth,principal.principal_id,9);else if(!localTestProfile||'session_id' in auth)failP2016('ACTION_FAILED',503);
  const current=await pool.query<{readable:boolean;current:boolean}>(workbenchSearchCardsSql(true)+` SELECT EXISTS(SELECT 1 FROM cards c
   JOIN intake.service_intake i ON i.id=c.intake_id::uuid JOIN intake.web_request_binding b ON b.intake_id=i.id
   WHERE c.kind=$4 AND c.id=$5 AND b.revoked_at IS NULL AND b.retention_until_epoch_ms>platform.physical_epoch_ms()
    AND i.retention_until_epoch_ms>platform.physical_epoch_ms()) AND EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal p WHERE p.id=$2::uuid AND p.is_active
    AND ARRAY(SELECT role FROM pilot_ticket.pilot_principal_role WHERE principal_id=p.id ORDER BY role COLLATE "C")=$6::text[]
    AND ARRAY(SELECT team_id FROM pilot_ticket.pilot_team_member WHERE principal_id=p.id ORDER BY team_id COLLATE "C")=$7::text[]) AS readable,
    ($8::bigint>platform.physical_epoch_ms() AND ${session.sql}) AS current`,
   [...scope.values,item.kind,item.id,[...principal.roles],[...principal.team_ids],auth.expires_epoch_ms,...session.values]);
  if(current.rows[0]?.current!==true)throw new WorkbenchError('WORKBENCH_UNAUTHENTICATED',401);if(current.rows[0]?.readable!==true)failP2016('NOT_FOUND',404);
 }
 async function source(item:Item){
  const result=await pool.query<{contact_requested:boolean}>(`SELECT COALESCE(s.safe_content->>'intent'='CONTACT_REQUEST',false) AS contact_requested
   FROM intake.service_intake i JOIN intake.web_request_binding b ON b.intake_id=i.id
   LEFT JOIN intake.web_submission s ON s.id=i.primary_web_submission_id AND s.retention_until_epoch_ms>platform.physical_epoch_ms()
   WHERE i.id=$1::uuid AND i.source_provider='YIXIAOXIU_WEB' AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
    AND b.revoked_at IS NULL AND b.retention_until_epoch_ms>platform.physical_epoch_ms()`,[item.intake_id]);return result.rows[0]??null;
 }
 async function readView(auth:WorkbenchHttpAuthContext,kind:string,id:string):Promise<WorkbenchWebReportView>{
  const item=await query.authorizedItem(auth,kind,id),web=await source(item),principal=await ticketQuery.principal(auth);
  await verifySession(auth,principal.principal_id);
  const base:WorkbenchWebReportView={schema_version:1,applicable:false,item:{kind:item.kind,id:item.id},ticket_id:null,ticket_version:null,contact_requested:false,can_publish_progress:false,public_progress:null,urge:EMPTY_URGE,evaluation:null,media_available:false,media:[]};
  if(!web)return base;
  let result=base;
  if(item.kind==='ticket'){
   const {ticket,principal:current}=await ticketQuery.authorizedTicket({authContext:auth,ticketId:item.id});
   const details=lifecycle?await lifecycle.publicForAuthorizedTicket(ticket.id):{public_progress:null,evaluation:null,urge:EMPTY_URGE};
   result={...base,public_progress:details.public_progress,evaluation:details.evaluation?{rating:details.evaluation.rating,comment:details.evaluation.comment,evaluated_at:details.evaluation.occurred_at}:null,urge:{active:details.urge.active,count:details.urge.count,last_urged_at:details.urge.last_urged_at},ticket_id:ticket.id,ticket_version:ticket.version,can_publish_progress:progressEnabled&&lifecycle!==null&&ticket.assignee_id===current.principal_id&&OPEN.has(ticket.status)&&current.roles.some(r=>['ADMIN','DISPATCHER','HANDLER'].includes(r))};
  }
  const materials=media?await media.listForIntake({intakeId:item.intake_id,verifyCurrentRead:()=>verifyRead(auth,item)}):[];
  if(materials.length>8)failP2016('ACTION_FAILED',503);await verifyRead(auth,item);
  return {...result,applicable:true,contact_requested:web.contact_requested,media_available:media!==null,media:materials.map(decodeWebMedia)};
 }
 async function authorizeTicket(auth:WorkbenchHttpAuthContext,ticketId:string,tx:PostgresTransaction,write:boolean){
  const {principal}=await ticketQuery.authorizedTicket({authContext:auth,ticketId,transaction:tx}),scope=ticketPredicateP2016(principal,2);
  let session={sql:'TRUE',values:[] as unknown[]};if(currentSessionPredicate)session=currentSessionPredicate(auth,principal.principal_id,10);else if(!localTestProfile||'session_id' in auth)failP2016('ACTION_FAILED',503);
  // The receipt path uses READ even after a transfer or closure. New writes additionally
  // require the current handler, with the same final session/role snapshot after waits.
  const proof=(await tx.query<{current:boolean;permitted:boolean}>(`SELECT ($7::bigint>platform.physical_epoch_ms() AND ${session.sql}) AS current,
   EXISTS(SELECT 1 FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.id=t.source_intake_id
    WHERE t.id=$1::uuid AND ${scope.sql} AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
     AND (NOT $8::boolean OR (t.assignee_id=$3::uuid AND t.status=ANY($9::text[]))))
   AND EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal p WHERE p.id=$3::uuid AND p.is_active
    AND ARRAY(SELECT role FROM pilot_ticket.pilot_principal_role WHERE principal_id=p.id ORDER BY role COLLATE "C")=$5::text[]
    AND ARRAY(SELECT team_id FROM pilot_ticket.pilot_team_member WHERE principal_id=p.id ORDER BY team_id COLLATE "C")=$6::text[]) AS permitted`,
   [ticketId,...scope.values,[...principal.roles],[...principal.team_ids],auth.expires_epoch_ms,write,[...OPEN],...session.values])).rows[0];
  if(proof?.current!==true)throw new WorkbenchError('WORKBENCH_UNAUTHENTICATED',401);
  return proof.permitted&&(!write||principal.roles.some(role=>['ADMIN','DISPATCHER','HANDLER'].includes(role)));
 }
 return Object.freeze({
  readView,
  async handler(context:Context){
   const {request,response,url,authContext,json,readJson,validateWriteRequest}=context;
   const report=/^\/api\/workbench\/items\/(ticket|review|intake)\/([a-f0-9-]{36})\/web-report(?:\/media\/([a-f0-9-]{36}))?$/iu.exec(url.pathname);
   const progress=/^\/api\/tickets\/([a-f0-9-]{36})\/member-progress(?:\/commands\/([a-f0-9-]{36}))?$/iu.exec(url.pathname);
   if(!report&&!progress)return false;if(!enabled||stopped)failP2016('DISABLED',503);
   try{
    if(progress){
     if(url.searchParams.size)failP2016();const ticketId=uuidP2016(progress[1]);if(!lifecycle)failP2016('DISABLED',503);
     const principal=await ticketQuery.principal(authContext);
     if(request.method==='GET'&&progress[2]){const result=await lifecycle.publicProgressReceipt({ticketId,actorPrincipalId:principal.principal_id,clientCommandId:uuidP2016(progress[2]),onAuthorize:tx=>authorizeTicket(authContext,ticketId,tx,false)});if(!await authorizeTicket(authContext,ticketId,pool,false))failP2016('NOT_FOUND',404);json(response,200,result);return true;}
     if(request.method!=='POST'||progress[2])failP2016('NOT_FOUND',404);if(!progressEnabled)failP2016('DISABLED',503);
     const raw=await readJson(request),input=normalizeWorkbenchMemberProgress(raw);validateWriteRequest(request,authContext,raw,{sessionMutation:false});if(request.headers['if-match']!=='"'+input.expected_version+'"')failP2016('VERSION_CONFLICT',409);
     const result=await lifecycle.publishPublicProgress({ticketId,actorPrincipalId:principal.principal_id,input,onAuthorize:tx=>authorizeTicket(authContext,ticketId,tx,true)});if(!await authorizeTicket(authContext,ticketId,pool,false))failP2016('NOT_FOUND',404);json(response,200,result);return true;
    }
    if(request.method!=='GET')failP2016('NOT_FOUND',404);const kind=report?.[1]??'',id=uuidP2016(report?.[2]);
    if(!report?.[3]){if(url.searchParams.size)failP2016();json(response,200,await readView(authContext,kind,id));return true;}
    if([...url.searchParams.keys()].some(key=>key!=='variant')||url.searchParams.getAll('variant').length>1)failP2016();
    const variant=url.searchParams.get('variant')??'PLAYABLE';if(variant!=='ORIGINAL'&&variant!=='PLAYABLE')failP2016();
    if(request.headers.range)throw new WorkbenchError('YXX_MEDIA_RANGE_UNSUPPORTED',416);if(!media)failP2016('DISABLED',503);if(reading)throw new WorkbenchError('YXX_MEDIA_BUSY',429);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60_000),disconnected=()=>controller.abort();timer.unref();active.add(controller);reading=true;response.once('close',disconnected);
    let complete=()=>{};const settled=new Promise<void>(resolve=>{complete=resolve;});settling.add(settled);
    let lease:Awaited<ReturnType<WorkbenchWebReportMediaPort['readForIntake']>>|null=null;
    let outputSignal:AbortSignal|null=null;const stopOutput=()=>{response.destroy();};
    try{
     const item=await awaitYxxH5MediaRead(controller.signal,()=>query.authorizedItem(authContext,kind,id));if(!await awaitYxxH5MediaRead(controller.signal,()=>source(item)))failP2016('NOT_FOUND',404);
     const verify=async()=>{controller.signal.throwIfAborted();await awaitYxxH5MediaRead(controller.signal,()=>verifyRead(authContext,item));controller.signal.throwIfAborted();};
     lease=await media.readForIntake({intakeId:item.intake_id,ref:uuidP2016(report[3]),variant,verifyCurrentRead:verify,signal:controller.signal});
     outputSignal=lease.signal?AbortSignal.any([controller.signal,lease.signal]):controller.signal;
     outputSignal.addEventListener('abort',stopOutput,{once:true});outputSignal.throwIfAborted();
     await awaitYxxH5MediaRead(outputSignal,verify);
     const asset=decodeWebMedia(lease.asset),expectedMime=variant==='ORIGINAL'?asset.mime_type:asset.playback_mime_type;
     if(asset.media_ref!==uuidP2016(report[3])||lease.mime_type!==expectedMime||!Number.isSafeInteger(lease.byte_size)||lease.byte_size<1||lease.byte_size>20*1024*1024||variant==='ORIGINAL'&&lease.byte_size!==asset.byte_size)failP2016('ACTION_FAILED',503);
     response.writeHead(200,{'content-type':lease.mime_type,'content-length':String(lease.byte_size),'content-disposition':variant==='ORIGINAL'?'attachment; filename="report-material"':'inline; filename="report-material"','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"sandbox; default-src 'none'"});
     let bytes=0;for await(const chunk of lease.stream){outputSignal.throwIfAborted();await awaitYxxH5MediaRead(outputSignal,verify);bytes+=Buffer.byteLength(chunk);if(bytes>lease.byte_size)throw new WorkbenchError('YXX_MEDIA_INTEGRITY_FAILED',502);if(!response.write(chunk))await once(response,'drain',{signal:outputSignal});}
     if(bytes!==lease.byte_size)throw new WorkbenchError('YXX_MEDIA_INTEGRITY_FAILED',502);response.end();await finished(response,{cleanup:true,signal:outputSignal});return true;
    }catch(error){if(response.headersSent){response.destroy();return true;}throw error;}
    finally{try{outputSignal?.removeEventListener('abort',stopOutput);await lease?.close();}finally{clearTimeout(timer);response.off('close',disconnected);active.delete(controller);reading=false;settling.delete(settled);complete();}}
   }catch(error){return externalError(error);}
  },
  async close(){stopped=true;for(const controller of active)controller.abort();await Promise.allSettled([...settling]);},
 });
}
