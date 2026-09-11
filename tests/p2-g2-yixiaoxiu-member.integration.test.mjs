import test from 'node:test';
import assert from 'node:assert/strict';
import {createWeComWebOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import {createYxxReadonlyServer} from '../src/p2-g2-yixiaoxiu-server.mjs';
import {entryOrigin,entryConfig,entryKey,withYxxDatabase,listenYxx,stopYxx,httpBrowser,loginYxx,businessDigest} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {createP2016ReporterTimeline} from '../src/p2-016-reporter-timeline.mjs';
import {createP2012ReporterTimelineAdapter} from '../src/p2-012-reporter-timeline-adapter.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {createTicketActionService} from '../src/p1-006-ticket-state-actions.mjs';
import {transactionP2016} from '../src/p2-016-domain-contracts.mjs';
import {p2016CatalogInventory} from '../scripts/p2-016-migrate.mjs';
import {p2012CatalogInventory} from '../scripts/p2-012-migrate.mjs';

const post=body=>({method:'POST',headers:{origin:entryOrigin,'content-type':'application/json'},body:JSON.stringify(body)});
async function openMember({pool,config=entryConfig,clock=Date.now,secret=entryKey}){
  let count=0;
  const oauth=createWeComWebOAuth({enabled:true,publicOrigin:entryOrigin,corpId:config.corpId,agentId:config.agentId,now:clock,
    resolveCode:async code=>{count++;return {userid:code.startsWith('synthetic-B')?'synthetic-B':'synthetic-A'};}});
  const server=createYxxReadonlyServer({pool,oauth,publicOrigin:entryOrigin,reporterHmacSecret:secret,reporterMemberEntry:config,now:clock});
  return {oauth,server,base:await listenYxx(server),calls:()=>count};
}

test('YXX-13 YXX-25 YXX-44 fresh legacy prepare survives old binding expiry and expired or restarted continuations show safe recovery',async()=>{
  await withYxxDatabase(async({pool,seed})=>{
    const a=await seed();let clock=0;const app=await openMember({pool,clock:()=>clock}),browser=httpBrowser(app.base);
    let expiredPath;
    try{
      await loginYxx(browser,{code:'synthetic-original'});clock=1199900;
      const prepared=await browser.request('/api/reporter/member-entry/prepare',post({grant:a.grant.token}));assert.equal(prepared.status,200);
      const entry=(await prepared.json()).entry_path;clock=1200100;
      assert.equal(await loginYxx(browser,{path:entry,code:'synthetic-refreshed'}),entry);
      assert.equal((await browser.request(entry)).status,303);
      expiredPath=(await (await browser.request('/api/reporter/member-entry/prepare',post({grant:a.grant.token}))).json()).entry_path;
      clock+=300001;const expired=await browser.request(expiredPath);assert.equal(expired.status,404);
      assert.match(expired.headers.get('content-type'),/^text\/html/u);assert.match(await expired.text(),/重新点击原工单卡片/u);
    }finally{await stopYxx(app.server);}
    const restarted=await openMember({pool,clock:()=>clock});
    try{
      const response=await httpBrowser(restarted.base).request(expiredPath);assert.equal(response.status,404);
      const html=await response.text();assert.match(html,/重新点击原工单卡片/u);assert.ok(!html.includes(a.ticket.ticket_no));
    }finally{await stopYxx(restarted.server);}
  });
});

test('YXX-02 YXX-03 YXX-04 YXX-46 YXX-47 actual OAuth HTTP and PostgreSQL enforce reporter ownership without business side effects',async()=>{
  await withYxxDatabase(async({pool,seed})=>{
    const a=await seed(),b=await seed('synthetic-B'),before=await businessDigest(pool);
    const oauth=createWeComWebOAuth({enabled:true,publicOrigin:entryOrigin,corpId:entryConfig.corpId,agentId:entryConfig.agentId,
      resolveCode:async code=>({userid:code.startsWith('synthetic-B')?'synthetic-B':'synthetic-A'})});
    const server=createYxxReadonlyServer({pool,oauth,publicOrigin:entryOrigin,reporterHmacSecret:entryKey,reporterMemberEntry:entryConfig});
    const base=await listenYxx(server),browser=httpBrowser(base);
    try{
      const anonymous=await browser.request('/api/reporter/tickets/'+a.grant.public_ref);assert.equal(anonymous.status,401);
      assert.doesNotMatch(await anonymous.text(),/synthetic-private-note|ticket_no/u);
      const path='/wecom/yixiaoxiu/tickets/'+a.grant.public_ref;
      assert.equal(await loginYxx(browser,{path}),path);
      const detail=await browser.request('/api/reporter/tickets/'+a.grant.public_ref);assert.equal(detail.status,200);
      assert.equal((await detail.json()).ticket_no,a.ticket.ticket_no);
      const denied=await browser.request('/api/reporter/tickets/'+b.grant.public_ref);assert.equal(denied.status,404);
      assert.deepEqual(await businessDigest(pool),before);
    }finally{await stopYxx(server);}
  });
});

test('YXX member HTTP ownership, cookie bypass, retention, conditional responses and stable input matrix',async t=>{
  await withYxxDatabase(async({pool,seed,access})=>{
    const a=await seed(),b=await seed('synthetic-B'),otherBot=await seed('synthetic-A','different-bot');
    const admin=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'synthetic-yxx-admin',displayName:'合成管理员',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    let clock=Date.now();const app=await openMember({pool,clock:()=>clock}),browser=httpBrowser(app.base),anonymous=httpBrowser(app.base);
    const path='/api/reporter/tickets/'+a.grant.public_ref;
    const catalogBefore=[await p2016CatalogInventory(pool),await p2012CatalogInventory(pool)];
    try{
      await loginYxx(browser);
      await t.test('YXX-03 member detail equals the complete legacy safe projection field for field',async()=>{
        const old=await access.exchange(a.grant.token),legacy=createP2016ReporterTimeline({pool,access,enabled:true,incidentAdapter:createP2012ReporterTimelineAdapter({pool,enabled:true})});
        assert.deepEqual(await (await browser.request(path)).json(),await legacy.detail({sessionToken:old.sessionToken,publicRef:a.grant.public_ref}));
      });
      await t.test('YXX-06 YXX-08 different Bot and malformed or unknown refs cannot broaden ownership',async()=>{
        assert.equal((await browser.request('/api/reporter/tickets/'+otherBot.grant.public_ref)).status,404);
        for(const ref of [a.ticket.id,a.ticket.ticket_no.slice(-4),'x','%2e%2e'])assert.equal((await browser.request('/api/reporter/tickets/'+ref)).status,400);
        assert.equal((await browser.request('/api/reporter/tickets/'+'X'.repeat(32))).status,404);
        for(const query of ['?userid=synthetic-B','?bot_id=different-bot','?return_url=https://evil.invalid','?limit=1'])assert.equal((await browser.request(path+query)).status,400);
      });
      await t.test('YXX-30 YXX-31 YXX-32 old Reporter Cookie, anonymous exchange and bootstrap confer no member permission',async()=>{
        const oldB=await access.exchange(b.grant.token);anonymous.cookies.set('p2016_reporter',oldB.sessionToken);browser.cookies.set('p2016_reporter',oldB.sessionToken);
        assert.equal((await anonymous.request('/api/reporter/tickets/'+b.grant.public_ref)).status,401);
        assert.equal((await browser.request('/api/reporter/tickets/'+b.grant.public_ref)).status,404);
        assert.equal((await anonymous.request('/api/reporter/bootstrap')).status,401);
        const bootstrap=await (await browser.request('/api/reporter/bootstrap')).json();
        assert.deepEqual(bootstrap,{identity_mode:'MEMBER_REQUIRED',authenticated:true,read_only:true});
        assert.equal((await anonymous.request('/api/reporter/access/exchange',post({grant:b.grant.token}))).status,403);
        assert.equal((await browser.request('/api/reporter/access/exchange',post({grant:b.grant.token}))).status,403);
      });
      await t.test('YXX-34 exact Origin, Host, CORS and POST boundaries reject contamination',async()=>{
        for(const origin of ['https://evil.invalid','null',entryOrigin+'/'])assert.equal((await browser.request('/api/reporter/logout',{...post({}),headers:{origin,'content-type':'application/json'}})).status,403);
        assert.equal((await browser.request(path,{headers:{host:'evil.invalid'}})).status,421);
        assert.equal((await browser.request(path,{headers:{origin:'https://evil.invalid'}})).status,403);
        assert.equal((await browser.request('/api/reporter/member-entry/prepare',{...post({grant:a.grant.token}),headers:{origin:entryOrigin,'content-type':'text/plain'}})).status,400);
        assert.equal((await browser.request('/api/reporter/member-entry/prepare',post({grant:'A'.repeat(2100)}))).status,400);
        assert.equal((await browser.request('/api/reporter/member-entry/prepare',post({grant:a.grant.token,userid:'synthetic-B'}))).status,400);
        const response=await browser.request(path);assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),null);
      });
      await t.test('YXX-17 YXX-18 callback pollution and arbitrary return query do not consume the valid intent',async()=>{
        const start=await browser.request('/wecom/yixiaoxiu/login');const state=new URL(start.headers.get('location')).searchParams.get('state'),calls=app.calls();
        for(const query of ['code=synthetic-new&code=other&state='+state,'code=synthetic-new&state='+state+'&state='+state,'code=synthetic-new&state='+state+'&return_url=https://evil.invalid']){
          assert.equal((await browser.request('/wecom/yixiaoxiu/callback?'+query)).status,401);
        }
        assert.equal(app.calls(),calls);assert.equal((await browser.request('/wecom/yixiaoxiu/login?return_url=https://evil.invalid')).status,404);
        assert.equal((await browser.request('/wecom/yixiaoxiu/callback?code=synthetic-unpolluted&state='+state)).status,303);assert.equal(app.calls(),calls+1);
      });
      await t.test('YXX-39 same-second pagination uses ordinals and rejects a cursor from another ref',async()=>{
        const commands=createTicketActionService({pool});let version=(await pool.query('SELECT version FROM pilot_ticket.ticket WHERE id=$1::uuid',[a.ticket.id])).rows[0].version;
        for(const action of ['accept','start','resolve','confirm']){
          const r=await commands.perform({ticketId:a.ticket.id,action,expectedVersion:version,actor:{type:'PILOT_USER',id:admin.id},traceId:'synthetic-yxx-lifecycle'});assert.equal(r.ok,true);version=r.ticket.version;
        }
        const first=await (await browser.request(path+'/timeline?limit=1')).json();assert.equal(first.items.length,1);assert.ok(first.next_cursor);
        const second=await (await browser.request(path+'/timeline?limit=1&cursor='+first.next_cursor)).json();assert.ok(second.items[0].source_ordinal>first.items[0].source_ordinal);
        const a2=await seed();assert.equal((await browser.request('/api/reporter/tickets/'+a2.grant.public_ref+'/timeline?cursor='+first.next_cursor)).status,400);
        assert.equal((await browser.request(path+'/timeline?limit=1&limit=2')).status,400);
      });
      await t.test('YXX-11 closed retained Ticket stays readable and member query does not reopen it',async()=>{
        const before=await businessDigest(pool),response=await browser.request(path);assert.equal(response.status,200);assert.equal((await response.json()).external_status,'已关闭');
        assert.deepEqual(await businessDigest(pool),before);
      });
      await t.test('YXX-12 YXX-46 YXX-47 repeated canonical page and timeline reads add no business facts or send qualification',async()=>{
        const before=await businessDigest(pool);
        for(let i=0;i<3;i++){assert.equal((await browser.request('/wecom/yixiaoxiu/tickets/'+a.grant.public_ref)).status,200);assert.equal((await browser.request(path+'/timeline')).status,200);}
        assert.deepEqual(await businessDigest(pool),before);
        const events=await pool.query("SELECT session_id,grant_id,actor_principal_id FROM pilot_ticket.reporter_access_event WHERE reason_code='MEMBER_AUTHORIZED_QUERY'");
        assert.ok(events.rowCount>=3);assert.ok(events.rows.every(r=>r.session_id===null&&r.grant_id===null&&r.actor_principal_id===null));
      });
      await t.test('YXX-10 Intake retention expiry removes eligibility using the actual persisted deadline',async()=>{
        const expired=await seed();await pool.query("UPDATE intake.service_intake SET retention_until=platform.local_now()-interval '1 second',retention_until_epoch_ms=platform.physical_epoch_ms()-1000 WHERE id=$1::uuid",[expired.intake.intakeId]);
        assert.equal((await browser.request('/api/reporter/tickets/'+expired.grant.public_ref)).status,404);
      });
      await t.test('YXX-09 YXX-37 revoked ref denies a formerly matching ETag before 304',async()=>{
        const etag=(await browser.request(path)).headers.get('etag');assert.equal((await browser.request(path,{headers:{'if-none-match':etag}})).status,304);
        await transactionP2016(pool,tx=>access.revokeInTransaction({transaction:tx,ticketId:a.ticket.id,actorPrincipalId:admin.id}));
        assert.equal((await browser.request(path,{headers:{'if-none-match':etag}})).status,404);
      });
      await t.test('YXX-13 YXX-14 YXX-37 separate devices and expired authentication require a fresh OAuth code',async()=>{
        const a2=await seed(),p='/api/reporter/tickets/'+a2.grant.public_ref,device=httpBrowser(app.base);await loginYxx(device,{code:'synthetic-A-device'});
        assert.equal((await device.request(p)).status,200);const etag=(await browser.request(p)).headers.get('etag');clock+=900001;
        assert.equal((await browser.request(p,{headers:{'if-none-match':etag}})).status,401);
        const target='/wecom/yixiaoxiu/tickets/'+a2.grant.public_ref;assert.equal(await loginYxx(browser,{path:target,code:'synthetic-A-new-login'}),target);
        assert.equal((await browser.request(p)).status,200);assert.equal((await device.request(p)).status,401);
      });
      await t.test('YXX-32 both logout aliases revoke member sessions and stop old-cookie fallback',async()=>{
        for(const [i,logout] of ['/api/reporter/logout','/wecom/yixiaoxiu/logout'].entries()){
          await loginYxx(browser,{code:'synthetic-A-logout-'+i});assert.equal((await browser.request(logout,post({}))).status,200);
          assert.equal((await browser.request('/api/reporter/member/session')).status,401);assert.equal((await browser.request('/api/reporter/bootstrap')).status,401);
        }
      });
      assert.deepEqual([await p2016CatalogInventory(pool),await p2012CatalogInventory(pool)],catalogBefore);
    }finally{await stopYxx(app.server);}
  });
});

