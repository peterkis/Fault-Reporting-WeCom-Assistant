import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixtureP2012} from './helpers/p2-012-postgres-harness.mjs';
import {withYxxDatabase,entryConfig,entryKey,entryOrigin,listenYxx,stopYxx,httpBrowser,loginYxx,businessDigest} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {createP2012WorkbenchExtension} from '../src/p2-012-workbench-assembly.mjs';
import {createWeComWebOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import {createYxxReadonlyServer} from '../src/p2-g2-yixiaoxiu-server.mjs';
import {textHashP2016,transactionP2016} from '../src/p2-016-domain-contracts.mjs';

test('YXX-38 member-safe Incident milestones disappear on unlink without changing the other reporter facts',async()=>{
  await withYxxDatabase(async({pool,access})=>{
    const f=await fixtureP2012(pool,{reporters:2}),refs=[];
    for(let i=0;i<2;i++)refs.push(await transactionP2016(pool,tx=>access.ensurePublicRefInTransaction({transaction:tx,ticketId:f.reports[i].ticketId,
      reporterBindingHash:textHashP2016(JSON.stringify(['WECOM_AIBOT','bot-test','synthetic-reporter-'+i]))})));
    const extension=createP2012WorkbenchExtension({pool,featureFlags:{INCIDENT_CORRELATION_ENABLED:true},backgroundMaintenance:false});
    const authContext={principal_id:f.admin.id},candidate=await f.newCandidate(),service=extension.commands;
    assert.equal((await service.perform({authContext,command:{action:'START_REVIEW',candidate_review_id:candidate.id,expected_row_version:'1',client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED'}})).ok,true);
    const confirmed=await service.perform({authContext,command:{action:'CONFIRM_INCIDENT',candidate_review_id:candidate.id,expected_candidate_version:'2',client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED',confirmed_scope:'LOCAL',owner_principal_id:f.admin.id,selected_report_refs:f.reports.map(r=>r.decisionId)}});assert.equal(confirmed.ok,true);
    const oauth=createWeComWebOAuth({enabled:true,corpId:entryConfig.corpId,agentId:entryConfig.agentId,publicOrigin:entryOrigin,resolveCode:async code=>({userid:code.endsWith('-other')?'synthetic-reporter-0':'synthetic-reporter-1'})});
    const server=createYxxReadonlyServer({pool,oauth,publicOrigin:entryOrigin,reporterMemberEntry:entryConfig,reporterHmacSecret:entryKey}),base=await listenYxx(server),browser=httpBrowser(base),other=httpBrowser(base);
    const path='/api/reporter/tickets/'+refs[1].public_ref,otherPath='/api/reporter/tickets/'+refs[0].public_ref;
    try{
      await loginYxx(browser);await loginYxx(other,{code:'synthetic-other'});
      const beforeRead=await businessDigest(pool),response=await browser.request(path),body=await response.json(),etag=response.headers.get('etag');
      assert.equal(body.incident_milestones.length,1);assert.equal((await browser.request(otherPath)).status,404);
      assert.deepEqual(await businessDigest(pool),beforeRead);
      const reports=(await extension.query.children({authContext,id:confirmed.result_ref_id,part:'reports'})).items;
      const selected=reports.find(r=>r.ticket_id===f.reports[1].ticketId);assert.ok(selected);
      const unlinked=await service.perform({authContext,command:{action:'UNLINK_REPORT',incident_id:confirmed.result_ref_id,expected_row_version:'1',incident_report_id:selected.id,expected_report_version:selected.row_version,client_command_id:randomUUID(),reason_code:'INCORRECT_ASSOCIATION'}});assert.equal(unlinked.ok,true);
      const afterMutation=await businessDigest(pool),changed=await browser.request(path,{headers:{'if-none-match':etag}});assert.equal(changed.status,200);assert.deepEqual((await changed.json()).incident_milestones,[]);
      assert.equal((await (await other.request(otherPath)).json()).incident_milestones.length,1);assert.deepEqual(await businessDigest(pool),afterMutation);
      assert.doesNotMatch(JSON.stringify(body),/synthetic-reporter|reporter_identity_hash|subscription_id|owner_principal_id|source_decision_id/u);
    }finally{await stopYxx(server);}
  });
});
