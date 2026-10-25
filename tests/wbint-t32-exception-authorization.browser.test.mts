import assert from 'node:assert/strict';
import {test} from 'node:test';
import {t32Browser} from './helpers/t32-notification-exception-browser-fixture.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {t32Record,t32Text} from './helpers/t32-notification-exception-fixture.mjs';
import {randomUUID} from 'node:crypto';
test('T32 production bundle discards a delayed item response and clears only the lost object scope',{timeout:240000},async()=>{
 await t32Browser('t32-late-and-object-loss',async f=>{const {browser,seed,capture}=f;await browser.waitFor('document.querySelectorAll("[data-exception-row]").length===3');
 const ids=await browser.evaluate('Array.from(document.querySelectorAll("[data-exception-row]")).map(r=>r.dataset.deliveryId)');assert.ok(Array.isArray(ids));const first=t32Text(ids[0]),second=t32Text(ids[1]);
 await browser.evaluate(`(()=>{const send=fetch;globalThis.__t32Held=false;globalThis.fetch=async(path,options)=>{const response=await send(path,options);if(String(path).endsWith('/${first}')){globalThis.__t32Held=true;await new Promise(resolve=>globalThis.__t32Release=resolve);}return response;};})()`);
 await browser.evaluate('document.querySelectorAll("[data-action=open-exception]")[0].click()');await browser.waitFor('globalThis.__t32Held===true');await browser.evaluate('document.querySelectorAll("[data-action=open-exception]")[1].click()');await browser.waitFor(`document.querySelector('[data-exception-detail]')?.dataset.deliveryId===${JSON.stringify(second)}`);await browser.evaluate('globalThis.__t32Release()');await browser.waitFor(`document.querySelector('[data-exception-detail]')?.dataset.deliveryId===${JSON.stringify(second)}`);
 // Current legitimate staff session remains; object VIEW is removed in the same real DB authority.
 const session=(await f.get('/api/conversations/'+seed.sessionId)).body;
 assert.equal((await f.post('/api/conversations/'+seed.sessionId+'/release',{client_command_id:randomUUID(),expected_row_version:t32Record(session.session).row_version,reason_code:'WORKBENCH_RELEASE'})).status,200);
 const current=await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'T32仍有效职员',roles:['HANDLER'],resolverTeamIds:[]});assert.equal(current.id,f.principals[0]?.id);
 assert.equal((await f.get('/api/lifecycle/bootstrap')).status,200);assert.equal((await f.get('/api/conversations/'+seed.sessionId)).status,404);
 await browser.evaluate('document.querySelectorAll("[data-action=open-exception]")[2].click()');await browser.waitFor('document.body.innerText.includes("旧异常副本已停止展示")');assert.equal(await browser.evaluate('document.querySelectorAll("[data-exception-row]").length'),0);assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-exception-detail]"))'),false);assert.equal(await browser.evaluate('document.body.innerText.includes("会话已失效")'),false);assert.equal(await browser.evaluate('fetch("/api/lifecycle/bootstrap").then(r=>r.status)'),200);await capture('object-loss');
 await browser.evaluate('document.querySelector("[data-action=reload-exceptions]").click()');await browser.waitFor('document.body.innerText.includes("当前筛选内没有可读取的异常")');assert.equal(await browser.evaluate('document.body.innerText.includes("会话已失效")'),false);assert.equal(await browser.evaluate('globalThis.__t32Posts'),0);assert.equal(seed.senderCalls(),3);
 const reads=await browser.evaluate('globalThis.__t32Reads');assert.ok(Array.isArray(reads));assert.ok(reads.map(t32Record).some(r=>r.status===404&&String(r.path).includes('/session/')));
 },3);
});
