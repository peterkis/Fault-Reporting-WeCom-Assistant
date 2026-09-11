import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeComAppTokenProvider } from '../src/p2-g2-wecom-app-token.mjs';
import { createWeComOAuthCodeResolver } from '../src/p2-g2-wecom-oauth-provider.mjs';

test('提前失效的应用令牌被清除，30秒刷新保护后新登录获取新令牌，不重试 code',async()=>{
  let now=0,tokens=0,users=0;
  const tokenProvider=createWeComAppTokenProvider({corpId:'ww-test',appSecret:'private',now:()=>now,
    fetchImpl:async()=>new Response(JSON.stringify({errcode:0,access_token:'token-'+(++tokens),expires_in:7200}))});
  const resolve=createWeComOAuthCodeResolver({accessTokenProvider:tokenProvider,fetchImpl:async()=>{
    users++;return new Response(JSON.stringify(users===1?{errcode:40014,errmsg:'private-error'}:{errcode:0,userid:'member'}));
  }});
  await assert.rejects(resolve('first-code'),{code:'WECOM_AUTH_UNAVAILABLE'});assert.equal(users,1);assert.equal(tokens,1);
  await assert.rejects(tokenProvider(),{code:'WECOM_TOKEN_UNAVAILABLE'});assert.equal(tokens,1);
  now=30000;assert.deepEqual(await resolve('new-code'),{userid:'member'});assert.equal(tokens,2);assert.equal(users,2);
});

test('令牌获取错误与畸形响应脱敏，失败后禁止密集重试',async()=>{
  for(const body of [{errcode:40013,errmsg:'private-secret'}, {errcode:0,access_token:'x'.repeat(513),expires_in:7200}, {errcode:0,access_token:'t',expires_in:0}]){
    let calls=0;const provider=createWeComAppTokenProvider({corpId:'ww-test',appSecret:'private',fetchImpl:async()=>{calls++;return new Response(JSON.stringify(body));}});
    await assert.rejects(provider(),{message:'WECOM_TOKEN_UNAVAILABLE'});
    await assert.rejects(provider(),{message:'WECOM_TOKEN_UNAVAILABLE'});assert.equal(calls,1);
  }
});

test('无效 code 只使本次登录失败，不能撤销其他成员共用的健康应用令牌',async()=>{
  let tokens=0;
  const provider=createWeComAppTokenProvider({corpId:'ww-test',appSecret:'private',fetchImpl:async()=>{
    tokens++;return new Response(JSON.stringify({errcode:0,access_token:'healthy-token',expires_in:7200}));
  }});
  const resolve=createWeComOAuthCodeResolver({accessTokenProvider:provider,fetchImpl:async()=>new Response(JSON.stringify({errcode:40029}))});
  await assert.rejects(resolve('invalid-code'),{code:'WECOM_AUTH_UNAVAILABLE'});
  assert.equal(await provider(),'healthy-token');assert.equal(tokens,1);
});

test('失败的 HTTP 响应也取消流，避免释放并发槽后遗留连接',async()=>{
  let cancelled=false;
  const resolve=createWeComOAuthCodeResolver({accessTokenProvider:async()=> 'token',fetchImpl:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:503})});
  await assert.rejects(resolve('code'),{code:'WECOM_AUTH_UNAVAILABLE'});assert.equal(cancelled,true);
});
