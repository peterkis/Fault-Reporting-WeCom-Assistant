import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { createPilotTicketCore } from '../src/p1-005-pilot-ticket-core.mjs';
import { appendTicketEvent } from '../src/p1-006-ticket-state-actions.mjs';
import { createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { createP2016Runtime } from '../src/p2-016-runtime.mjs';
import { transactionP2016 } from '../src/p2-016-domain-contracts.mjs';
import { seedPersistedIntake } from './helpers/p2-015-postgres-harness.mjs';
import { withP2016IsolatedDatabase,applyThrough030 } from './helpers/p2-016-postgres-harness.mjs';
import { migrateP2016 } from '../scripts/p2-016-migrate.mjs';
import { launchSystemBrowser,closeBrowserTestResources } from './helpers/p2-006-browser-harness.mjs';
for(const [width,height] of [[1440,900],[390,844]])test('Reporter browser '+width+'x'+height+' real DB/session, fragment removal, refresh, timezone, safe data and logout',{timeout:90000},async()=>{
  await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'p2016browser',run:async({pool,databaseUrl})=>{
    await applyThrough030({pool,databaseUrl});await migrateP2016({databaseUrl});
    const principal=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'synthetic-reporter-test-admin',displayName:'合成管理员',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const listenPort=probe.address().port;await new Promise(r=>probe.close(r));
    const origin='http://127.0.0.1:'+listenPort,runtime=createP2016Runtime({pool,principalId:principal.id,publicOrigin:origin,listenPort,
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true,REPORTER_TIMELINE_ENABLED:true,WECOM_TEMPLATE_CARD_ENABLED:true},
      ticketNotificationAdditionalEvents:['ticket.created'],
      allowLocalHttp:true,reporterHmacSecret:'synthetic-only-reporter-browser-secret-32bytes'});
    const intake=await seedPersistedIntake({pool,text:'<img src=x onerror=window.reporter_xss=1> patient-test 10.0.0.2',requestType:'INCIDENT',status:'RECEIVED'});
    const ticket=(await createPilotTicketCore({pool}).createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'synthetic-browser'})).ticket;
    const notification=await transactionP2016(pool,async tx=>{const event=await appendTicketEvent({transaction:tx,ticket,eventType:'ticket.created',actor:{type:'SYSTEM',id:null},traceId:'synthetic-browser'});return runtime.notifications.project({transaction:tx,ticket,event});});
    const grant=await runtime.reporterAccess.deliveryGrant({deliveryId:notification.delivery_id});let browser,primaryError=null;
    try{
      await runtime.start();browser=await launchSystemBrowser({url:origin+'/reporter/open#grant='+grant.token,width,height,redirectPaths:['/reporter/']});
      async function reloadReporter(predicate){
        await browser.evaluate("document.documentElement.dataset.reporterReloading='1';location.reload()",{awaitPromise:false});
        await browser.waitFor("!document.documentElement.dataset.reporterReloading && document.readyState==='complete' && ("+predicate+")");
      }
      await browser.waitFor("document.querySelector('#ticket').hidden===false");
      assert.equal(await browser.evaluate('location.hash'),'');assert.equal(await browser.evaluate('location.pathname'),'/reporter/');
      assert.equal(await browser.evaluate('localStorage.length+sessionStorage.length'),0);assert.equal(await browser.evaluate('document.cookie.includes("p2016_reporter")'),false);
      const visible=await browser.evaluate('document.body.textContent');assert.ok(visible.includes(ticket.ticket_no));assert.doesNotMatch(visible,/patient-test|10\.0\.0\.2|user-test|<img/u);assert.ok(!visible.includes(ticket.id));assert.ok(!visible.includes(grant.token));
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
      const times=await browser.evaluate('document.querySelector("#times").textContent');
      for(const zone of ['Asia/Shanghai','UTC','America/New_York']){await browser.setTimezone(zone);await reloadReporter("document.querySelector('#ticket')?.hidden===false && document.querySelector('#times')?.textContent.length>0");assert.equal(await browser.evaluate('document.querySelector("#times").textContent'),times);}
      const denied=await fetch(origin+'/api/reporter/access/exchange',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.token})});assert.equal(denied.status,401);
      const csrf=await fetch(origin+'/api/reporter/logout',{method:'POST',headers:{origin:'https://attacker.invalid','content-type':'application/json'},body:'{}'});assert.equal(csrf.status,403);
      await browser.evaluate('document.querySelector("#logout").click()');await browser.waitFor("document.querySelector('#status').textContent==='已退出访问。'");
      await reloadReporter("document.querySelector('#status')?.textContent.includes('访问已失效')");
      if(width===1440){
        const before=await browser.evaluate("performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/reporter/')).map(e=>e.name)");
        assert.equal(before.some(url=>url.includes('/access/exchange')),false,'reload after logout must not replay a consumed Grant');
        await new Promise(resolve=>setTimeout(resolve,5500));
        const after=await browser.evaluate("performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/reporter/')).map(e=>e.name)");
        assert.deepEqual(after,before,'401 stops polling and produces no further exchange/logout POST');
        assert.equal(await browser.evaluate('location.hash'), '');
        assert.equal(await browser.evaluate('localStorage.length+sessionStorage.length'),0);
      }
    }catch(error){primaryError=error;}finally{await closeBrowserTestResources([()=>browser?.close(),()=>runtime.stop()],primaryError);}
  }});
});
