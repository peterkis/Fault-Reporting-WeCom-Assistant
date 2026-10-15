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

test('T27 formal canonical candidate requires explicit lawful decisions and returns one independent Incident',async()=>{
  await withP2012Database({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'t27detail',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});
    const f=await fixtureP2012(pool,{reporters:3}),candidate=await f.newCandidate(),version='9007199254740993';
    await pool.query('UPDATE incident.candidate_review SET row_version=$2::bigint WHERE id=$1::uuid',[candidate.id,version]);
    const personal=(await pool.query('SELECT id::text,status,version FROM pilot_ticket.ticket ORDER BY id')).rows;
    const events=(await pool.query('SELECT count(*)::integer AS count FROM pilot_ticket.ticket_event')).rows[0].count;
    const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
    const origin='http://127.0.0.1:'+port,runtime=createP2012Runtime({pool,principalId:f.admin.id,publicOrigin:origin,listenPort:port,
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true},incidentBackgroundMaintenance:false,incidentCandidateWorkspaceEnabled:true,externalSendEnabled:false});
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);let browser,error;const screenshots=[];
    const capture=async()=>{const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-detail-1920.png');await writeFile(file,bytes);screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
    const root=`article[data-candidate-id="${candidate.id}"]`;
    const select=async(label,value)=>browser.evaluate(`(()=>{const control=document.querySelector(${JSON.stringify(root)}).querySelector(${JSON.stringify('select[aria-label="'+label+'"]')});if(!control)throw Error('MISSING_SELECT');control.value=${JSON.stringify(value)};control.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    try{
      const started=await runtime.start();browser=await launchSystemBrowser({url:origin+'/workbench/app/',width:1920,height:1080,cookies:[started.cookie]});
      await browser.waitFor('document.querySelector(".page-title h1")?.textContent==="团队工作台"');
      await browser.command('Page.navigate',{url:origin+'/workbench/app/incidents/candidates/'+candidate.id});
      await browser.waitFor('document.querySelector(".entry-state")?.innerText.includes("页面不存在") || Boolean(document.querySelector("article[data-candidate-id] [data-action=refresh-candidate]"))');
      assert.equal(await browser.evaluate(`document.querySelectorAll(${JSON.stringify(root)}).length`),1,'the canonical candidate must render independently of a Ticket or Manual Review route');
      await browser.waitFor(`document.querySelector(${JSON.stringify(root)})?.innerText.includes(${JSON.stringify(version)})`);
      assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(root)}).querySelectorAll('select[aria-label="人工决定"]').length`),1,'the current permitted decisions require an explicit human control');
      assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(root)}).querySelector('select[aria-label="人工决定"]').value`),'');
      assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(root)}).querySelector('[data-action=submit-candidate]').disabled`),true);
      assert.equal(await browser.evaluate(`document.querySelectorAll(${JSON.stringify(root+' input[data-report-ref]:checked')}).length`),0);
      assert.match(await browser.evaluate(`document.querySelector(${JSON.stringify(root)}).innerText`),/获权来源总数[：:]?\s*3/u);
      await select('人工决定','START_REVIEW');await select('决定原因','OPERATOR_REVIEWED');
      await browser.evaluate(`document.querySelector(${JSON.stringify(root)}).querySelector('[data-action=submit-candidate]').click()`);
      await browser.waitFor(`document.querySelector(${JSON.stringify(root)})?.innerText.includes(${JSON.stringify((BigInt(version)+1n).toString())})`);
      assert.equal((await pool.query('SELECT status,row_version::text FROM incident.candidate_review WHERE id=$1::uuid',[candidate.id])).rows[0].status,'UNDER_REVIEW');
      await select('人工决定','CONFIRM_INCIDENT');await select('决定原因','CONFIRMED_SHARED_FAULT');
      for(const label of ['确认范围','故障负责人','责任组','主工单'])assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(root)}).querySelector('select[aria-label="${label}"]').value`),'');
      assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(root)}).querySelector('[data-action=submit-candidate]').disabled`),true);
      await select('确认范围','LOCAL');await select('故障负责人',f.handler.id);await select('责任组','PILOT_IT');
      for(const report of f.reports.slice(0,2))await browser.evaluate(`document.querySelector(${JSON.stringify(root)}).querySelector('input[data-report-ref="${report.decisionId}"]').click()`);
      assert.equal(await browser.evaluate(`Array.from(document.querySelector(${JSON.stringify(root)}).querySelector('select[aria-label="主工单"]').options).some(option=>option.value===${JSON.stringify(f.reports[2].ticketId)})`),false);
      await select('主工单','NONE');await browser.evaluate(`document.querySelector(${JSON.stringify(root)}).querySelector('[data-action=submit-candidate]').click()`);
      await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(root)})?.querySelector('[data-result-ref]'))`);
      const resultId=await browser.evaluate(`document.querySelector(${JSON.stringify(root)}).querySelector('[data-result-ref]').getAttribute('data-result-ref')`);
      await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(root)})?.querySelector('[data-incident-id="'+${JSON.stringify(resultId)}+'"]'))`);
      const incident=(await pool.query('SELECT id::text,owner_principal_id::text,owner_team_id,primary_ticket_id FROM incident.incident')).rows;
      assert.equal(incident.length,1);assert.equal(incident[0].id,resultId);assert.equal(incident[0].owner_principal_id,f.handler.id);assert.equal(incident[0].owner_team_id,'PILOT_IT');assert.equal(incident[0].primary_ticket_id,null);
      assert.equal((await pool.query('SELECT count(*)::integer AS count FROM incident.incident_report')).rows[0].count,2);
      assert.deepEqual((await pool.query('SELECT id::text,status,version FROM pilot_ticket.ticket ORDER BY id')).rows,personal);
      assert.equal((await pool.query('SELECT count(*)::integer AS count FROM pilot_ticket.ticket_event')).rows[0].count,events);
      for(const table of ['communication.message','communication.outbox','communication.delivery'])assert.equal((await pool.query('SELECT count(*)::integer AS count FROM '+table)).rows[0].count,0);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
      await capture();console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',candidate_detail_and_decisions:true,screenshots}));
    }catch(failure){error=failure;try{if(browser){await capture();await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,url:location.href})')));console.log('T27_FAILURE_DIRECTORY '+directory);}}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);}],error);
  }});await assertNoP2012Residual({databaseUrl:process.env.PILOT_DATABASE_URL});
});
