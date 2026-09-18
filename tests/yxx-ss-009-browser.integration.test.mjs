import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createYxxBrowserFixture} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
import {withSS009Database,closeSS009Resources} from './helpers/yxx-ss-009-resources.mjs';
import {createYxxProfile} from '../src/p2-g2-yixiaoxiu-profile.mjs';
import {createYxxDelegatedIdentityMapping} from '../src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {migrateCurrentBaselineWithYxx} from '../scripts/migrate-current-baseline.mjs';
import {g2CandidateInventory} from '../src/p2-g2-candidate.mjs';
import {g2EvidenceTime} from '../src/p2-g2-evidence-time.mjs';
import {origin,secret,flags,config,oauthOptions,browser,post} from './helpers/yxx-ss-009-http-fixture.mjs';

test('SS-009 real browser and PostgreSQL submit supplement review and original workbench share one Ticket',{timeout:180000},async t=>{
  const screenshots=[];
  await withSS009Database({testContext:t,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'ss009ui',run:async({pool,databaseUrl,observeResource})=>{
    await migrateCurrentBaselineWithYxx({databaseUrl});
    const identityMapping=await createYxxDelegatedIdentityMapping({config,accessTokenProvider:async()=> 'synthetic',fetchImpl:async()=>new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:'member-a',open_userid:'synthetic-A'},{userid:'member-b',open_userid:'synthetic-B'}]}))});
    let runtime,fixture,tab,staffRuntime,proof,primaryError=null;
    try{
      observeResource('tls_proxy_listeners',()=>fixture?.ownedResourceState().listeners??0);observeResource('tls_proxy_sockets',()=>fixture?.ownedResourceState().sockets??0);observeResource('tls_directory',()=>fixture?.ownedResourceState().tlsDirectories??0);
      observeResource('member_listener',()=>runtime?.server.listening?1:0);observeResource('staff_listener',()=>staffRuntime?.server.listening?1:0);
      observeResource('browser_process',()=>tab?.ownedResourceState().processes??0);observeResource('browser_profile',()=>tab?.ownedResourceState().profiles??0);observeResource('browser_command_timers',()=>tab?.ownedResourceState().commandTimers??0);observeResource('browser_socket',()=>tab?.ownedResourceState().sockets??0);
      fixture=await createYxxBrowserFixture({pool,createApp:({oauth,origin:publicOrigin})=>{
        runtime=createYxxProfile({pool,profile:'MEMBER_SELF_SERVICE',oauth,publicOrigin,reporterMemberEntry:config,identityMapping,reporterHmacSecret:secret,yxxSelfService:{featureFlags:flags,pollMilliseconds:100}});return runtime.server;
      }});runtime.selfService.start();tab=await fixture.launch({path:'/synthetic-start',width:390,height:844});
      await tab.evaluate("location.assign('/wecom/yixiaoxiu/')",{awaitPromise:false});await tab.waitFor("document.querySelector('#home-view')?.hidden===false");
      async function submit(text){await tab.evaluate("location.assign('/wecom/yixiaoxiu/reports/new')",{awaitPromise:false});await tab.waitFor("document.querySelector('#new-view')?.hidden===false");await tab.evaluate(`document.querySelector('#description').value=${JSON.stringify(text)};document.querySelector('#location-unknown').checked=true;document.querySelector('#submit-report').click()`);await tab.waitFor("/^\\/wecom\\/yixiaoxiu\\/reports\\/[A-Za-z0-9_-]{32}$/.test(location.pathname)");return tab.evaluate('location.pathname.split("/").at(-1)');}
      const detailsRef=await submit('系统不行');await tab.waitFor("document.querySelector('#detail-status')?.textContent.includes('补充')");
      await tab.evaluate("document.querySelector('#supplement-text').value='处方提交不了';document.querySelector('#submit-supplement').click()");
      await tab.waitFor("document.querySelector('#detail-status')?.textContent.includes('已生成工单')");
      const reviewRef=await submit('这个问题一直没处理我要投诉');await tab.waitFor("document.querySelector('#detail-status')?.textContent.includes('人工')");
      const principal=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'ss009-ui-admin',displayName:'Synthetic UI',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
      staffRuntime=createYxxProfile({pool,profile:'FULL_SERVICE_LOOP',publicOrigin:origin,reporterPolicy:'MEMBER_REQUIRED',reporterMemberEntry:config,identityMapping,reporterHmacSecret:secret,principalId:principal.id,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true,REPORTER_TIMELINE_ENABLED:true},wecomWebOAuth:oauthOptions,yxxSelfService:{featureFlags:flags}});
      const started=await staffRuntime.start(),staff=browser(staffRuntime.server,started.cookie),csrf=(await staff.request('/api/lifecycle/bootstrap')).json().csrf_token;
      const review=(await pool.query('SELECT r.id::text,r.row_version::text FROM intake.manual_review_item r JOIN intake.web_request_binding b ON b.intake_id=r.service_intake_id WHERE b.request_ref=$1',[reviewRef])).rows[0];assert.ok(review);
      const resolved=await staff.request('/api/manual-reviews/'+review.id+'/resolve',post({client_command_id:randomUUID(),expected_row_version:review.row_version,resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:'SS009_SYNTHETIC'},csrf));assert.equal(resolved.status,200,resolved.text);
      const ticket=(await pool.query('SELECT pilot_ticket_id::text AS id FROM intake.service_intake i JOIN intake.web_request_binding b ON b.intake_id=i.id WHERE b.request_ref=$1',[reviewRef])).rows[0];assert.ok(ticket.id);
      for(const action of ['queue','accept','start','resolve','confirm']){const d=(await staff.request('/api/tickets/'+ticket.id)).json();if(action==='queue'&&d.status==='QUEUED')continue;const r=await staff.request('/api/tickets/'+ticket.id+'/'+action,post({client_command_id:randomUUID(),expected_version:d.version,reason_code:'SS009_'+action.toUpperCase()},csrf));assert.equal(r.status,200,r.text);}
      await tab.evaluate('location.reload()',{awaitPromise:false});await tab.waitFor("document.querySelector('#detail-status')?.textContent.includes('关闭')");
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket')).rows[0].n,2);
      mkdirSync('tmp/ss009-ui',{recursive:true});
      for(const [width,height] of [[390,844],[1440,900]]){await tab.command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});assert.equal(await tab.evaluate('document.documentElement.scrollWidth>innerWidth'),false);const bytes=Buffer.from(await tab.screenshot(),'base64'),file='tmp/ss009-ui/'+randomUUID()+'.png';writeFileSync(file,bytes);screenshots.push({file,width,height,sha256:createHash('sha256').update(bytes).digest('hex')});}
      const storage=await tab.evaluate('JSON.stringify({local:{...localStorage},session:{...sessionStorage}})');assert.ok(!storage.includes('处方提交不了')&&!storage.includes('synthetic-A')&&!storage.includes('csrf'));
      proof={...g2EvidenceTime(),kind:'browser',status:'PASS',candidate_fingerprint:g2CandidateInventory().fingerprint,screenshots,real_pg:true,real_browser:true,tickets:2,external_network_calls:0,simulated_provider_calls:fixture.providerCalls};
    }catch(error){primaryError=error;}finally{await closeSS009Resources([()=>tab?.close(),()=>staffRuntime?.stop(),()=>runtime?.selfService.close(),()=>fixture?.close(),()=>runtime?.stop()],primaryError);}
    t.diagnostic('SS009_RECEIPT '+JSON.stringify(proof));
  }});
});
