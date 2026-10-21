import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createYxxH5Runtime,validateYxxH5RuntimeOptions,createYxxH5RequestAuthentication} from '../src/yxx-h5-runtime.mjs';
import {readWorkbenchH5RuntimeOptions,readHumanWorkbenchConfiguration,workbenchRoleEnvironment} from '../src/human-workbench-configuration.mjs';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import {workbenchTestSettings} from './helpers/human-workbench-test-settings.mjs';
import {createYxxH5Media} from '../src/yxx-h5-media.mjs';
import type {H5MediaPrivateStore} from '../contracts/yxx_h5_media_contracts.js';
import {createSourceFile,createPrinter,factory,isImportDeclaration,ScriptKind,ScriptTarget} from 'typescript';

const privatePath=join(tmpdir(),'yxx-h5-runtime-private');
const h5Env={YIXIAOXIU_H5_ENABLED:'true',YIXIAOXIU_H5_PRIVATE_ROOT:privatePath,YIXIAOXIU_H5_MEDIA_KEY_HEX:'12'.repeat(32),
  YIXIAOXIU_H5_FFMPEG_PATH:join(tmpdir(),'ffmpeg.exe'),YIXIAOXIU_H5_FFPROBE_PATH:join(tmpdir(),'ffprobe.exe')};
const pool=()=>createPostgresPool({connectionString:'postgres://synthetic:synthetic@127.0.0.1:9/p2_015_h5_no_connection',max:1,connectionTimeoutMillis:100});

