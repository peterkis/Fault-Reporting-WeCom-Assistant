import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readHumanWorkbenchConfiguration,workbenchRoleEnvironment,createWorkbenchNotificationOptions,resolveWorkbenchMention,readWorkbenchRoleSettings,readWorkbenchWorkerSettings} from '../app/server/src/human-workbench-configuration.mjs';
import {readP2016LiveConfiguration} from '../app/server/src/p2-016-live-configuration.mjs';
import {workbenchTestSettings} from './helpers/human-workbench-test-settings.mjs';
import {createHmac} from 'node:crypto';
import {createWorkbenchBotMemberAdmission} from '../app/server/src/human-workbench-bot-member-admission.mjs';
function fixture(run:(f:ReturnType<typeof workbenchTestSettings>)=>void|Promise<void>){const directory=mkdtempSync(join(tmpdir(),'human-workbench-config-'));return Promise.resolve().then(()=>run(workbenchTestSettings(directory))).finally(()=>rmSync(directory,{recursive:true,force:true}));}

test('employee media is default-off and its single setting reaches APP/WORKER without reaching Gateway',()=>fixture(f=>{
 const baseline=readHumanWorkbenchConfiguration(f.env,{isolatedBoundaries:true});assert.equal(baseline.enabled,true);if(!baseline.enabled)throw Error('SYNTHETIC_PROFILE_DISABLED');assert.equal(baseline.settings.workbenchMediaEmployeeReadEnabled,false);
 writeFileSync(f.file,JSON.stringify({...f.settings,workbenchMediaEmployeeReadEnabled:'true'}));assert.throws(()=>readHumanWorkbenchConfiguration(f.env,{isolatedBoundaries:true}),/workbenchMediaEmployeeReadEnabled/u);
 writeFileSync(f.file,JSON.stringify({...f.settings,workbenchMediaEmployeeReadEnabled:true}));assert.throws(()=>readHumanWorkbenchConfiguration(f.env,{isolatedBoundaries:true}),/workbenchMediaEmployeeReadEnabled/u);
 const config=readHumanWorkbenchConfiguration({...f.env,YIXIAOXIU_H5_ENABLED:'true',YIXIAOXIU_H5_PRIVATE_ROOT:join(tmpdir(),'synthetic-private-root'),YIXIAOXIU_H5_MEDIA_KEY_HEX:'ab'.repeat(32),YIXIAOXIU_H5_FFMPEG_PATH:join(tmpdir(),'synthetic-ffmpeg.exe'),YIXIAOXIU_H5_FFPROBE_PATH:join(tmpdir(),'synthetic-ffprobe.exe')},{isolatedBoundaries:true});assert.equal(config.enabled,true);if(!config.enabled)throw Error('SYNTHETIC_PROFILE_DISABLED');
 assert.equal(readWorkbenchRoleSettings('APP',workbenchRoleEnvironment(config,'APP')).workbenchMediaEmployeeReadEnabled,true);
 assert.equal(readWorkbenchWorkerSettings(workbenchRoleEnvironment(config,'WORKER')).workbenchMediaEmployeeReadEnabled,true);
 assert.equal(JSON.parse(workbenchRoleEnvironment(config,'GATEWAY').WORKBENCH_ROLE_SETTINGS??'{}').workbenchMediaEmployeeReadEnabled,undefined);
}));

