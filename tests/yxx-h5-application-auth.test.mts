import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IncomingMessage} from 'node:http';
import {Socket} from 'node:net';
import {createWeComWebOAuth} from '../app/server/src/p2-g2-wecom-web-oauth.mjs';
import type {OAuthState,SessionToken} from '../app/server/src/p2-g2-wecom-web-oauth.mjs';
import {sessionName} from '../app/server/src/p2-g2-wecom-oauth-http.mjs';
import {createYxxApplicationMemberAuthentication} from '../app/server/src/yxx-application-member-auth.mjs';
import {validateYxxEntryConfig} from '../app/server/src/p2-g2-yixiaoxiu-contract.mjs';
import type {ApplicationMemberVerifier} from '../app/server/src/wecom-application-member.mjs';

const config=validateYxxEntryConfig({enabled:true,corpId:'synthetic-h5-corp',agentId:'1000002',botId:'synthetic-h5-bot',identityMode:'VERIFIED_APP_OPENID',memberIdsConfirmed:true,proofRef:'tests/h5-media-auth',proofKind:'SYNTHETIC',validationProfile:'ISOLATED_TEST'});
const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
function request(token:SessionToken){const r=new IncomingMessage(new Socket());r.headers.cookie=sessionName+'='+token;return r;}
async function fixture(budget?:number,h5EntryVerifier?:ApplicationMemberVerifier,profileRead?:ApplicationMemberVerifier){
 assert.ok(config.enabled);
 const oauth=createWeComWebOAuth({enabled:true,corpId:config.corpId,agentId:config.agentId,publicOrigin:'https://h5.synthetic.test',resolveCode:async()=>({userid:'synthetic-open-A'})});assert.ok(oauth.enabled);
 const begin=oauth.begin(),state=new URL(begin.location).searchParams.get('state');assert.match(state??'',/^[a-f0-9]{64}$/u);
 const session=await oauth.complete({browserToken:begin.browserToken,state:state as OAuthState,code:'synthetic-initial'});
 let lookups=0;
 const auth=createYxxApplicationMemberAuthentication({oauth,config,secret:'synthetic-only-h5-request-proof-secret-32bytes',flags,
   ...(h5EntryVerifier===undefined?{}:{h5EntryVerifier}),
  ...(budget===undefined?{}:{requestBudgetMs:budget}),verifyMember:Object.assign(async(id:string)=>{lookups++;return {openUserId:id,displayName:'合成测试',checkedEpochMs:String(Date.now())};},profileRead?{profileRead}:{})});
 return {oauth,auth,session,lookups:()=>lookups};
}

test('H5 media proof survives a bounded transfer and is never reused by another request',async t=>{
 const epoch=1_790_000_000_000;t.mock.timers.enable({apis:['Date'],now:epoch});const f=await fixture(60000);
 try{
  const first=request(f.session.sessionToken);const before=await f.auth.authenticate(first);assert.equal(f.lookups(),1);
  t.mock.timers.setTime(epoch+6000);assert.equal(f.auth.recheck(first).canonical_reporter_binding,before.canonical_reporter_binding);
  await f.auth.authenticate(first);assert.equal(f.lookups(),1);
  const second=request(f.session.sessionToken);await f.auth.authenticate(second);assert.equal(f.lookups(),2);
  t.mock.timers.setTime(epoch+60000);assert.throws(()=>f.auth.recheck(first),{status:401});assert.doesNotThrow(()=>f.auth.recheck(second));
 }finally{f.oauth.close();t.mock.timers.reset();}
});

test('H5 current display is request-local and never changes authority or skips Cookie/logout terminal checks',async()=>{
 let profiles=0;const f=await fixture(60000,undefined,async id=>{profiles++;return {openUserId:id,displayName:'合成成员',departmentName:'合成科室',checkedEpochMs:String(Date.now())};});
 try{
  const r=request(f.session.sessionToken),authority=await f.auth.authenticateProfile(r);assert.equal(profiles,1);assert.equal(f.lookups(),0);
  assert.deepEqual(f.auth.currentDisplay(r),{name:'合成成员',department:'合成科室'});assert.deepEqual(await f.auth.authenticate(r),authority);assert.equal(f.lookups(),0);
  assert.equal(Object.hasOwn(authority,'displayName'),false);assert.equal(Object.hasOwn(authority,'departmentName'),false);
  assert.throws(()=>f.auth.currentDisplay(request(f.session.sessionToken)),{status:401});
  r.headers.cookie=sessionName+'='+'a'.repeat(64);assert.throws(()=>f.auth.currentDisplay(r),{status:401});
  r.headers.cookie=sessionName+'='+f.session.sessionToken;f.oauth.logout(f.session.sessionToken);assert.throws(()=>f.auth.currentDisplay(r),{status:401});
 }finally{f.oauth.close();}
});

