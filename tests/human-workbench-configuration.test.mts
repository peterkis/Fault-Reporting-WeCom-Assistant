import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readHumanWorkbenchConfiguration,workbenchRoleEnvironment,createWorkbenchNotificationOptions,resolveWorkbenchMention,readWorkbenchRoleSettings,readWorkbenchWorkerSettings} from '../src/human-workbench-configuration.mjs';
import {readP2016LiveConfiguration} from '../src/p2-016-live-configuration.mjs';
import {workbenchTestSettings} from './helpers/human-workbench-test-settings.mjs';
import {createHmac} from 'node:crypto';
function fixture(run:(f:ReturnType<typeof workbenchTestSettings>)=>void|Promise<void>){const directory=mkdtempSync(join(tmpdir(),'human-workbench-config-'));return Promise.resolve().then(()=>run(workbenchTestSettings(directory))).finally(()=>rmSync(directory,{recursive:true,force:true}));}

test('profile is opt-in and the compiled check reports disabled without touching dependencies',()=>{
 assert.deepEqual(readHumanWorkbenchConfiguration({}),{enabled:false});
 const r=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/human-workbench.mjs',import.meta.url)),'--check'],{env:{},encoding:'utf8',windowsHide:true});
 assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).enabled,false);assert.equal(JSON.parse(r.stdout).network_started,false);
});
test('configuration rejects missing secrets, unverified member configuration, wrong types, scopes and unapproved transport before forking',async()=>fixture(f=>{
 for(const key of ['PILOT_LOG_IDENTITY_HASH_KEY','P2_016_REPORTER_HMAC_SECRET','APP_SECRET'])assert.throws(()=>readHumanWorkbenchConfiguration({...f.env,[key]:undefined}),new RegExp(key,'u'));
 assert.throws(()=>readHumanWorkbenchConfiguration({...f.env,P2_016_REPORTER_HMAC_SECRET:f.env.PILOT_LOG_IDENTITY_HASH_KEY}),/P2_016_REPORTER_HMAC_SECRET/u);
 const check=()=>readHumanWorkbenchConfiguration(f.env);
 const invalids:unknown[]=[{...f.settings,transportEnabled:'true'},{...f.settings,memberEntry:{enabled:false}},{...f.settings,bot:{...f.settings.bot,id:'wrong'}},{...f.settings,groupRoutes:[]},{...f.settings,listenPort:'43166'}];
 invalids.push({...f.settings,memberEntry:{...f.settings.memberEntry,identityMode:'VERIFIED_SAME_NAMESPACE',reporterUserIds:undefined}});
 for(const s of invalids){writeFileSync(f.file,JSON.stringify(s));assert.throws(check,/HUMAN_WORKBENCH_CONFIG_INVALID/u);}f.save();
 f.settings.transportEnabled=true;f.save();assert.throws(check,/WORKBENCH_EXTERNAL_IO_APPROVED/u);
 const r=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/human-workbench.mjs',import.meta.url)),'--start'],{env:{...f.env,PILOT_LOG_IDENTITY_HASH_KEY:undefined},encoding:'utf8',windowsHide:true});
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
