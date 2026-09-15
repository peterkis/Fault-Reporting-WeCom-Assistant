import test from 'node:test';
import assert from 'node:assert/strict';
import {createWeComWebOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import {createYxxReadonlyServer} from '../src/p2-g2-yixiaoxiu-server.mjs';
import {createYxxDelegatedIdentityMapping} from '../src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {entryOrigin,entryConfig,entryKey,withYxxDatabase,listenYxx,stopYxx,httpBrowser,loginYxx,businessDigest} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';

test('delegated OAuth HTTP reads own original Bot tickets, denies other members and preserves Grant and business facts',async()=>{
 await withYxxDatabase(async({pool,seed})=>{
  const a1=await seed(),a2=await seed(),b1=await seed('synthetic-B'),otherBot=await seed('synthetic-A','other-bot');
  const before=await businessDigest(pool),config={...entryConfig,identityMode:'VERIFIED_DELEGATED_MAPPING',reporterUserIds:['synthetic-A','synthetic-B']};
  let conversions=0;
  const identityMapping=await createYxxDelegatedIdentityMapping({config,accessTokenProvider:async()=> 'synthetic-token',fetchImpl:async()=>{
   conversions++;return new Response(JSON.stringify({errcode:0,invalid_userid_list:[],open_userid_list:[{userid:'synthetic-A',open_userid:'encrypted-A'},{userid:'synthetic-B',open_userid:'encrypted-B'}]}));
  }});
  const oauth=createWeComWebOAuth({enabled:true,publicOrigin:entryOrigin,corpId:config.corpId,agentId:config.agentId,
   resolveCode:async code=>({userid:code.startsWith('B-')?'encrypted-B':'encrypted-A'})});
  const server=createYxxReadonlyServer({pool,oauth,publicOrigin:entryOrigin,reporterHmacSecret:entryKey,reporterMemberEntry:config,identityMapping});
  const browser=httpBrowser(await listenYxx(server)),path=ref=>'/api/reporter/tickets/'+ref;
  try{
   await loginYxx(browser,{code:'A-first'});
   for(const a of [a1,a2]){const detail=await browser.request(path(a.grant.public_ref));assert.equal(detail.status,200);assert.equal((await detail.json()).ticket_no,a.ticket.ticket_no);}
   assert.equal((await browser.request(path(b1.grant.public_ref))).status,404);
   assert.equal((await browser.request(path(otherBot.grant.public_ref))).status,404);
   const timeline=await browser.request(path(a1.grant.public_ref)+'/timeline');assert.equal(timeline.status,200);
   const etag=timeline.headers.get('etag');
   const prepared=await browser.request('/api/reporter/member-entry/prepare',{method:'POST',headers:{origin:entryOrigin,'content-type':'application/json'},body:JSON.stringify({grant:a1.grant.token})});
   assert.equal(prepared.status,200);const continuation=(await prepared.json()).entry_path;
   assert.equal((await browser.request(continuation)).status,303);
   assert.equal((await browser.request('/api/reporter/logout',{method:'POST',headers:{origin:entryOrigin,'content-type':'application/json'},body:'{}'})).status,200);
   assert.equal((await browser.request(path(a1.grant.public_ref))).status,401);
   await loginYxx(browser,{code:'B-second'});
   assert.equal((await browser.request(path(b1.grant.public_ref))).status,200);
   assert.equal((await browser.request(path(a1.grant.public_ref)+'/timeline',{headers:etag?{'if-none-match':etag}:{}})).status,404);
   assert.equal(conversions,1);assert.deepEqual(await businessDigest(pool),before);
  }finally{await stopYxx(server);}
 });
});
