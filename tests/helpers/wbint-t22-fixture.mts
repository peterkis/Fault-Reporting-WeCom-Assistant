import {randomUUID} from 'node:crypto';
import {withWeb01Fixture} from './web01-workbench-fixture.mjs';
import {buildConversationThreadIdentity,buildConversationSessionScope} from '../../app/server/src/p2-001-conversation-contracts.mjs';
import {createP2016Runtime} from '../../app/server/src/p2-016-runtime.mjs';
import {createP2G1TestAuthentication} from '../../app/server/src/p2-g1-test-authentication.mjs';
import {computeTimelineCanonicalOrderKey} from '../../app/server/src/p2-002-timeline-projector.mjs';
import type {G1AuthenticationPort} from '../../app/server/src/p2-g1-runtime.mjs';
import type {P2016EnabledRuntime} from '../../app/server/src/p2-016-runtime.mjs';
import type {PostgresPool} from '../../app/server/src/platform/postgres-pool.mjs';
import {migrateP2012} from '../../app/server/scripts/p2-012-migrate.mjs';
import {migrateYxxSelfService} from '../../app/server/scripts/yxx-self-service-migrate.mjs';
import {migrateWorkbenchManualReports} from '../../app/server/scripts/workbench-manual-reports-migrate.mjs';
import {migrateWorkbenchPersonalRead} from '../../app/server/scripts/workbench-personal-read-migrate.mjs';
interface Base {databaseUrl:string;pool:PostgresPool;tickets:{ticket:{id:string};intake:{intakeId:string;messageId:string}}[];principals:{id:string}[];outsider:{id:string};runtime:P2016EnabledRuntime;origin:string}
export interface T22Session {id:string;intakeId:string;ticketId:string;reporter:string;rowVersion:number}
export interface T22Fixture extends Base {sessions:T22Session[];cookie:string;outsiderCookie:string;handlerCookie:string;browserCookie:{name:string;value:string;url:string|undefined;httpOnly:true;secure:boolean;sameSite:'Strict';expires:number};restoreResponses:()=>void;bootstrapAuthenticationBoundary?:{armNext:(callback:()=>Promise<void>)=>void;readonly calls:number;readonly authenticatedPrincipalId:string|null}}
export async function appendT22Item(pool:Pick<PostgresPool,'query'>,sessionId:string,sequence:number,text:string,daysAgo=0){
  const sourceId=randomUUID(),clock=(await pool.query<{occurred_at:string;retention_until:string}>(`SELECT platform.local_now()-($1::text||' days')::interval AS occurred_at,platform.local_now()+interval '30 days' AS retention_until`,[daysAgo])).rows[0];if(!clock)throw Error('T22_CLOCK_REQUIRED');
  const canonical=computeTimelineCanonicalOrderKey({schema_version:1,projector_name:'CONVERSATION_TIMELINE',projector_version:'P2-G1.1',source_stream:'CHANNEL_MESSAGE_INBOX',source_type:'CHANNEL_MESSAGE',source_id:sourceId,projection_variant:'T22_FIXTURE',session_id:sessionId,item_type:'USER_MESSAGE',sender_kind:'USER',visibility:'EXTERNAL',text,safe_content:{},occurred_at:clock.occurred_at,source_ordinal:String(sequence),privacy_class:'INTERNAL',retention_until:clock.retention_until});
  const result=await pool.query<{id:string}>(`INSERT INTO conversation.item(session_id,sequence_no,item_type,sender_kind,visibility,text,safe_content,source_type,source_id,projection_variant,canonical_order_key,content_hash,privacy_class,retention_until,occurred_at)
    VALUES($1::uuid,$2,'USER_MESSAGE','USER','EXTERNAL',$3,'{}','CHANNEL_MESSAGE',$4,'T22_FIXTURE',$5,$6,'INTERNAL',$7::timestamp without time zone,$8::timestamp without time zone) RETURNING id::text`,[sessionId,sequence,text,sourceId,canonical,'c'.repeat(64),clock.retention_until,clock.occurred_at]);
  return result.rows[0]?.id??'';
}
export async function appendT22LiveItem(pool:PostgresPool,sessionId:string,text:string,daysAgo=0){
  const transaction=await pool.connect();
  try{
    await transaction.query('BEGIN');
    await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',['P2_002_SESSION:'+sessionId]);
    const sequence=(await transaction.query<{sequence:number}>('SELECT (COALESCE(max(sequence_no),0)+1)::integer AS sequence FROM conversation.item WHERE session_id=$1::uuid',[sessionId])).rows[0]?.sequence;if(sequence===undefined)throw Error('T22_LIVE_SEQUENCE_REQUIRED');
    const id=await appendT22Item(transaction,sessionId,sequence,text,daysAgo);await transaction.query('COMMIT');return id;
  }catch(error){try{await transaction.query('ROLLBACK');}catch{/* preserve the arrangement failure */}throw error;}
  finally{transaction.release();}
}
export async function withT22Fixture(run:(fixture:T22Fixture)=>Promise<void>,{enabled=true,inbox=false,realtime=false,personalRead=false,recovery=true,dropResponses=false,bootstrapRoleRace=false}:{enabled?:boolean;inbox?:boolean;realtime?:boolean;personalRead?:boolean;recovery?:boolean;dropResponses?:boolean;bootstrapRoleRace?:boolean}={}){
  await withWeb01Fixture(async(f:Base)=>{
    await f.runtime.stop();const sessions:T22Session[]=[];
    if(personalRead){const input={databaseUrl:f.databaseUrl,mode:'apply' as const};await migrateP2012(input);await migrateYxxSelfService(input);await migrateWorkbenchManualReports(input);await migrateWorkbenchPersonalRead(input);}
    const identity=buildConversationThreadIdentity({provider:'WECOM_AIBOT',botId:'t22-synthetic-bot',chatType:'group',chatId:'t22-private-group-id',senderUserId:'t22-reporter-a'});
    const thread=(await f.pool.query<{id:string}>(`INSERT INTO conversation.thread(provider,channel_account_id,chat_type,external_thread_key,thread_key,last_activity_at)
      VALUES($1,$2,$3,$4,$5,platform.local_now()) RETURNING id::text`,[identity.provider,identity.channel_account_id,identity.chat_type,identity.external_thread_key,identity.thread_key])).rows[0];if(!thread)throw Error('T22_THREAD_REQUIRED');
    for(let index=0;index<3;index++){
      const ticket=f.tickets[index],reporter=index===1?'t22-reporter-b':'t22-reporter-a';if(!ticket)throw Error('T22_TICKET_REQUIRED');
      await f.pool.query(`UPDATE intake.service_intake SET source_provider='WECOM_AIBOT',source_bot_id=$2,source_chat_type='group',source_chat_id=$3,reporter_wecom_userid=$4 WHERE id=$1::uuid`,[ticket.intake.intakeId,identity.channel_account_id,identity.external_thread_key,reporter]);
      const scope=buildConversationSessionScope({threadKey:identity.thread_key,participantKey:reporter,serviceIntakeId:ticket.intake.intakeId,creationIdempotencyKey:'T22:'+randomUUID()});
      const row=(await f.pool.query<{id:string;row_version:number}>(`INSERT INTO conversation.session(thread_id,participant_key,service_intake_id,session_scope_key,creation_idempotency_key,status,control_mode,last_activity_at,ended_at,close_reason)
        VALUES($1::uuid,$2,$3::uuid,$4,$5,$6,'HUMAN',platform.local_now(),CASE WHEN $6='ENDED' THEN platform.local_now() END,CASE WHEN $6='ENDED' THEN 'SYNTHETIC_ENDED' END) RETURNING id::text,row_version::integer`,[thread.id,scope.participant_key,ticket.intake.intakeId,scope.session_scope_key,scope.creation_idempotency_key,index===2?'ENDED':'OPEN'])).rows[0];if(!row)throw Error('T22_SESSION_REQUIRED');
      sessions.push({id:row.id,intakeId:ticket.intake.intakeId,ticketId:ticket.ticket.id,reporter,rowVersion:row.row_version});
      await appendT22Item(f.pool,row.id,1,['参与者甲的打印机主题','参与者乙的护理主题','参与者甲的读卡主题'][index]??'合成主题');
    }
    const principalIds=[f.principals[0]?.id??'',f.outsider.id,f.principals[1]?.id??''];
    // Test-only role mutation between two genuine authority reads; both return their real result.
    const originalAuthentication=bootstrapRoleRace?createP2G1TestAuthentication({pool:f.pool,principalIds,publicOrigin:f.origin}):null;
    let nextBootstrapCallback:(()=>Promise<void>)|null=null,bootstrapCallbackArmed=false,bootstrapCallbackCalls=0,authenticatedPrincipalId:string|null=null;
    const bootstrapAuthenticationBoundary=originalAuthentication?{armNext:(callback:()=>Promise<void>)=>{if(bootstrapCallbackArmed)throw Error('T22_BOOTSTRAP_CALLBACK_ALREADY_ARMED');bootstrapCallbackArmed=true;nextBootstrapCallback=callback;},get calls(){return bootstrapCallbackCalls;},get authenticatedPrincipalId(){return authenticatedPrincipalId;}}:undefined;
    const workbenchAuthentication:G1AuthenticationPort|null=originalAuthentication?{browserCookies:originalAuthentication.browserCookies,authenticate:async request=>{
      const originalContext=await originalAuthentication.authenticate(request);
      if(originalContext&&request.method==='GET'&&request.url==='/api/lifecycle/bootstrap'&&nextBootstrapCallback){
        const callback=nextBootstrapCallback;nextBootstrapCallback=null;authenticatedPrincipalId=originalContext.principal_id;bootstrapCallbackCalls++;await callback();
      }
      return originalContext;
    }}:null;
    const runtime=createP2016Runtime({pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),principalIds,workbenchAuthentication,externalSendEnabled:false,...{workbenchConversationsEnabled:enabled,workbenchConversationInboxEnabled:inbox,workbenchRealtimeEnabled:realtime,workbenchPersonalReadEnabled:personalRead,identityHmacKey:inbox?'conversation-inbox-synthetic-key-v1':undefined},workbenchDraftRecoveryEnabled:recovery});
    let dropping=dropResponses;
    if(dropResponses)runtime.server.on('request',(request,response)=>{if(!/\/messages$/u.test(request.url??''))return;const end=response.end.bind(response);response.end=((...args:Parameters<typeof response.end>)=>{if(response.statusCode===202&&dropping){request.socket.destroy();return response;}return end(...args);}) as typeof response.end;});
    try{const started=await runtime.start(),[first,other,handler]=started.cookies??[];if(!first||!other||!handler)throw Error('T22_AUTH_REQUIRED');
      await run({...f,runtime,sessions,cookie:first.name+'='+first.value,outsiderCookie:other.name+'='+other.value,handlerCookie:handler.name+'='+handler.value,browserCookie:first,restoreResponses:()=>{dropping=false;},...(bootstrapAuthenticationBoundary?{bootstrapAuthenticationBoundary}:{})});
    }finally{nextBootstrapCallback=null;await runtime.stop();if(runtime.server.listening)throw Error('T22_SERVER_NOT_CLOSED');}
  });
}

