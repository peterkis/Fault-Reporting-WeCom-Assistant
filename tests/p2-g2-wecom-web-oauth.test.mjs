import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeComWebOAuth } from '../src/p2-g2-wecom-web-oauth.mjs';
import { createWeComOAuthCodeResolver } from '../src/p2-g2-wecom-oauth-provider.mjs';

const config={enabled:true,corpId:'ww-test-corp',agentId:'1000002',publicOrigin:'https://cd3120.mobimedical.cn'};
test('网页授权使用固定回调、snsapi_base 和浏览器绑定 state，成员身份仅保留在服务端',async()=>{
  const oauth=createWeComWebOAuth({...config,resolveCode:async code=>{assert.equal(code,'one-code');return {userid:'member-one'};}});
  const start=oauth.begin();const url=new URL(start.location);
  assert.equal(url.origin,'https://open.weixin.qq.com');
  assert.equal(url.searchParams.get('redirect_uri'),'https://cd3120.mobimedical.cn/wecom/yixiaoxiu/callback');
  assert.equal(url.searchParams.get('scope'),'snsapi_base');assert.equal(url.searchParams.get('agentid'),'1000002');
  assert.match(url.searchParams.get('state'),/^[a-zA-Z0-9]{64}$/u);
  const result=await oauth.complete({state:url.searchParams.get('state'),browserToken:start.browserToken,code:'one-code'});
  assert.deepEqual(oauth.authenticate(result.sessionToken),{corpId:'ww-test-corp',userid:'member-one'});
  assert.equal(result.userid,undefined);
});

test('code 只发送给固定 getuserinfo 接口，响应只返回成员 userid',async()=>{
  let calls=0;
  const resolve=createWeComOAuthCodeResolver({accessTokenProvider:async()=> 'private-token',fetchImpl:async(url,options)=>{
    calls++;assert.equal(url.origin,'https://qyapi.weixin.qq.com');assert.equal(url.pathname,'/cgi-bin/auth/getuserinfo');
    assert.equal(url.searchParams.get('code'),'single-code');assert.equal(url.searchParams.get('access_token'),'private-token');
    assert.equal(options.redirect,'error');assert.equal(options.method,'GET');
    return new Response(JSON.stringify({errcode:0,userid:'member-one',user_ticket:'sensitive-ticket',errmsg:'sensitive-response'}));
  }});
  assert.deepEqual(await resolve('single-code'),{userid:'member-one'});assert.equal(calls,1);
});

