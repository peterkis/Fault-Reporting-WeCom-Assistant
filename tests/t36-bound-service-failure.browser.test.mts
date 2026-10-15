import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withT36BoundReplyFixture} from './helpers/t36-bound-reply-fixture.mjs';
import {withT36Browser,input,openReply} from './helpers/t36-browser-risk-journey.mjs';
test('T36 a real binding schema failure is service-unavailable, rolls back Message and preserves the unknown reply',{timeout:240000},()=>withT36BoundReplyFixture(async f=>{
 await withT36Browser(f,async(browser,capture)=>{await openReply(browser,f.r2);const text='T36_STILL_AUTHORIZED_REPLY_TECHNICAL_FAILURE';await input(browser,'[data-supplement-bound-reply] textarea',text);await browser.evaluate('globalThis.__t36PausePosts=true;document.querySelector("[data-action=send-conversation-reply]").click()');await browser.waitFor('Boolean(globalThis.__t36Resume)');
  await f.pool.query('ALTER TABLE pilot_ticket.workbench_supplement_reply_binding DROP CONSTRAINT supplement_reply_source_kind');await browser.evaluate('globalThis.__t36Resume()');await browser.waitFor('globalThis.__t36Risk.some(row=>row.method==="POST"&&row.path.endsWith("/messages"))');await capture();
  const rows=await browser.evaluate('globalThis.__t36Risk.filter(row=>row.method==="POST"&&row.path.endsWith("/messages"))') as {status:number}[];console.log('T36_BOUND_TECHNICAL_POST '+JSON.stringify(rows));assert.equal(rows[0]?.status,503,'current actor and material remain authorized; a failed schema guard cannot be a purpose revocation');
  assert.equal(await browser.evaluate('document.querySelector("[data-supplement-bound-reply] textarea")?.value'),text);assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-action=check-messages]"))'),true);
  const body=await browser.evaluate('globalThis.__t36PostedBody') as {client_command_id:string};const facts=await f.pool.query<{n:string}>('SELECT count(*)::text AS n FROM communication.message WHERE client_command_id=$1::uuid',[body.client_command_id]);assert.equal(facts.rows[0]?.n,'0');assert.equal(rows.length,1);
 });
}));