/** Exercise the compiled role's public main while replacing only process/Worker launch leaves. */
async function workerBeforeReady(h5:NodeJS.ProcessEnv){
  const roleUrl=new URL('../scripts/human-workbench-role.mjs',import.meta.url);
  const data=(body:string)=>'data:text/javascript;base64,'+Buffer.from(body).toString('base64');
  const processUrl=data('export default {env:globalThis.process.env,argv:[],send(){return true},once(){},exit(){throw Error("UNEXPECTED_PROCESS_EXIT")}};');
  const launchUrl=data('export function runWorker(options){return options} export function runApp(){throw Error("UNEXPECTED_APP_START")} export function runGateway(){throw Error("UNEXPECTED_GATEWAY_START")}');
  const source=createSourceFile(roleUrl.pathname,await readFile(roleUrl,'utf8'),ScriptTarget.ES2022,true,ScriptKind.JS);
  const statements=source.statements.map(statement=>{
    if(!isImportDeclaration(statement)||!('text' in statement.moduleSpecifier)||typeof statement.moduleSpecifier.text!=='string')return statement;
    const specifier=statement.moduleSpecifier.text;
    const target=specifier==='./p2-g1-process-role.mjs'?launchUrl:specifier.startsWith('.')?new URL(specifier,roleUrl).href:specifier;
    return factory.updateImportDeclaration(statement,statement.modifiers,statement.importClause,factory.createStringLiteral(target),statement.attributes);
  });
  const module:unknown=await import(data('import process from '+JSON.stringify(processUrl)+';\n'+createPrinter().printFile(factory.updateSourceFile(source,statements))));
  assert.ok(module&&typeof module==='object'&&'main' in module&&typeof module.main==='function');
  const environment:NodeJS.ProcessEnv={WORKBENCH_RUNTIME_PROFILE:'human-v1',WORKBENCH_ROLE_SETTINGS:JSON.stringify({role:'WORKER',transportEnabled:false,botId:'synthetic-worker-bot'}),
    PILOT_LOG_IDENTITY_HASH_KEY:'synthetic-worker-identity-key',P2_016_REPORTER_HMAC_SECRET:'synthetic-worker-reporter-secret'.repeat(2),...h5};
  const names=[...new Set([...Object.keys(environment),...Object.keys(h5Env),'YIXIAOXIU_H5_PERFORMANCE_ENABLED','YIXIAOXIU_H5_PROGRESS_ENABLED','YIXIAOXIU_H5_PREVIOUS_STATIC_ROOT','APP_SECRET','WECOM_BOT_SECRET'])];
  const original=new Map(names.map(name=>[name,process.env[name]]));
  let options:unknown;
  try{
    for(const name of names){const value=environment[name];if(value===undefined)delete process.env[name];else process.env[name]=value;}
    options=await Reflect.apply(module.main,undefined,[['--role=worker']]);
  }finally{for(const [name,value]of original){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
  assert.ok(options&&typeof options==='object'&&'beforeReady' in options&&typeof options.beforeReady==='function');
  const beforeReady=options.beforeReady;
  return async(database:{query:(sql:string,values?:readonly unknown[])=>Promise<{rowCount:number;rows:{migration_id:string}[]}>})=>{await Reflect.apply(beforeReady,undefined,[{pool:database}]);};
}

function schemaPool(migrations:ReadonlySet<string>){
  const queried:string[][]=[];
  return {queried,query:async(sql:string,values?:readonly unknown[])=>{
    assert.match(sql,/^SELECT migration_id FROM platform\.schema_migration WHERE migration_id\s*(?:IN|=\s*ANY)/u);
    const parameter=values?.[0];
    const required=Array.isArray(parameter)?parameter.map(value=>{assert.equal(typeof value,'string');return String(value);}):[...sql.matchAll(/'(\d{3}_[a-z0-9_]+)'/gu)].map(match=>match[1]??'');
    assert.ok(required.length>0);queried.push(required);
    const rows=required.filter(id=>migrations.has(id)).map(migration_id=>({migration_id}));return {rowCount:rows.length,rows};
  }};
}

test('performance Worker refuses readiness before 066 and accepts the same database after 066 exists',async()=>{
  const fetch=mock.method(globalThis,'fetch',async()=>{throw Error('UNEXPECTED_PROVIDER_CALL');});
  try{
    const ready=await workerBeforeReady({...h5Env,YIXIAOXIU_H5_PERFORMANCE_ENABLED:'true'});
    const migrations=new Set(['064_yixiaoxiu_h5_member_service','065_yixiaoxiu_h5_web_media']),database=schemaPool(migrations);
    await assert.rejects(ready(database),{message:'HUMAN_WORKBENCH_SCHEMA_REQUIRED:yxx_h5_schema'});
    migrations.add('066_yixiaoxiu_h5_media_previews');await ready(database);
    assert.deepEqual(database.queried,[['064_yixiaoxiu_h5_member_service','065_yixiaoxiu_h5_web_media','066_yixiaoxiu_h5_media_previews'],['064_yixiaoxiu_h5_member_service','065_yixiaoxiu_h5_web_media','066_yixiaoxiu_h5_media_previews']]);
    assert.equal(fetch.mock.callCount(),0);
  }finally{fetch.mock.restore();}
});

test('nonperformance Worker keeps the 064/065 requirement without requiring 066',async()=>{
  const fetch=mock.method(globalThis,'fetch',async()=>{throw Error('UNEXPECTED_PROVIDER_CALL');});
  try{
    for(const performance of [undefined,'false']){
      const ready=await workerBeforeReady({...h5Env,...(performance===undefined?{}:{YIXIAOXIU_H5_PERFORMANCE_ENABLED:performance})});
      const migrations=new Set(['064_yixiaoxiu_h5_member_service','065_yixiaoxiu_h5_web_media']),database=schemaPool(migrations);
      await ready(database);assert.deepEqual(database.queried,[['064_yixiaoxiu_h5_member_service','065_yixiaoxiu_h5_web_media']]);
      for(const missing of ['064_yixiaoxiu_h5_member_service','065_yixiaoxiu_h5_web_media']){
        migrations.delete(missing);await assert.rejects(ready(database),{message:'HUMAN_WORKBENCH_SCHEMA_REQUIRED:yxx_h5_schema'});migrations.add(missing);
      }
    }
    assert.equal(fetch.mock.callCount(),0);
  }finally{fetch.mock.restore();}
});

test('disabled H5 Worker readiness does not query schema or call a Provider',async()=>{
  const fetch=mock.method(globalThis,'fetch',async()=>{throw Error('UNEXPECTED_PROVIDER_CALL');});
  try{const ready=await workerBeforeReady({}),database=schemaPool(new Set());await ready(database);assert.deepEqual(database.queried,[]);assert.equal(fetch.mock.callCount(),0);}finally{fetch.mock.restore();}
});

test('H5 runtime and CLI stay disabled by default and reject non-boolean enablement',()=>{
  assert.equal(validateYxxH5RuntimeOptions(undefined),false);
  assert.equal(validateYxxH5RuntimeOptions(null),false);
  assert.deepEqual(readWorkbenchH5RuntimeOptions({}),{enabled:false});
  assert.deepEqual(readWorkbenchH5RuntimeOptions({YIXIAOXIU_H5_ENABLED:'false'}),{enabled:false});
  for(const value of ['TRUE','1','yes',''])assert.throws(()=>readWorkbenchH5RuntimeOptions({YIXIAOXIU_H5_ENABLED:value}),/YIXIAOXIU_H5_ENABLED/u);
  // Exercise malformed JavaScript input without weakening the TypeScript contract.
  assert.throws(()=>Reflect.apply(validateYxxH5RuntimeOptions,undefined,[{enabled:'true'}]),/CONFIG_INVALID/u);
  assert.throws(()=>readWorkbenchH5RuntimeOptions({YIXIAOXIU_H5_PROGRESS_ENABLED:'true'}),/YIXIAOXIU_H5_PROGRESS_ENABLED/u);
  assert.throws(()=>readWorkbenchH5RuntimeOptions({YIXIAOXIU_H5_PERFORMANCE_ENABLED:'true'}),/YIXIAOXIU_H5_PERFORMANCE_ENABLED/u);
  assert.throws(()=>readWorkbenchH5RuntimeOptions({YIXIAOXIU_H5_PREVIOUS_STATIC_ROOT:privatePath}),/YIXIAOXIU_H5_PREVIOUS_STATIC_ROOT/u);
  assert.throws(()=>Reflect.apply(validateYxxH5RuntimeOptions,undefined,[{enabled:false,performanceEnabled:true}]),/CONFIG_INVALID/u);
});

test('explicit H5 configuration requires a private absolute root, 256-bit key and Worker executable pair',()=>{
  const app=readWorkbenchH5RuntimeOptions(h5Env);
  assert.equal(app.enabled,true);assert.equal(app.key?.byteLength,32);assert.equal(app.workbenchProgressEnabled,false);assert.equal(app.performanceEnabled,false);
  assert.equal(app.ffmpegPath,undefined);assert.equal(app.ffprobePath,undefined);
  assert.equal(validateYxxH5RuntimeOptions(app),true);
  assert.throws(()=>validateYxxH5RuntimeOptions(app,'WORKER'),/CONFIG_INVALID/u);
  const worker=readWorkbenchH5RuntimeOptions(h5Env,{worker:true});
  assert.equal(validateYxxH5RuntimeOptions(worker,'WORKER'),true);
  for(const key of ['YIXIAOXIU_H5_PRIVATE_ROOT','YIXIAOXIU_H5_MEDIA_KEY_HEX','YIXIAOXIU_H5_FFMPEG_PATH','YIXIAOXIU_H5_FFPROBE_PATH'])
    assert.throws(()=>readWorkbenchH5RuntimeOptions({...h5Env,[key]:undefined},{worker:true}),new RegExp(key,'u'));
  assert.throws(()=>readWorkbenchH5RuntimeOptions({...h5Env,YIXIAOXIU_H5_PRIVATE_ROOT:'relative/root'}),/PRIVATE_ROOT/u);
  assert.throws(()=>readWorkbenchH5RuntimeOptions({...h5Env,YIXIAOXIU_H5_MEDIA_KEY_HEX:'gg'.repeat(32)}),/MEDIA_KEY_HEX/u);
  assert.throws(()=>validateYxxH5RuntimeOptions({...worker,key:Buffer.alloc(31)}),/CONFIG_INVALID/u);
  assert.equal(readWorkbenchH5RuntimeOptions({...h5Env,YIXIAOXIU_H5_PROGRESS_ENABLED:'true'}).workbenchProgressEnabled,true);
  assert.equal(readWorkbenchH5RuntimeOptions({...h5Env,YIXIAOXIU_H5_PERFORMANCE_ENABLED:'true'}).performanceEnabled,true);
  assert.equal(readWorkbenchH5RuntimeOptions({...h5Env,YIXIAOXIU_H5_PREVIOUS_STATIC_ROOT:privatePath}).previousStaticRoot,privatePath);
  assert.throws(()=>readWorkbenchH5RuntimeOptions({...h5Env,YIXIAOXIU_H5_PERFORMANCE_ENABLED:'1'}),/PERFORMANCE_ENABLED/u);
  assert.throws(()=>readWorkbenchH5RuntimeOptions({...h5Env,YIXIAOXIU_H5_PREVIOUS_STATIC_ROOT:'relative'}),/PREVIOUS_STATIC_ROOT/u);
});

test('supervisor sends H5 storage to App and Worker while retaining role credential separation',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'yxx-h5-runtime-config-'));
  try{
    const f=workbenchTestSettings(directory),c=readHumanWorkbenchConfiguration({...f.env,...h5Env,YIXIAOXIU_H5_PERFORMANCE_ENABLED:'true',YIXIAOXIU_H5_PREVIOUS_STATIC_ROOT:privatePath},{isolatedBoundaries:true});
    assert.ok(c.enabled);
    const app=workbenchRoleEnvironment(c,'APP'),worker=workbenchRoleEnvironment(c,'WORKER'),gateway=workbenchRoleEnvironment(c,'GATEWAY');
    assert.equal(app.YIXIAOXIU_H5_ENABLED,'true');assert.equal(worker.YIXIAOXIU_H5_ENABLED,'true');
    assert.equal(app.YIXIAOXIU_H5_PERFORMANCE_ENABLED,'true');assert.equal(worker.YIXIAOXIU_H5_PERFORMANCE_ENABLED,'true');
    assert.equal(app.YIXIAOXIU_H5_PREVIOUS_STATIC_ROOT,privatePath);assert.equal(gateway.YIXIAOXIU_H5_PERFORMANCE_ENABLED,undefined);assert.equal(gateway.YIXIAOXIU_H5_PREVIOUS_STATIC_ROOT,undefined);
    assert.equal(app.YIXIAOXIU_H5_MEDIA_KEY_HEX,h5Env.YIXIAOXIU_H5_MEDIA_KEY_HEX);
    assert.equal(app.YIXIAOXIU_H5_FFMPEG_PATH,undefined);assert.equal(worker.YIXIAOXIU_H5_FFMPEG_PATH,h5Env.YIXIAOXIU_H5_FFMPEG_PATH);
    assert.equal(worker.APP_SECRET,undefined);assert.equal(worker.WECOM_BOT_SECRET,undefined);
    for(const key of Object.keys(h5Env))assert.equal(gateway[key],undefined);
    assert.equal(JSON.parse(worker.WORKBENCH_ROLE_SETTINGS??'').memberEntry,undefined);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('overlapping reads share one qualification and recheck locally until the HTTP request is released',async()=>{
  let authenticateCalls=0,rechecks=0,settle:((context:{scope:string})=>void)|undefined;
  const authentication=createYxxH5RequestAuthentication({authenticate:async(_request:object)=>{authenticateCalls++;return new Promise<{scope:string}>(resolve=>{settle=resolve;});},
    recheck:()=>{rechecks++;return {scope:'current'};}});
  const request={};
  const first=authentication.authenticate(request),second=authentication.authenticate(request);
  await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(authenticateCalls,1);assert.ok(settle);settle({scope:'initial'});
  assert.deepEqual(await first,{scope:'initial'});assert.deepEqual(await second,{scope:'current'});assert.equal(rechecks,1);
  assert.deepEqual(await authentication.authenticate(request),{scope:'current'});assert.equal(authenticateCalls,1);
  authentication.release(request);
  const again=authentication.authenticate(request);await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(authenticateCalls,2);assert.ok(settle);settle({scope:'new-request'});await again;
  authentication.release(request);
});

test('qualification unavailability stays 503 and local revocation is checked before reuse',async()=>{
  const unavailable=Object.assign(new Error('YXX_UNAVAILABLE'),{status:503,code:'YXX_UNAVAILABLE'});
  let calls=0,revoked=false;
  const failing=createYxxH5RequestAuthentication({authenticate:async(_request:object)=>{calls++;throw unavailable;},recheck:()=>true});
  const request={};
  await assert.rejects(failing.authenticate(request),error=>error===unavailable);
  await assert.rejects(failing.authenticate(request),error=>error===unavailable);assert.equal(calls,1);failing.release(request);
  const ready=createYxxH5RequestAuthentication({authenticate:(_request:object)=>true,recheck:()=>{if(revoked)throw Object.assign(new Error('YXX_AUTH_REQUIRED'),{status:401});return true;}});
  await ready.authenticate(request);revoked=true;
  await assert.rejects(ready.authenticate(request),{message:'YXX_AUTH_REQUIRED'});ready.release(request);
});

test('entry and general authentication overlap on the same pending qualification in either order',async()=>{
  for(const firstPurpose of ['ENTRY','BASE'] as const){
    const calls={ENTRY:0,BASE:0};let rechecks=0,revoked=false,release=()=>{},entered=()=>{};
    const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
    const qualify=async(purpose:'ENTRY'|'BASE')=>{calls[purpose]++;entered();await gate;return {scope:purpose};};
    const authentication=createYxxH5RequestAuthentication<object,{scope:string}>({authenticate:()=>qualify('BASE'),authenticateEntry:()=>qualify('ENTRY'),
      recheck:()=>{rechecks++;if(revoked)throw Object.assign(new Error('YXX_AUTH_REQUIRED'),{status:401});return {scope:'current'};}});
    const request={};
    try{
      const first=firstPurpose==='ENTRY'?authentication.authenticateEntry(request):authentication.authenticate(request);
      const second=firstPurpose==='ENTRY'?authentication.authenticate(request):authentication.authenticateEntry(request);
      const third=authentication.authenticateEntry(request);
      await started;assert.deepEqual(calls,firstPurpose==='ENTRY'?{ENTRY:1,BASE:0}:{ENTRY:0,BASE:1});assert.equal(rechecks,0);
      release();const contexts=await Promise.all([first,second,third]);
      assert.deepEqual(contexts,[{scope:firstPurpose},{scope:'current'},{scope:'current'}]);assert.equal(rechecks,2);
      assert.deepEqual(await authentication.authenticateEntry(request),{scope:'current'});
      assert.deepEqual(await authentication.authenticate(request),{scope:'current'});assert.equal(rechecks,4);
      revoked=true;await Promise.all([assert.rejects(authentication.authenticateEntry(request),{status:401}),assert.rejects(authentication.authenticate(request),{status:401})]);
      assert.deepEqual(calls,firstPurpose==='ENTRY'?{ENTRY:1,BASE:0}:{ENTRY:0,BASE:1});
    }finally{release();authentication.release(request);}
  }
});

test('a failed entry or base qualification is shared across purposes without retry until release',async()=>{
  const unavailable=Object.assign(new Error('YXX_UNAVAILABLE'),{status:503,code:'YXX_UNAVAILABLE'});
  for(const firstPurpose of ['ENTRY','BASE'] as const){
    const calls={ENTRY:0,BASE:0};let rechecks=0;
    const fail=async(purpose:'ENTRY'|'BASE'):Promise<boolean>=>{calls[purpose]++;throw unavailable;};
    const authentication=createYxxH5RequestAuthentication<object,boolean>({authenticate:()=>fail('BASE'),authenticateEntry:()=>fail('ENTRY'),recheck:()=>{rechecks++;return true;}}),request={};
    try{
      const first=firstPurpose==='ENTRY'?authentication.authenticateEntry(request):authentication.authenticate(request);
      const second=firstPurpose==='ENTRY'?authentication.authenticate(request):authentication.authenticateEntry(request);
      await Promise.all([assert.rejects(first,error=>error===unavailable),assert.rejects(second,error=>error===unavailable)]);
      await assert.rejects(authentication.authenticateEntry(request),error=>error===unavailable);await assert.rejects(authentication.authenticate(request),error=>error===unavailable);
      assert.equal(rechecks,0);assert.deepEqual(calls,firstPurpose==='ENTRY'?{ENTRY:1,BASE:0}:{ENTRY:0,BASE:1});
      authentication.release(request);await assert.rejects(authentication.authenticateEntry(request),error=>error===unavailable);
      assert.deepEqual(calls,firstPurpose==='ENTRY'?{ENTRY:2,BASE:0}:{ENTRY:1,BASE:1});
    }finally{authentication.release(request);}
  }
});

test('disabled composition performs no IO and leaves its externally owned pool open',async()=>{
  const database=pool(),end=mock.method(database,'end');
  const runtime=createYxxH5Runtime({pool:database,scopeSecret:'runtime-test-secret'.repeat(3),publicOrigin:'https://synthetic.invalid',corpId:'synthetic',agentId:'1'});
  try{
    assert.equal(runtime.enabled,false);assert.equal(runtime.media,null);assert.equal(runtime.wecom,null);assert.equal(runtime.lifecycle,null);
    assert.equal(await runtime.ready(),true);await runtime.runOnce();await runtime.close();await runtime.close();
    assert.equal(database.totalCount,0);assert.equal(end.mock.callCount(),0);
  }finally{end.mock.restore();await database.end();}
});

test('concurrent media close waits for the same pending underlying close exactly once',async()=>{
  const database=pool();let release=()=>{},started=()=>{},closeCalls=0,secondFinished=false;
  const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
  const store:H5MediaPrivateStore={write:async()=>{throw new Error('UNUSED');},read:async()=>{throw new Error('UNUSED');},remove:async()=>{throw new Error('UNUSED');},
    close:async()=>{closeCalls++;started();await gate;},ownedResourceState:()=>({active:0,handles:0,plaintext_bytes:0})};
  const media=createYxxH5Media({pool:database,store,enabled:true});
  try{
    const first=media.close();await entered;const second=media.close().then(()=>{secondFinished=true;});
    await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(secondFinished,false);assert.equal(closeCalls,1);
    release();await Promise.all([first,second]);assert.equal(secondFinished,true);assert.equal(closeCalls,1);assert.deepEqual(media.ownedResourceState(),{active:0,plaintext_bytes:0});
  }finally{release();await media.close();await database.end();}
});

test('performance readiness requires the incremental media schema and does not enable H5 implicitly',async()=>{
  const database=pool(),directory=await mkdtemp(join(tmpdir(),'yxx-h5-runtime-ready-'));
  const migrations=new Set(['064_yixiaoxiu_h5_member_service','065_yixiaoxiu_h5_web_media','043_ticket_reopen_rounds']);
  const query=mock.method(database,'query',async(_sql:string,values:readonly unknown[])=>{
    const required=values[0];assert.ok(Array.isArray(required));
    const rows=required.filter((value):value is string=>typeof value==='string'&&migrations.has(value)).map(migration_id=>({migration_id}));
    return {rows,rowCount:rows.length};
  });
  const runtime=createYxxH5Runtime({pool:database,scopeSecret:'runtime-ready-secret'.repeat(3),publicOrigin:'https://synthetic.invalid',corpId:'synthetic',agentId:'1',options:{enabled:true,performanceEnabled:true,privateRoot:directory,key:Buffer.alloc(32,4)}});
  try{
    assert.equal(runtime.performanceEnabled,true);assert.equal(await runtime.ready(),false);
    migrations.add('066_yixiaoxiu_h5_media_previews');assert.equal(await runtime.ready(),true);
  }finally{await runtime.close();query.mock.restore();await database.end();await rm(directory,{recursive:true,force:true});}
});

test('App composition derives SDK identity from the supplied member entry and releases only its media resources',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'yxx-h5-runtime-store-')),database=pool(),end=mock.method(database,'end');
  const key=Buffer.alloc(32,7),options={enabled:true,privateRoot:directory,key,accessTokenProvider:async()=> 'synthetic-token'};
  const runtime=createYxxH5Runtime({pool:database,scopeSecret:'runtime-test-secret'.repeat(3),publicOrigin:'https://synthetic.invalid',corpId:'current-corp',agentId:'42',options});
  try{
    assert.deepEqual(runtime.sdk,{enabled:true,corp_id:'current-corp',agent_id:'42'});assert.equal(runtime.workbenchProgressEnabled,false);
    await runtime.runOnce();assert.equal(database.totalCount,0,'App owns no media Worker pump');
    await runtime.close();await runtime.close();assert.equal(end.mock.callCount(),0);
    assert.deepEqual(runtime.media?.ownedResourceState(),{active:0,plaintext_bytes:0});assert.deepEqual(await readdir(directory),[]);
    assert.deepEqual(key,Buffer.alloc(32,7),'the caller retains ownership of its injected key');
  }finally{await runtime.close();end.mock.restore();await database.end();await rm(directory,{recursive:true,force:true});}
});