const attempt=oauth=>{const start=oauth.begin();return {state:new URL(start.location).searchParams.get('state'),browserToken:start.browserToken,code:'code-one'};};
test('跨浏览器与伪造 state 拒绝；成功后 state 和 code 都不能重放',async()=>{
  let calls=0;const oauth=createWeComWebOAuth({...config,resolveCode:async()=>{calls++;return {userid:'member'};}});
  const a=attempt(oauth),b=attempt(oauth);
  await assert.rejects(oauth.complete({...a,browserToken:b.browserToken}),{code:'WECOM_AUTH_REQUIRED'});
  await assert.rejects(oauth.complete({...a,state:'0'.repeat(64)}),{code:'WECOM_AUTH_REQUIRED'});assert.equal(calls,0);
  await oauth.complete(a);await assert.rejects(oauth.complete(a),{code:'WECOM_AUTH_REQUIRED'});
  await assert.rejects(oauth.complete(b),{code:'WECOM_AUTH_REQUIRED'});assert.equal(calls,1);
});
test('过期 state、过期或已退出会话拒绝，重启丢失会话',async()=>{
  let time=0;const options={...config,now:()=>time,resolveCode:async()=>({userid:'member'})};
  const oauth=createWeComWebOAuth(options),expired=attempt(oauth);time=300000;
  await assert.rejects(oauth.complete(expired),{code:'WECOM_AUTH_REQUIRED'});
  const session=await oauth.complete(attempt(oauth));time+=900000;
  assert.throws(()=>oauth.authenticate(session.sessionToken),{code:'WECOM_AUTH_REQUIRED'});
  const current=await oauth.complete(attempt(oauth));
  assert.throws(()=>createWeComWebOAuth(options).authenticate(current.sessionToken),{code:'WECOM_AUTH_REQUIRED'});
  oauth.logout(current.sessionToken);assert.throws(()=>oauth.authenticate(current.sessionToken),{code:'WECOM_AUTH_REQUIRED'});
});
test('提供商失败也消耗 state/code，原始错误不外露',async()=>{
  let calls=0;const oauth=createWeComWebOAuth({...config,resolveCode:async()=>{calls++;throw new Error('secret-provider-url');}});
  const a=attempt(oauth);await assert.rejects(oauth.complete(a),{message:'WECOM_AUTH_UNAVAILABLE'});
  await assert.rejects(oauth.complete(a),{code:'WECOM_AUTH_REQUIRED'});
  await assert.rejects(oauth.complete(attempt(oauth)),{code:'WECOM_AUTH_REQUIRED'});assert.equal(calls,1);
});
test('外部用户、互联企业身份、供应商错误、超大和非 JSON 响应均关闭访问',async()=>{
  for(const [body,code] of [
    [JSON.stringify({errcode:0,openid:'external',external_userid:'external'}),'WECOM_MEMBER_REQUIRED'],
    [JSON.stringify({errcode:0,userid:'othercorp/member'}),'WECOM_MEMBER_REQUIRED'],
    [JSON.stringify({errcode:40029,errmsg:'private-error'}),'WECOM_AUTH_UNAVAILABLE'],
    ['x'.repeat(65537),'WECOM_AUTH_UNAVAILABLE'],['not-json','WECOM_AUTH_UNAVAILABLE'],
  ]){
    const resolve=createWeComOAuthCodeResolver({accessTokenProvider:async()=> 'private',fetchImpl:async()=>new Response(body)});
    await assert.rejects(resolve('code'),{code,message:code});
  }
});
test('关闭态无需凭据，不构造身份端口',()=>{assert.deepEqual(createWeComWebOAuth(),{enabled:false});});

test('认证资源有界且不并行调用身份提供商',async()=>{
  let release;let calls=0;const oauth=createWeComWebOAuth({...config,resolveCode:()=>{calls++;return new Promise(resolve=>{release=resolve;});}});
  const first=oauth.complete(attempt(oauth));
  await assert.rejects(oauth.complete({...attempt(oauth),code:'code-two'}),{code:'WECOM_AUTH_BUSY'});assert.equal(calls,1);
  release({userid:'member'});await first;
  const limited=createWeComWebOAuth({...config,resolveCode:async()=>({userid:'member'})});
  for(let i=0;i<1024;i++)limited.begin();assert.throws(()=>limited.begin(),{code:'WECOM_AUTH_BUSY'});
});

test('令牌提供商挂起时仍在五秒内结束认证请求',{timeout:6500},async()=>{
  let calls=0;const resolve=createWeComOAuthCodeResolver({accessTokenProvider:()=>{calls++;return new Promise(()=>{});}});
  const keepAlive=setTimeout(()=>{},7000);
  try{await assert.rejects(resolve('code'),{code:'WECOM_AUTH_UNAVAILABLE'});
    await assert.rejects(resolve('another-code'),{code:'WECOM_AUTH_BUSY'});assert.equal(calls,1);
  }finally{clearTimeout(keepAlive);}
});

test('关闭撤销已有会话，晚到的提供商响应不能重新建立会话',async()=>{
  let release;let calls=0;const oauth=createWeComWebOAuth({...config,resolveCode:async()=>{
    if(++calls===1)return {userid:'member'};return new Promise(resolve=>{release=resolve;});
  }});
  const session=await oauth.complete(attempt(oauth));
  const late=oauth.complete({...attempt(oauth),code:'second'});oauth.close();release({userid:'member'});
  await assert.rejects(late,{code:'WECOM_AUTH_UNAVAILABLE'});
  assert.throws(()=>oauth.authenticate(session.sessionToken),{code:'WECOM_AUTH_REQUIRED'});
  assert.throws(()=>oauth.begin(),{code:'WECOM_AUTH_UNAVAILABLE'});
});
