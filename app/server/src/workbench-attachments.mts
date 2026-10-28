import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import type {createWeb01WorkbenchQuery} from './web01-workbench-query.mjs';
import type {WorkbenchHttpOptions} from './p2-006-workbench-http.mjs';
import type {StoredAttachment,AttachmentStore,AttachmentPage,AttachmentMetadata,AttachmentReason} from '../../../contracts/workbench_attachment_contracts.js';
import {AttachmentError,attachmentReason,ATTACHMENT_DEADLINE_MS} from './workbench-attachment-store.mjs';
import {failP2016} from './p2-016-domain-contracts.mjs';
import {once} from 'node:events';
import type {createWeComWorkbenchAuthentication} from './p2-016-workbench-wecom-auth.mjs';
import {createPilotWorkbenchAuthorizationAdapter} from './p2-006-workbench-authorization.mjs';
import {ticketPredicateP2016} from './p2-016-ticket-query.mjs';
import {workbenchSearchCardsSql} from './web01-workbench-query.mjs';
type Context=Parameters<NonNullable<WorkbenchHttpOptions['authenticatedHandler']>>[0];
type Item=Awaited<ReturnType<ReturnType<typeof createWeb01WorkbenchQuery>['authorizedItem']>>;
const EMPTY:AttachmentPage={available:false,reason:'STORAGE_UNAVAILABLE',items:[],truncated:false};
const LIMIT=20;
function sameRegistration(first:StoredAttachment,current:Readonly<StoredAttachment>):void {if(JSON.stringify(first)!==JSON.stringify(current))throw new AttachmentError('ATTACHMENT_INTEGRITY_FAILED');}
function visible(asset:StoredAttachment,reason:AttachmentReason|null):AttachmentMetadata {return {ref:asset.ref,display_name:asset.mime_type==='image/png'?'报修附件.png':asset.mime_type==='image/jpeg'?'报修附件.jpg':'报修附件',mime_type:asset.mime_type,byte_size:asset.byte_size,available:reason===null,reason};}
export function createWorkbenchAttachments({pool,query,enabled=false,store=null,currentSessionPredicate,localTestProfile=false,metadataOnly=false}:{pool:PostgresTransaction;query:ReturnType<typeof createWeb01WorkbenchQuery>;enabled?:boolean;store?:AttachmentStore|null;currentSessionPredicate?:ReturnType<typeof createWeComWorkbenchAuthentication>['currentSessionPredicate']|undefined;localTestProfile?:boolean;metadataOnly?:boolean}) {
  const active=new Set<AbortController>();let stopped=false,operation:AbortController|null=null,settled:Promise<void>=Promise.resolve();
  const authorization=createPilotWorkbenchAuthorizationAdapter({pool});
  async function requireSession(authContext:Context['authContext'],kind:string,id:string){
    const item=await query.authorizedItem(authContext,kind,id),principal=await authorization.resolvePrincipal(authContext);
    if(!principal)failP2016('NOT_FOUND',404);
    const scope=ticketPredicateP2016(principal);let predicate:{sql:string;values:unknown[]}={sql:'TRUE',values:[]};
    if(!currentSessionPredicate){
      if(!localTestProfile||'session_id' in authContext)throw new AttachmentError('ATTACHMENT_AUTH_UNAVAILABLE',503);
    }else predicate=currentSessionPredicate(authContext,authContext.principal_id,9);
    // Reuse the exact card READ predicate; its current role/team basis and the
    // official Session are consumed in the same last statement after all waits.
    const current=await pool.query<{readable:boolean;current:boolean}>(workbenchSearchCardsSql(true)+` SELECT
      EXISTS(SELECT 1 FROM cards WHERE kind=$4 AND id=$5) AND EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal actor
        WHERE actor.id=$2::uuid AND actor.is_active
        AND ARRAY(SELECT role FROM pilot_ticket.pilot_principal_role WHERE principal_id=actor.id ORDER BY role COLLATE "C")=$6::text[]
        AND ARRAY(SELECT team_id FROM pilot_ticket.pilot_team_member WHERE principal_id=actor.id ORDER BY team_id COLLATE "C")=$7::text[]) AS readable,
      ($8::bigint>platform.physical_epoch_ms() AND ${predicate.sql}) AS current`,
    [...scope.values,item.kind,item.id,[...principal.roles],[...principal.team_ids],authContext.expires_epoch_ms,...predicate.values]);
    if(current.rows[0]?.current!==true)throw new AttachmentError('ATTACHMENT_AUTH_REVOKED',401);
    if(current.rows[0]?.readable!==true)failP2016('NOT_FOUND',404);
  }
  async function sources(item:Item,assets:readonly StoredAttachment[]) {
    if(!assets.length)return new Map<string,{fresh:boolean;trusted:boolean}>();
    const rows=await pool.query<{ref:string;fresh:boolean;trusted:boolean}>(`SELECT a.ref,
      i.retention_until>platform.local_now() AND m.retention_until>platform.local_now()
      AND NOT EXISTS(SELECT 1 FROM intake.contact_journey original WHERE original.retention_until_epoch_ms<=platform.physical_epoch_ms()
        AND (original.origin_intake_id=i.id OR $5='ticket' AND original.linked_ticket_id=$6::uuid AND EXISTS(
          SELECT 1 FROM intake.channel_leg own_leg WHERE own_leg.journey_id=original.id AND own_leg.source_intake_id=i.id)))
      AND (i.id=$4::uuid OR EXISTS(SELECT 1 FROM intake.contact_journey j JOIN intake.channel_leg l ON l.journey_id=j.id
        WHERE j.linked_ticket_id=$6::uuid AND l.source_intake_id=i.id AND j.retention_until_epoch_ms>platform.physical_epoch_ms())) AS fresh,
      i.privacy_class IN ('INTERNAL','SENSITIVE_INTERNAL') AND m.privacy_class IN ('INTERNAL','SENSITIVE_INTERNAL') AS trusted
      FROM unnest($1::uuid[],$2::bigint[],$3::text[],$7::text[]) a(intake_id,message_id,media_ref,ref)
      JOIN intake.service_intake_message rel ON rel.intake_id=a.intake_id AND rel.channel_message_id=a.message_id
        AND rel.relation_type IN ('PRIMARY','SUPPLEMENT','CLARIFICATION')
      JOIN intake.service_intake i ON i.id=rel.intake_id JOIN channel.message_inbox m ON m.id=rel.channel_message_id
      WHERE (i.id=$4::uuid OR $5='ticket' AND EXISTS(SELECT 1 FROM intake.contact_journey j JOIN intake.channel_leg l ON l.journey_id=j.id
        WHERE j.linked_ticket_id=$6::uuid AND l.source_intake_id=i.id))
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.normalized_message->'content')='array' THEN m.normalized_message->'content' ELSE '[]'::jsonb END) body
        WHERE body->>'kind'='media' AND body->'media'->>'download_ref'=a.media_ref)`,
      [assets.map(a=>a.source_intake_id),assets.map(a=>a.source_message_id),assets.map(a=>a.media_ref),item.intake_id,item.kind,item.id,assets.map(a=>a.ref)]);
    return new Map(rows.rows.map(r=>[r.ref,{fresh:r.fresh,trusted:r.trusted}]));
  }
  async function authorize(authContext:Context['authContext'],kind:string,id:string,ref:string) {
    const item=await query.authorizedItem(authContext,kind,id);
    if(!enabled||!store||stopped)throw new AttachmentError('ATTACHMENT_STORAGE_UNAVAILABLE',503);
    const asset=(await store.entries()).find(a=>a.ref===ref);if(!asset)throw new AttachmentError('ATTACHMENT_NOT_FOUND',404);
    const source=(await sources(item,[asset])).get(ref);if(!source)throw new AttachmentError('ATTACHMENT_NOT_FOUND',404);
    if(!source.fresh)throw new AttachmentError('ATTACHMENT_EXPIRED',410);
    if(!source.trusted)throw new AttachmentError('ATTACHMENT_UNTRUSTED');
    const reason=attachmentReason(asset);if(reason)throw new AttachmentError('ATTACHMENT_'+reason,reason==='EXPIRED'?410:422);
    // The final check follows every source/READ wait, including each subsequent chunk.
    await requireSession(authContext,kind,id);
    return asset;
  }
  async function list(authContext:Context['authContext'],kind:string,id:string,signal:AbortSignal):Promise<AttachmentPage> {
    const item=await query.authorizedItem(authContext,kind,id);if(!enabled||!store||stopped)return EMPTY;
    let assets:readonly StoredAttachment[];try{assets=await store.entries();}catch{return EMPTY;}
    const allowed=await sources(item,assets),selected=assets.filter(a=>allowed.has(a.ref)).slice(0,LIMIT+1),items:AttachmentMetadata[]=[];
    for(const asset of selected.slice(0,LIMIT)){
      signal.throwIfAborted();const source=allowed.get(asset.ref);let reason:AttachmentReason|null=source?.fresh===false?'EXPIRED':source?.trusted===false?'UNTRUSTED':attachmentReason(asset);
      // Server-side validation is bounded and serial; no attachment content is sent or prefetched by the browser.
      if(!reason&&!metadataOnly){try{const lease=await store.open(asset.ref,signal);try{sameRegistration(asset,lease.asset);}finally{await lease.close();}}catch(error){const code=error instanceof AttachmentError?error.code.replace('ATTACHMENT_',''):'STORAGE_UNAVAILABLE';reason=['EXPIRED','MISSING','OVERSIZED','UNSUPPORTED','UNTRUSTED','INTEGRITY_FAILED','BUSY'].includes(code)?code as AttachmentReason:'STORAGE_UNAVAILABLE';}}
      items.push(visible(asset,reason));
    }
    await requireSession(authContext,kind,id);
    return {available:true,reason:null,items,truncated:selected.length>LIMIT};
  }
  return Object.freeze({
    async handler(context:Context) {
      const {request,response,url,authContext,json}=context;
      const metadata=/^\/api\/workbench\/items\/(ticket|review|intake)\/([a-f0-9-]{36})\/attachments$/iu.exec(url.pathname);
      const content=/^\/api\/attachments\/([a-f0-9-]{36})$/u.exec(url.pathname);
      if(!metadata&&!content)return false;
      if(request.method!=='GET')failP2016('NOT_FOUND',404);
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new AttachmentError('ATTACHMENT_TIMEOUT',504)),ATTACHMENT_DEADLINE_MS);timer.unref();active.add(controller);
      const disconnected=()=>controller.abort();response.once('close',disconnected);let complete=()=>{};
      try{
        if(stopped)throw new AttachmentError('ATTACHMENT_STORAGE_UNAVAILABLE',503);
        if(operation)throw new AttachmentError('ATTACHMENT_BUSY',429);
        operation=controller;settled=new Promise<void>(resolve=>{complete=resolve;});
        if(metadata){if(url.searchParams.size)failP2016();json(response,200,await list(authContext,metadata[1]??'',metadata[2]??'',controller.signal));return true;}
        if(request.headers.range)throw new AttachmentError('ATTACHMENT_RANGE_NOT_SUPPORTED',416);
        if([...url.searchParams.keys()].some(k=>!['kind','id'].includes(k))||['kind','id'].some(k=>url.searchParams.getAll(k).length!==1))failP2016();
        const kind=url.searchParams.get('kind')??'',id=url.searchParams.get('id')??'',ref=content?.[1]??'';
        const asset=await authorize(authContext,kind,id,ref);if(!store)throw new AttachmentError('ATTACHMENT_STORAGE_UNAVAILABLE',503);
        const lease=await store.open(ref,controller.signal);
        try{
          sameRegistration(asset,lease.asset);sameRegistration(asset,await authorize(authContext,kind,id,ref));controller.signal.throwIfAborted();
          response.writeHead(200,{'content-type':asset.mime_type,'content-length':asset.byte_size,'content-disposition':'attachment; filename="report-attachment.'+(asset.mime_type==='image/png'?'png':'jpg')+'"','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"sandbox; default-src 'none'"});
          for await(const chunk of lease.stream){controller.signal.throwIfAborted();if(BigInt(authContext.expires_epoch_ms)<=BigInt(Date.now()))throw new AttachmentError('ATTACHMENT_AUTH_EXPIRED',401);sameRegistration(asset,await authorize(authContext,kind,id,ref));if(!response.write(chunk))await once(response,'drain',{signal:controller.signal});}
          response.end();
        }finally{await lease.close();}
        return true;
      }catch(error){if(response.headersSent){response.destroy();return true;}if(error instanceof AttachmentError){json(response,error.status,{error:{code:error.code,retryable:error.status>=500||error.status===429}});return true;}throw error;}
      finally{clearTimeout(timer);response.off('close',disconnected);active.delete(controller);if(operation===controller){operation=null;complete();}}
    },
    async close(){stopped=true;for(const controller of active)controller.abort();await store?.close();await settled;},
  });
}
