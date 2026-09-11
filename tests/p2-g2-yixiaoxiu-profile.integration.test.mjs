import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createYxxProfile} from '../src/p2-g2-yixiaoxiu-profile.mjs';
import {createWeComWebOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {minimalG2Environment} from '../src/p2-g2-validation-config.mjs';
import {entryOrigin,entryConfig,entryKey,withYxxDatabase,httpBrowser,loginYxx,businessDigest} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';

async function catalog(pool){
  const schemas=['platform','pilot_ticket','intake','channel','conversation','incident','communication','notification','operations'];
  const statements=[
    "SELECT table_schema,table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema=ANY($1::text[]) ORDER BY table_schema,table_name,ordinal_position",
    "SELECT n.nspname,c.conname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=ANY($1::text[]) ORDER BY n.nspname,c.conname,definition",
    "SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=ANY($1::text[]) ORDER BY schemaname,tablename,indexname",
    "SELECT n.nspname,p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1::text[]) AND p.prokind IN ('f','p') ORDER BY n.nspname,p.proname,definition",
    "SELECT n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[]) ORDER BY n.nspname,c.relname,t.tgname",
    "SELECT e.extname,e.extversion,n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE n.nspname=ANY($1::text[]) OR n.nspname='public' ORDER BY e.extname",
  ];
  const rows=[];for(const sql of statements)rows.push((await pool.query(sql,[schemas])).rows);
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
function options(pool){return {pool,publicOrigin:entryOrigin,reporterHmacSecret:entryKey,reporterMemberEntry:entryConfig,
  oauth:createWeComWebOAuth({enabled:true,publicOrigin:entryOrigin,corpId:entryConfig.corpId,agentId:entryConfig.agentId,resolveCode:async()=>({userid:'synthetic-A'})})};}

test('YXX-42 100 authenticated sessions and 32 simultaneous PostgreSQL HTTP reads stay bounded and preserve catalog',async t=>{
  await withYxxDatabase(async({pool,seed})=>{
    const a=await seed(),before=await businessDigest(pool),catalogBefore=await catalog(pool),runtime=createYxxProfile({profile:'MEMBER_TICKET_READONLY',...options(pool)});
    const started=await runtime.start(),base='http://127.0.0.1:'+started.port,clients=[];let blocker;
    try{
      const start=performance.now(),rssBefore=process.memoryUsage().rss;
      for(let i=0;i<100;i++){const client=httpBrowser(base);await loginYxx(client,{code:'synthetic-A-capacity-'+i});clients.push(client);}
      blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM pilot_ticket.reporter_public_ref WHERE public_ref=$1 FOR UPDATE',[a.grant.public_ref]);
      const reads=clients.slice(0,32).map(c=>c.request('/api/reporter/tickets/'+a.grant.public_ref));
      const deadline=Date.now()+1000;while(pool.waitingCount<29&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));
      assert.equal(pool.waitingCount,29);assert.equal(pool.totalCount,4);
      const overload=await clients[32].request('/api/reporter/tickets/'+a.grant.public_ref);assert.equal(overload.status,503);assert.equal((await overload.json()).error.code,'YXX_ENTRY_BUSY');
      await blocker.query('ROLLBACK');blocker.release();blocker=null;
      const result=await Promise.all(reads);assert.ok(result.every(r=>r.status===200));
      assert.equal(pool.waitingCount,0);assert.ok(pool.totalCount<=4);
      assert.deepEqual(await businessDigest(pool),before);assert.equal(await catalog(pool),catalogBefore);
      const rssAfter=process.memoryUsage().rss;
      t.diagnostic('YXX_RESOURCE '+JSON.stringify({authenticated_sessions:100,concurrent_reads:32,overload_status:503,pool_peak_connections:4,
        pending_pool_after:pool.waitingCount,elapsed_ms:Math.round(performance.now()-start),rss_before_bytes:rssBefore,rss_after_bytes:rssAfter,
        catalog_unchanged:true,business_tables_unchanged:true,formal_observation:false,real_provider_calls:0}));
    }finally{if(blocker){await blocker.query('ROLLBACK');blocker.release();}await runtime.stop();}
    assert.equal((await pool.query('SELECT 1 AS n')).rows[0].n,1,'profile stop preserves its externally owned pool');
  });
});

test('YXX-45 OAUTH_ONLY is zero DB and MEMBER_TICKET_READONLY exposes no business write or staff API',async()=>{
  let dbAccess=0;const unusedPool=new Proxy({},{get(){dbAccess++;throw new Error('DB_MUST_NOT_BE_USED');}});
  const oauthOnly=createYxxProfile({profile:'OAUTH_ONLY',...options(unusedPool)});
  try{const started=await oauthOnly.start(),browser=httpBrowser('http://127.0.0.1:'+started.port);await loginYxx(browser);
    for(const path of ['/api/reporter/bootstrap','/api/tickets','/api/incidents','/workbench/'])assert.equal((await browser.request(path)).status,404);
    assert.equal(dbAccess,0);
  }finally{await oauthOnly.stop();}
  await withYxxDatabase(async({pool})=>{
    const readonly=createYxxProfile({profile:'MEMBER_TICKET_READONLY',...options(pool)});
    try{const started=await readonly.start(),browser=httpBrowser('http://127.0.0.1:'+started.port);await loginYxx(browser);
      for(const path of ['/api/tickets','/api/incidents','/workbench/','/api/tickets/123/actions'])assert.equal((await browser.request(path,{method:'POST',headers:{origin:entryOrigin},body:'{}'})).status,404);
    }finally{await readonly.stop();}
  });
});

test('YXX-33 YXX-45 FULL_SERVICE_LOOP composes the same member policy and keeps member Cookie outside staff authority',async()=>{
  await withYxxDatabase(async({pool,seed})=>{
    const a=await seed(),admin=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'synthetic-yxx-full-admin',displayName:'合成管理员',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const o=options(pool);o.oauth.close();
    const runtime=createYxxProfile({profile:'FULL_SERVICE_LOOP',pool,publicOrigin:'http://127.0.0.1',principalId:admin.id,
      reporterOrigin:entryOrigin,reporterHmacSecret:entryKey,reporterPolicy:'MEMBER_REQUIRED',reporterMemberEntry:entryConfig,
      wecomWebOAuth:{enabled:true,corpId:entryConfig.corpId,agentId:entryConfig.agentId,resolveCode:async()=>({userid:'synthetic-A'})},
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true,REPORTER_TIMELINE_ENABLED:true,WECOM_TEMPLATE_CARD_ENABLED:true},
      incidentFlags:{INCIDENT_CORRELATION_ENABLED:true},incidentBackgroundMaintenance:false});
    try{
      await runtime.start();const browser=httpBrowser('http://127.0.0.1:'+runtime.server.address().port);await loginYxx(browser);
      assert.equal((await browser.request('/api/reporter/tickets/'+a.grant.public_ref)).status,200);
      assert.equal((await browser.request('/api/reporter/access/exchange',{method:'POST',headers:{origin:entryOrigin,'content-type':'application/json'},body:JSON.stringify({grant:a.grant.token})})).status,403);
      for(const path of ['/api/tickets','/api/incidents','/api/workbench/bootstrap'])assert.equal((await browser.request(path)).status,401);
    }finally{await runtime.stop();}
    assert.throws(()=>createYxxProfile({profile:'FULL_SERVICE_LOOP',reporterPolicy:'LEGACY_BOUND_GRANT'}),{code:'YXX_ENTRY_CONFIG_INVALID'});
  });
});

