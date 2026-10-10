import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {candidateBrowser,record,text} from './helpers/wbint-t27-browser-fixture.mjs';
test('T27 default-disabled workspace does no candidate reads or draft storage and old APIs retain their profile',async()=>{
 await candidateBrowser({purpose:'t27off',workspace:false,recovery:true},async({candidateId,browser,origin,started})=>{
  assert.deepEqual(await browser.evaluate('globalThis.__t27DomainReads'),[]);assert.deepEqual(await browser.evaluate('globalThis.__t27Posts'),[]);assert.equal(await browser.evaluate('document.querySelectorAll("[data-action=open-incident-candidates]").length'),0);
  assert.equal(await browser.evaluate("(async()=>!(await indexedDB.databases()).some(db=>db.name==='wecom-workbench-drafts-v1'))()"),true);
  const cookie=record(started.cookie),headers={cookie:text(cookie.name)+'='+text(cookie.value)};
  assert.equal((await fetch(origin+'/api/incident-candidates/'+candidateId,{headers})).status,200);
  assert.equal((await fetch(origin+'/api/incident-candidates/'+candidateId+'/commands/'+randomUUID(),{headers})).status,404);
  for(const suffix of ['incidents/candidates/'+('-'.repeat(36)),'incidents/'+('-'.repeat(36))])assert.equal((await fetch(origin+'/workbench/app/'+suffix,{headers})).status,404,'a new canonical path must contain an actual UUID');
 });
});