test('profile is opt-in and the compiled check reports disabled without touching dependencies',()=>{
 assert.deepEqual(readHumanWorkbenchConfiguration({}),{enabled:false});
 const r=spawnSync(process.execPath,[fileURLToPath(new URL('../app/server/scripts/human-workbench.mjs',import.meta.url)),'--check'],{env:{},encoding:'utf8',windowsHide:true});
 assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).enabled,false);assert.equal(JSON.parse(r.stdout).network_started,false);
});
test('configuration rejects missing secrets, unverified member configuration, wrong types, scopes and unapproved transport before forking',async()=>fixture(f=>{
 for(const key of ['PILOT_LOG_IDENTITY_HASH_KEY','P2_016_REPORTER_HMAC_SECRET','APP_SECRET'])assert.throws(()=>readHumanWorkbenchConfiguration({...f.env,[key]:undefined}),new RegExp(key,'u'));
 assert.throws(()=>readHumanWorkbenchConfiguration({...f.env,P2_016_REPORTER_HMAC_SECRET:f.env.PILOT_LOG_IDENTITY_HASH_KEY}),/P2_016_REPORTER_HMAC_SECRET/u);
 const check=()=>readHumanWorkbenchConfiguration(f.env);
 const invalids:unknown[]=[{...f.settings,transportEnabled:'true'},{...f.settings,memberEntry:{enabled:false}},{...f.settings,bot:{...f.settings.bot,id:'wrong'}},{...f.settings,listenPort:'43166'}];
 invalids.push({...f.settings,memberEntry:{...f.settings.memberEntry,identityMode:'VERIFIED_SAME_NAMESPACE',reporterUserIds:undefined}});
 for(const s of invalids){writeFileSync(f.file,JSON.stringify(s));assert.throws(check,/HUMAN_WORKBENCH_CONFIG_INVALID/u);}f.save();
 f.settings.transportEnabled=true;f.save();assert.throws(check,/WORKBENCH_EXTERNAL_IO_APPROVED/u);
 const r=spawnSync(process.execPath,[fileURLToPath(new URL('../app/server/scripts/human-workbench.mjs',import.meta.url)),'--start'],{env:{...f.env,PILOT_LOG_IDENTITY_HASH_KEY:undefined},encoding:'utf8',windowsHide:true});
 assert.equal(r.status,1);assert.match(r.stderr,/PILOT_LOG_IDENTITY_HASH_KEY/u);assert.equal(r.stderr.includes(f.env.APP_SECRET??''),false);
}));
test('role mapping preserves key purposes and excludes other roles credentials and optional capabilities',async()=>fixture(f=>{
 assert.throws(()=>readHumanWorkbenchConfiguration(f.env),/memberEntry.validationProfile/u);
 const c=readHumanWorkbenchConfiguration(f.env,{isolatedBoundaries:true});assert.ok(c.enabled);
 const app=workbenchRoleEnvironment(c,'APP'),worker=workbenchRoleEnvironment(c,'WORKER'),gateway=workbenchRoleEnvironment(c,'GATEWAY');
 assert.equal(app.PILOT_LOG_IDENTITY_HASH_KEY,f.env.PILOT_LOG_IDENTITY_HASH_KEY);assert.equal(app.P2_016_REPORTER_HMAC_SECRET,f.env.P2_016_REPORTER_HMAC_SECRET);
 assert.equal(app.WECOM_BOT_SECRET,undefined);assert.equal(worker.APP_SECRET,undefined);assert.equal(worker.WECOM_BOT_SECRET,undefined);assert.equal(gateway.APP_SECRET,undefined);
 assert.equal(readWorkbenchRoleSettings('APP',app).publicOrigin,f.settings.publicOrigin);
 assert.equal(JSON.parse(worker.WORKBENCH_ROLE_SETTINGS??'').publicOrigin,undefined);assert.equal(JSON.parse(app.WORKBENCH_ROLE_SETTINGS??'').groupRoutes,undefined);
 assert.equal(JSON.parse(worker.WORKBENCH_ROLE_SETTINGS??'').memberEntry,undefined);assert.equal(JSON.parse(worker.WORKBENCH_ROLE_SETTINGS??'').notificationBindingsFile,undefined);assert.equal(readWorkbenchWorkerSettings(worker).botId,f.settings.bot.id);
 assert.throws(()=>readP2016LiveConfiguration({WORKBENCH_CONVERSATIONS_ENABLED:'true'},{requireApproval:false}),/P2_016_BASE_FLAGS_MUST_REMAIN_FALSE/u);
}));

