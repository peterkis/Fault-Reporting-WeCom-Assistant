import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createConversationWorkbenchHttpServer} from '../src/p2-006-workbench-http.mjs';
import {createWeComWebOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import {createWeComOAuthHttp} from '../src/p2-g2-wecom-oauth-http.mjs';

const origin='https://entry.test';
const app=oauth=>createConversationWorkbenchHttpServer({authenticate:async()=>null,queryService:{},commandFacade:{},publicOrigin:origin,
  unauthenticatedHandler:createWeComOAuthHttp({oauth,publicOrigin:origin})});
const pair=value=>value.split(';',1)[0];

test('SS-001 fixed homepage performs one bounded OAuth round trip and returns to the bare root',async t=>{
  let calls=0;
  const oauth=createWeComWebOAuth({enabled:true,publicOrigin:origin,corpId:'corp',agentId:'1000002',
    resolveCode:async()=>{calls++;return {userid:'member-a'};}});
  const server=app(oauth);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const initial=await fetch(base+'/wecom/yixiaoxiu/',{redirect:'manual'});
  assert.equal(initial.status,302);assert.match(initial.headers.get('location'),/^https:\/\/open\.weixin\.qq\.com\//u);
  const browser=pair(initial.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_oauth=')));
  const state=new URL(initial.headers.get('location')).searchParams.get('state');
  const callback=await fetch(base+'/wecom/yixiaoxiu/callback?code=one&state='+state,{redirect:'manual',headers:{cookie:browser}});
  assert.equal(callback.status,303);assert.equal(callback.headers.get('location'),'/wecom/yixiaoxiu/?auth_return=1');
  const session=pair(callback.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_session=')));
  const returned=await fetch(base+'/wecom/yixiaoxiu/?auth_return=1',{redirect:'manual',headers:{cookie:session}});
  assert.equal(returned.status,303);assert.equal(returned.headers.get('location'),'/wecom/yixiaoxiu/');
  const page=await fetch(base+'/wecom/yixiaoxiu/',{headers:{cookie:session}});
  assert.equal(page.status,200);assert.match(await page.text(),/认证成功/u);assert.equal(calls,1);
});

test('SS-001 already authenticated and unusable cookies never begin a second OAuth flow',async t=>{
  const oauth=createWeComWebOAuth({enabled:true,publicOrigin:origin,corpId:'corp',agentId:'1000002',resolveCode:async()=>({userid:'member-a'})});
  const server=app(oauth);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const start=await fetch(base+'/wecom/yixiaoxiu/login',{redirect:'manual'});
  const browser=pair(start.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_oauth=')));
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  const callback=await fetch(base+'/wecom/yixiaoxiu/callback?code=one&state='+state,{redirect:'manual',headers:{cookie:browser}});
  const session=pair(callback.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_session=')));
  const authenticated=await fetch(base+'/wecom/yixiaoxiu/',{redirect:'manual',headers:{cookie:session}});
  assert.equal(authenticated.status,200);assert.equal(authenticated.headers.get('location'),null);
  const malformed=await fetch(base+'/wecom/yixiaoxiu/',{redirect:'manual',headers:{cookie:session+'; '+session}});
  assert.equal(malformed.status,401);assert.equal(malformed.headers.get('location'),null);
  const returnWithoutSession=await fetch(base+'/wecom/yixiaoxiu/?auth_return=1',{redirect:'manual',headers:{cookie:browser}});
  assert.equal(returnWithoutSession.status,401);assert.equal(returnWithoutSession.headers.get('location'),null);
});

test('SS-001 callback/provider errors terminate with a safe error page and no redirect loop',async t=>{
  const oauth=createWeComWebOAuth({enabled:true,publicOrigin:origin,corpId:'corp',agentId:'1000002',resolveCode:async()=>{throw new Error('provider secret');}});
  const server=app(oauth);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const start=await fetch(base+'/wecom/yixiaoxiu/',{redirect:'manual'});
  const browser=pair(start.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_oauth=')));
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  const failed=await fetch(base+'/wecom/yixiaoxiu/callback?code=bad&state='+state,{redirect:'manual',headers:{cookie:browser}});
  assert.equal(failed.status,502);assert.equal(failed.headers.get('location'),null);assert.doesNotMatch(await failed.text(),/provider secret/u);
});

test('SS-001 natural session expiry can recover only after the browser drops the expired cookie',async t=>{
  let clock=0,calls=0;
  const oauth=createWeComWebOAuth({enabled:true,publicOrigin:origin,corpId:'corp',agentId:'1000002',now:()=>clock,
    resolveCode:async()=>{calls++;return {userid:'member-a'};}});
  const server=app(oauth);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const start=await fetch(base+'/wecom/yixiaoxiu/login',{redirect:'manual'});
  const browser=pair(start.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_oauth=')));
  const firstState=new URL(start.headers.get('location')).searchParams.get('state');
  const first=await fetch(base+'/wecom/yixiaoxiu/callback?code=one&state='+firstState,{redirect:'manual',headers:{cookie:browser}});
  const session=pair(first.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_session=')));
  assert.equal((await fetch(base+'/wecom/yixiaoxiu/',{headers:{cookie:session}})).status,200);
  clock=900001;
  const recovered=await fetch(base+'/wecom/yixiaoxiu/',{redirect:'manual',headers:{cookie:browser}});
  assert.equal(recovered.status,302);assert.equal(calls,1);
});

test('SS-001 fully disabled cookies, wrong state, member 403, and POST paths terminate without redirect',async t=>{
  const invalid=createWeComWebOAuth({enabled:true,publicOrigin:origin,corpId:'corp',agentId:'1000002',resolveCode:async()=>({openid:'external'})});
  const server=app(invalid);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const start=await fetch(base+'/wecom/yixiaoxiu/',{redirect:'manual'});
  const browser=pair(start.headers.getSetCookie().find(value=>value.startsWith('__Host-wecom_oauth=')));
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  const noCookie=await fetch(base+'/wecom/yixiaoxiu/callback?code=bad&state='+state,{redirect:'manual'});
  assert.equal(noCookie.status,401);assert.equal(noCookie.headers.get('location'),null);
  const wrong=await fetch(base+'/wecom/yixiaoxiu/callback?code=bad&state='+('0'.repeat(64)),{redirect:'manual',headers:{cookie:browser}});
  assert.equal(wrong.status,401);assert.equal(wrong.headers.get('location'),null);
  const forbidden=await fetch(base+'/wecom/yixiaoxiu/callback?code=bad&state='+state,{redirect:'manual',headers:{cookie:browser}});
  assert.equal(forbidden.status,403);assert.equal(forbidden.headers.get('location'),null);
  const post=await fetch(base+'/wecom/yixiaoxiu/',{method:'POST',redirect:'manual',headers:{origin:origin},body:''});
  assert.equal(post.status,404);assert.equal(post.headers.get('location'),null);
});