test('YXX-07 live namespace unknown stays denied after successful synthetic member authentication',async()=>{
  await withYxxDatabase(async({pool,seed})=>{
    const a=await seed(),app=await openMember({pool,config:{...entryConfig,identityMode:'UNVERIFIED',memberIdsConfirmed:false,proofRef:null,proofKind:null}});
    try{const browser=httpBrowser(app.base);await loginYxx(browser);const response=await browser.request('/api/reporter/tickets/'+a.grant.public_ref);
      assert.equal(response.status,503);assert.equal((await response.json()).error.code,'YXX_ENTRY_IDENTITY_NAMESPACE_UNVERIFIED');
    }finally{await stopYxx(app.server);}
  });
});

test('YXX-22 YXX-37 OAuth logout during real authorized SQL read prevents any late detail or 304 response',async()=>{
  await withYxxDatabase(async({pool,seed})=>{
    const a=await seed();let release,entered;const waiting=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});let intercept=false;
    const wrapped={connect:async()=>{const tx=await pool.connect();return {release:destroy=>tx.release(destroy),query:async(sql,args)=>{
      if(intercept&&sql.startsWith('SELECT ticket_no')){entered();await gate;}return tx.query(sql,args);
    }};}};
    const app=await openMember({pool:wrapped}),browser=httpBrowser(app.base);
    try{await loginYxx(browser);const path='/api/reporter/tickets/'+a.grant.public_ref,etag=(await browser.request(path)).headers.get('etag');intercept=true;
      const late=browser.request(path,{headers:{'if-none-match':etag}});await waiting;
      assert.equal((await browser.request('/api/reporter/logout',post({}))).status,200);release();
      const response=await late;assert.equal(response.status,401);assert.doesNotMatch(await response.text(),/ticket_no|incident_milestones/u);
    }finally{release();await stopYxx(app.server);}
  });
});

