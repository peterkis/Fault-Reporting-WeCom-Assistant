import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {yxxTab} from './helpers/p2-g2-yixiaoxiu-browser.mjs';

async function type(browser,text){await browser.evaluate(`(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function saved(browser){await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('已保存恢复副本')");}
async function reload(browser){const previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'`);}
const counts="new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['drafts','operations']),drafts=tx.objectStore('drafts').count(),operations=tx.objectStore('operations').count();tx.oncomplete=()=>{db.close();resolve({drafts:drafts.result,operations:operations.result});};};})";

test('discard clears the same-profile copy and fences a second tab delayed native encryption from resurrecting it',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets})=>{
    const path='/workbench/app/items/ticket/'+tickets[5].ticket.id+'?detail=page';let browser,tab,error;
    try{
      browser=await launchSystemBrowser({url:origin+path,width:900,height:900,cookies:[browserCookies[0]]});
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");
      await type(browser,'T03 discard synthetic note');await saved(browser);
      tab=await yxxTab(browser,origin+path);await tab.waitFor("document.querySelector('textarea')?.value==='T03 discard synthetic note'");
      await tab.evaluate("(()=>{const encrypt=crypto.subtle.encrypt.bind(crypto.subtle);crypto.subtle.encrypt=(...args)=>new Promise(resolve=>{globalThis.__releaseEncryption=()=>encrypt(...args).then(resolve);});})()");
      await type(tab,'T03 delayed copy must never resurrect');await tab.waitFor('typeof globalThis.__releaseEncryption===\'function\'');
      await browser.waitFor("Boolean(document.querySelector('[data-action=discard-note-draft]'))");
      await browser.evaluate("document.querySelector('[data-action=discard-note-draft]').click()");
      await tab.waitFor("document.querySelector('textarea')?.value===''");
      await tab.evaluate('globalThis.__releaseEncryption()');
      await tab.waitFor("!document.querySelector('[data-draft-status]')?.textContent.includes('正在保存')");
      assert.deepEqual(await browser.evaluate(counts),{drafts:0,operations:0});
      await reload(browser);await browser.waitFor("Boolean(document.querySelector('textarea'))");assert.equal(await browser.evaluate("document.querySelector('textarea').value"),'');
      await tab.close();tab=null;
    }catch(failure){error=failure;console.log('T03_DISCARD_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText})'):{}));}
    await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});