test('the existing Worker turn serializes media work, bounds cleanup cadence and cancels new work on close',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'yxx-h5-runtime-worker-')),database=pool();
  let finishCleanup:((value:{rowCount:number;rows:never[]})=>void)|undefined,cleanupCalls=0,transactions=0;
  let cleanupStarted=()=>{};const started=new Promise<void>(resolve=>{cleanupStarted=resolve;});
  const cleanup=mock.method(database,'query',async()=>{cleanupCalls++;cleanupStarted();return new Promise<{rowCount:number;rows:never[]}>(resolve=>{finishCleanup=resolve;});});
  const connect=mock.method(database,'connect',async()=>{transactions++;return {query:async()=>({rowCount:0,rows:[]}),release:()=>{}};});
  const end=mock.method(database,'end');
  const runtime=createYxxH5Runtime({pool:database,scopeSecret:'runtime-test-secret'.repeat(3),role:'WORKER',options:{
    enabled:true,privateRoot:directory,key:Buffer.alloc(32,2),ffmpegPath:h5Env.YIXIAOXIU_H5_FFMPEG_PATH,ffprobePath:h5Env.YIXIAOXIU_H5_FFPROBE_PATH,
  }});
  try{
    const first=runtime.runOnce();await runtime.runOnce();await started;assert.equal(cleanupCalls,1);assert.equal(transactions,0);
    assert.ok(finishCleanup);finishCleanup({rowCount:0,rows:[]});await first;
    await runtime.runOnce();assert.equal(cleanupCalls,1);assert.equal(transactions,2);
    await runtime.close();await runtime.runOnce();assert.equal(transactions,2);assert.equal(end.mock.callCount(),0);
    assert.deepEqual(runtime.sdk,{enabled:false,corp_id:null,agent_id:null});assert.deepEqual(await readdir(directory),[]);
  }finally{finishCleanup?.({rowCount:0,rows:[]});await runtime.close();cleanup.mock.restore();connect.mock.restore();end.mock.restore();await database.end();await rm(directory,{recursive:true,force:true});}
});
