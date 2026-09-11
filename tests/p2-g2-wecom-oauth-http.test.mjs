import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createConversationWorkbenchHttpServer } from '../src/p2-006-workbench-http.mjs';
import { createWeComWebOAuth } from '../src/p2-g2-wecom-web-oauth.mjs';
import { createWeComOAuthHttp } from '../src/p2-g2-wecom-oauth-http.mjs';

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