test('actor avatars default off and the directory credential is confined to the explicitly enabled Worker',async()=>fixture(f=>{
 const read=()=>{const value=readHumanWorkbenchConfiguration(f.env,{isolatedBoundaries:true});assert.ok(value.enabled);return value;};
 assert.equal(read().settings.workbenchActorAvatarsEnabled,false);
 f.settings.workbenchActorAvatarsEnabled=true;f.save();assert.throws(read,/workbenchActorAvatarRootRef/u);
 f.settings.workbenchActorAvatarRootRef='synthetic-approved-root';f.save();assert.throws(read,/THIRD_STAFF_INFO_SYNC_KEY/u);
 f.env.THIRD_STAFF_INFO_SYNC_KEY='synthetic-directory-secret';const value=read();
 const app=workbenchRoleEnvironment(value,'APP'),worker=workbenchRoleEnvironment(value,'WORKER'),gateway=workbenchRoleEnvironment(value,'GATEWAY');
 assert.equal(readWorkbenchRoleSettings('APP',app).workbenchActorAvatarsEnabled,true);
 assert.equal(readWorkbenchWorkerSettings(worker).actorAvatars?.rootRef,'synthetic-approved-root');
 assert.equal(worker.THIRD_STAFF_INFO_SYNC_KEY,f.env.THIRD_STAFF_INFO_SYNC_KEY);assert.equal(app.THIRD_STAFF_INFO_SYNC_KEY,undefined);assert.equal(gateway.THIRD_STAFF_INFO_SYNC_KEY,undefined);
 assert.equal(JSON.parse(app.WORKBENCH_ROLE_SETTINGS??'{}').workbenchActorAvatarRootRef,undefined);assert.equal(JSON.parse(gateway.WORKBENCH_ROLE_SETTINGS??'{}').workbenchActorAvatarsEnabled,undefined);
 assert.throws(()=>readWorkbenchWorkerSettings({...worker,THIRD_STAFF_INFO_SYNC_KEY:undefined}),/THIRD_STAFF_INFO_SYNC_KEY/u);
}));
test('MVP group reception and response scopes do not require a Webhook for every group',async()=>fixture(f=>{
 f.settings.groupRoutes=[];f.save();
 const c=readHumanWorkbenchConfiguration(f.env,{isolatedBoundaries:true});assert.ok(c.enabled);
 const app=readWorkbenchRoleSettings('APP',workbenchRoleEnvironment(c,'APP'));assert.deepEqual(app.groupNotificationTargets,[]);
 assert.equal(c.settings.bot.groupTargetHashes.length>0,true);
}));
test('desktop reminders default off and are passed only to App with closed boolean validation',async()=>fixture(f=>{
 const read=()=>{const c=readHumanWorkbenchConfiguration(f.env,{isolatedBoundaries:true});assert.ok(c.enabled);return c;};
 assert.equal(read().settings.workbenchRemindersEnabled,false);
 f.settings.workbenchRemindersEnabled=true;f.save();const c=read();
 const app=workbenchRoleEnvironment(c,'APP');assert.equal(readWorkbenchRoleSettings('APP',app).workbenchRemindersEnabled,true);
 for(const role of ['WORKER','GATEWAY'] as const)assert.equal(JSON.parse(workbenchRoleEnvironment(c,role).WORKBENCH_ROLE_SETTINGS??'').workbenchRemindersEnabled,undefined);
 const gateway=workbenchRoleEnvironment(c,'GATEWAY');gateway.WORKBENCH_ROLE_SETTINGS=JSON.stringify({...JSON.parse(gateway.WORKBENCH_ROLE_SETTINGS??'{}'),workbenchRemindersEnabled:true});
 assert.throws(()=>readWorkbenchRoleSettings('GATEWAY',gateway),/workbenchRemindersEnabled/u);
 writeFileSync(f.file,JSON.stringify({...f.settings,workbenchRemindersEnabled:'true'}));assert.throws(read,/workbenchRemindersEnabled/u);
}));