test('H5 display never returns a profile after logout while the Provider was pending',async()=>{
 let release:()=>void=()=>{throw Error('PROFILE_NOT_PENDING');};const wait=new Promise<void>(resolve=>{release=resolve;});
 const f=await fixture(60000,undefined,async id=>{await wait;return {openUserId:id,displayName:'PRIVATE_SYNTHETIC',departmentName:'PRIVATE_DEPARTMENT',checkedEpochMs:String(Date.now())};});
 try{const r=request(f.session.sessionToken),pending=f.auth.authenticateProfile(r);f.oauth.logout(f.session.sessionToken);release();await assert.rejects(pending,{status:401});assert.throws(()=>f.auth.currentDisplay(r),{status:401});}
 finally{release();f.oauth.close();}
});

test('legacy member qualification keeps its original five second request proof budget',async t=>{
 const epoch=1_790_000_000_000;t.mock.timers.enable({apis:['Date'],now:epoch});const f=await fixture();
 try{const r=request(f.session.sessionToken);await f.auth.authenticate(r);t.mock.timers.setTime(epoch+5000);assert.throws(()=>f.auth.recheck(r),{status:401});assert.equal(f.lookups(),1);}
 finally{f.oauth.close();t.mock.timers.reset();}
});

test('longer H5 request proof never overrides live session revocation or Cookie replacement',async t=>{
 const epoch=1_790_000_000_000;t.mock.timers.enable({apis:['Date'],now:epoch});const f=await fixture(60000);
 try{
  const r=request(f.session.sessionToken);await f.auth.authenticate(r);t.mock.timers.setTime(epoch+6000);
  r.headers.cookie=sessionName+'='+'a'.repeat(64);assert.throws(()=>f.auth.recheck(r),{status:401});
  r.headers.cookie=sessionName+'='+f.session.sessionToken;assert.doesNotThrow(()=>f.auth.recheck(r));
  f.oauth.logout(f.session.sessionToken);assert.throws(()=>f.auth.recheck(r),{status:401});assert.equal(f.lookups(),1);
 }finally{f.oauth.close();t.mock.timers.reset();}
});

test('H5 proof budget rejects an unbounded or invalid configuration',async()=>{
 for(const budget of [0,4999,60001,Infinity,5500.5])await assert.rejects(fixture(budget),{status:503});
});

test('H5 entry qualification shares its prepared proof with general reads but never another HTTP request',async()=>{
 let entryLookups=0;
 const f=await fixture(60000,async id=>{entryLookups++;return {openUserId:id,displayName:null,checkedEpochMs:String(Date.now())};});
 try{
  const first=request(f.session.sessionToken),qualified=await f.auth.authenticateEntry(first);
  assert.equal(entryLookups,1);assert.equal(f.lookups(),0);
  assert.deepEqual(await f.auth.authenticate(first),qualified);assert.deepEqual(f.auth.recheck(first),qualified);
  assert.deepEqual(await f.auth.authenticateEntry(first),qualified);assert.equal(entryLookups,1);assert.equal(f.lookups(),0);
  const second=request(f.session.sessionToken),independent=await f.auth.authenticateEntry(second);
  assert.equal(independent.canonical_reporter_binding,qualified.canonical_reporter_binding);
  assert.equal(entryLookups,2,'the same userid on another HTTP request requires a fresh lookup');assert.equal(f.lookups(),0);
  const general=request(f.session.sessionToken),base=await f.auth.authenticate(general);
  assert.equal(f.lookups(),1);assert.deepEqual(await f.auth.authenticateEntry(general),base);assert.equal(entryLookups,2);
 }finally{f.oauth.close();}
});

test('H5 entry prepared proof cannot override Cookie replacement, logout or a denied current member',async()=>{
 let entryLookups=0,deniedLookups=0;
 const f=await fixture(60000,async id=>{entryLookups++;return {openUserId:id,displayName:null,checkedEpochMs:String(Date.now())};});
 const denied=await fixture(60000,async()=>{deniedLookups++;return null;});
 try{
  const r=request(f.session.sessionToken);await f.auth.authenticateEntry(r);
  r.headers.cookie=sessionName+'='+'a'.repeat(64);
  await assert.rejects(f.auth.authenticateEntry(r),{status:401});await assert.rejects(f.auth.authenticate(r),{status:401});
  r.headers.cookie=sessionName+'='+f.session.sessionToken;assert.doesNotThrow(()=>f.auth.recheck(r));
  f.oauth.logout(f.session.sessionToken);
  await assert.rejects(f.auth.authenticateEntry(r),{status:401});await assert.rejects(f.auth.authenticate(r),{status:401});assert.throws(()=>f.auth.recheck(r),{status:401});
  assert.equal(entryLookups,1);assert.equal(f.lookups(),0);
  const rejected=request(denied.session.sessionToken);await assert.rejects(denied.auth.authenticateEntry(rejected),{status:403});
  assert.throws(()=>denied.auth.recheck(rejected),{status:401});assert.equal(deniedLookups,1);assert.equal(denied.lookups(),0);
 }finally{f.oauth.close();denied.oauth.close();}
});
