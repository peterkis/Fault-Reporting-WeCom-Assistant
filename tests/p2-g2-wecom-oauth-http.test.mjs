import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {request as requestHttp} from 'node:http';
import {EventEmitter} from 'node:events';
import { createConversationWorkbenchHttpServer } from '../src/p2-006-workbench-http.mjs';
import { createWeComWebOAuth,h5OAuthReturnPath,WeComOAuthError } from '../src/p2-g2-wecom-web-oauth.mjs';
import { createWeComOAuthHttp } from '../src/p2-g2-wecom-oauth-http.mjs';
import {createYxxSelfServiceNativeHttp} from '../src/yxx-self-service-native-http.mjs';
import {createYxxApplicationMemberAuthentication} from '../src/yxx-application-member-auth.mjs';
import {createYxxSelfServiceExtension} from '../src/yxx-self-service-runtime.mjs';
import {yxxIdentityConfigHash} from '../src/p2-g2-yixiaoxiu-delegated-identity.mjs';

test('真实 HTTP 授权往返使用安全 Cookie 和清洁成功 URL，不向浏览器泄露成员身份',async t=>{
  const publicOrigin='https://cd3120.mobimedical.cn';
  const oauth=createWeComWebOAuth({enabled:true,publicOrigin,corpId:'ww-test',agentId:'1000002',resolveCode:async()=>({userid:'private-member'})});
  const server=createConversationWorkbenchHttpServer({authenticate:async()=>null,queryService:{},commandFacade:{},publicOrigin,
    unauthenticatedHandler:createWeComOAuthHttp({oauth,publicOrigin})});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const start=await fetch(base+'/wecom/yixiaoxiu/login',{redirect:'manual'});assert.equal(start.status,302);
  const browser=start.headers.getSetCookie()[0];assert.match(browser,/HttpOnly; Secure; SameSite=Lax/u);
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  const result=await fetch(base+'/wecom/yixiaoxiu/callback?code=private-code&state='+state,{redirect:'manual',headers:{cookie:browser.split(';')[0]}});
  assert.equal(result.status,303);assert.equal(result.headers.get('location'),'/wecom/yixiaoxiu/');
  const session=result.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_session='));assert.ok(session);
  const page=await fetch(base+'/wecom/yixiaoxiu/',{headers:{cookie:session.split(';')[0]}});
  assert.equal(page.status,200);const content=await page.text();assert.match(content,/认证成功/u);assert.doesNotMatch(content,/private-/u);
  assert.equal(page.headers.get('cache-control'),'no-store');
  const replay=await fetch(base+'/wecom/yixiaoxiu/callback?code=private-code&state='+state,{redirect:'manual',headers:{cookie:browser.split(';')[0]}});
  assert.equal(replay.status,401);assert.doesNotMatch(await replay.text(),/private-/u);
  const duplicate=await fetch(base+'/wecom/yixiaoxiu/callback?code=a&code=b&state='+state);assert.equal(duplicate.status,401);
  const event=await fetch(base+'/wecom/yixiaoxiu/callback',{method:'POST',body:'encrypted-event'});assert.equal(event.status,404);
  const injected=await fetch(base+'/wecom/yixiaoxiu/login?redirect_uri=https://attacker.invalid',{redirect:'manual'});assert.equal(injected.status,404);
  const cookiePair=session.split(';')[0];
  const duplicateCookie=await fetch(base+'/wecom/yixiaoxiu/',{headers:{cookie:cookiePair+'; '+cookiePair}});assert.equal(duplicateCookie.status,401);
  const csrf=await fetch(base+'/wecom/yixiaoxiu/logout',{method:'POST',headers:{cookie:cookiePair,origin:'https://attacker.invalid'}});assert.equal(csrf.status,403);
  const logout=await fetch(base+'/wecom/yixiaoxiu/logout',{method:'POST',headers:{cookie:cookiePair,origin:publicOrigin}});assert.equal(logout.status,200);
  const revoked=await fetch(base+'/wecom/yixiaoxiu/',{headers:{cookie:cookiePair}});assert.equal(revoked.status,401);
});

test('HTTP 关闭态拒绝所有认证路径且不调用提供商',async t=>{
  const publicOrigin='https://cd3120.mobimedical.cn';
  const server=createConversationWorkbenchHttpServer({authenticate:async()=>null,queryService:{},commandFacade:{},publicOrigin,
    unauthenticatedHandler:createWeComOAuthHttp({oauth:createWeComWebOAuth(),publicOrigin})});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  for(const path of ['login','callback?code=x&state=y','']){
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/wecom/yixiaoxiu/'+path,{redirect:'manual'});
    assert.equal(response.status,503);assert.equal(response.headers.get('location'),null);
  }
});

