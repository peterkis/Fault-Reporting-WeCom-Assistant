import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeComAppTokenProvider } from '../src/p2-g2-wecom-app-token.mjs';

test('应用令牌按应用缓存，并发合并，按 expires_in 提前刷新且不泄露 secret',async()=>{
  let now=0,calls=0;
  const provider=createWeComAppTokenProvider({corpId:'ww-test',appSecret:'private-secret',now:()=>now,fetchImpl:async(url,options)=>{
    assert.equal(url.origin,'https://qyapi.weixin.qq.com');assert.equal(url.pathname,'/cgi-bin/gettoken');
    assert.equal(url.searchParams.get('corpid'),'ww-test');assert.equal(url.searchParams.get('corpsecret'),'private-secret');assert.equal(options.redirect,'error');
    calls++;return new Response(JSON.stringify({errcode:0,access_token:'token-'+calls,expires_in:7200}));
  }});
  assert.deepEqual(await Promise.all([provider(),provider()]),['token-1','token-1']);assert.equal(calls,1);
  now=7100000;assert.equal(await provider(),'token-1');
  now=7140000;assert.equal(await provider(),'token-2');assert.equal(calls,2);
});
