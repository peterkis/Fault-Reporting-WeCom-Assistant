import {createHash} from 'node:crypto';
import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import {createThirdPartyStaffDirectoryAdapter} from './p2-007-third-party-staff-directory-adapter.mjs';
import {createBotRawUidResolver,matchDirectoryProfile} from './p2-007-staff-directory-contracts.mjs';
import type {DirectorySnapshot} from './p2-007-staff-directory-contracts.mjs';
import type {WorkbenchHttpOptions} from './p2-006-workbench-http.mjs';
import type {createWeb01WorkbenchQuery} from './web01-workbench-query.mjs';
import type {createWeComWorkbenchAuthentication} from './p2-016-workbench-wecom-auth.mjs';
import {uuidP2016,failP2016} from './p2-016-domain-contracts.mjs';
import {WorkbenchError} from './p2-006-workbench-query.mjs';
import {createPilotWorkbenchAuthorizationAdapter} from './p2-006-workbench-authorization.mjs';
import {ticketPredicateP2016} from './p2-016-ticket-query.mjs';
import {workbenchSearchCardsSql} from './web01-workbench-query.mjs';

const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const hosts=new Set(['wx.qlogo.cn','wework.qlogo.cn','p.qlogo.cn','shp.qpic.cn','wework.qpic.cn']);
export function trustedActorAvatarUrl(value:unknown):URL|null{
  if(typeof value!=='string'||value.length>2048)return null;
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.hash&&hosts.has(url.hostname)?url:null;}catch{return null;}
}
export async function actorAvatarSchemaReady(pool:PostgresTransaction){
  const result=await pool.query<{ready:boolean}>(`SELECT EXISTS(SELECT 1 FROM platform.schema_migration WHERE migration_id='068_workbench_actor_avatar_cache')
    AND NOT EXISTS(SELECT 1 FROM (VALUES
      ('principal_id','uuid',true),('identity_hash','text',true),('status','text',true),('avatar_bytes','bytea',false),
      ('avatar_sha256','text',false),('error_code','text',false),('attempted_epoch_ms','int8',true),('expires_epoch_ms','int8',true)
    ) expected(name,type_name,required) LEFT JOIN pg_attribute a ON a.attrelid=to_regclass('workbench.actor_avatar_cache')
      AND a.attname=expected.name AND a.attnum>0 AND NOT a.attisdropped
      LEFT JOIN pg_type t ON t.oid=a.atttypid
      WHERE a.attname IS NULL OR t.typname<>expected.type_name OR a.attnotnull<>expected.required) AS ready`);
  return result.rows[0]?.ready===true;
}

// A stable cohort avoids starving every actor when more than 256 staff exist.
// Role loss and cohort changes also remove stale cache rows on an otherwise idle run.
const eligibleActorsSql=`SELECT p.id,p.wecom_user_id FROM pilot_ticket.pilot_principal p
  WHERE p.is_active AND EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal_role r
    WHERE r.principal_id=p.id AND r.role IN ('ADMIN','DISPATCHER','HANDLER'))
  ORDER BY p.id LIMIT 256`;
const pruneActorsSql=`DELETE FROM workbench.actor_avatar_cache c WHERE NOT EXISTS(SELECT 1 FROM eligible p WHERE p.id=c.principal_id)`;