test('related scope and explicit follow default off and are admitted only by the App role',async()=>fixture(f=>{
 const read=()=>{const c=readHumanWorkbenchConfiguration(f.env,{isolatedBoundaries:true});assert.ok(c.enabled);return c;};
 const defaults=read();assert.equal(defaults.settings.workbenchFollowEnabled,false);
 assert.equal(readWorkbenchRoleSettings('APP',workbenchRoleEnvironment(defaults,'APP')).workbenchFollowEnabled,false);
 f.settings.workbenchFollowEnabled=true;f.save();const enabled=read();
 assert.equal(readWorkbenchRoleSettings('APP',workbenchRoleEnvironment(enabled,'APP')).workbenchFollowEnabled,true);
 for(const role of ['WORKER','GATEWAY'] as const)assert.equal(JSON.parse(workbenchRoleEnvironment(enabled,role).WORKBENCH_ROLE_SETTINGS??'{}').workbenchFollowEnabled,undefined);
 const app=workbenchRoleEnvironment(enabled,'APP');app.WORKBENCH_ROLE_SETTINGS=JSON.stringify({...JSON.parse(app.WORKBENCH_ROLE_SETTINGS??'{}'),workbenchFollowEnabled:'true'});
 assert.throws(()=>readWorkbenchRoleSettings('APP',app),/workbenchFollowEnabled/u);
 const gateway=workbenchRoleEnvironment(enabled,'GATEWAY');gateway.WORKBENCH_ROLE_SETTINGS=JSON.stringify({...JSON.parse(gateway.WORKBENCH_ROLE_SETTINGS??'{}'),workbenchFollowEnabled:true});
 assert.throws(()=>readWorkbenchRoleSettings('GATEWAY',gateway),/workbenchFollowEnabled/u);
 for(const value of ['true',1,null]){writeFileSync(f.file,JSON.stringify({...f.settings,workbenchFollowEnabled:value}));assert.throws(read,/workbenchFollowEnabled/u);}
}));

test('reporter profiles are default off and only their enabled Worker receives the narrow read capability',async()=>fixture(f=>{
 const read=()=>{const c=readHumanWorkbenchConfiguration(f.env,{isolatedBoundaries:true});assert.ok(c.enabled);return c;};
 assert.equal(read().settings.workbenchReporterProfilesEnabled,false);
 f.settings.workbenchReporterProfilesEnabled=true;f.save();const c=read();
 const app=workbenchRoleEnvironment(c,'APP'),worker=workbenchRoleEnvironment(c,'WORKER'),gateway=workbenchRoleEnvironment(c,'GATEWAY');
 assert.equal(readWorkbenchRoleSettings('APP',app).workbenchReporterProfilesEnabled,true);
 const settings=readWorkbenchWorkerSettings(worker);assert.ok(settings.reporterProfiles);assert.equal(settings.reporterProfiles.corpId,f.settings.memberEntry.corpId);
 assert.equal(worker.APP_SECRET,f.env.APP_SECRET);assert.equal(worker.WECOM_BOT_SECRET,undefined);assert.equal(JSON.parse(worker.WORKBENCH_ROLE_SETTINGS??'{}').notificationBindingsFile,undefined);
 assert.equal(JSON.parse(gateway.WORKBENCH_ROLE_SETTINGS??'{}').workbenchReporterProfilesEnabled,undefined);
 assert.throws(()=>readWorkbenchWorkerSettings({...worker,APP_SECRET:undefined}),/APP_SECRET/u);
 writeFileSync(f.file,JSON.stringify({...f.settings,workbenchReporterProfilesEnabled:'true'}));assert.throws(read,/workbenchReporterProfilesEnabled/u);
}));
test('notification authority rereads revocation and expiry without borrowing identity HMAC for reporter scope',async()=>fixture(async f=>{
 const c=readHumanWorkbenchConfiguration(f.env,{isolatedBoundaries:true});assert.ok(c.enabled);
 const app=createWorkbenchNotificationOptions(f.settings,c.reporterHmacSecret);
 const scope={sourceCorpScope:f.settings.memberEntry.corpId,sourceAppScope:f.settings.memberEntry.agentId,proofRef:f.settings.memberEntry.proofRef as string,scopeHash:createHmac('sha256',c.reporterHmacSecret).update(JSON.stringify(['member',f.settings.memberEntry.corpId,f.settings.memberEntry.agentId,'synthetic-A'])).digest('hex')};
 const input={source_kind:'WEB_REQUEST' as const,scope:scope as Parameters<typeof app.targetResolver.resolveCurrentTarget>[0]['scope'],signal:AbortSignal.timeout(1000)};
 const result=await app.targetResolver.resolveCurrentTarget(input);assert.equal((result as {state:string}).state,'ELIGIBLE');
 f.bindings.members=[];f.save();assert.equal((await app.targetResolver.resolveCurrentTarget(input) as {state:string}).state,'NOT_ELIGIBLE');
 assert.equal(resolveWorkbenchMention({...f.settings,role:'GATEWAY',botId:'bot-test'},{botId:'bot-test',groupId:'runtime-group',reporterUserId:'synthetic-A'}),'qualified-mention-A');
 f.bindings.validUntilEpochMs=String(Date.now()-1);f.save();await assert.rejects(app.targetResolver.resolveCurrentTarget(input),/validUntilEpochMs/u);
}));

