import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir,cpus,totalmem} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {brotliCompressSync,constants,gzipSync} from 'node:zlib';
import WebSocket from 'ws';
import {execFileSync} from 'node:child_process';
import {runH5BrowserQa} from './yxx-h5-performance-qa.mjs';
import {explainLargeConcurrency,measureLargeConcurrency,seedLargeConcurrencyDataset} from './yxx-h5-large-performance.mjs';
import {startH5PerformanceWorker} from './yxx-h5-performance-worker-controller.mjs';
import {H5PerformanceSqlLedger,H5PerformanceMemberVerificationLedger,recordH5PerformanceProviderDelay,type H5PerformanceTrace} from './helpers/yxx-h5-performance-observability.mjs';
import type {ApplicationMemberVerificationEvent} from '../app/server/src/wecom-application-member.mjs';
import type {PostgresPool,PostgresPoolClient} from '../app/server/src/platform/postgres-pool.mjs';
import type {P2016EnabledRuntime} from '../app/server/src/p2-016-runtime.mjs';

interface VitalsReading {lcp:number|null;cls:number;supported:string[];events:{id:number;duration:number}[];trustedClicks:number;errors:string[]}
interface Metrics {
  WEB_VITALS_OBSERVER:string;
  isBusinessSelect(sql:string):boolean;
  percentiles(samples:readonly number[]):{count:number;min:number;p50:number;p75:number;p95:number;max:number};
  interactionMetric(reading:VitalsReading):{status:'MEASURED'|'UPPER_BOUND'|'NOT_RUN';milliseconds:number|null;trusted_clicks:number;observed_interactions:number};
}
type Trace=H5PerformanceTrace;
interface SqlSample {sha256:string;text:string;values:unknown[];owner_kind:'REQUEST'|'BATCH'|'SETUP';batch_slots:number|null;read_views:string[]}
interface Result {status:number;body:Record<string,unknown>;location:string|undefined}
interface ReadFault {afterUrge:boolean;active:boolean}
interface Config {runtimeRoot:string;outputRoot:string;mode:'baseline'|'current';samples:number;warmups:number;metricsModule:string;largeData:boolean;profile:'main390'|'weak320';largeConcurrency?:boolean}
const ACCEPT='application/vnd.yixiaoxiu.v2+json';
const contexts=new AsyncLocalStorage<Trace>();
function record(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
function hash(value:Uint8Array|string):string{return createHash('sha256').update(value).digest('hex');}
function safeError(error:unknown):string{return error instanceof Error&&/^[A-Z0-9_: .-]+$/u.test(error.message)?error.message:'H5_PERFORMANCE_RUN_FAILED';}
function config():Config{
  const runtimeRoot=process.env.H5_PERFORMANCE_RUNTIME_ROOT,outputRoot=process.env.H5_PERFORMANCE_OUTPUT_ROOT;
  assert.ok(runtimeRoot&&path.isAbsolute(runtimeRoot),'H5_PERFORMANCE_RUNTIME_ROOT must be an absolute compiled root');
  assert.ok(outputRoot&&path.isAbsolute(outputRoot)&&!existsSync(outputRoot),'H5_PERFORMANCE_OUTPUT_ROOT must be a fresh absolute directory');
  const samples=Number(process.env.H5_PERFORMANCE_SAMPLES??20),warmups=Number(process.env.H5_PERFORMANCE_WARMUPS??3);
  assert.ok(Number.isSafeInteger(samples)&&samples>=1&&samples<=20&&Number.isSafeInteger(warmups)&&warmups>=0&&warmups<=3);
  const mode=process.env.H5_PERFORMANCE_MODE==='baseline'?'baseline':'current';
  return {runtimeRoot,outputRoot,mode,samples,warmups,metricsModule:process.env.H5_PERFORMANCE_METRICS_MODULE??fileURLToPath(new URL('../../tools/h5-performance-metrics.mjs',import.meta.url)),largeData:process.env.H5_PERFORMANCE_LARGE_DATA==='1',profile:process.env.H5_PERFORMANCE_PROFILE==='weak320'?'weak320':'main390',largeConcurrency:process.env.H5_PERFORMANCE_LARGE_CONCURRENCY==='1'};
}
function instrumentPool(pool:PostgresPool,metrics:Metrics,samples:Map<string,SqlSample>,ledger:H5PerformanceSqlLedger):PostgresPool{
  const traced=new WeakSet<object>(),poolQuery=new AsyncLocalStorage<boolean>(),originalPoolQuery=pool.query,originalConnect=pool.connect;
  function invoke(target:object,original:PostgresPool['query'],args:unknown[],mode:'CONNECTED_CLIENT'|'POOL_QUERY_WITH_INTERNAL_CHECKOUT'):unknown{
    const context=contexts.getStore(),first=args[0],sql=typeof first==='string'?first:first&&typeof first==='object'&&'text' in first?String(first.text):'';
    const business=metrics.isBusinessSelect(sql),sha256=hash(sql),statement=ledger.beginStatement({sha256,business_select:business,mode},context);
    if(business&&(context||statement.kind==='BATCH')&&samples.size<128){
      const values=Array.isArray(args[1])?args[1]:first&&typeof first==='object'&&'values' in first&&Array.isArray(first.values)?first.values:[],batchSlots=statement.kind==='BATCH'?statement.participant_ids.length:null,key=sha256+':'+(batchSlots??'direct');
      const views=ledger.statementViews(statement),existing=samples.get(key);if(existing)existing.read_views=[...new Set([...existing.read_views,...views])].sort();else samples.set(key,{sha256,text:sql,values,owner_kind:statement.kind,batch_slots:batchSlots,read_views:views});
    }
    let finished=false;const finish=(error?:unknown)=>{if(finished)return;finished=true;ledger.finishStatement(statement,error);};
    let callbackIndex=-1;for(let index=args.length-1;index>=0;index--)if(typeof args[index]==='function'){callbackIndex=index;break;}const callback=callbackIndex>=0?args[callbackIndex]:undefined;
    if(typeof callback==='function')args=args.map((value,index)=>index===callbackIndex?function(this:unknown,...received:unknown[]){finish(received[0]??undefined);return Reflect.apply(callback,this,received);}:value);
    try{const result:unknown=Reflect.apply(original,target,args);if(result instanceof Promise)return result.then(value=>{finish();return value;},(error:unknown)=>{finish(error);throw error;});if(typeof callback!=='function')finish();return result;}
    catch(error){finish(error);throw error;}
  }
  function retainGuard(original:PostgresPool['query'],wrapper:object):void{const guarded=Object.getOwnPropertyDescriptor(original,'__arch005Guarded');if(guarded?.value===true)Object.defineProperty(wrapper,'__arch005Guarded',{value:true});}
  function client(value:unknown):PostgresPoolClient{
    assert.ok(value&&typeof value==='object'&&'query' in value&&typeof value.query==='function'&&'release' in value&&typeof value.release==='function');const actual=value as PostgresPoolClient;if(traced.has(actual))return actual;traced.add(actual);
    const original=actual.query,wrapped=function(...args:unknown[]):unknown{return poolQuery.getStore()===true?Reflect.apply(original,actual,args):invoke(actual,original,args,'CONNECTED_CLIENT');};retainGuard(original,wrapped);Object.defineProperty(actual,'query',{value:wrapped,writable:true,configurable:true});return actual;
  }
  const wrappedPoolQuery=function(...args:unknown[]):unknown{return poolQuery.run(true,()=>invoke(pool,originalPoolQuery,args,'POOL_QUERY_WITH_INTERNAL_CHECKOUT'));};retainGuard(originalPoolQuery,wrappedPoolQuery);Object.defineProperty(pool,'query',{value:wrappedPoolQuery,writable:true,configurable:true});
  Object.defineProperty(pool,'connect',{writable:true,configurable:true,value:function(...args:unknown[]):unknown{
    const checkout=poolQuery.getStore()===true?null:ledger.beginCheckout(contexts.getStore());let finished=false;const finish=(error?:unknown)=>{if(finished)return;finished=true;if(checkout)ledger.finishCheckout(checkout,error);};
    const callback=args[0];try{if(typeof callback==='function')return Reflect.apply(originalConnect,pool,[function(this:unknown,...received:unknown[]){finish(received[0]??undefined);if(received[1])received[1]=client(received[1]);return Reflect.apply(callback,this,received);},...args.slice(1)]);
      const result:unknown=Reflect.apply(originalConnect,pool,args);if(result instanceof Promise)return result.then(value=>{finish();return client(value);},(error:unknown)=>{finish(error);throw error;});finish();return result;
    }catch(error){finish(error);throw error;}
  }});return pool;
}
function observeRequests(runtime:P2016EnabledRuntime,traces:Trace[],fault:ReadFault,ledger:H5PerformanceSqlLedger):void{
  const listeners=runtime.server.listeners('request');runtime.server.removeAllListeners('request');
  runtime.server.on('request',(request:IncomingMessage,response:ServerResponse)=>{
    const url=new URL(request.url??'/','http://127.0.0.1');
    const supplied=request.headers['x-h5-performance-id'],id=typeof supplied==='string'?supplied.slice(0,96):'setup';
    const trace=ledger.createTrace(id,url.pathname,url.searchParams.get('view'));ledger.bindRequest(request,trace);let finished=false;
    const finish=(complete:boolean)=>{if(finished)return;finished=true;ledger.finishTrace(request,trace,complete?response.statusCode:0,complete);if(id!=='setup')traces.push(trace);if(complete&&fault.afterUrge&&url.pathname.endsWith('/urge')&&response.statusCode===200){fault.afterUrge=false;fault.active=true;}};
    response.once('finish',()=>finish(true));response.once('close',()=>finish(response.writableFinished));
    if(fault.active&&url.pathname==='/api/yixiaoxiu/h5/entry'){response.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});response.end('{"error":{"code":"SYNTHETIC_READ_UNAVAILABLE"}}');return;}
    contexts.run(trace,()=>{for(const listener of listeners)Reflect.apply(listener,runtime.server,[request,response]);});
  });
}
export function createH5PerformanceHttpClient(base:string,origin:()=>string){
  const cookies=new Map<string,string>();let csrf='',recoveryScope='';
  async function send(route:string,{method='GET',body,id='setup',commandId,contentType}:{method?:string;body?:Record<string,unknown>|Buffer;id?:string;commandId?:string;contentType?:string}={}):Promise<Result>{
    const bytes=body?Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body)):null;
    const command=commandId??(body&&!Buffer.isBuffer(body)?text(body.client_command_id):null);
    return new Promise((resolve,reject)=>{
      const request=httpRequest(base+route,{method,headers:{host:new URL(origin()).host,accept:ACCEPT,cookie:[...cookies].map(([key,value])=>key+'='+value).join('; '),'x-h5-performance-id':id,
        ...(method!=='GET'?{origin:origin(),'x-csrf-token':csrf}:{}),...(bytes?{'content-type':contentType??'application/json','content-length':String(bytes.length),...(command?{'idempotency-key':command}:{})}:{})}},response=>{
          for(const cookie of response.headers['set-cookie']??[]){const pair=cookie.split(';')[0]??'',at=pair.indexOf('=');if(at>0)cookies.set(pair.slice(0,at),pair.slice(at+1));}
          const chunks:Buffer[]=[];response.on('data',(chunk:Buffer)=>chunks.push(chunk));response.on('error',reject);response.on('end',()=>{
            try{const bytes=Buffer.concat(chunks),parsed:unknown=bytes.length&&response.headers['content-type']?.includes('application/json')?JSON.parse(bytes.toString('utf8')):{};
              const data=record(parsed);if(typeof data.csrf_token==='string')csrf=data.csrf_token;if(typeof data.recovery_scope==='string')recoveryScope=data.recovery_scope;
              resolve({status:response.statusCode??0,body:data,location:response.headers.location});
            }catch{reject(new Error('H5_PERFORMANCE_HTTP_JSON_INVALID'));}
          });
        });
      request.on('error',reject);request.setTimeout(30000,()=>request.destroy(new Error('H5_PERFORMANCE_HTTP_TIMEOUT')));request.end(bytes);
    });
  }
  return {send,cookies,get recoveryScope(){return recoveryScope;},async login(code:string){const begin=await send('/wecom/yixiaoxiu/login');assert.equal(begin.status,302);assert.ok(begin.location);const state=new URL(begin.location).searchParams.get('state');assert.ok(state);assert.equal((await send('/wecom/yixiaoxiu/callback?code='+encodeURIComponent(code)+'&state='+encodeURIComponent(state))).status,303);assert.equal((await send('/api/yixiaoxiu/bootstrap')).status,200);}};
}
const client=createH5PerformanceHttpClient;
async function run(options:Config):Promise<void>{
  const databaseUrl=process.env.PILOT_DATABASE_URL;assert.ok(databaseUrl,'owned loopback PG18 URL is required');
  const database=new URL(databaseUrl);assert.equal(database.hostname,'127.0.0.1');assert.equal(database.port,'54184','only this task-owned PG port is allowed');
  const root=path.resolve(options.runtimeRoot),component=process.env.H5_PERFORMANCE_COMPONENT_PREFLIGHT==='1';
  assert.ok(!component||process.env.H5_PERFORMANCE_ONLY_EXPLAIN==='1','component candidates may only run the explicit SQL preflight');
  const manifest=component?null:readFileSync(path.join(root,'build-manifest.json')),identity=manifest?record(JSON.parse(manifest.toString('utf8')) as unknown):{node_major:24,source:null};
  assert.equal(identity.node_major,24);assert.equal(Number(process.versions.node.split('.')[0]),24);if(!component)assert.ok(existsSync(path.join(root,'h5/.vite/manifest.json')));
  const module=<T,>(relative:string)=>import(pathToFileURL(path.join(root,relative)).href) as Promise<T>;
  const [isolation,baseline,migrations,authMigration,directoryMigration,selfHandling,completion,round,reopen,mvp,runtimeModule,accessModule,identityModule,memberModule,tokenModule,contractsModule,fixtureModule,browserModule,directoryModule,orchestratorModule,metrics]=await Promise.all([
    module<typeof import('./helpers/p2-015-postgres-harness.mjs')>('tests/helpers/p2-015-postgres-harness.mjs'),
    module<typeof import('../app/server/scripts/migrate-current-baseline.mjs')>('app/server/scripts/migrate-current-baseline.mjs'),
    readdir(path.join(root,'database/migrations')),
    module<typeof import('../app/server/scripts/p2-016-workbench-auth-migrate.mjs')>('app/server/scripts/p2-016-workbench-auth-migrate.mjs'),
    module<typeof import('../app/server/scripts/p2-007-migrate.mjs')>('app/server/scripts/p2-007-migrate.mjs'),
    module<typeof import('../app/server/scripts/ticket-self-handling-migrate.mjs')>('app/server/scripts/ticket-self-handling-migrate.mjs'),
    module<typeof import('../app/server/scripts/ticket-staff-completion-migrate.mjs')>('app/server/scripts/ticket-staff-completion-migrate.mjs'),
    module<typeof import('../app/server/scripts/ticket-round-notifications-migrate.mjs')>('app/server/scripts/ticket-round-notifications-migrate.mjs'),
    module<typeof import('../app/server/scripts/ticket-reopen-rounds-migrate.mjs')>('app/server/scripts/ticket-reopen-rounds-migrate.mjs'),
    module<typeof import('../app/server/scripts/mvp-notifications-migrate.mjs')>('app/server/scripts/mvp-notifications-migrate.mjs'),
    module<typeof import('../app/server/src/p2-016-runtime.mjs')>('app/server/src/p2-016-runtime.mjs'),
    module<typeof import('../app/server/src/p1-009-pilot-access-workbench.mjs')>('app/server/src/p1-009-pilot-access-workbench.mjs'),
    module<typeof import('../app/server/src/p2-g2-yixiaoxiu-delegated-identity.mjs')>('app/server/src/p2-g2-yixiaoxiu-delegated-identity.mjs'),
    module<typeof import('../app/server/src/wecom-application-member.mjs')>('app/server/src/wecom-application-member.mjs'),
    module<typeof import('../app/server/src/p2-g2-wecom-app-token.mjs')>('app/server/src/p2-g2-wecom-app-token.mjs'),
    module<typeof import('../app/server/src/p2-g2-yixiaoxiu-contract.mjs')>('app/server/src/p2-g2-yixiaoxiu-contract.mjs'),
    module<typeof import('./helpers/p2-g2-yixiaoxiu-browser.mjs')>('tests/helpers/p2-g2-yixiaoxiu-browser.mjs'),
    module<typeof import('./helpers/p2-006-browser-harness.mjs')>('tests/helpers/p2-006-browser-harness.mjs'),
    module<typeof import('../app/server/src/p2-007-staff-directory-store.mjs')>('app/server/src/p2-007-staff-directory-store.mjs'),
    module<typeof import('../app/server/src/yxx-self-service-orchestrator.mjs')>('app/server/src/yxx-self-service-orchestrator.mjs'),
    import(pathToFileURL(options.metricsModule).href) as Promise<Metrics>,
  ]);
  mkdirSync(options.outputRoot,{recursive:false});
  const ledger=new H5PerformanceSqlLedger(),verificationLedger=new H5PerformanceMemberVerificationLedger(options.mode==='current');
  // The current candidate must expose its actual compiled batch context. An older baseline is explicitly unbatched.
  if(options.mode==='current'){
    const batch=await module<typeof import('../app/server/src/yxx-h5-read-batch.mjs')>('app/server/src/yxx-h5-read-batch.mjs');
    assert.equal(typeof batch.getH5ReadBatchContext,'function');assert.equal(typeof batch.getH5ReadBatchTiming,'function');assert.equal(typeof batch.getH5ReadParticipantId,'function');
    ledger.setBatchReaders(batch.getH5ReadBatchContext,batch.getH5ReadBatchTiming,batch.getH5ReadParticipantId);
  }
  const privateRoot=await mkdtemp(path.join(tmpdir(),'h5-performance-media-')),key=randomBytes(32),traces:Trace[]=[],sqlSamples=new Map<string,SqlSample>();
  const width=options.profile==='weak320'?320:390,downlink=options.profile==='weak320'?1_600_000:4_000_000;
  const report:Record<string,unknown>={schema_version:1,mode:options.mode,component_preflight:component,manifest_sha256:manifest?hash(manifest):null,compiled_sql_modules:['app/server/src/yxx-self-service-query.mjs','app/server/src/yxx-self-service-store.mjs','app/server/src/yxx-h5-v2-profile.mjs',...(options.mode==='current'?['app/server/src/yxx-h5-read-batch.mjs','app/server/src/yxx-h5-batch-sql.mjs']:[])].map(file=>({file,sha256:hash(readFileSync(path.join(root,file)))})),harness_sha256:hash(readFileSync(fileURLToPath(import.meta.url))),metrics_sha256:hash(readFileSync(options.metricsModule)),source:identity.source,started_at:new Date().toISOString(),parameters:{profile:options.profile,samples:options.samples,warmups:options.warmups,provider_delay_ms:100,width,height:844,downlink_bps:downlink,uplink_bps:1_000_000,rtt_ms:150,cpu_slowdown:4},host:{node:process.version,logical_processors:cpus().length,memory_bytes:totalmem(),resource_enforcement:'NOT_ENFORCED_2C4G',browser:'OWNED_SYSTEM_BROWSER_CDP'},status:'RUNNING',samples:[],traces:[],cleanup:{}};
  if(options.largeConcurrency)report.host={node:process.version,logical_processors:cpus().length,memory_bytes:totalmem(),resource_enforcement:'WINDOWS_JOB_OBJECT_EXTERNAL_EVIDENCE_REQUIRED',budget_scope:'Root Node / load generator / App / Worker and all PostgreSQL descendants; external Job proof must be bound before claiming ENFORCED',browser:'NOT_STARTED_FOR_SERVER_CONCURRENCY'};
  report.timing_semantics={business_selects:'Direct request-owned physical SELECTs only; whole-page SQL budget uses read_dependencies including one shared dependency',sql_ms:'Direct request-owned awaited SQL only; pool.query includes its internal checkout',sql_shared_dependency_ms:'Inclusive batch SQL awaited time linked to each participant; never add replicated participant values to physical throughput',pool_wait_ms:'Explicit request-owned pool.connect checkout',pool_wait_shared_dependency_ms:'Inclusive shared checkout dependency; counted once in the physical ledger',batch_queue_ms:'Actual queued_at_ms to sealed_at_ms; received_at_ms remains a separate pre-Provider timestamp',other_ms:'Residual including shared reads and admission; not an independently measured queue',provider_queue_ms:options.mode==='current'?'Actual verifier STARTED.started_at_ms minus QUEUED.queued_at_ms; opaque operation ID binds back to its own HTTP trace':'NOT_RUN',provider_fetch_ms:'Existing provider_ms remains only the fixed 100 ms fetch delay measured in finally',concurrency_dataset:{members:10,own_reports:5,department_reports:5},large_dataset:'Separate 10000 own / 100000 department / 10000 event EXPLAIN, never a concurrency benchmark'};
  writeFileSync(path.join(options.outputRoot,'harness.mjs'),readFileSync(fileURLToPath(import.meta.url)),{flag:'wx'});writeFileSync(path.join(options.outputRoot,'metrics.mjs'),readFileSync(options.metricsModule),{flag:'wx'});
  let primary:unknown;
  try{await isolation.withP2015IsolatedDatabase({databaseUrl,purpose:'h5perf',max:4,run:async({pool:original,databaseUrl:isolated}:{pool:PostgresPool;databaseUrl:string})=>{
    assert.ok(Number((await original.query<{server_version_num:string}>('SHOW server_version_num')).rows[0]?.server_version_num)>=180000);
    await baseline.migrateCurrentBaselineWithYxx({databaseUrl:isolated});const migrationOptions={databaseUrl:isolated,mode:'apply' as const};
    const formal=new Map<number,()=>Promise<unknown>>([[35,()=>authMigration.migrateWorkbenchAuth(migrationOptions)],[36,()=>directoryMigration.migrateThirdPartyStaffDirectory(migrationOptions)],[39,()=>selfHandling.migrateTicketSelfHandling(migrationOptions)],[40,()=>completion.migrateTicketStaffCompletion(migrationOptions)],[41,()=>round.migrateTicketRoundNotifications(migrationOptions)],[43,()=>reopen.migrateTicketReopenRounds(migrationOptions)],[63,()=>mvp.migrateMvpNotifications(migrationOptions)]]);
    const h5MigrationProof:Record<string,unknown>[]=[];
    for(const file of migrations.filter(file=>/^\d{3}_.+\.sql$/u.test(file)&&Number(file.slice(0,3))>34).sort()){
      const number=Number(file.slice(0,3));if(number===52)continue;const migrate=formal.get(number);
      if(migrate)await migrate();else{
        const bytes=await readFile(path.join(root,'database/migrations',file));await original.query(bytes.toString('utf8'));
        // These raw SQL files intentionally leave ledger registration to their caller.
        // Register only after their complete real DDL succeeds, then verify exact bytes and actual structure.
        if([64,65,66].includes(number)){
          const id=file.replace(/\.sql$/u,''),checksum=hash(bytes);
          await original.query(`WITH stamp AS MATERIALIZED(SELECT platform.physical_epoch_ms() AS epoch)
            INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
            SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[id,checksum]);
          const metadata=(await original.query<{checksum_sha256:string;time_pair_valid:boolean}>('SELECT checksum_sha256,applied_at=platform.local_from_epoch_ms(applied_epoch_ms) AS time_pair_valid FROM platform.schema_migration WHERE migration_id=$1',[id])).rows[0];assert.equal(metadata?.checksum_sha256,checksum);assert.equal(metadata?.time_pair_valid,true);
          if(number===64){const structures=(await original.query<{count:number}>("SELECT count(*)::integer AS count FROM unnest(ARRAY['intake.web_report_urge','intake.web_report_evaluation','pilot_ticket.ticket_public_progress'])r WHERE to_regclass(r) IS NOT NULL")).rows[0];assert.equal(structures?.count,3);}
          if(number===65){const structures=(await original.query<{valid:boolean}>("SELECT to_regclass('intake.web_media_upload') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='intake.web_media_upload'::regclass AND conname='web_media_initial_retention') AS valid")).rows[0];assert.equal(structures?.valid,true);}
          if(number===66){const structures=(await original.query<{count:number;constraint_valid:boolean}>("SELECT count(*)::integer AS count,EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='intake.web_media_upload'::regclass AND conname='web_media_thumbnail_state' AND convalidated) AS constraint_valid FROM pg_attribute WHERE attrelid='intake.web_media_upload'::regclass AND attname=ANY(ARRAY['thumbnail_status','thumbnail_mime_type','thumbnail_byte_size','thumbnail_sha256']) AND NOT attisdropped")).rows[0];assert.equal(structures?.count,4);assert.equal(structures?.constraint_valid,true);}
          h5MigrationProof.push({migration_id:id,checksum_sha256:checksum,real_ddl_applied_before_registration:true,metadata_readback:true,actual_structure_verified:true});
        }
      }
    }
    report.h5_fixture_migrations=h5MigrationProof;
    const pool=instrumentPool(original,metrics,sqlSamples,ledger),access=accessModule.createPilotAccessService({pool});
    const principal=await access.upsertPrincipal({wecomUserId:'h5-perf-admin',displayName:'性能合成管理员',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const entry=contractsModule.validateYxxEntryConfig({enabled:true,corpId:'ww-h5-perf',agentId:'1000002',botId:'h5-perf-bot',identityMode:'VERIFIED_APP_OPENID',memberIdsConfirmed:true,proofRef:'tests/synthetic-h5-performance',proofKind:'SYNTHETIC',validationProfile:'ISOLATED_TEST'});assert.ok(entry.enabled);
    const providerPaths:string[]=[],readFault:ReadFault={afterUrge:false,active:false};
    const providerFetch:typeof fetch=async(input,init)=>{
      const url=new URL(input instanceof Request?input.url:String(input));assert.equal(url.origin,'https://qyapi.weixin.qq.com');providerPaths.push(url.pathname);
      if(url.pathname==='/cgi-bin/gettoken')return new Response(JSON.stringify({errcode:0,access_token:'SYNTHETIC_PERFORMANCE_TOKEN',expires_in:7200}));
      if(url.pathname==='/cgi-bin/get_jsapi_ticket'||url.pathname==='/cgi-bin/ticket/get')return new Response(JSON.stringify({errcode:0,ticket:'SYNTHETIC_PERFORMANCE_TICKET',expires_in:7200}));
      if(url.pathname==='/cgi-bin/user/get'){
        await recordH5PerformanceProviderDelay(contexts.getStore(),init?.signal??undefined);
        const userid=url.searchParams.get('userid');return new Response(JSON.stringify({errcode:0,userid,name:'性能合成成员',status:1,enable:1}));
      }
      throw new Error('H5_PERFORMANCE_EXTERNAL_PROVIDER_FORBIDDEN');
    };
    const token=tokenModule.createWeComAppTokenProvider({corpId:entry.corpId,appSecret:'SYNTHETIC_PERFORMANCE_SECRET',fetchImpl:providerFetch});
    const mapping=await identityModule.createYxxDelegatedIdentityMapping({config:entry,accessTokenProvider:token,fetchImpl:providerFetch});
    const applicationMemberVerifier=memberModule.createApplicationMemberVerifier({accessTokenProvider:token,fetchImpl:providerFetch,...(options.mode==='current'?{h5EntryReadEnabled:true,observe:(event:ApplicationMemberVerificationEvent)=>verificationLedger.observe(event,contexts.getStore())}:{})});
    if(options.mode==='current')assert.equal(typeof applicationMemberVerifier.h5EntryRead,'function','current must use the same factory shared H5 purpose');
    const memberFlags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true},secret='h5-performance-synthetic-scope-key-at-least-32-bytes';
    let runtime:P2016EnabledRuntime|null=null,base='',origin='https://127.0.0.1';
    const tls=await fixtureModule.createYxxBrowserFixture({pool,createApp:({origin:publicOrigin})=>{
      origin=publicOrigin;
      const candidate=runtimeModule.createP2016Runtime({pool,publicOrigin,reporterOrigin:publicOrigin,principalIds:[principal.id],identityHmacKey:'h5-performance-synthetic-identity-key',flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true,REPORTER_TIMELINE_ENABLED:true,WECOM_TEMPLATE_CARD_ENABLED:false},externalSendEnabled:false,
        reporterHmacSecret:secret,reporterPolicy:'MEMBER_REQUIRED',reporterMemberEntry:entry,identityMapping:mapping,applicationMemberVerifier,...(options.mode==='current'?{h5EntryMemberVerifier:applicationMemberVerifier.h5EntryRead}:{}),
        yxxSelfService:{featureFlags:memberFlags,reporterFeedbackEnabled:true},ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketReopenRoundsEnabled:true,
        yxxH5:{enabled:true,privateRoot,key,accessTokenProvider:token,fetchImpl:providerFetch,workbenchProgressEnabled:true,...{performanceEnabled:options.mode==='current'}},
        wecomWebOAuth:{enabled:true,corpId:entry.corpId,agentId:entry.agentId,resolveCode:async code=>({userid:'h5-perf-PERF_'+(/^PERF_([0-9]+)(?:_[a-f0-9-]+)?$/u.exec(code)?.[1]??'0')})}});
      assert.ok('server' in candidate);runtime=candidate;observeRequests(runtime,traces,readFault,ledger);return runtime.server;
    },startApp:async server=>{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');base='http://127.0.0.1:'+address.port;return base;},stopApp:async()=>{await runtime?.stop();}});
    assert.ok(tls,'owned TLS fixture must initialize');
    let browser:Awaited<ReturnType<typeof browserModule.launchSystemBrowser>>|null=null,performanceWorker:Awaited<ReturnType<typeof startH5PerformanceWorker>>|null=null;
    try{
      report.ports={postgres:54184,http:Number(new URL(base).port),https:Number(new URL(origin).port),browser_debug:'OWNED_EPHEMERAL'};
      const owner=client(base,()=>origin);await owner.login('PERF_0');let requestRef='';
      const orchestrator=orchestratorModule.createYxxSelfServiceOrchestrator({pool,profile:'MEMBER_SELF_SERVICE',featureFlags:memberFlags,ruleEngine:{evaluate(){throw new Error('H5_PERFORMANCE_RULES_FORBIDDEN');}}});
      for(let index=0;index<5;index++){
        const accepted=await owner.send('/api/yixiaoxiu/requests',{method:'POST',body:{schema_version:2,client_command_id:randomUUID(),intent:'FAULT',description:'性能基准合成打印机故障 '+index,location:{text:'合成门诊二楼',unknown:false},media_refs:[]}});assert.equal(accepted.status,202);
        const ref=text(record(accepted.body.receipt).request_ref);if(index===0)requestRef=ref;await orchestrator.processOne({requestRef:ref});
      }
      const scope=(await original.query<{scope_hash:string;source_corp_scope:string;source_app_scope:string}>('SELECT canonical_reporter_binding AS scope_hash,source_corp_scope,source_app_scope FROM intake.web_request_binding WHERE request_ref=$1',[requestRef])).rows[0];assert.ok(scope);
      const directory=directoryModule.createThirdPartyStaffDirectoryStore({pool}),snapshot=hash('h5-performance-'+randomUUID());
      const members=Array.from({length:10},(_,index)=>({provider_user_id:'h5-provider-'+index,employee_id:'PERF-'+index,nickname:'性能合成成员 '+index,phone:null,provider_wecom_id:null}));
      await directory.publishSnapshot({source_scope:'FORMAL',root_ref:'h5-performance-root',snapshot:{snapshot_version:snapshot,departments:[{provider_department_id:'h5-perf-dept',parent_provider_department_id:null,name:'性能合成科室',provider_gid:null,provider_gid_type:null,depth:0}],members,memberships:members.map(member=>({provider_user_id:member.provider_user_id,provider_department_id:'h5-perf-dept'})),protocol_warnings:[],counts:{departments:1,members:10,memberships:10,max_depth:0}}});
      const currentMember=await directory.findMemberByProviderUserId({source_scope:'FORMAL',provider_user_id:'h5-provider-0'});assert.ok(currentMember);
      await directory.saveResolvedProfile({source_scope:'FORMAL',reporter_identity_hash:scope.scope_hash,source_namespace:'WECOM_APP_OPENID',resolution_method:'SYNTHETIC_VERIFIED_UID',member:currentMember,profile:{provider_user_id:currentMember.provider_user_id,employee_id:currentMember.employee_id,display_name:currentMember.nickname,phone:null,sex:null,avatar_url:null}});
      await original.query("UPDATE directory.member_current SET account_status='ACTIVE'");
      if(process.env.H5_PERFORMANCE_WORKER_SMOKE==='1'){
        performanceWorker=await startH5PerformanceWorker({runtimeRoot:root,databaseUrl:isolated,privateRoot,key,scopeSecret:secret,outputRoot:options.outputRoot});
        for(let round=0;round<10;round++)await performanceWorker.round('smoke-'+round);
        report.worker=performanceWorker.state();report.status='WORKER_COMPONENT_SMOKE';return;
      }
      if(options.largeConcurrency){
        assert.equal(options.mode,'current');
        const clients=Array.from({length:10},(_,index)=>({member:index,client:index===0?owner:client(base,()=>origin),requestRef:index===0?requestRef:'',scopeHash:index===0?scope.scope_hash:''}));
        for(const item of clients){
          if(item.member>0){
            await item.client.login('PERF_'+item.member+'_'+randomUUID());
            const accepted=await item.client.send('/api/yixiaoxiu/requests',{method:'POST',body:{schema_version:2,client_command_id:randomUUID(),intent:'FAULT',description:'大库并发合成成员工单 '+item.member,location:{text:'合成门诊二楼',unknown:false},media_refs:[]}});assert.equal(accepted.status,202);
            item.requestRef=text(record(accepted.body.receipt).request_ref);await orchestrator.processOne({requestRef:item.requestRef});
            const binding=(await original.query<{scope_hash:string}>('SELECT canonical_reporter_binding AS scope_hash FROM intake.web_request_binding WHERE request_ref=$1',[item.requestRef])).rows[0];assert.ok(binding);item.scopeHash=binding.scope_hash;
            const member=await directory.findMemberByProviderUserId({source_scope:'FORMAL',provider_user_id:'h5-provider-'+item.member});assert.ok(member);
            await directory.saveResolvedProfile({source_scope:'FORMAL',reporter_identity_hash:item.scopeHash,source_namespace:'WECOM_APP_OPENID',resolution_method:'SYNTHETIC_VERIFIED_UID',member,profile:{provider_user_id:member.provider_user_id,employee_id:member.employee_id,display_name:member.nickname,phone:null,sex:null,avatar_url:null}});
          }
        }
        const largeDataset=await seedLargeConcurrencyDataset(original,clients,options.outputRoot);report.large_concurrency_dataset=largeDataset;
        for(const view of ['home','request','department'])assert.equal((await owner.send('/api/yixiaoxiu/h5/entry?view='+view+(view==='request'?'&request_ref='+requestRef:''),{id:'large-explain-'+view})).status,200);
        report.large_concurrency_explain=await explainLargeConcurrency(original,sqlSamples,options.outputRoot);
        const probeModule=process.env.H5_PERFORMANCE_LARGE_SQL_PROBE_MODULE;
        if(probeModule){
          const probeRoot=path.resolve('D:/wecom-workbench-evidence/h5-performance-closure-20261021-b88e5ff1'),probePath=path.resolve(probeModule),relative=path.relative(probeRoot,probePath);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'owned isolated SQL probe module required');
          const probe:unknown=await import(pathToFileURL(probePath).href);assert.ok(probe&&typeof probe==='object'&&'runLargeSqlProbe' in probe&&typeof probe.runLargeSqlProbe==='function');
          report.large_sql_probe=await Reflect.apply(probe.runLargeSqlProbe,undefined,[{pool:original,queries:sqlSamples,members:clients.map(({member,scopeHash,requestRef})=>({member,scopeHash,requestRef})),outputRoot:options.outputRoot}]);
          report.status='SQL_PROBE_MEASURED';return;
        }
        assert.equal(component,false,'component SQL probes cannot claim formal concurrency');
        performanceWorker=await startH5PerformanceWorker({runtimeRoot:root,databaseUrl:isolated,privateRoot,key,scopeSecret:secret,outputRoot:options.outputRoot});
        report.worker=performanceWorker.state();
        const expectedActive=largeDataset.expected_department_active_count;assert.equal(typeof expectedActive,'number');assert.ok(typeof expectedActive==='number');
        const measured=await measureLargeConcurrency({members:clients.map(item=>({member:item.member,requestRef:item.requestRef,recoveryScope:item.client.recoveryScope,send:item.client.send})),warmups:options.warmups,samples:options.samples,outputRoot:options.outputRoot,traces,percentiles:metrics.percentiles,expectedActive,cursorSecret:secret,inspectRead:(trace,kind)=>ledger.inspectRead(trace,kind),sqlLedger:()=>ledger.snapshot(),inspectVerification:trace=>verificationLedger.inspectTrace(trace,'H5_ENTRY'),verificationLedger:()=>verificationLedger.snapshot(),onRoundBoundary:id=>performanceWorker?performanceWorker.round(id):Promise.reject(new Error('H5_PERFORMANCE_WORKER_REQUIRED'))});
        // The measured waves may create other sealed sizes than the single-owner preflight.
        report.large_concurrency_explain_after_measurement=await explainLargeConcurrency(original,sqlSamples,options.outputRoot,'after-measurement');
        report.connections_after_measurement=(await original.query(`SELECT application_name,backend_type,state,count(*)::integer AS connections FROM pg_stat_activity WHERE datname=current_database() OR application_name LIKE 'p2_015_%' GROUP BY application_name,backend_type,state ORDER BY application_name,backend_type,state`)).rows;
        report.large_concurrency=measured;report.status=measured.status==='PASS'?'MEASURED':'FAIL';
        report.resource_timing_scope={scope:'All HTTP/App/load generator processes and PostgreSQL must be launched within the externally verified Windows Job Object',scheduler_queue_ms:'Per-round dispatcher lag plus global event-loop delay, never HTTP residual',dataset:'10 distinct members x 10000 own reports = 100000 department; 10 target tickets x 10000 events = 100000 heavy events'};
        assert.equal(measured.status,'PASS','H5_LARGE_CONCURRENCY_BUDGET_FAILED');return;
      }
      if(process.env.H5_PERFORMANCE_ONLY_EXPLAIN==='1'){
        const routes=options.mode==='current'?['/api/yixiaoxiu/h5/entry?view=home','/api/yixiaoxiu/h5/entry?view=reports','/api/yixiaoxiu/h5/entry?view=request&request_ref='+requestRef,'/api/yixiaoxiu/h5/entry?view=department']:['/api/yixiaoxiu/my-reports?limit=20','/api/yixiaoxiu/requests/'+requestRef,'/api/yixiaoxiu/requests/'+requestRef+'/timeline?limit=20','/api/yixiaoxiu/department-reports?limit=20'];
        for(const route of routes)assert.equal((await owner.send(route,{id:'explain-fixture'})).status,200);
        report.large_data=await largeDataset(original,scope.scope_hash,requestRef,sqlSamples,options.outputRoot);report.status='MEASURED';return;
      }
      const network=new Map<string,{path:string;variant:string|null;start_ms:number;end_ms:number;status:number;mime:string;encoded_bytes:number;decoded_bytes:number;cached:boolean;date:string;request_range:string|null;content_range:string|null;content_length:number|null;failure_code:string|null}>();
      const scriptInventory=new Map<string,{file:string;raw:number;gzip:number;brotli:number}>();
      browser=await browserModule.launchSystemBrowser({url:origin+'/synthetic-start',width,height:844,certificateSpki:tls.certificateSpki,socketFactory:address=>{
        const socket=new WebSocket(address);socket.addEventListener('message',event=>{
          const message:unknown=JSON.parse(String(event.data)),frame=record(message);if(typeof frame.method!=='string'||!frame.params)return;const params=record(frame.params);
          if(frame.method==='Page.javascriptDialogOpening')report.unexpected_dialog={type:params.type};
          const id=typeof params.requestId==='string'?params.requestId:null;if(!id)return;
          if(frame.method==='Network.requestWillBeSent'){
            const request=record(params.request),url=new URL(text(request.url));if(url.origin!==origin)return;
            network.set(id,{path:url.pathname,variant:url.searchParams.get('variant'),start_ms:Number(params.timestamp)*1000,end_ms:0,status:0,mime:'',encoded_bytes:0,decoded_bytes:0,cached:false,date:new Date(Number(params.wallTime)*1000).toISOString(),request_range:typeof record(request.headers).Range==='string'?String(record(request.headers).Range):null,content_range:null,content_length:null,failure_code:null});
          }
          const target=network.get(id);if(!target)return;
          if(frame.method==='Network.responseReceived'){const response=record(params.response);target.status=Number(response.status);target.mime=String(response.mimeType??'');target.cached=response.fromDiskCache===true||response.fromServiceWorker===true;const headers=record(response.headers);for(const [name,value]of Object.entries(headers)){if(name.toLowerCase()==='content-range')target.content_range=String(value);if(name.toLowerCase()==='content-length')target.content_length=Number(value);}}
          if(frame.method==='Network.dataReceived')target.decoded_bytes+=Number(params.dataLength??0);
          if(frame.method==='Network.loadingFailed'){target.end_ms=Number(params.timestamp)*1000;target.failure_code=typeof params.errorText==='string'&&/^net::ERR_[A-Z_]+$/u.test(params.errorText)?params.errorText:'UNCLASSIFIED';}
          if(frame.method==='Network.loadingFinished'){target.end_ms=Number(params.timestamp)*1000;target.encoded_bytes=Number(params.encodedDataLength??0);if(target.status>=400&&target.path.startsWith('/api/'))void browser?.command('Network.getResponseBody',{requestId:id}).then(value=>{const response=record(value);const raw=text(response.body),body=record(JSON.parse(response.base64Encoded===true?Buffer.from(raw,'base64').toString('utf8'):raw) as unknown),code=record(body.error).code;const entries=Array.isArray(report.error_responses)?report.error_responses:[];entries.push({path:target.path,status:target.status,code:typeof code==='string'?code:'UNCLASSIFIED'});report.error_responses=entries;}).catch(()=>undefined);}
        });return socket;
      }});
      assert.ok(browser,'owned browser must initialize');
      await browser.command('Network.enable');await browser.command('Network.setCookies',{cookies:[...owner.cookies].map(([name,value])=>({name,value,url:origin+'/',secure:true,httpOnly:true,sameSite:'Lax'}))});
      await browser.command('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 Android wxwork/4.1 Language/zh_CN ColorScheme/Light'});
      await browser.command('Emulation.setCPUThrottlingRate',{rate:4});await browser.command('Emulation.setTimezoneOverride',{timezoneId:'Asia/Shanghai'});
      await browser.command('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:downlink/8,uploadThroughput:1_000_000/8,connectionType:'cellular4g'});
      await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:metrics.WEB_VITALS_OBSERVER});
      const browserVersion=record(await browser.command('Browser.getVersion'));report.browser={product:browserVersion.product,protocol_version:browserVersion.protocolVersion,executable:browser.executable};
      const rows:Record<string,unknown>[]=[];let previousUrl:string|null=null;
      for(const view of ['home','request'] as const)for(const cache of ['cold','warm'] as const){
        const hashRoute='#/'+(view==='home'?'':'requests/'+requestRef);
        for(let attempt=-options.warmups;attempt<options.samples;attempt++){
          const id=view+'-'+cache+'-'+attempt;report.last_stage=id+':headers';await browser.command('Network.setExtraHTTPHeaders',{headers:{'x-h5-performance-id':id}});
          report.last_stage=id+':cache';
          await browser.command('Network.setCacheDisabled',{cacheDisabled:cache==='cold'});if(cache==='cold')await browser.command('Network.clearBrowserCache');
          const url=origin+'/wecom/yixiaoxiu/'+hashRoute;
          // The closed native route rejects extra query keys. Reload the exact route and require a new document identity.
          if(previousUrl!==null&&previousUrl!==url){
            await browser.command('Network.setExtraHTTPHeaders',{headers:{'x-h5-performance-id':'setup'}});await browser.command('Page.navigate',{url});
            await browser.command('Network.setExtraHTTPHeaders',{headers:{'x-h5-performance-id':id}});
          }
          const oldOrigin=await browser.evaluate('performance.timeOrigin');network.clear();
          report.last_stage=id+':navigate';
          if(previousUrl===null)await browser.command('Page.navigate',{url});else await browser.command('Page.reload',{ignoreCache:cache==='cold'});
          previousUrl=url;
          const ready=options.mode==='current'?`!!document.querySelector('[data-h5-ready="${view}"][data-h5-checking="false"]')${view==='request'?`&&document.querySelector('[data-h5-ready="request"]').dataset.requestRef===${JSON.stringify(requestRef)}`:''}`
            :view==='home'?`!!document.querySelector('.home-page .report-card')&&!document.querySelector('.loading-stack')`:`!!document.querySelector('.detail-page')&&document.body.textContent.includes('性能基准合成打印机故障 0')&&!document.querySelector('.detail-page .loading-stack')`;
          report.last_stage=id+':ready';await browser.waitFor(`performance.timeOrigin!==${Number(oldOrigin)}&&(${ready})`,{timeoutMs:45000});report.last_stage=id+':fonts';await browser.evaluate('document.fonts.ready');
          const navigation=record(await browser.evaluate('({ready:performance.now(),origin:performance.timeOrigin})'));
          await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
          const cutoff=Number(navigation.ready),performanceEntries=await browser.evaluate('performance.getEntriesByType("resource").map(e=>({name:e.name,start:e.startTime,end:e.responseEnd,encoded:e.encodedBodySize,decoded:e.decodedBodySize,transfer:e.transferSize,initiator:e.initiatorType}))');
          const beforeInteraction=[...network.values()].map(item=>({...item}));
          assert.ok(Array.isArray(performanceEntries));
          const scriptFiles=[...new Set(performanceEntries.map(value=>record(value)).filter(value=>Number(value.start)<=cutoff&&typeof value.name==='string'&&new URL(value.name).pathname.endsWith('.js')).map(value=>new URL(String(value.name)).pathname.slice('/wecom/yixiaoxiu/'.length)))];
          const scripts=scriptFiles.map(file=>{assert.match(file,/^assets\/[A-Za-z0-9_.-]+\.js$/u);const existing=scriptInventory.get(file);if(existing)return existing;const bytes=readFileSync(path.join(root,'h5',file)),item={file,raw:bytes.length,gzip:gzipSync(bytes,{level:9}).length,brotli:brotliCompressSync(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:11}}).length};scriptInventory.set(file,item);return item;});
          const javascript={files:scripts,raw:scripts.reduce((sum,item)=>sum+item.raw,0),gzip:scripts.reduce((sum,item)=>sum+item.gzip,0),brotli:scripts.reduce((sum,item)=>sum+item.brotli,0)};
          // The 390px reference hides header profile controls. Exercise visible help/supplement controls with trusted pointer input.
          const elementExpression=view==='home'?`document.querySelector('.support-button')`:`document.querySelector('[data-h5-action="supplement"]')||[...document.querySelectorAll('button')].find(button=>button.textContent.includes('补充'))`;
          for(let interaction=0;interaction<3;interaction++){
            await browser.waitFor(`(${ready})&&${options.mode==='current'?`!!document.querySelector('[data-h5-write-ready="true"]')`:'true'}&&(()=>{const element=${elementExpression};if(!element||element.disabled)return false;const bounds=element.getBoundingClientRect();return bounds.width>0&&bounds.height>0;})()`,{timeoutMs:45000});
            const bounds=record(await browser.evaluate(`(()=>{const element=${elementExpression};if(!element)throw new Error('H5_PERFORMANCE_VISIBLE_ACTION_REQUIRED');element.scrollIntoView({block:'center'});const r=element.getBoundingClientRect();if(!r.width||!r.height)throw new Error('H5_PERFORMANCE_ACTION_HIDDEN');return {x:r.x+r.width/2,y:r.y+r.height/2};})()`));
            for(const type of ['mousePressed','mouseReleased'])await browser.command('Input.dispatchMouseEvent',{type,x:bounds.x,y:bounds.y,button:'left',clickCount:1});
            await browser.waitFor(`!!document.querySelector('[role=dialog]')`);await browser.command('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await browser.waitFor(`!document.querySelector('[role=dialog]')`);
          }
          await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
          const vitals=await browser.evaluate('window.__h5Performance') as VitalsReading;assert.ok(vitals.lcp!==null,'a ready DOM shell is not LCP evidence');assert.equal(vitals.errors.length,0);
          const trace=traces.filter(item=>item.id===id&&item.path.startsWith('/api/yixiaoxiu/'));
          assert.ok(trace.length>0&&trace.every(item=>item.status===200),'the actual protected API response must finish successfully');
          if(options.mode==='current')assert.ok(trace.some(item=>item.path==='/api/yixiaoxiu/h5/entry'),'current must use the actual compiled aggregate entry');
          const apiSql=trace.map(item=>({trace_key:item.trace_key,path:item.path,...ledger.inspectRead(item,options.mode==='current'&&item.path==='/api/yixiaoxiu/h5/entry'?(view==='home'?'BATCHED_HOME_OR_DEPARTMENT':'REQUEST'):'UNCONSTRAINED'),member_verification:verificationLedger.inspectTrace(item,options.mode==='current'&&item.path==='/api/yixiaoxiu/h5/entry'?'H5_ENTRY':'UNCONSTRAINED')}));
          if(options.mode==='current')assert.ok(apiSql.every(item=>item.integrity_errors.length===0&&item.member_verification.integrity_errors.length===0),'actual browser entry must preserve its complete SQL dependency and one shared-purpose verification proof');
          const row={id,view,cache,warmup:attempt<0,ready_ms:cutoff,lcp_ms:vitals.lcp,cls:vitals.cls,interaction:metrics.interactionMetric(vitals),resources:performanceEntries,javascript,node_memory:process.memoryUsage(),request_count:beforeInteraction.length,api:trace.map(item=>({...item})),api_sql_counts:apiSql,sql_count_semantics:'Whole-page participation includes each shared SELECT once per dependent HTTP. Physical statements are unique only in physical-sql-ledger.json.',har_file:id+'.har.json'};
          if(attempt>=0){rows.push(row);await writeFile(path.join(options.outputRoot,id+'.har.json'),JSON.stringify({log:{version:'1.2',creator:{name:'h5-performance-owned-cdp',version:'1'},entries:beforeInteraction.map(item=>({startedDateTime:item.date,time:Math.max(0,item.end_ms-item.start_ms),request:{method:'GET',url:origin+item.path,httpVersion:'HTTP/1.1',cookies:[],headers:[],queryString:[],headersSize:-1,bodySize:0},response:{status:item.status,statusText:'',httpVersion:'HTTP/1.1',cookies:[],headers:[],content:{size:item.decoded_bytes,mimeType:item.mime},redirectURL:'',headersSize:-1,bodySize:item.encoded_bytes},cache:{},timings:{send:0,wait:Math.max(0,item.end_ms-item.start_ms),receive:0}}))}},null,2)+'\n');}
          process.stdout.write(JSON.stringify({phase:'browser',id,lcp_ms:vitals.lcp,ready_ms:cutoff,api_requests:trace.length})+'\n');
        }
      }
      report.samples=rows;report.summary=Object.fromEntries(['home-cold','home-warm','request-cold','request-warm'].map(key=>{const selected=rows.filter(row=>row.view+'-'+row.cache===key);return [key,{lcp_ms:metrics.percentiles(selected.map(row=>Number(row.lcp_ms))),ready_ms:metrics.percentiles(selected.map(row=>Number(row.ready_ms))),max_cls:Math.max(...selected.map(row=>Number(row.cls)))}];}));
      const clients=Array.from({length:10},()=>client(base,()=>origin));for(const [index,member]of clients.entries())await member.login('PERF_'+index+'_'+randomUUID());
      const concurrency=await Promise.all(clients.map(async(member,index)=>{const started=performance.now();let response=await member.send(options.mode==='current'?'/api/yixiaoxiu/h5/entry?view=home':'/api/yixiaoxiu/bootstrap',{id:'concurrency-'+index});if(options.mode==='baseline'&&response.status===200)response=await member.send('/api/yixiaoxiu/my-reports?limit=20',{id:'concurrency-'+index});return {index,status:response.status,elapsed_ms:performance.now()-started};}));
      report.concurrency={requests:concurrency,latency_ms:metrics.percentiles(concurrency.map(item=>item.elapsed_ms)),traces:traces.filter(item=>item.id.startsWith('concurrency-'))};
      if(options.mode==='current'&&process.env.H5_PERFORMANCE_QA!=='0'){
        const media=await seedQaMedia({owner,orchestrator,pool,privateRoot,key,secret,root});
        const beforeUrge=(await original.query<{count:number}>('SELECT count(*)::integer AS count FROM intake.web_report_urge')).rows[0]?.count??0;
        const emptyMember=clients[1];assert.ok(emptyMember);const cookies={owner:[...owner.cookies].map(([name,value])=>({name,value})),empty:[...emptyMember.cookies].map(([name,value])=>({name,value}))};
        report.browser_qa=await runH5BrowserQa({browser,origin,requestRef,outputRoot:options.outputRoot,armReadFailureAfterUrge(){readFault.afterUrge=true;},clearReadFailure(){readFault.afterUrge=false;readFault.active=false;},media,cookies,network:()=>[...network.values()],clearNetwork:()=>network.clear()});
        assert.equal((await original.query<{count:number}>('SELECT count(*)::integer AS count FROM intake.web_report_urge')).rows[0]?.count,beforeUrge+1,'the real UI command commits only once even when its following read fails');
      }
      report.provider_paths=[...new Set(providerPaths)];assert.equal(providerPaths.includes('/cgi-bin/message/send'),false);
      if(options.largeData)report.large_data=await largeDataset(original,scope.scope_hash,requestRef,sqlSamples,options.outputRoot);
      report.traces=traces;report.sql_statement_fingerprints=[...sqlSamples.values()].map(({sha256,text})=>({sha256,text}));
      report.status='MEASURED';
    }catch(error){
      if(browser){
        report.last_browser_state=await browser.evaluate('({href:location.href,text:document.body.innerText.slice(0,3000),vitals:window.__h5Performance})').catch(()=>null);
        await writeFile(path.join(options.outputRoot,'failure.png'),Buffer.from(await browser.screenshot(),'base64')).catch(()=>{});
      }
      throw error;
    }finally{
      try{await performanceWorker?.close();if(performanceWorker)report.worker_cleanup=performanceWorker.state();}finally{await browser?.close();if(browser)report.browser_cleanup=browser.ownedResourceState();await tls.close();report.http_cleanup=tls.ownedResourceState();assert.deepEqual(tls.ownedResourceState(),{listeners:0,sockets:0,tlsDirectories:0});}
    }
  }});}catch(error){primary=error;report.status='FAIL';report.error=safeError(error);}
  finally{
    const physical=ledger.snapshot();report.physical_sql_ledger={file:'physical-sql-ledger.json',statement_count:physical.statements.length,integrity_errors:physical.integrity_errors};
    await writeFile(path.join(options.outputRoot,'physical-sql-ledger.json'),JSON.stringify(physical,null,2)+'\n');
    const verifications=verificationLedger.snapshot();report.member_verification_ledger={file:'member-verification-ledger.json',enabled:verifications.enabled,operation_count:verifications.operations.length,observed_max:verifications.observed_max,final:verifications.final,integrity_errors:verifications.integrity_errors};
    await writeFile(path.join(options.outputRoot,'member-verification-ledger.json'),JSON.stringify(verifications,null,2)+'\n');
    if(physical.integrity_errors.length){report.status='FAIL';report.measurement_error='H5_PERFORMANCE_SQL_LEDGER_INVALID';primary??=new Error('H5_PERFORMANCE_SQL_LEDGER_INVALID');}
    if(verifications.integrity_errors.length){report.status='FAIL';report.verification_measurement_error='H5_PERFORMANCE_VERIFICATION_LEDGER_INVALID';primary??=new Error('H5_PERFORMANCE_VERIFICATION_LEDGER_INVALID');}
    report.traces=traces;report.provider_outcomes=traces.reduce((summary,trace)=>({completed:summary.completed+trace.provider_outcomes.completed,aborted:summary.aborted+trace.provider_outcomes.aborted,error:summary.error+trace.provider_outcomes.error}),{completed:0,aborted:0,error:0});key.fill(0);await rm(privateRoot,{recursive:true,force:true});report.finished_at=new Date().toISOString();report.cleanup={isolated_database:'EXISTING_OWNED_FIXTURE_FINALLY_EXECUTED',private_root:!existsSync(privateRoot)};
    await writeFile(path.join(options.outputRoot,'performance.json'),JSON.stringify(report,null,2)+'\n');
  }
  if(primary)throw primary;
}
async function seedQaMedia({owner,orchestrator,pool,privateRoot,key,secret,root}:{owner:ReturnType<typeof client>;orchestrator:ReturnType<typeof import('../app/server/src/yxx-self-service-orchestrator.mjs').createYxxSelfServiceOrchestrator>;pool:PostgresPool;privateRoot:string;key:Uint8Array;secret:string;root:string}):Promise<{requestRef:string;images:string[];voiceRef:string;videoRef:string;voiceBytes:number;videoBytes:number}>{
  const ffmpegPath=process.env.H5_MEDIA_FFMPEG,ffprobePath=process.env.H5_MEDIA_FFPROBE;
  assert.ok(ffmpegPath&&ffprobePath&&path.isAbsolute(ffmpegPath)&&path.isAbsolute(ffprobePath)&&existsSync(ffmpegPath)&&existsSync(ffprobePath),'controlled FFmpeg/FFprobe paths are required for nonempty browser media evidence');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==','base64');
  const samples=16000*30,voice=Buffer.alloc(44+samples*2);voice.write('RIFF',0);voice.writeUInt32LE(36+samples*2,4);voice.write('WAVEfmt ',8);voice.writeUInt32LE(16,16);voice.writeUInt16LE(1,20);voice.writeUInt16LE(1,22);voice.writeUInt32LE(16000,24);voice.writeUInt32LE(32000,28);voice.writeUInt16LE(2,32);voice.writeUInt16LE(16,34);voice.write('data',36);voice.writeUInt32LE(samples*2,40);
  for(let index=0;index<samples;index++)voice.writeInt16LE(Math.round(Math.sin(index*2*Math.PI*440/16000)*2000),44+index*2);
  const clip=path.join(privateRoot,'synthetic-qa-source.mp4');assert.equal(existsSync(clip),false);
  execFileSync(ffmpegPath,['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i','testsrc2=size=480x360:rate=24:duration=20','-vf','noise=alls=20:allf=t+u','-an','-c:v','libx264','-crf','32','-preset','ultrafast','-threads','1','-filter_threads','1','-pix_fmt','yuv420p','-movflags','+faststart','-n',clip],{windowsHide:true,stdio:'ignore',timeout:25000});
  const video=await readFile(clip);await rm(clip);
  const upload=async(kind:'IMAGE'|'VOICE'|'VIDEO',bytes:Buffer,mime:string,duration:number|null)=>{
    const reserve=await owner.send('/api/yixiaoxiu/media/uploads',{method:'POST',body:{schema_version:1,client_command_id:randomUUID(),kind,mime_type:mime,byte_size:bytes.length,duration_ms:duration}});assert.equal(reserve.status,201);
    const ref=text(reserve.body.media_ref),uploaded=await owner.send('/api/yixiaoxiu/media/uploads/'+ref+'/content',{method:'PUT',body:bytes,contentType:mime,commandId:randomUUID()});assert.equal(uploaded.status,200);return ref;
  };
  const images:string[]=[];for(let index=0;index<6;index++)images.push(await upload('IMAGE',png,'image/png',null));
  const voiceRef=await upload('VOICE',voice,'audio/wav',30000),videoRef=await upload('VIDEO',video,'video/mp4',20000),refs=[...images,voiceRef,videoRef];
  const accepted=await owner.send('/api/yixiaoxiu/requests',{method:'POST',body:{schema_version:2,client_command_id:randomUUID(),intent:'FAULT',description:'合成私有材料浏览器校验',location:{text:'合成科室',unknown:false},media_refs:refs}});assert.equal(accepted.status,202);const requestRef=text(record(accepted.body.receipt).request_ref);await orchestrator.processOne({requestRef});
  const module=await import(pathToFileURL(path.join(root,'app/server/src/yxx-h5-runtime.mjs')).href) as typeof import('../app/server/src/yxx-h5-runtime.mjs');
  const worker=module.createYxxH5Runtime({pool,scopeSecret:secret,role:'WORKER',options:{enabled:true,performanceEnabled:true,privateRoot,key,ffmpegPath,ffprobePath}});
  let voiceBytes=0,videoBytes=0;
  try{
    for(let turn=0;turn<10;turn++)await worker.runOnce();
    const ready=await pool.query<{media_ref:string;kind:string;playback_status:string;thumbnail_status:string;playback_byte_size:string|null}>('SELECT media_ref::text,kind,playback_status,thumbnail_status,playback_byte_size::text FROM intake.web_media_upload WHERE media_ref=ANY($1::uuid[])',[refs]);assert.equal(ready.rows.length,8);
    assert.ok(ready.rows.every(row=>row.kind==='IMAGE'?row.thumbnail_status==='READY':row.playback_status==='READY'),'all actual encrypted media derivatives must be ready before checking browser download behavior');
    voiceBytes=Number(ready.rows.find(row=>row.media_ref===voiceRef)?.playback_byte_size);videoBytes=Number(ready.rows.find(row=>row.media_ref===videoRef)?.playback_byte_size);assert.ok(voiceBytes>=512*1024&&videoBytes>=512*1024,'progressive evidence requires media that cannot be mistaken for a tiny fully buffered response');
  }finally{await worker.close();assert.deepEqual(worker.media?.ownedResourceState(),{active:0,plaintext_bytes:0});}
  return {requestRef,images,voiceRef,videoRef,voiceBytes,videoBytes};
}
async function largeDataset(pool:PostgresPool,scopeHash:string,requestRef:string,queries:Map<string,SqlSample>,outputRoot:string):Promise<Record<string,unknown>>{
  // Only task-owned synthetic data is changed. Preserve the original facts and all FKs/checks.
  const template=(await pool.query<{intake_id:string;ticket_id:string}>('SELECT b.intake_id::text,i.pilot_ticket_id::text AS ticket_id FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id WHERE b.request_ref=$1',[requestRef])).rows[0];assert.ok(template);
  const initial=(await pool.query<{total:number;owned:number}>('SELECT count(*)::integer AS total,count(*) FILTER(WHERE canonical_reporter_binding=$1)::integer AS owned FROM intake.web_request_binding',[scopeHash])).rows[0];assert.ok(initial);
  const added=100000-initial.total,ownedAdded=10000-initial.owned;assert.ok(Number.isSafeInteger(added)&&Number.isSafeInteger(ownedAdded)&&added>0&&ownedAdded>0&&ownedAdded<=added);
  const connection=await pool.connect();
  type CloneTable='intake.web_command_receipt'|'intake.service_intake'|'intake.web_request_binding'|'intake.web_submission'|'pilot_ticket.ticket'|'directory.identity_binding'|'pilot_ticket.ticket_event';
  const clone=async(table:CloneTable,source:string,overrides:string,values:unknown[])=>{
    const started=performance.now();
    // A table-function LATERAL computes the composite once per row. SELECT (function()).* would repeat it for every column.
    await connection.query(`INSERT INTO ${table} SELECT expanded.* FROM ${source} CROSS JOIN LATERAL jsonb_populate_record(NULL::${table},to_jsonb(t)||${overrides}) expanded`,values);
    process.stdout.write(JSON.stringify({phase:'bulk-seed',table,elapsed_ms:performance.now()-started})+'\n');
  };
  try{
    await connection.query('BEGIN');await connection.query('SET CONSTRAINTS ALL DEFERRED');
    await connection.query(`CREATE TEMP TABLE h5_perf_bulk ON COMMIT DROP AS SELECT g,gen_random_uuid() AS intake_id,gen_random_uuid() AS ticket_id,gen_random_uuid() AS receipt_id,gen_random_uuid() AS command_id,gen_random_uuid() AS submission_id,replace(gen_random_uuid()::text,'-','') AS request_ref FROM generate_series(1,${added})g`);
    await clone('intake.web_command_receipt',`h5_perf_bulk b CROSS JOIN LATERAL(SELECT r.* FROM intake.web_command_receipt r WHERE r.result_intake_id=$1::uuid LIMIT 1)t`,`jsonb_build_object('id',b.receipt_id,'client_command_id',b.command_id,'result_intake_id',b.intake_id,'result_request_ref',b.request_ref,'scope_hash',CASE WHEN b.g<=${ownedAdded} THEN $2 ELSE $3 END)`,[template.intake_id,scopeHash,hash('h5-performance-other')]);
    await clone('intake.service_intake',`h5_perf_bulk b CROSS JOIN LATERAL(SELECT * FROM intake.service_intake WHERE id=$1::uuid)t`,`jsonb_build_object('id',b.intake_id,'intake_no','INT-'||to_char(platform.local_now(),'YYYYMMDD')||'-'||(900000+b.g)::text,'primary_web_submission_id',b.submission_id,'pilot_ticket_id',NULL,'status','RECEIVED','canonical_reporter_binding',CASE WHEN b.g<=${ownedAdded} THEN $2 ELSE $3 END)`,[template.intake_id,scopeHash,hash('h5-performance-other')]);
    await clone('intake.web_request_binding',`h5_perf_bulk b CROSS JOIN LATERAL(SELECT * FROM intake.web_request_binding WHERE intake_id=$1::uuid)t`,`jsonb_build_object('intake_id',b.intake_id,'request_ref',b.request_ref,'canonical_reporter_binding',CASE WHEN b.g<=${ownedAdded} THEN $2 ELSE $3 END,'notify_recipient_id',NULL,'notify_identity_namespace',NULL,'notify_proof_ref',NULL,'notify_verified_epoch_ms',NULL)`,[template.intake_id,scopeHash,hash('h5-performance-other')]);
    await clone('intake.web_submission',`h5_perf_bulk b CROSS JOIN LATERAL(SELECT * FROM intake.web_submission WHERE intake_id=$1::uuid AND kind='SUBMIT' LIMIT 1)t`,`jsonb_build_object('id',b.submission_id,'intake_id',b.intake_id,'command_receipt_id',b.receipt_id,'canonical_reporter_binding',CASE WHEN b.g<=${ownedAdded} THEN $2 ELSE $3 END)`,[template.intake_id,scopeHash,hash('h5-performance-other')]);
    await clone('pilot_ticket.ticket',`h5_perf_bulk b CROSS JOIN LATERAL(SELECT * FROM pilot_ticket.ticket WHERE id=$1::uuid)t`,`jsonb_build_object('id',b.ticket_id,'source_intake_id',b.intake_id,'ticket_no','IT-'||to_char(platform.local_now(),'YYYYMMDD')||'-'||(900000+b.g)::text)`,[template.ticket_id]);
    await connection.query("UPDATE intake.service_intake i SET pilot_ticket_id=b.ticket_id,status='TICKET_CREATED' FROM h5_perf_bulk b WHERE i.id=b.intake_id");
    await clone('directory.identity_binding',`(SELECT * FROM directory.identity_binding WHERE reporter_identity_hash=$1 LIMIT 1)t`,`jsonb_build_object('reporter_identity_hash',$2::text,'provider_user_id','h5-provider-1')`,[scopeHash,hash('h5-performance-other')]);
    await clone('pilot_ticket.ticket_event',`generate_series(1,9999)g CROSS JOIN LATERAL(SELECT * FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid ORDER BY event_ordinal LIMIT 1)t`,`jsonb_build_object('event_id',gen_random_uuid(),'event_type','ticket.information_added','old_status',t.new_status,'aggregate_version',g+1,'event_ordinal',g+1)`,[template.ticket_id]);
    await connection.query('UPDATE pilot_ticket.ticket SET version=10000 WHERE id=$1::uuid',[template.ticket_id]);
    await connection.query('COMMIT');
  }catch(error){await connection.query('ROLLBACK');throw error;}finally{connection.release();}
  await pool.query('ANALYZE intake.service_intake');await pool.query('ANALYZE intake.web_request_binding');await pool.query('ANALYZE intake.web_submission');await pool.query('ANALYZE pilot_ticket.ticket');await pool.query('ANALYZE pilot_ticket.ticket_event');
  const plans=[];for(const [id,sample]of queries){
    if(sample.owner_kind!=='BATCH'&&!/FROM\s+(?:intake\.web_request_binding|directory\.identity_binding)|WITH\s+(?:all_events|current_member|current_ticket|web_reports|eligible)/iu.test(sample.text))continue;
    const plan=await pool.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sample.text,sample.values);plans.push({sample_key:id,sha256:sample.sha256,statement:sample.text,batch_slots:sample.batch_slots,read_views:sample.read_views,parameter_types:sample.values.map(value=>value===null?'null':Array.isArray(value)?'array':typeof value),parameter_values:sample.values,plan:plan.rows});
  }
  const counts=(await pool.query<{person_reports:number;department_reports:number;ticket_events:number}>(`SELECT (SELECT count(*)::integer FROM intake.web_request_binding WHERE canonical_reporter_binding=$1) AS person_reports,(SELECT count(*)::integer FROM intake.web_request_binding) AS department_reports,(SELECT count(*)::integer FROM pilot_ticket.ticket_event WHERE ticket_id=$2::uuid) AS ticket_events`,[scopeHash,template.ticket_id])).rows[0];
  assert.deepEqual(counts,{person_reports:10000,department_reports:100000,ticket_events:10000});
  await writeFile(path.join(outputRoot,'large-data-explain.json'),JSON.stringify({synthetic:true,...counts,plans},null,2)+'\n');
  return {synthetic:true,...counts,explain_count:plans.length};
}
const invoked=process.argv[1];
if(invoked&&pathToFileURL(path.resolve(invoked)).href===import.meta.url)await run(config());
export {run as runH5Performance};
