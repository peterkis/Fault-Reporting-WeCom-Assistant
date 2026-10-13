import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {t30Browser} from './helpers/t30-internal-note-browser-fixture.mjs';
import {t30Http,record,text} from './helpers/t30-internal-note-fixture.mjs';

test('T30 recovery disabled retains the original lost-ACK receipt identity after lawful CLOSED without replay',async()=>{
  await t30Browser('t30norecovery',async({browser,incidentId,get,post,put})=>{
    const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);assert.equal(bootstrap.body.incident_internal_notes_enabled,true);assert.equal(bootstrap.body.incident_internal_note_draft_recovery_enabled,false);
    assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-internal-note-draft]"))'),false);
    await browser.evaluate("(()=>{const send=fetch;globalThis.__t30Original=null;globalThis.__t30Writes=0;globalThis.__t30ReceiptReads=[];globalThis.fetch=async(path,options)=>{const url=String(path);if(options?.method==='POST'&&url.endsWith('/internal-notes')){globalThis.__t30Writes++;globalThis.__t30Original=JSON.parse(options.body);const response=await send(path,options);await response.arrayBuffer();throw new TypeError('SYNTHETIC_ACK_LOSS_AFTER_REAL_COMMIT');}if(url.includes('/commands/'))globalThis.__t30ReceiptReads.push(url);return send(path,options);};})()");
    await put('合成恢复关闭分支，真实提交后仅丢 ACK');await browser.waitFor('document.querySelector("[data-action=submit-internal-note]")?.disabled===false');await browser.evaluate('document.querySelector("[data-action=submit-internal-note]").click()');await browser.waitFor('document.querySelector("[data-internal-note-outcome]")?.textContent.includes("结果未知")');
    const original=record(await browser.evaluate('globalThis.__t30Original')),id=text(original.client_command_id),path='/api/incidents/'+incidentId;assert.equal(original.expected_row_version,'1');assert.equal((await get(path+'/commands/'+id)).body.state,'COMMITTED');
    for(const [action,version,reason] of [['start-investigating','2','OPERATOR_REVIEWED'],['resolve','3','RECOVERY_CONFIRMED'],['close','4','RECOVERY_CONFIRMED']])assert.equal((await post(path+'/'+action,{client_command_id:randomUUID(),expected_row_version:version,reason_code:reason})).status,200);
    await browser.evaluate('document.querySelector("[data-action=refresh-incident]").click()');await browser.waitFor(`document.querySelector('[data-incident-id="${incidentId}"]')?.textContent.includes('CLOSED')`);await browser.waitFor('document.querySelector("[data-internal-note-outcome]")?.textContent.includes("公共故障已关闭")');
    assert.equal(await browser.evaluate('Boolean(document.querySelector("textarea[aria-label=内部处置记录]"))'),false);
    assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-action=check-internal-note-operation]"))'),true,'CLOSED must retain explicit receipt lookup even when recovery storage was disabled');
    assert.equal(await browser.evaluate(`document.querySelector('[aria-label="内部处置记录"]')?.textContent.includes(${JSON.stringify('原操作 UUID：'+id+'；原提交版本：1')})`),true,'receipt lookup uses the original UUID and submitted version, never the current parent version');
    await browser.evaluate('document.querySelector("[data-action=check-internal-note-operation]").click()');await browser.waitFor('document.querySelector("[data-internal-note-outcome]")?.textContent.includes("已提交")');
    assert.equal(await browser.evaluate('globalThis.__t30Writes'),1);assert.deepEqual(await browser.evaluate('globalThis.__t30ReceiptReads'),[path+'/commands/'+id]);
    const page=(await get(path+'/internal-notes')).body;assert.ok(Array.isArray(page.items));assert.equal(page.items.length,1);assert.equal(record(page.items[0]).text,original.text);assert.equal(record(page.items[0]).incident_row_version,'2');assert.equal((await get(path)).body.row_version,'5');
  },{recovery:false});
});

test('T30 HTTP fixture retains its primary failure alongside an owned cleanup failure after real stop',async()=>{
  const primary=new Error('SYNTHETIC_T30_PRIMARY'),cleanup=new Error('SYNTHETIC_T30_CLEANUP_AFTER_REAL_STOP');
  await assert.rejects(t30Http({purpose:'t30cleanupfailure'},async({runtime})=>{
    const stop=runtime.stop.bind(runtime);runtime.stop=async()=>{await stop();throw cleanup;};throw primary;
  }),error=>error instanceof AggregateError&&error.errors.length===2&&error.errors[0]===primary&&error.errors[1]===cleanup);
});