test('Bot intake can be enabled with its own approval while all outbound roles remain disabled',async()=>fixture(f=>{
 const original=readHumanWorkbenchConfiguration(f.env,{isolatedBoundaries:true});assert.ok(original.enabled);assert.equal(original.settings.botInboundEnabled,false);assert.equal(original.botSecret,'');
 f.settings.botInboundEnabled=true;f.save();assert.throws(()=>readHumanWorkbenchConfiguration(f.env,{isolatedBoundaries:true}),/WORKBENCH_INBOUND_IO_APPROVAL_REF/u);
 f.env.WORKBENCH_INBOUND_IO_APPROVAL_REF='tests/isolated-inbound';
 const c=readHumanWorkbenchConfiguration(f.env,{isolatedBoundaries:true});assert.ok(c.enabled);assert.equal(c.settings.transportEnabled,false);assert.equal(c.botSecret,f.env.WECOM_BOT_SECRET);
 const gateway=workbenchRoleEnvironment(c,'GATEWAY'),worker=workbenchRoleEnvironment(c,'WORKER'),app=workbenchRoleEnvironment(c,'APP');
 assert.equal(gateway.APP_SECRET,f.env.APP_SECRET);assert.equal(gateway.WORKBENCH_INBOUND_IO_APPROVED,'true');assert.equal(gateway.WORKBENCH_EXTERNAL_IO_APPROVED,undefined);
 assert.equal(readWorkbenchRoleSettings('GATEWAY',gateway).botInboundEnabled,true);assert.equal(readWorkbenchWorkerSettings(worker).transportEnabled,false);
 assert.equal(worker.APP_SECRET,undefined);assert.equal(worker.WECOM_BOT_SECRET,undefined);assert.equal(app.WECOM_BOT_SECRET,undefined);
 assert.throws(()=>readWorkbenchRoleSettings('GATEWAY',{...gateway,WORKBENCH_INBOUND_IO_APPROVED:undefined}),/WORKBENCH_INBOUND_IO_APPROVED/u);
 f.settings.memberEntry={...f.settings.memberEntry,identityMode:'UNVERIFIED',memberIdsConfirmed:false,proofRef:null,proofKind:null};delete f.settings.memberEntry.reporterUserIds;
 f.save();rmSync(f.settings.notificationBindingsFile);
 const withoutH5=readHumanWorkbenchConfiguration(f.env,{isolatedBoundaries:true});assert.ok(withoutH5.enabled);assert.equal(withoutH5.settings.memberEntry.reporterUserIds,undefined);
 assert.equal(readWorkbenchRoleSettings('GATEWAY',workbenchRoleEnvironment(withoutH5,'GATEWAY')).botInboundEnabled,true);
 assert.throws(()=>createWorkbenchNotificationOptions(withoutH5.settings,withoutH5.reporterHmacSecret),/notificationBindings.authority/u);
 writeFileSync(f.file,JSON.stringify({...f.settings,botInboundEnabled:'true'}));assert.throws(()=>readHumanWorkbenchConfiguration(f.env,{isolatedBoundaries:true}),/botInboundEnabled/u);
}));

