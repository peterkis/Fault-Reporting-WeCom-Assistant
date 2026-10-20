import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createYxxH5Runtime,validateYxxH5RuntimeOptions,createYxxH5RequestAuthentication} from '../src/yxx-h5-runtime.mjs';
import {readWorkbenchH5RuntimeOptions,readHumanWorkbenchConfiguration,workbenchRoleEnvironment} from '../src/human-workbench-configuration.mjs';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import {workbenchTestSettings} from './helpers/human-workbench-test-settings.mjs';

const privatePath=join(tmpdir(),'yxx-h5-runtime-private');
const h5Env={YIXIAOXIU_H5_ENABLED:'true',YIXIAOXIU_H5_PRIVATE_ROOT:privatePath,YIXIAOXIU_H5_MEDIA_KEY_HEX:'12'.repeat(32),
  YIXIAOXIU_H5_FFMPEG_PATH:join(tmpdir(),'ffmpeg.exe'),YIXIAOXIU_H5_FFPROBE_PATH:join(tmpdir(),'ffprobe.exe')};
const pool=()=>createPostgresPool({connectionString:'postgres://synthetic:synthetic@127.0.0.1:9/p2_015_h5_no_connection',max:1,connectionTimeoutMillis:100});

test('H5 runtime and CLI stay disabled by default and reject non-boolean enablement',()=>{
  assert.equal(validateYxxH5RuntimeOptions(undefined),false);
  assert.equal(validateYxxH5RuntimeOptions(null),false);
  assert.deepEqual(readWorkbenchH5RuntimeOptions({}),{enabled:false});
  assert.deepEqual(readWorkbenchH5RuntimeOptions({YIXIAOXIU_H5_ENABLED:'false'}),{enabled:false});
  for(const value of ['TRUE','1','yes',''])assert.throws(()=>readWorkbenchH5RuntimeOptions({YIXIAOXIU_H5_ENABLED:value}),/YIXIAOXIU_H5_ENABLED/u);
  // @ts-expect-error Negative runtime boundary: string flags must be rejected rather than coerced.
  assert.throws(()=>validateYxxH5RuntimeOptions({enabled:'true'}),/CONFIG_INVALID/u);
  assert.throws(()=>readWorkbenchH5RuntimeOptions({YIXIAOXIU_H5_PROGRESS_ENABLED:'true'}),/YIXIAOXIU_H5_PROGRESS_ENABLED/u);
});

test('explicit H5 configuration requires a private absolute root, 256-bit key and Worker executable pair',()=>{
  const app=readWorkbenchH5RuntimeOptions(h5Env);
  assert.equal(app.enabled,true);assert.equal(app.key?.byteLength,32);assert.equal(app.workbenchProgressEnabled,false);
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
});

test('supervisor sends H5 storage to App and Worker while retaining role credential separation',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'yxx-h5-runtime-config-'));
  try{
    const f=workbenchTestSettings(directory),c=readHumanWorkbenchConfiguration({...f.env,...h5Env},{isolatedBoundaries:true});
    assert.ok(c.enabled);
    const app=workbenchRoleEnvironment(c,'APP'),worker=workbenchRoleEnvironment(c,'WORKER'),gateway=workbenchRoleEnvironment(c,'GATEWAY');
    assert.equal(app.YIXIAOXIU_H5_ENABLED,'true');assert.equal(worker.YIXIAOXIU_H5_ENABLED,'true');
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

test('disabled composition performs no IO and leaves its externally owned pool open',async()=>{
  const database=pool(),end=mock.method(database,'end');
  const runtime=createYxxH5Runtime({pool:database,scopeSecret:'runtime-test-secret'.repeat(3),publicOrigin:'https://synthetic.invalid',corpId:'synthetic',agentId:'1'});
  try{
    assert.equal(runtime.enabled,false);assert.equal(runtime.media,null);assert.equal(runtime.wecom,null);assert.equal(runtime.lifecycle,null);
    assert.equal(await runtime.ready(),true);await runtime.runOnce();await runtime.close();await runtime.close();
    assert.equal(database.totalCount,0);assert.equal(end.mock.callCount(),0);
  }finally{end.mock.restore();await database.end();}
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
  const cleanup=mock.method(database,'query',async()=>{cleanupCalls++;return new Promise<{rowCount:number;rows:never[]}>(resolve=>{finishCleanup=resolve;});});
  const connect=mock.method(database,'connect',async()=>{transactions++;return {query:async()=>({rowCount:0,rows:[]}),release:()=>{}};});
  const end=mock.method(database,'end');
  const runtime=createYxxH5Runtime({pool:database,scopeSecret:'runtime-test-secret'.repeat(3),role:'WORKER',options:{
    enabled:true,privateRoot:directory,key:Buffer.alloc(32,2),ffmpegPath:h5Env.YIXIAOXIU_H5_FFMPEG_PATH,ffprobePath:h5Env.YIXIAOXIU_H5_FFPROBE_PATH,
  }});
  try{
    const first=runtime.runOnce();await runtime.runOnce();assert.equal(cleanupCalls,1);assert.equal(transactions,0);
    assert.ok(finishCleanup);finishCleanup({rowCount:0,rows:[]});await first;
    await runtime.runOnce();assert.equal(cleanupCalls,1);assert.equal(transactions,2);
    await runtime.close();await runtime.runOnce();assert.equal(transactions,2);assert.equal(end.mock.callCount(),0);
    assert.deepEqual(runtime.sdk,{enabled:false,corp_id:null,agent_id:null});assert.deepEqual(await readdir(directory),[]);
  }finally{finishCleanup?.({rowCount:0,rows:[]});await runtime.close();cleanup.mock.restore();connect.mock.restore();end.mock.restore();await database.end();await rm(directory,{recursive:true,force:true});}
});