/** Current display cache only; provider credentials and full directory responses remain in Worker. */
export function createWorkbenchActorAvatarWorker({pool,keyProvider,rootRef,fetchImpl=fetch,enabled=false}:{pool:PostgresTransaction;keyProvider:()=>string;rootRef:string;fetchImpl?:typeof fetch;enabled?:boolean}){
  if(typeof enabled!=='boolean'||enabled&&(!rootRef||rootRef.length>256))throw Error('ACTOR_AVATAR_CONFIG_INVALID');
  const provider=createThirdPartyStaffDirectoryAdapter({keyProvider,uidResolver:createBotRawUidResolver(),fetchImpl,timeoutMs:5000});
  let tree:DirectorySnapshot|null=null,treeExpires=0,closed=false,running:Promise<{processed:boolean}>|null=null,current:AbortController|null=null;
  async function image(url:URL,signal:AbortSignal){
    const response=await fetchImpl(url,{method:'GET',redirect:'error',signal});
    if(!response.ok||!/^image\/(jpeg|png|webp)(?:;|$)/u.test(response.headers.get('content-type')??''))throw Error('ACTOR_AVATAR_IMAGE_UNAVAILABLE');
    const reader=response.body?.getReader();if(!reader)throw Error('ACTOR_AVATAR_IMAGE_UNAVAILABLE');
    const input=Buffer.alloc(512*1024);let size=0,complete=false;
    try{
      for(;;){signal.throwIfAborted();const part=await reader.read();if(part.done){complete=true;break;}if(size+part.value.length>input.length)throw Error('ACTOR_AVATAR_IMAGE_OVERSIZED');input.set(part.value,size);size+=part.value.length;}
      if(!size)throw Error('ACTOR_AVATAR_IMAGE_UNAVAILABLE');
      const {default:sharp}=await import('sharp');sharp.concurrency(1);sharp.cache(false);
      const options={limitInputPixels:4_194_304,failOn:'error' as const};const meta=await sharp(input.subarray(0,size),options).metadata();
      if((meta.pages??1)!==1)throw Error('ACTOR_AVATAR_IMAGE_INVALID');
      const bytes=await sharp(input.subarray(0,size),options).autoOrient().resize(64,64,{fit:'cover'}).webp({quality:90,effort:4}).timeout({seconds:5}).toBuffer();
      if(signal.aborted||!bytes.length||bytes.length>32768){bytes.fill(0);throw Error('ACTOR_AVATAR_IMAGE_INVALID');}return bytes;
    }finally{input.fill(0);if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  async function processOne():Promise<{processed:boolean}>{
    if(!enabled||closed)return {processed:false};
    const rows=await pool.query<{id:string;wecom_user_id:string;identity_hash:string|null;expires_epoch_ms:string|null}>(`WITH eligible AS MATERIALIZED(${eligibleActorsSql}),pruned AS(${pruneActorsSql})
      SELECT p.id::text,p.wecom_user_id,c.identity_hash,c.expires_epoch_ms::text FROM eligible p
      LEFT JOIN workbench.actor_avatar_cache c ON c.principal_id=p.id ORDER BY c.expires_epoch_ms NULLS FIRST,p.id`);
    if(closed)return {processed:false};
    const row=rows.rows.find(value=>value.identity_hash!==digest(value.wecom_user_id)||BigInt(value.expires_epoch_ms??'0')<=BigInt(Date.now()));if(!row)return {processed:false};
    const controller=new AbortController();current=controller;const timer=setTimeout(()=>controller.abort(),10_000);timer.unref();let bytes:Buffer|null=null,errorCode:string|null=null;
    try{
      if(!tree||treeExpires<=Date.now()){tree=await provider.syncOrganizationTree({source_scope:'PC_ACTOR_AVATARS',root_ref:rootRef,signal:controller.signal});treeExpires=Date.now()+3600_000;}
      const profile=await provider.getPersonProfile({source_identity:{namespace:'WECOM_AIBOT',value:row.wecom_user_id},signal:controller.signal});
      if(profile.status!=='RESOLVED')throw Error('ACTOR_AVATAR_PROFILE_UNAVAILABLE');
      const matches=tree.members.filter(member=>member.provider_user_id===profile.profile.provider_user_id);
      if(matches.length!==1||!matchDirectoryProfile(profile.profile,matches[0]).matched){tree=null;throw Error('ACTOR_AVATAR_IDENTITY_MISMATCH');}
      const url=trustedActorAvatarUrl(profile.profile.avatar_url);if(!url)throw Error('ACTOR_AVATAR_IMAGE_UNAVAILABLE');
      bytes=await image(url,controller.signal);controller.signal.throwIfAborted();
    }catch(error){errorCode=error instanceof Error&&/^ACTOR_AVATAR_[A-Z_]{1,80}$/u.test(error.message)?error.message:'ACTOR_AVATAR_REFRESH_UNAVAILABLE';bytes?.fill(0);bytes=null;}
    finally{clearTimeout(timer);controller.abort();current=null;}
    try{
      if(closed)return {processed:false};
      // A changed source identity cannot inherit an earlier person's cached photo.
      await pool.query(`WITH eligible AS MATERIALIZED(${eligibleActorsSql}),pruned AS(${pruneActorsSql}),stamp AS(SELECT platform.physical_epoch_ms() AS epoch)
        INSERT INTO workbench.actor_avatar_cache(principal_id,identity_hash,status,avatar_bytes,avatar_sha256,error_code,attempted_epoch_ms,expires_epoch_ms)
        SELECT p.id,$3,$4,$5,$6,$7,stamp.epoch,stamp.epoch+$8::bigint FROM eligible p CROSS JOIN stamp WHERE p.id=$1::uuid AND p.wecom_user_id=$2
        ON CONFLICT(principal_id) DO UPDATE SET identity_hash=EXCLUDED.identity_hash,status=EXCLUDED.status,avatar_bytes=EXCLUDED.avatar_bytes,avatar_sha256=EXCLUDED.avatar_sha256,error_code=EXCLUDED.error_code,attempted_epoch_ms=EXCLUDED.attempted_epoch_ms,expires_epoch_ms=EXCLUDED.expires_epoch_ms`,
        [row.id,row.wecom_user_id,digest(row.wecom_user_id),bytes?'READY':'UNAVAILABLE',bytes,bytes?digest(bytes):null,errorCode,bytes?86400_000:300_000]);
      return {processed:true};
    }finally{bytes?.fill(0);}
  }
  return Object.freeze({
    runOnce(){if(running)return running;running=processOne().finally(()=>{running=null;});return running;},
    async close(){closed=true;current?.abort();try{await running;}finally{tree=null;provider.close();}},
  });
}

type Context=Parameters<NonNullable<WorkbenchHttpOptions['authenticatedHandler']>>[0];
/** Every image is scoped to an existing actor on an item the current staff session can read. */
export function createWorkbenchActorAvatarHttp({pool,query,enabled=false,currentSessionPredicate,localTestProfile=false}:{pool:PostgresTransaction;query:Pick<ReturnType<typeof createWeb01WorkbenchQuery>,'authorizedItem'>;enabled?:boolean;currentSessionPredicate?:ReturnType<typeof createWeComWorkbenchAuthentication>['currentSessionPredicate'];localTestProfile?:boolean}){
  const authorization=createPilotWorkbenchAuthorizationAdapter({pool});
  return async({request,response,url,authContext}:Context)=>{
    const match=/^\/api\/workbench\/items\/(ticket|review|intake)\/([0-9a-f-]{36})\/actor-avatars\/([0-9a-f-]{36})$/iu.exec(url.pathname);
    if(!match)return false;if(!enabled)failP2016('NOT_FOUND',404);if(request.method!=='GET'||url.searchParams.size)failP2016();
    const kind=match[1]??'',id=uuidP2016(match[2]),actor=uuidP2016(match[3]);
    // Only Ticket events expose actor_ref. Refuse aliases whose review-to-ticket
    // relation could change independently while this image request is waiting.
    if(kind!=='ticket')failP2016('NOT_FOUND',404);
    const item=await query.authorizedItem(authContext,kind,id,false);if(item.kind!=='ticket')failP2016('NOT_FOUND',404);
    const final=await query.authorizedItem(authContext,kind,id,false);
    if(final.kind!==item.kind||final.id!==item.id||final.intake_id!==item.intake_id)failP2016('NOT_FOUND',404);
    const principal=await authorization.resolvePrincipal(authContext);if(!principal)failP2016('NOT_FOUND',404);
    const scope=ticketPredicateP2016(principal),guard=currentSessionPredicate?.(authContext,authContext.principal_id,11);
    if(!guard&&(!localTestProfile||'session_id' in authContext))failP2016('ACTION_FAILED',503);
    // The final statement checks current READ, the same original item, current
    // session and current avatar identity together. No projection wait follows it.
    const result=await pool.query<{identity_hash:string|null;wecom_user_id:string|null;avatar_bytes:Buffer|null;avatar_sha256:string|null;readable:boolean;session_current:boolean}>(workbenchSearchCardsSql(true)+` SELECT
      EXISTS(SELECT 1 FROM cards WHERE kind=$4 AND id=$5::text AND intake_id=$6) AND EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal reader
        WHERE reader.id=$2::uuid AND reader.is_active
          AND ARRAY(SELECT role FROM pilot_ticket.pilot_principal_role WHERE principal_id=reader.id ORDER BY role COLLATE "C")=$7::text[]
          AND ARRAY(SELECT team_id FROM pilot_ticket.pilot_team_member WHERE principal_id=reader.id ORDER BY team_id COLLATE "C")=$8::text[]) AS readable,
      ($9::bigint>platform.physical_epoch_ms() AND ${guard?.sql??'TRUE'}) AS session_current,
      cached.identity_hash,cached.wecom_user_id,cached.avatar_bytes,cached.avatar_sha256
      FROM (SELECT 1) one LEFT JOIN LATERAL(
        SELECT c.identity_hash,p.wecom_user_id,c.avatar_bytes,c.avatar_sha256 FROM pilot_ticket.pilot_principal p
        JOIN workbench.actor_avatar_cache c ON c.principal_id=p.id AND c.status='READY' AND c.expires_epoch_ms>platform.physical_epoch_ms()
        WHERE p.id=$10::uuid AND p.is_active AND EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal_role r
          WHERE r.principal_id=p.id AND r.role IN ('ADMIN','DISPATCHER','HANDLER'))
          AND EXISTS(SELECT 1 FROM pilot_ticket.ticket_event e WHERE e.ticket_id=$5::uuid AND e.operator_id=p.id::text)
      ) cached ON TRUE`,[...scope.values,item.kind,item.id,item.intake_id,[...principal.roles],[...principal.team_ids],authContext.expires_epoch_ms,actor,...(guard?.values??[])]);
    const cached=result.rows[0];
    if(cached?.session_current!==true)throw new WorkbenchError('WORKBENCH_UNAUTHENTICATED',401);
    if(!cached.readable)failP2016('NOT_FOUND',404);
    const bytes=cached?.avatar_bytes;
    if(!cached.wecom_user_id||cached.identity_hash!==digest(cached.wecom_user_id)||!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>32768||digest(bytes)!==cached.avatar_sha256){response.writeHead(204,{'cache-control':'private, no-store'});response.end();return true;}
    response.writeHead(200,{'content-type':'image/webp','content-length':bytes.length,'cache-control':'private, no-store','x-content-type-options':'nosniff'});response.end(bytes);return true;
  };
}