test('YXX-22 YXX-23 callback identity replacement with stale Cookie snapshots invalidates the earlier in-flight SQL read',async()=>{
  await withYxxDatabase(async({pool,seed})=>{
    const a=await seed();
    for(const firstNavigationRace of [false,true]){
      let release,entered;const waiting=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
      const wrapped={connect:async()=>{const tx=await pool.connect();return {release:destroy=>tx.release(destroy),query:async(sql,args)=>{
        if(sql.startsWith('SELECT ticket_no')){entered();await gate;}return tx.query(sql,args);
      }};}};
      const app=await openMember({pool:wrapped}),browser=httpBrowser(app.base);
      try{
        const startA=await browser.request('/wecom/yixiaoxiu/login');
        const startB=await browser.request('/wecom/yixiaoxiu/login',firstNavigationRace?{headers:{cookie:''}}:{});
        const stale=[...browser.cookies].map(([key,value])=>key+'='+value).join('; ');
        const callback=async(start,code)=>browser.request('/wecom/yixiaoxiu/callback?state='+new URL(start.headers.get('location')).searchParams.get('state')+'&code='+code,{headers:{cookie:stale}});
        assert.equal((await callback(startA,'synthetic-A-replacement')).status,303);
        const late=browser.request('/api/reporter/tickets/'+a.grant.public_ref);await waiting;
        assert.equal((await callback(startB,'synthetic-B-replacement')).status,303);release();
        const response=await late;assert.equal(response.status,401);assert.doesNotMatch(await response.text(),/ticket_no|incident_milestones/u);
      }finally{release();await stopYxx(app.server);}
    }
  });
});

