import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { get } from 'node:http';
import { createWeComOAuthServer } from '../src/p2-g2-wecom-oauth-server.mjs';
import { createWeComWebOAuth } from '../src/p2-g2-wecom-web-oauth.mjs';

test('独立认证启动模式只提供认证路由，固定 Host，无业务 API，关闭后撤销会话',async t=>{
  const publicOrigin='https://cd3120.mobimedical.cn';
  const oauth=createWeComWebOAuth({enabled:true,publicOrigin,corpId:'ww-test',agentId:'1000002',resolveCode:async()=>({userid:'member'})});
  const server=createWeComOAuthServer({oauth,publicOrigin});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin='http://127.0.0.1:'+server.address().port;
  const request=path=>new Promise((resolve,reject)=>{
    get(origin+path,{headers:{host:'cd3120.mobimedical.cn'}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));}).on('error',reject);
  });
  assert.equal((await fetch(origin+'/wecom/yixiaoxiu/login',{redirect:'manual'})).status,421);
  assert.equal(await request('/wecom/yixiaoxiu/login'),302);
  assert.equal(await request('/health/live'),200);
  assert.equal(await request('/api/workbench/tickets'),404);
  await new Promise(resolve=>server.close(resolve));assert.throws(()=>oauth.begin(),{code:'WECOM_AUTH_UNAVAILABLE'});
});