async function resumeFixture(t,{shell=false,fallback=false,h5Session=true}={}){
  const publicOrigin='https://session-resume.example.test',flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
  let clock=0,revoked=false,codeCalls=0,memberCalls=0,entryHook=async()=>{},codeHook=async()=>({userid:'session-test-member'}),loginCount=0;
  const oauth=createWeComWebOAuth({enabled:true,h5Session,publicOrigin,corpId:'session-test-corp',agentId:'1000002',now:()=>clock,
    resolveCode:async()=>{codeCalls++;return codeHook();}});
  const authentication=createYxxApplicationMemberAuthentication({oauth,config:{corpId:'session-test-corp',agentId:'1000002',botId:'session-test-bot',proofRef:'session-test-proof'},
    secret:'session-resume-test-secret-over-thirty-two-characters',flags,verifyMember:async openUserId=>{memberCalls++;return revoked?null:{openUserId,checkedEpochMs:String(Date.now())};}});
  const oauthHttp=createWeComOAuthHttp({oauth,publicOrigin});
  const unused=async()=>{throw Error('UNEXPECTED_BUSINESS_PORT');};
  const native=createYxxSelfServiceNativeHttp({publicOrigin,oauth,oauthHttp,featureFlags:flags,recoveryBindingSecret:'session-resume-recovery-secret-over-thirty-two-characters',
    authenticateMember:({request})=>authentication.authenticate(request,'MEMBER_SELF_SERVICE'),command:{accept:unused},supplement:{accept:unused},
    query:{list:unused,detailWithEtag:unused,timeline:unused,commandStatus:unused},
    h5Static:shell?{asset:async()=>false,page:async response=>{response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end('<!doctype html><title>Public H5 shell</title><div id="root"></div>');return true;}}:null,
    ...(fallback?{h5Bootstrap:async request=>{await entryHook();authentication.recheck(request);return {
      profile:{name:null,department:null,phone:null,avatar_url:null},can_upload:false,can_urge:false,can_evaluate:false,can_view_department:false,
      sdk:{enabled:false,corp_id:null,agent_id:null},support:{emergency_phone:'18117887318',service_phone:'61318500'},
      limits:{voice_count:1,voice_duration_seconds:60,voice_bytes:5*1024*1024,image_count:6,image_bytes:10*1024*1024,video_count:1,video_duration_seconds:60,video_bytes:20*1024*1024,total_bytes:40*1024*1024}};}}
      :{h5Entry:async({request,input,bootstrap})=>{await entryHook();authentication.recheck(request);return {schema_version:1,view:input.view,bootstrap,membership_revision:'session-test-revision',data:{recent_reports:[],department_summary:null}};}})});
  const server=createConversationWorkbenchHttpServer({authenticate:async()=>null,queryService:{},commandFacade:{},publicOrigin,
    unauthenticatedHandler:async context=>await native.handler(context)||await oauthHttp(context)});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{oauth.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base='http://127.0.0.1:'+server.address().port,headers={host:new URL(publicOrigin).host,origin:publicOrigin,'sec-fetch-site':'same-origin'};
  // Model the real reverse proxy Host explicitly; fetch may discard Host.
  const send=(path,cookie,options={})=>new Promise((resolve,reject)=>{
    const req=requestHttp(new URL(path,base),{method:options.method??'GET',headers:{...headers,...options.headers,...(cookie?{cookie}:{}),...(options.body?{'content-type':'application/json'}:{})}},res=>{
      const chunks=[];let length=0;
      res.on('data',chunk=>{length+=chunk.length;if(length>65536){res.destroy(Error('TEST_RESPONSE_LIMIT'));return;}chunks.push(chunk);});
      res.on('error',reject);res.on('end',()=>{
        const selected=new Headers();for(const [name,value]of Object.entries(res.headers))for(const item of Array.isArray(value)?value:value===undefined?[]:[value])selected.append(name,item);
        resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:selected}));
      });
    });
    req.on('error',reject);req.setTimeout(4000,()=>req.destroy(Error('TEST_HTTP_TIMEOUT')));req.end(options.body);
  });
  const start=await send('/wecom/yixiaoxiu/login');assert.equal(start.status,302);
  const binding=start.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_oauth='));assert.ok(binding);
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  const callback=await send('/wecom/yixiaoxiu/callback?code=session-test-code&state='+state,binding.split(';')[0]);
  assert.equal(callback.status,303);
  const session=callback.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_session='));assert.ok(session);
  const cookie=binding.split(';')[0]+'; '+session.split(';')[0];
  return {advance:value=>{clock=value;},revoke:()=>{revoked=true;},counts:()=>({code_calls:codeCalls,current_member_calls:memberCalls}),
    maxAge:Number(/Max-Age=(\d+)/u.exec(session)?.[1]),cookie,sessionCookie:session.split(';')[0],browserCookie:binding.split(';')[0],
    setEntryHook:hook=>{entryHook=hook;},setCodeHook:hook=>{codeHook=hook;},logout:()=>oauth.logout(session.split(';')[0].slice('__Host-wecom_session='.length)),
    replace:async()=>{const next=oauth.begin({browserToken:binding.split(';')[0].slice('__Host-wecom_oauth='.length)});await oauth.complete({state:new URL(next.location).searchParams.get('state'),browserToken:next.browserToken,code:'replacement-'+(++loginCount)});},
    close:()=>oauth.close(),send:(path,selectedCookie=cookie,options)=>send(path,selectedCookie,options),
    read:()=>fallback?send('/api/yixiaoxiu/bootstrap',cookie,{headers:{accept:'application/vnd.yixiaoxiu.v2+json'}}):send('/api/yixiaoxiu/h5/entry?view=home',cookie)};
}

