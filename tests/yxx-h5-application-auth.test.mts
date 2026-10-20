import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IncomingMessage} from 'node:http';
import {Socket} from 'node:net';
import {createWeComWebOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import type {OAuthState,SessionToken} from '../src/p2-g2-wecom-web-oauth.mjs';
import {sessionName} from '../src/p2-g2-wecom-oauth-http.mjs';
import {createYxxApplicationMemberAuthentication} from '../src/yxx-application-member-auth.mjs';
import {validateYxxEntryConfig} from '../src/p2-g2-yixiaoxiu-contract.mjs';

const config=validateYxxEntryConfig({enabled:true,corpId:'synthetic-h5-corp',agentId:'1000002',botId:'synthetic-h5-bot',identityMode:'VERIFIED_APP_OPENID',memberIdsConfirmed:true,proofRef:'tests/h5-media-auth',proofKind:'SYNTHETIC',validationProfile:'ISOLATED_TEST'});
const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
function request(token:SessionToken){const r=new IncomingMessage(new Socket());r.headers.cookie=sessionName+'='+token;return r;}
async function fixture(budget?:number){
 assert.ok(config.enabled);
 const oauth=createWeComWebOAuth({enabled:true,corpId:config.corpId,agentId:config.agentId,publicOrigin:'https://h5.synthetic.test',resolveCode:async()=>({userid:'synthetic-open-A'})});assert.ok(oauth.enabled);
 const begin=oauth.begin(),state=new URL(begin.location).searchParams.get('state');assert.match(state??'',/^[a-f0-9]{64}$/u);
 const session=await oauth.complete({browserToken:begin.browserToken,state:state as OAuthState,code:'synthetic-initial'});
 let lookups=0;
 const auth=createYxxApplicationMemberAuthentication({oauth,config,secret:'synthetic-only-h5-request-proof-secret-32bytes',flags,
  ...(budget===undefined?{}:{requestBudgetMs:budget}),verifyMember:async id=>{lookups++;return {openUserId:id,displayName:'合成测试',checkedEpochMs:String(Date.now())};}});
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
