import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withT36BoundReplyFixture} from './helpers/t36-bound-reply-fixture.mjs';
import {withT36Browser,input,openReply,closeReply} from './helpers/t36-browser-risk-journey.mjs';
import {yxxTab} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
test('T36 an unsent encrypted r2 reply never restores as r3 after r2 retention expires',{timeout:240000},()=>withT36BoundReplyFixture(async f=>{
 await withT36Browser(f,async(browser,capture)=>{await openReply(browser,f.r2);const privateText='T36_ONLY_ORIGINAL_R2_UNSENT_BODY';await input(browser,'[data-supplement-bound-reply] textarea',privateText);await browser.waitFor('document.querySelector("[data-conversation-draft=messages]")?.textContent.includes("已保存")');await closeReply(browser);
  const r3=await f.appendR3();await f.expire(f.r2);await browser.evaluate('document.querySelector("[data-action=refresh-supplement-follow-up]").click()');await openReply(browser,r3);await browser.waitFor('document.querySelector("[data-conversation-draft=messages]")?.textContent.includes("草稿")||document.querySelector("[data-conversation-draft=messages]")?.textContent.includes("恢复")');await capture();
  assert.equal(await browser.evaluate('document.querySelector("[data-supplement-bound-reply] textarea").value'),'','r2 body must not be decrypted or retargeted under the authorized r3 context');assert.equal(await browser.evaluate('globalThis.__t36Risk.filter(row=>row.method==="POST").length'),0);
 });
},{recovery:true}));

test('T36 a peer receipt clears the old bound reply identity on the original page',{timeout:240000},()=>withT36BoundReplyFixture(async f=>{
 await withT36Browser(f,async browser=>{
  let tab:Awaited<ReturnType<typeof yxxTab>>|undefined;
  try{
   await openReply(browser,f.r2);await input(browser,'[data-supplement-bound-reply] textarea','T36 peer receipt clears bound identity');
   await browser.waitFor('document.querySelector("[data-conversation-draft=messages]")?.textContent.includes("草稿已保存")');
   await browser.evaluate("(()=>{const send=fetch;fetch=async(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/messages')){const response=await send(path,options);return new Promise(resolve=>{globalThis.__releaseBoundReply=()=>resolve(response);});}return send(path,options);};})()");
   await browser.evaluate('document.querySelector("[data-supplement-bound-reply] [data-action=send-conversation-reply]").click()');await browser.waitFor('typeof globalThis.__releaseBoundReply==="function"');
   tab=await yxxTab(browser,f.origin+'/workbench/app/items/ticket/'+f.ticketId+'?detail=page');
   const row='[data-supplement-source-ref="'+f.r2.source_ref+'"][data-supplement-revision="'+f.r2.revision+'"]';
   await tab.waitFor('Boolean(document.querySelector('+JSON.stringify(row)+')?.querySelector("[data-action=reply-supplement]"))');
   await tab.evaluate('document.querySelector('+JSON.stringify(row)+').querySelector("[data-action=reply-supplement]").click()');
   await tab.waitFor('document.querySelector("[data-supplement-bound-reply] [data-action=check-messages]")?.disabled===false');
   await tab.evaluate('document.querySelector("[data-supplement-bound-reply] [data-action=check-messages]").click()');
   await browser.waitFor('document.querySelector("[data-supplement-bound-reply] textarea")?.disabled===false&&!document.querySelector("[data-supplement-bound-reply] [data-action=check-messages]")');
   await browser.evaluate('globalThis.__releaseBoundReply()');
   assert.equal(await browser.evaluate('document.querySelector("[data-supplement-bound-reply] textarea")?.disabled'),false);
  }finally{await tab?.close();}
 });
},{recovery:true}));