test('H5 V2 bootstrap fallback slides the idle session after complete terminal validation',{timeout:5000},async t=>{
  const f=await resumeFixture(t,{fallback:true});
  const negotiation=await f.send('/api/yixiaoxiu/h5/entry?view=home');assert.equal(negotiation.status,404);assert.equal((await negotiation.json()).error.code,'YXX_H5_ENTRY_DISABLED');
  const initial=await f.read();assert.equal(initial.status,200);const first=await initial.json();assert.equal(first.h5.sdk.enabled,false);
  f.advance(7*60*60*1000);const renewed=await f.read();assert.equal(renewed.status,200);const middle=await renewed.json();
  f.advance(9*60*60*1000);const continued=await f.read(),body=await continued.json();
  t.diagnostic('H5_BOOTSTRAP_FALLBACK '+JSON.stringify({entry_status:404,at_seven_hours_status:renewed.status,renewal_cookie_count:renewed.headers.getSetCookie().length,at_nine_hours_status:continued.status,error_code:body.error?.code??null,...f.counts()}));
  assert.equal(continued.status,200,'a successful seven-hour H5 fallback read must extend the eight-hour idle session');
  assert.equal(middle.csrf_token,first.csrf_token);assert.equal(middle.recovery_scope,first.recovery_scope);
  assert.equal(renewed.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_session=')).split(';')[0],f.sessionCookie);
  assert.equal(renewed.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_oauth=')).split(';')[0],f.browserCookie);
  assert.match(renewed.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_session=')),/Max-Age=28800$/u);
  assert.deepEqual(f.counts(),{code_calls:1,current_member_calls:3});
});

test('H5 V2 bootstrap fallback never renews after failed or superseded terminal validation',{timeout:5000},async t=>{
  for(const scenario of ['forbidden','unavailable','logout','replacement','expiry'])await t.test(scenario,async t=>{
    const f=await resumeFixture(t,{fallback:true});let enter,release;
    const entered=new Promise(resolve=>{enter=resolve;}),gate=new Promise(resolve=>{release=resolve;});
    f.setEntryHook(async()=>{enter();await gate;if(scenario==='forbidden'||scenario==='unavailable')throw Object.assign(Error('TEST_TERMINAL_DENIED'),{code:scenario==='forbidden'?'YXX_FORBIDDEN':'YXX_UNAVAILABLE',status:scenario==='forbidden'?403:503});});
    const pending=f.read();await entered;if(scenario==='logout')f.logout();if(scenario==='replacement')await f.replace();if(scenario==='expiry')f.advance(8*60*60*1000);release();
    const denied=await pending;assert.equal(denied.status,scenario==='forbidden'?403:scenario==='unavailable'?503:401);assert.deepEqual(denied.headers.getSetCookie(),[]);assert.equal(denied.headers.get('location'),null);assert.equal(f.counts().current_member_calls,1);
  });
});

test('Bootstrap renewal leaves V1 reads and non-H5 OAuth lifetimes unchanged',{timeout:5000},async t=>{
  const h5=await resumeFixture(t,{fallback:true});h5.advance(7*60*60*1000);
  const v1=await h5.send('/api/yixiaoxiu/bootstrap');assert.equal(v1.status,200);const body=await v1.json();assert.equal(body.h5,undefined);assert.deepEqual(v1.headers.getSetCookie(),[]);
  h5.advance(9*60*60*1000);const expired=await h5.read();assert.equal(expired.status,401);await expired.json();
  const legacy=await resumeFixture(t,{fallback:true,h5Session:false});assert.equal(legacy.maxAge,900);legacy.advance(14*60*1000);
  const success=await legacy.read();assert.equal(success.status,200);await success.json();assert.deepEqual(success.headers.getSetCookie(),[]);
  legacy.advance(16*60*1000);const old=await legacy.read();assert.equal(old.status,401);await old.json();assert.equal(legacy.counts().code_calls,1);
});

test('H5 session resume keeps the current member read after a sixteen-minute screen lock',{timeout:5000},async t=>{
  const f=await resumeFixture(t),first=await f.read();assert.equal(first.status,200);assert.equal((await first.json()).bootstrap.authenticated,true);
  f.advance(16*60*1000);
  const resumed=await f.read(),body=await resumed.json();
  t.diagnostic('H5_SESSION_RESUME '+JSON.stringify({initial_status:200,resume_after_ms:16*60*1000,status:resumed.status,error_code:body.error?.code??null,cookie_max_age_seconds:f.maxAge,...f.counts()}));
  assert.equal(resumed.status,200,'a normal foreground read must not leave the member in authRequired after a short screen lock');
  assert.equal(body.bootstrap.authenticated,true);
  assert.equal(f.maxAge,8*60*60);assert.equal(f.counts().code_calls,1);assert.equal(f.counts().current_member_calls,2);
  assert.match(resumed.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_session=')),/Max-Age=28800$/u);
});

test('H5 session resume preserves terminal 403 when current application membership is revoked',{timeout:5000},async t=>{
  const f=await resumeFixture(t),first=await f.read();assert.equal(first.status,200);await first.json();
  f.advance(60*1000);f.revoke();
  const denied=await f.read(),body=await denied.json();
  t.diagnostic('H5_SESSION_REVOKED '+JSON.stringify({status:denied.status,error_code:body.error?.code??null,...f.counts()}));
  assert.equal(denied.status,403);assert.equal(body.error.code,'YXX_FORBIDDEN');assert.equal(denied.headers.get('location'),null);assert.equal(f.counts().code_calls,1);
  assert.deepEqual(denied.headers.getSetCookie(),[]);
});

test('H5 session slides only after a successful entry and keeps SID, CSRF and recovery scope',{timeout:5000},async t=>{
  const f=await resumeFixture(t),first=await f.read(),original=await first.json();assert.equal(first.status,200);
  f.advance(7*60*60*1000);const renewed=await f.read(),next=await renewed.json();assert.equal(renewed.status,200);
  assert.equal(next.bootstrap.csrf_token,original.bootstrap.csrf_token);assert.equal(next.bootstrap.recovery_scope,original.bootstrap.recovery_scope);
  assert.equal(renewed.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_session=')).split(';')[0],f.sessionCookie);
  assert.equal(renewed.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_oauth=')).split(';')[0],f.browserCookie);
  assert.match(renewed.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_oauth=')),/Max-Age=61200$/u);
  f.advance(9*60*60*1000);const afterOldIdle=await f.read();assert.equal(afterOldIdle.status,200);await afterOldIdle.json();
  assert.deepEqual(f.counts(),{code_calls:1,current_member_calls:3});
});

test('H5 session cannot renew after idle expiration, logout, replacement or missing original browser',{timeout:5000},async t=>{
  for(const scenario of ['idle','logout','replacement','missing-browser','restart']){
    await t.test(scenario,async t=>{
      const f=await resumeFixture(t);
      if(scenario==='idle')f.advance(8*60*60*1000);
      if(scenario==='logout')f.logout();
      if(scenario==='replacement')await f.replace();
      if(scenario==='restart')f.close();
      const response=scenario==='missing-browser'?await f.send('/api/yixiaoxiu/h5/entry?view=home',f.sessionCookie):await f.read();
      assert.equal(response.status,401);assert.equal((await response.json()).error.code,'YXX_AUTH_REQUIRED');assert.equal(response.headers.get('location'),null);assert.deepEqual(response.headers.getSetCookie(),[]);
    });
  }
});

test('H5 session obeys a hard 24-hour cap even with repeated successful entry renewal',{timeout:5000},async t=>{
  const f=await resumeFixture(t);
  for(const hour of [7,14,21]){f.advance(hour*60*60*1000);const response=await f.read();assert.equal(response.status,200);await response.json();}
  f.advance(24*60*60*1000-1000);const final=await f.read();assert.equal(final.status,200);await final.json();
  const cookies=final.headers.getSetCookie();assert.equal(cookies.length,2);for(const value of cookies)assert.match(value,/Max-Age=1$/u);
  f.advance(24*60*60*1000);const expired=await f.read();assert.equal(expired.status,401);assert.equal((await expired.json()).error.code,'YXX_AUTH_REQUIRED');assert.deepEqual(expired.headers.getSetCookie(),[]);assert.equal(f.counts().code_calls,1);
});

test('H5 session failed entry does not slide idle expiry or turn temporary failure into login',{timeout:5000},async t=>{
  const f=await resumeFixture(t);f.advance(7*60*60*1000);
  f.setEntryHook(async()=>{throw Object.assign(Error('YXX_UNAVAILABLE'),{code:'YXX_UNAVAILABLE',status:503});});
  const failed=await f.read();assert.equal(failed.status,503);assert.equal((await failed.json()).error.code,'YXX_UNAVAILABLE');assert.deepEqual(failed.headers.getSetCookie(),[]);assert.equal(failed.headers.get('location'),null);
  f.advance(8*60*60*1000);f.setEntryHook(async()=>{});
  const expired=await f.read();assert.equal(expired.status,401);assert.equal((await expired.json()).error.code,'YXX_AUTH_REQUIRED');assert.equal(f.counts().code_calls,1);
});

test('H5 session waits for terminal validation and cannot revive logout, replacement or expiry during entry',{timeout:5000},async t=>{
  for(const scenario of ['logout','replacement','expiry','forbidden']){
    await t.test(scenario,async t=>{
      const f=await resumeFixture(t);let enter,release;
      const entered=new Promise(resolve=>{enter=resolve;}),gate=new Promise(resolve=>{release=resolve;});
      f.setEntryHook(async()=>{enter();await gate;if(scenario==='forbidden')throw Object.assign(Error('YXX_FORBIDDEN'),{code:'YXX_FORBIDDEN',status:403});});
      const pending=f.read();await entered;
      if(scenario==='logout')f.logout();
      if(scenario==='replacement')await f.replace();
      if(scenario==='expiry')f.advance(8*60*60*1000);
      release();const denied=await pending;assert.equal(denied.status,scenario==='forbidden'?403:401);
      const body=await denied.json();assert.equal(body.error.code,scenario==='forbidden'?'YXX_FORBIDDEN':'YXX_AUTH_REQUIRED');assert.deepEqual(denied.headers.getSetCookie(),[]);assert.equal(denied.headers.get('location'),null);assert.equal(f.counts().current_member_calls,1);
    });
  }
});

test('H5 public shell is safe before authentication and OAuth return while entry remains protected',{timeout:5000},async t=>{
  const f=await resumeFixture(t,{shell:true});
  for(const path of ['/wecom/yixiaoxiu/','/wecom/yixiaoxiu/?auth_return=1']){
    const shell=await f.send(path,'');assert.equal(shell.status,200);assert.equal(shell.headers.get('cache-control'),'no-store');assert.equal(shell.headers.get('location'),null);
    const body=await shell.text();assert.match(body,/Public H5 shell/u);assert.doesNotMatch(body,/session-test-member|csrf_token|recovery_scope/u);
  }
  const denied=await f.send('/api/yixiaoxiu/h5/entry?view=home','');assert.equal(denied.status,401);assert.equal((await denied.json()).error.code,'YXX_AUTH_REQUIRED');assert.equal(denied.headers.get('location'),null);assert.equal(f.counts().current_member_calls,0);
});

test('H5 login returns to each bounded SPA destination and rejects external or ambiguous destinations',{timeout:5000},async t=>{
  const f=await resumeFixture(t),ref='A'.repeat(32);
  const destinations=['/','/report','/reports','/requests/'+ref,'/department','/reports?search='+encodeURIComponent('打印机 A')+'&status=ACTIVE&source=WEB','/department?status=COMPLETED','/reports?search=打印机'];
  let count=0;
  for(const route of destinations){
    const start=await f.send('/wecom/yixiaoxiu/login?return_to='+encodeURIComponent(route));assert.equal(start.status,302);
    const binding=start.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_oauth='));assert.match(binding,/Max-Age=86400$/u);
    const url=new URL(start.headers.get('location'));assert.equal(url.searchParams.get('scope'),'snsapi_base');assert.equal(url.searchParams.get('redirect_uri'),'https://session-resume.example.test/wecom/yixiaoxiu/callback');
    const result=await f.send('/wecom/yixiaoxiu/callback?code=route-'+(++count)+'&state='+url.searchParams.get('state'),binding.split(';')[0]);
    assert.equal(result.status,303);const expected=new URL(route,'https://session-resume.example.test');assert.equal(result.headers.get('location'),'/wecom/yixiaoxiu/?auth_return=1#'+expected.pathname+expected.search);assert.match(result.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_session=')),/Max-Age=28800$/u);
  }
  const previous=f.counts().code_calls;
  for(const route of ['https://attacker.invalid/','//attacker.invalid/','/\\attacker.invalid/','https://user:password@attacker.invalid/','/admin','/reports/../','/%72eports','/requests/short','/reports?search=x&search=y','/reports?status=OPEN&status=ACTIVE','/reports?next=https://attacker.invalid','/report?search=x','/department?source=WEB','/reports?status=INVALID','/reports?source=INVALID','/reports?search='+encodeURIComponent('x'.repeat(101)),'/reports?search=%0d%0a','/reports#evil','/reports?search=%zz','/reports?search='+('a'.repeat(1100))]){
    const response=await f.send('/wecom/yixiaoxiu/login?return_to='+encodeURIComponent(route));assert.equal(response.status,400);assert.equal(response.headers.get('location'),null);assert.deepEqual(response.headers.getSetCookie(),[]);
  }
  for(const query of ['?return_to=%2Freports&return_to=%2F','?return_to=%2F&extra=x']){
    const response=await f.send('/wecom/yixiaoxiu/login'+query);assert.equal(response.status,400);assert.equal(response.headers.get('location'),null);
  }
  assert.equal(f.counts().code_calls,previous);
  assert.equal(h5OAuthReturnPath('/reports?status=OPEN'),'/wecom/yixiaoxiu/?auth_return=1#/reports?status=OPEN');
});

test('H5 session policy keeps the independent five-minute state and code replay fences',async()=>{
  let clock=0,calls=0;
  const oauth=createWeComWebOAuth({enabled:true,h5Session:true,publicOrigin:'https://session-budget.example.test',corpId:'budget-test',agentId:'1000002',now:()=>clock,resolveCode:async()=>{calls++;return{userid:'budget-member'};}});
  try{
    const expired=oauth.begin();clock=300000;
    await assert.rejects(oauth.complete({state:new URL(expired.location).searchParams.get('state'),browserToken:expired.browserToken,code:'expired-state'}),{code:'WECOM_AUTH_REQUIRED'});assert.equal(calls,0);
    const start=oauth.begin(),state=new URL(start.location).searchParams.get('state'),session=await oauth.complete({state,browserToken:start.browserToken,code:'fresh-state'});
    clock+=5*60*1000+1;assert.equal(oauth.authenticate(session.sessionToken).userid,'budget-member');
    const pending=oauth.begin({browserToken:start.browserToken});await oauth.complete({state:new URL(pending.location).searchParams.get('state'),browserToken:pending.browserToken,code:'used-code'});
    const replay=oauth.begin({browserToken:start.browserToken});await assert.rejects(oauth.complete({state:new URL(replay.location).searchParams.get('state'),browserToken:replay.browserToken,code:'used-code'}),{code:'WECOM_AUTH_REQUIRED'});assert.equal(calls,2);
  }finally{oauth.close();}
});

test('H5 renewal cannot truncate a fresh OAuth intent at the previous session hard deadline',async()=>{
  let clock=0;const oauth=createWeComWebOAuth({enabled:true,h5Session:true,publicOrigin:'https://pending-policy.example.test',corpId:'pending-policy-corp',agentId:'1000002',now:()=>clock,resolveCode:async()=>({userid:'pending-policy-member'})});
  try{
    const first=oauth.begin(),session=await oauth.complete({state:new URL(first.location).searchParams.get('state'),browserToken:first.browserToken,code:'previous-session'});
    for(const hour of [7,14,21]){clock=hour*60*60*1000;oauth.renewH5Session({sessionToken:session.sessionToken,browserToken:first.browserToken});}
    clock=24*60*60*1000-60_000;const fresh=oauth.begin({browserToken:first.browserToken});
    const lastRenewal=oauth.renewH5Session({sessionToken:session.sessionToken,browserToken:first.browserToken});assert.equal(lastRenewal.maxAgeSeconds,60);assert.equal(lastRenewal.browserMaxAgeSeconds,60);
    clock=24*60*60*1000+30_000;assert.throws(()=>oauth.authenticate(session.sessionToken),{code:'WECOM_AUTH_REQUIRED'});
    const resumed=await oauth.complete({state:new URL(fresh.location).searchParams.get('state'),browserToken:fresh.browserToken,code:'fresh-session'});
    assert.notEqual(resumed.sessionToken,session.sessionToken);assert.equal(resumed.maxAgeSeconds,28800);assert.equal(oauth.authenticate(resumed.sessionToken).userid,'pending-policy-member');assert.throws(()=>oauth.authenticate(session.sessionToken),{code:'WECOM_AUTH_REQUIRED'});
  }finally{oauth.close();}
});

test('H5 callback failure returns a clean public shell without replaying authentication or changing API denial',{timeout:5000},async t=>{
  for(const scenario of ['identity-403','provider-error','provider-503','state-expired','replay','missing-state']){
    await t.test(scenario,async t=>{
      const f=await resumeFixture(t,{shell:true}),start=await f.send('/wecom/yixiaoxiu/login?return_to=%2Freports');assert.equal(start.status,302);
      const binding=start.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_oauth=')).split(';')[0],state=new URL(start.headers.get('location')).searchParams.get('state');
      const path='/wecom/yixiaoxiu/callback?code=callback-failure-'+scenario+(scenario==='missing-state'?'':'&state='+state);
      if(scenario==='identity-403')f.setCodeHook(async()=>({openid:'synthetic-external'}));
      if(scenario==='provider-error')f.setCodeHook(async()=>{throw Error('synthetic-provider-failure');});
      if(scenario==='provider-503')f.setCodeHook(async()=>{throw new WeComOAuthError('WECOM_AUTH_UNAVAILABLE',503);});
      if(scenario==='state-expired')f.advance(300000);
      if(scenario==='replay'){const success=await f.send(path,binding);assert.equal(success.status,303);assert.equal(success.headers.get('location'),'/wecom/yixiaoxiu/?auth_return=1#/reports');}
      const failed=await f.send(path,binding),body=await failed.text();
      t.diagnostic('H5_CALLBACK_FAILURE '+JSON.stringify({scenario,status:failed.status,location:failed.headers.get('location'),code_calls:f.counts().code_calls}));
      assert.equal(failed.status,303);assert.equal(failed.headers.get('location'),'/wecom/yixiaoxiu/?auth_return=1#/');assert.equal(body,'');assert.equal(failed.headers.get('cache-control'),'no-store');
      assert.equal(failed.headers.getSetCookie().some(value=>value.startsWith('__Host-wecom_session=')),false);
      const calls=f.counts().code_calls;
      for(let attempt=0;attempt<2;attempt++){
        const shell=await f.send('/wecom/yixiaoxiu/?auth_return=1','');assert.equal(shell.status,200);assert.equal(shell.headers.get('location'),null);assert.match(await shell.text(),/Public H5 shell/u);
        const entry=await f.send('/api/yixiaoxiu/h5/entry?view=home','');assert.equal(entry.status,401);assert.equal(entry.headers.get('location'),null);assert.equal((await entry.json()).error.code,'YXX_AUTH_REQUIRED');
      }
      assert.equal(f.counts().code_calls,calls);assert.equal(f.counts().current_member_calls,0);
      const invalidLogin=await f.send('/wecom/yixiaoxiu/login?return_to=https%3A%2F%2Fattacker.invalid');assert.equal(invalidLogin.status,400);assert.equal(invalidLogin.headers.get('location'),null);
    });
  }
});

async function memberExtensionFixture(t,{h5=true,oauthOptions={},prepare}={}){
  const publicOrigin='https://member-h5.example.test',flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
  let clock=0,codeCalls=0,memberCalls=0,profileReads=0,profileTerminals=0;
  const oauth=createWeComWebOAuth({enabled:true,publicOrigin,corpId:'member-h5-corp',agentId:'1000002',now:()=>clock,...oauthOptions,resolveCode:async()=>{codeCalls++;return{userid:'member-h5-user'};}});
  if(prepare)await prepare(oauth,value=>{clock=value;});
  const controls=[];
  // A bounded transaction Port only: this test exercises real M composition, not PostgreSQL reads.
  const pool=Object.assign(new EventEmitter(),{options:{max:1,connectionTimeoutMillis:100},query:async()=>{throw Error('UNEXPECTED_BUSINESS_SQL');},connect:async()=>({
    query:async sql=>{assert.match(sql,/^(?:BEGIN|COMMIT|ROLLBACK|SET TRANSACTION ISOLATION LEVEL READ COMMITTED|SET LOCAL statement_timeout = \d+)$/u);controls.push(sql);return{rows:[],rowCount:0};},
    release:()=>{},
  })});
  const h5Bootstrap={profile:{name:null,department:null,phone:null,avatar_url:null},can_upload:false,can_urge:false,can_evaluate:false,can_view_department:false,
    sdk:{enabled:false,corp_id:null,agent_id:null},support:{emergency_phone:'18117887318',service_phone:'61318500'},
    limits:{voice_count:1,voice_duration_seconds:60,voice_bytes:5*1024*1024,image_count:6,image_bytes:10*1024*1024,video_count:1,video_duration_seconds:60,video_bytes:20*1024*1024,total_bytes:40*1024*1024}};
  const h5Runtime=h5?{enabled:true,performanceEnabled:true,previousStaticRoot:undefined,lifecycle:null,media:null,wecom:null,sdk:h5Bootstrap.sdk,
    profile:{resolveInTransaction:async()=>{profileReads++;return{membership_hash:'member-h5-revision',can_view_department:false};},revalidateInTransaction:async()=>{profileTerminals++;},bootstrapFromResolved:()=>h5Bootstrap},
    queryMedia:async()=>[],queryMediaEntry:async()=>[],close:async()=>{}}:null;
  const config={enabled:true,corpId:'member-h5-corp',agentId:'1000002',botId:'member-h5-bot',identityMode:'VERIFIED_APP_OPENID',memberIdsConfirmed:true,proofRef:'tests/member-h5',proofKind:'SYNTHETIC',validationProfile:'ISOLATED_TEST'};
  let extension;try{extension=createYxxSelfServiceExtension({pool,oauth,publicOrigin,reporterMemberEntry:config,identityMapping:{configHash:yxxIdentityConfigHash(config),resolve:()=>null},reporterHmacSecret:'member-h5-fixture-secret-over-thirty-two-characters',
    profile:'MEMBER_SELF_SERVICE',featureFlags:flags,serviceCatalog:null,ruleEngine:{evaluate:async()=>{throw Error('UNEXPECTED_RULE_EXECUTION');}},h5Runtime,
    applicationMemberVerifier:async openUserId=>{memberCalls++;return{openUserId,checkedEpochMs:String(Date.now())};}});}catch(error){oauth.close();throw error;}
  const server=createConversationWorkbenchHttpServer({authenticate:async()=>null,queryService:{},commandFacade:{},publicOrigin,
    unauthenticatedHandler:async context=>await extension.handler(context)||await createWeComOAuthHttp({oauth,publicOrigin})(context)});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await extension.close();oauth.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base='http://127.0.0.1:'+server.address().port;
  const send=(path,cookie='')=>new Promise((resolve,reject)=>{
    const req=requestHttp(new URL(path,base),{headers:{host:new URL(publicOrigin).host,origin:publicOrigin,'sec-fetch-site':'same-origin',...(cookie?{cookie}:{})}},res=>{
      const chunks=[];let bytes=0;res.on('data',chunk=>{bytes+=chunk.length;if(bytes>256*1024){res.destroy(Error('TEST_RESPONSE_LIMIT'));return;}chunks.push(chunk);});res.on('error',reject);res.on('end',()=>{
        const headers=new Headers();for(const [name,value]of Object.entries(res.headers))for(const item of Array.isArray(value)?value:value===undefined?[]:[value])headers.append(name,item);
        resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers}));
      });
    });req.on('error',reject);req.setTimeout(4000,()=>req.destroy(Error('TEST_HTTP_TIMEOUT')));req.end();
  });
  return{send,oauth,advance:value=>{clock=value;},counts:()=>({code_calls:codeCalls,member_calls:memberCalls,profile_reads:profileReads,profile_terminals:profileTerminals,control_sql:controls.length})};
}

test('M explicit H5 composition upgrades only a pristine OAuth factory before shell and return_to login',{timeout:5000},async t=>{
  const f=await memberExtensionFixture(t);
  const shell=await f.send('/wecom/yixiaoxiu/');assert.equal(shell.status,200);assert.match(await shell.text(),/id="root"/u);assert.equal(f.counts().code_calls,0);
  const unauthenticated=await f.send('/api/yixiaoxiu/h5/entry?view=report');assert.equal(unauthenticated.status,401);assert.equal((await unauthenticated.json()).error.code,'YXX_AUTH_REQUIRED');
  const start=await f.send('/wecom/yixiaoxiu/login?return_to=%2Freport');assert.equal(start.status,302);
  assert.equal(f.oauth.h5Session,true);const binding=start.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_oauth=')).split(';')[0];assert.match(start.headers.getSetCookie()[0],/Max-Age=86400$/u);
  const state=new URL(start.headers.get('location')).searchParams.get('state'),callback=await f.send('/wecom/yixiaoxiu/callback?code=member-h5-code&state='+state,binding);
  assert.equal(callback.status,303);assert.equal(callback.headers.get('location'),'/wecom/yixiaoxiu/?auth_return=1#/report');
  const session=callback.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_session='));assert.match(session,/Max-Age=28800$/u);const cookie=binding+'; '+session.split(';')[0];
  const first=await f.send('/api/yixiaoxiu/h5/entry?view=report',cookie);assert.equal(first.status,200);const before=await first.json();
  f.advance(16*60*1000);const resumed=await f.send('/api/yixiaoxiu/h5/entry?view=report',cookie);assert.equal(resumed.status,200);const after=await resumed.json();
  assert.equal(after.bootstrap.csrf_token,before.bootstrap.csrf_token);assert.equal(after.bootstrap.recovery_scope,before.bootstrap.recovery_scope);
  assert.equal(resumed.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_session=')).split(';')[0],session.split(';')[0]);
  assert.deepEqual(f.counts(),{code_calls:1,member_calls:2,profile_reads:2,profile_terminals:2,control_sql:8});
});

test('M without H5 keeps legacy 900-second cookies and rejects return_to login',{timeout:5000},async t=>{
  const f=await memberExtensionFixture(t,{h5:false});assert.equal(f.oauth.h5Session,false);
  const unsupported=await f.send('/wecom/yixiaoxiu/login?return_to=%2Freport');assert.equal(unsupported.status,404);assert.equal(unsupported.headers.get('location'),null);
  const start=await f.send('/wecom/yixiaoxiu/login'),binding=start.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_oauth=')).split(';')[0],state=new URL(start.headers.get('location')).searchParams.get('state');assert.equal(start.status,302);
  const callback=await f.send('/wecom/yixiaoxiu/callback?code=member-legacy-code&state='+state,binding);assert.equal(callback.status,303);assert.equal(callback.headers.get('location'),'/wecom/yixiaoxiu/');assert.match(callback.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_session=')),/Max-Age=900$/u);
  assert.deepEqual(f.counts(),{code_calls:1,member_calls:0,profile_reads:0,profile_terminals:0,control_sql:0});
});

test('M H5 composition refuses legacy credentials issued before assembly even after their expiry',async t=>{
  for(const expired of [false,true])await assert.rejects(memberExtensionFixture(t,{prepare:async(oauth,advance)=>{
    const start=oauth.begin();await oauth.complete({state:new URL(start.location).searchParams.get('state'),browserToken:start.browserToken,code:'before-assembly'});
    if(expired){advance(24*60*60*1000);oauth.browserValid(start.browserToken);}
  }}),{message:'WECOM_OAUTH_CONFIG_INVALID'});
});

test('H5 startup policy cannot upgrade any issued legacy credential even after expiry sweep',async()=>{
  for(const kind of ['browser','intent','session','expired-browser','expired-intent','expired-session']){
    let clock=0;const oauth=createWeComWebOAuth({enabled:true,publicOrigin:'https://policy-start.example.test',corpId:'policy-start-corp',agentId:'1000002',now:()=>clock,resolveCode:async()=>({userid:'policy-user'})});
    try{
      assert.equal(typeof oauth.enableH5Session,'function');
      if(kind.endsWith('browser'))oauth.browserBinding();
      else{const start=oauth.begin();if(kind.endsWith('session'))await oauth.complete({state:new URL(start.location).searchParams.get('state'),browserToken:start.browserToken,code:'policy-code'});}
      if(kind.startsWith('expired-')){clock=24*60*60*1000;oauth.browserValid('f'.repeat(64));}
      assert.throws(()=>oauth.enableH5Session(),{message:'WECOM_OAUTH_CONFIG_INVALID'});assert.equal(oauth.h5Session,false);assert.equal(oauth.browserMaxAgeSeconds,1200);
    }finally{oauth.close();}
  }
  const ready=createWeComWebOAuth({enabled:true,h5Session:true,publicOrigin:'https://policy-start.example.test',corpId:'policy-start-corp',agentId:'1000002',resolveCode:async()=>({userid:'policy-user'})});
  try{const start=ready.begin(),session=await ready.complete({state:new URL(start.location).searchParams.get('state'),browserToken:start.browserToken,code:'h5-already'});ready.enableH5Session();ready.enableH5Session();assert.equal(ready.h5Session,true);assert.equal(ready.authenticate(session.sessionToken).userid,'policy-user');}finally{ready.close();}
});
