import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createP2012Runtime} from '../src/p2-012-workbench-assembly.mjs';
import {migrateP2012} from '../scripts/p2-012-migrate.mjs';
import {withP2012Database,applyThrough031,fixtureP2012,assertNoP2012Residual} from './helpers/p2-012-postgres-harness.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

test('T27 explicitly enabled formal workspace reads an authorized candidate from the actual production bundle',async()=>{
  await withP2012Database({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'t27browser',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});
    const f=await fixtureP2012(pool,{reporters:3}),candidate=await f.newCandidate();
    const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
    const origin='http://127.0.0.1:'+port,runtime=createP2012Runtime({pool,principalId:f.admin.id,publicOrigin:origin,listenPort:port,
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true},incidentBackgroundMaintenance:false,incidentCandidateWorkspaceEnabled:true,externalSendEnabled:false});
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);let browser,error;const screenshots=[];
    const capture=async()=>{const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-detail-1920.png');await writeFile(file,bytes);screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
    try{
      const started=await runtime.start();
      browser=await launchSystemBrowser({url:origin+'/workbench/app/',width:1920,height:1080,cookies:[started.cookie]});
      await browser.waitFor('document.querySelector(".page-title h1")?.textContent==="团队工作台"');
      assert.equal(await browser.evaluate('document.querySelectorAll("aside [data-action=open-incident-candidates]").length'),1,'the enabled workspace must be reachable in the formal Shell');
      await browser.evaluate('document.querySelector("aside [data-action=open-incident-candidates]").click()');
      await browser.waitFor(`document.querySelectorAll('[data-candidate-id="${candidate.id}"]').length===1`);
      assert.equal(await browser.evaluate('location.pathname'),'/workbench/app/incidents/candidates');
      assert.match(await browser.evaluate('document.querySelector(".workspace").innerText'),/当前加载|已加载/u);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
      await capture();console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',incident_candidate_workspace:true,screenshots}));
    }catch(failure){error=failure;if(browser){await capture();await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,url:location.href})')));console.log('T27_FAILURE_DIRECTORY '+directory);}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);}],error);
  }});await assertNoP2012Residual({databaseUrl:process.env.PILOT_DATABASE_URL});
});