test('YXX legacy Grant adapter verifies signatures and ownership without consuming or resurrecting grants',async t=>{
  await withYxxDatabase(async({pool,seed,access,setGrantClock})=>{
    const a=await seed(),consumed=await seed(),revoked=await seed();await access.exchange(consumed.grant.token);
    const admin=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'synthetic-yxx-revoke',displayName:'合成管理员',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    await transactionP2016(pool,tx=>access.revokeInTransaction({transaction:tx,ticketId:revoked.ticket.id,actorPrincipalId:admin.id}));
    const app=await openMember({pool}),aBrowser=httpBrowser(app.base),bBrowser=httpBrowser(app.base);
    const snapshot=async()=> (await pool.query('SELECT grant_id::text,state,row_version::text FROM pilot_ticket.reporter_access_grant ORDER BY grant_id')).rows;
    const before=await snapshot();
    async function prepare(browser,grant){const p=await browser.request('/api/reporter/member-entry/prepare',post({grant}));assert.equal(p.status,200);const body=await p.json();assert.deepEqual(Object.keys(body),['entry_path']);return body.entry_path;}
    try{
      await t.test('YXX-25 YXX-29 anonymous old entry scanning prepares only context and requires real OAuth flow',async()=>{
        const entry=await prepare(aBrowser,a.grant.token);assert.deepEqual(await snapshot(),before);
        const start=await aBrowser.request(entry);assert.equal(start.status,302);assert.equal(app.calls(),0);assert.deepEqual(await snapshot(),before);
        const state=new URL(start.headers.get('location')).searchParams.get('state');
        const callback=await aBrowser.request('/wecom/yixiaoxiu/callback?state='+state+'&code=synthetic-A-legacy');assert.equal(callback.status,303);assert.equal(callback.headers.get('location'),entry);
        const result=await aBrowser.request(entry);assert.equal(result.status,303);assert.equal(result.headers.get('location'),'/wecom/yixiaoxiu/tickets/'+a.grant.public_ref);
        assert.deepEqual(await snapshot(),before);
      });
      await t.test('YXX-26 wrong member possession cannot consume or lock the original grant',async()=>{
        await loginYxx(bBrowser,{code:'synthetic-B-forwarded'});const entry=await prepare(bBrowser,a.grant.token);
        assert.equal((await bBrowser.request(entry)).status,404);assert.deepEqual(await snapshot(),before);
      });
      await t.test('YXX-27 consumed and expired signed grants locate only under fresh member ownership',async()=>{
        await new Promise(r=>setTimeout(r,1100));
        setGrantClock(String(Date.now()));
        await assert.rejects(access.exchange(a.grant.token),{code:'P2_016_GRANT_INVALID'});
        for(const grant of [a.grant,consumed.grant]){const entry=await prepare(aBrowser,grant.token);const r=await aBrowser.request(entry);assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/wecom/yixiaoxiu/tickets/'+grant.public_ref);}
        assert.deepEqual(await snapshot(),before);
      });
      await t.test('YXX-28 revoked, forged and rotated-key grants reject without using a parsed UUID as proof',async()=>{
        const forged=a.grant.token.slice(0,-1)+(a.grant.token.endsWith('A')?'B':'A');
        for(const token of [revoked.grant.token,forged]){const entry=await prepare(aBrowser,token);assert.equal((await aBrowser.request(entry)).status,404);}
        const rotated=await openMember({pool,secret:'different-synthetic-rotated-key-at-least-32bytes'}),browser=httpBrowser(rotated.base);
        try{await loginYxx(browser,{code:'synthetic-A-rotated'});const entry=await prepare(browser,a.grant.token);assert.equal((await browser.request(entry)).status,404);}finally{await stopYxx(rotated.server);}
        assert.deepEqual(await snapshot(),before);
      });
    }finally{await stopYxx(app.server);}
  },{grantTtlMs:1000});
});