test('YXX-44 actual App process stop and restart loses ephemeral authentication then restores the canonical ref',async()=>{
  await withYxxDatabase(async({databaseUrl,seed})=>{
    const a=await seed();let child;
    async function start(){
      child=fork(new URL('./helpers/p2-g2-yixiaoxiu-process-child.mjs',import.meta.url),[],{execArgv:[],env:{...minimalG2Environment(),PILOT_DATABASE_URL:databaseUrl},stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
      const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('YXX_CHILD_START_TIMEOUT')),10000);
        child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(new Error('YXX_CHILD_START_FAILED'));});child.once('message',message=>{clearTimeout(timer);resolve(message);});});
      assert.equal(ready.type,'ready');return httpBrowser('http://127.0.0.1:'+ready.port);
    }
    async function stop(){if(!child||child.exitCode!==null)return;const active=child,exit=once(active,'exit');active.send({type:'stop'});
      const timer=setTimeout(()=>active.kill(),5000);try{const [code]=await exit;assert.equal(code,0);}finally{clearTimeout(timer);child=null;}}
    try{
      const first=await start(),target='/wecom/yixiaoxiu/tickets/'+a.grant.public_ref;assert.equal(await loginYxx(first,{path:target}),target);
      assert.equal((await first.request('/api/reporter/tickets/'+a.grant.public_ref)).status,200);await stop();
      const second=await start();for(const [k,v] of first.cookies)second.cookies.set(k,v);
      assert.equal((await second.request('/api/reporter/tickets/'+a.grant.public_ref)).status,401);
      assert.equal(await loginYxx(second,{path:target,code:'synthetic-after-restart'}),target);assert.equal((await second.request('/api/reporter/tickets/'+a.grant.public_ref)).status,200);
    }finally{await stop();}
  });
});