test('Bot sender is checked against current application visibility without a configured member or group roster',async()=>{
 const message={provider:'WECOM_AIBOT',bot_id:'bot-test',sender_user_id:'new-visible-member',chat_type:'single',chat_id:null};
 let active=true,conversionMode='valid',accountStatus=1,returnedIdentity='open-new-visible-member',tokenInvalidated=0,conversionErrcode=0;
 const calls:string[]=[];let concurrent=0,maxConcurrent=0;
 const token=Object.assign(async()=> 'synthetic-token',{invalidate:()=>{tokenInvalidated++;}});
 const fetchImpl:typeof fetch=async(input,init)=>{
  concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);await new Promise<void>(resolve=>setImmediate(resolve));concurrent--;
  const url=new URL(input instanceof Request?input.url:String(input));assert.equal(url.origin,'https://qyapi.weixin.qq.com');assert.equal(init?.redirect,'error');assert.ok(init?.signal);
  calls.push(url.pathname);let response:unknown;
  if(url.pathname==='/cgi-bin/batch/userid_to_openuserid'){
   assert.deepEqual(JSON.parse(String(init?.body)),{userid_list:['new-visible-member']});
   response={errcode:conversionErrcode,open_userid_list:conversionMode==='partial'?[]:[{userid:conversionMode==='foreign'?'someone-else':'new-visible-member',open_userid:'open-new-visible-member'}],...(conversionMode==='invalid'?{invalid_userid_list:['new-visible-member']}:{})};
  }else{
   assert.equal(url.pathname,'/cgi-bin/user/get');assert.equal(url.searchParams.get('userid'),'open-new-visible-member');
   response=active?{errcode:0,userid:returnedIdentity,status:accountStatus,enable:1}:{errcode:60011};
  }
  return new Response(JSON.stringify(response),{status:200});
 };
 const admission=createWorkbenchBotMemberAdmission({botId:'bot-test',accessTokenProvider:token,fetchImpl});
 assert.equal(await admission.accepts(message),true);
 assert.equal(await admission.accepts({...message,chat_type:'group',chat_id:'new-group-without-webhook-route'}),true);
 assert.deepEqual(calls,['/cgi-bin/batch/userid_to_openuserid','/cgi-bin/user/get','/cgi-bin/batch/userid_to_openuserid','/cgi-bin/user/get']);
 assert.deepEqual(await Promise.all(Array.from({length:4},()=>admission.accepts(message))),[true,true,true,true]);assert.equal(maxConcurrent,1);
 active=false;assert.equal(await admission.accepts(message),false,'visibility removal is checked on the next message');active=true;
 accountStatus=2;assert.equal(await admission.accepts(message),false);accountStatus=1;
 returnedIdentity='open-someone-else';assert.equal(await admission.accepts(message),false);returnedIdentity='open-new-visible-member';
 for(const mode of ['partial','foreign','invalid']){conversionMode=mode;const before=calls.length;assert.equal(await admission.accepts(message),false);assert.equal(calls.length,before+1);}
 conversionMode='valid';conversionErrcode=42001;assert.equal(await admission.accepts(message),false);assert.equal(tokenInvalidated,1);
 const before=calls.length;
 for(const input of [{...message,bot_id:'wrong-bot'},{...message,provider:'unknown'},{...message,sender_user_id:''},{...message,chat_type:'group',chat_id:null}])assert.equal(await admission.accepts(input),false);
 assert.equal(calls.length,before,'invalid sources never open a Provider');
});

test('Bot member queue is bounded and retains its serial fence until a late Provider settles',{timeout:8000},async()=>{
 let settle:((value:Response)=>void)|undefined,calls=0,signal:AbortSignal|null|undefined,blocked=true;
 const fetchImpl:typeof fetch=async(input,init)=>{calls++;signal=init?.signal;if(blocked)return new Promise<Response>(resolve=>{settle=resolve;});const url=new URL(input instanceof Request?input.url:String(input));return new Response(JSON.stringify(url.pathname.endsWith('/user/get')?{errcode:0,userid:'open-new-visible-member',status:1}:{errcode:0,open_userid_list:[{userid:'new-visible-member',open_userid:'open-new-visible-member'}]}));};
 const admission=createWorkbenchBotMemberAdmission({botId:'bot-test',accessTokenProvider:async()=> 'synthetic-token',fetchImpl});
 const message={provider:'WECOM_AIBOT',bot_id:'bot-test',sender_user_id:'new-visible-member',chat_type:'single'};
 const waiting=Array.from({length:32},()=>admission.accepts(message));assert.equal(await admission.accepts(message),false,'overflow opens no Provider');
 assert.deepEqual(await Promise.all(waiting),Array.from({length:32},()=>false));assert.equal(calls,1);
 assert.equal(await admission.accepts(message),false,'deadline does not release a non-cooperative Provider');assert.equal(calls,1);
 assert.equal(signal?.aborted,true);assert.ok(settle);blocked=false;settle(new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:'new-visible-member',open_userid:'open-new-visible-member'}]})));
 await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(calls,1);
 assert.equal(await admission.accepts(message),true,'new lookups recover after the original operation settles');assert.equal(calls,3);
});
