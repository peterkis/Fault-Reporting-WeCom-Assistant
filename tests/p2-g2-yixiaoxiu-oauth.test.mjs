import test from 'node:test';
import assert from 'node:assert/strict';
import {createWeComWebOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';

const config={enabled:true,corpId:'synthetic-corp',agentId:'1000002',publicOrigin:'https://entry.test',resolveCode:async()=>({userid:'synthetic-A'})};
const state=start=>new URL(start.location).searchParams.get('state');
test('YXX-13 explicit fresh login refreshes browser binding without extending authentication or polling lifetime',async()=>{
  let clock=0;const oauth=createWeComWebOAuth({...config,now:()=>clock});
  try{
    const first=oauth.begin(),session=await oauth.complete({state:state(first),browserToken:first.browserToken,code:'synthetic-first'});
    clock=899900;oauth.browserBinding(first.browserToken);oauth.authenticate(session.sessionToken);
    clock=900001;assert.throws(()=>oauth.authenticate(session.sessionToken),{code:'WECOM_AUTH_REQUIRED'});
    clock=2099800;const next=oauth.begin({browserToken:first.browserToken});assert.ok(next.browserToken===first.browserToken);
    clock=2100001;await oauth.complete({state:state(next),browserToken:next.browserToken,code:'synthetic-fresh'});
    clock=3299900;assert.equal(oauth.browserValid(next.browserToken),true);
    clock=3300002;assert.equal(oauth.browserValid(next.browserToken),false);
    const replacement=oauth.browserBinding(next.browserToken);assert.notEqual(replacement,next.browserToken);
    oauth.logoutBrowser(replacement);assert.notEqual(oauth.browserBinding(replacement),replacement);
  }finally{oauth.close();}
});
test('YXX-15 YXX-43 same-browser OAuth intents retain independent ticket destinations and bounded capacity',async()=>{
  const oauth=createWeComWebOAuth(config);
  try{
    const a=oauth.begin({returnPath:'/wecom/yixiaoxiu/tickets/'+'A'.repeat(32)});
    const b=oauth.begin({browserToken:a.browserToken,returnPath:'/wecom/yixiaoxiu/tickets/'+'B'.repeat(32)});
    assert.ok(b.browserToken===a.browserToken,'recognized browser binding must survive a second login');
    const first=await oauth.complete({state:state(a),browserToken:a.browserToken,code:'synthetic-code-a'});
    const second=await oauth.complete({state:state(b),browserToken:b.browserToken,code:'synthetic-code-b'});
    assert.equal(first.returnPath,'/wecom/yixiaoxiu/tickets/'+'A'.repeat(32));
    assert.equal(second.returnPath,'/wecom/yixiaoxiu/tickets/'+'B'.repeat(32));
    for(let i=0;i<8;i++)oauth.begin({browserToken:a.browserToken});
    assert.throws(()=>oauth.begin({browserToken:a.browserToken}),{code:'WECOM_AUTH_BUSY'});
  }finally{oauth.close();}
});
test('YXX-16 YXX-17 YXX-18 YXX-43 opaque intents reject replay, foreign browser, arbitrary return paths and release expired slots',async()=>{
  let clock=0,calls=0;const oauth=createWeComWebOAuth({...config,now:()=>clock,resolveCode:async()=>{calls++;return {userid:'synthetic-A'};}});
  try{
    const a=oauth.begin(),foreign=oauth.begin();
    await assert.rejects(oauth.complete({state:state(a),browserToken:foreign.browserToken,code:'synthetic-replay'}),{code:'WECOM_AUTH_REQUIRED'});
    assert.equal(calls,0);await oauth.complete({state:state(a),browserToken:a.browserToken,code:'synthetic-replay'});
    await assert.rejects(oauth.complete({state:state(a),browserToken:a.browserToken,code:'synthetic-replay'}),{code:'WECOM_AUTH_REQUIRED'});assert.equal(calls,1);
    for(const returnPath of ['https://evil.invalid','//evil.invalid','/wecom/yixiaoxiu/tickets/a?return_url=x','/workbench/'])assert.throws(()=>oauth.begin({returnPath}),{code:'WECOM_AUTH_REQUIRED'});
    for(let i=0;i<8;i++)oauth.begin({browserToken:a.browserToken});clock=300001;
    assert.ok(oauth.begin({browserToken:a.browserToken}));
    const unknown=oauth.begin({browserToken:'f'.repeat(64)});assert.ok(unknown.browserToken!=='f'.repeat(64));
  }finally{oauth.close();}
});
test('YXX-22 browser logout invalidates pending and in-flight callbacks without minting late sessions',async()=>{
  let release;const oauth=createWeComWebOAuth({...config,resolveCode:()=>new Promise(r=>{release=r;})});
  const a=oauth.begin(),b=oauth.begin({browserToken:a.browserToken});
  const pending=oauth.complete({state:state(a),browserToken:a.browserToken,code:'synthetic-late'});
  oauth.logoutBrowser(a.browserToken);release({userid:'synthetic-A'});
  await assert.rejects(pending,{code:'WECOM_AUTH_REQUIRED'});
  await assert.rejects(oauth.complete({state:state(b),browserToken:b.browserToken,code:'synthetic-unstarted'}),{code:'WECOM_AUTH_REQUIRED'});oauth.close();
});
test('YXX-05 OAuth rejects non-member, interconnected identity and accessor responses without invoking getters',async()=>{
  let gets=0;
  for(const identity of [{openid:'synthetic-external'},{userid:'corp/member'},{get userid(){gets++;return 'synthetic-A';}},new Proxy({},{get(_target,key){if(key==='userid')gets++;return undefined;}})]){
    const oauth=createWeComWebOAuth({...config,resolveCode:async()=>identity}),a=oauth.begin();
    await assert.rejects(oauth.complete({state:state(a),browserToken:a.browserToken,code:'synthetic-invalid-member'}),{code:'WECOM_MEMBER_REQUIRED'});oauth.close();
  }
  assert.equal(gets,0);
});
test('YXX-20 non-cooperative injected provider times out and remains fenced with no queued calls',{timeout:6500},async()=>{
  let calls=0;const oauth=createWeComWebOAuth({...config,resolveCode:()=>{calls++;return new Promise(()=>{});}}),keepAlive=setTimeout(()=>{},7000);
  const a=oauth.begin();
  try{
    await assert.rejects(oauth.complete({state:state(a),browserToken:a.browserToken,code:'synthetic-hanging-code'}),{code:'WECOM_AUTH_UNAVAILABLE'});
    const b=oauth.begin();await assert.rejects(oauth.complete({state:state(b),browserToken:b.browserToken,code:'synthetic-next-code'}),{code:'WECOM_AUTH_BUSY'});
    assert.equal(calls,1);
  }finally{clearTimeout(keepAlive);oauth.close();}
});
