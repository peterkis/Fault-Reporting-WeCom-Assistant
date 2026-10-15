import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {yxxTab} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
async function type(browser,text){await browser.evaluate(`(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function reload(browser){const previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'`);}
async function ready(browser){await browser.waitFor("Boolean(document.querySelector('textarea'))&&!document.querySelector('[data-draft-status]').textContent.includes('正在')");}
async function saved(browser){await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('已保存恢复副本')");}

test('same-profile account and purpose isolation and a separate native browser profile never restore another scope copy',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets,principals})=>{
    let browser,error;const path=origin+'/workbench/app/items/ticket/'+tickets[5].ticket.id+'?detail=page';
    try{
      browser=await launchSystemBrowser({url:path,width:900,height:900,cookies:[browserCookies[0]]});await ready(browser);await type(browser,'T03 account A private copy');await saved(browser);
      await browser.command('Network.deleteCookies',{name:browserCookies[0].name,url:origin});await browser.command('Network.setCookies',{cookies:[browserCookies[2]]});await reload(browser);await ready(browser);assert.equal(await browser.evaluate(`fetch('/api/lifecycle/bootstrap').then(r=>r.json()).then(v=>v.principal_id===${JSON.stringify(principals[1].id)})`),true);assert.equal(await browser.evaluate("document.querySelector('textarea').value"),'');await type(browser,'T03 account B independent copy');await saved(browser);
      await browser.command('Network.deleteCookies',{name:browserCookies[2].name,url:origin});await browser.command('Network.setCookies',{cookies:[browserCookies[0]]});await reload(browser);await browser.waitFor("document.querySelector('textarea')?.value==='T03 account A private copy'");
      await browser.evaluate("new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),read=store.getAll();read.onsuccess=()=>{const row=read.result.find(row=>row.principal==="+JSON.stringify(principals[0].id)+");store.delete(row.scope);row.purpose='different-purpose';row.scope=JSON.stringify([row.principal,row.kind,row.id,row.purpose]);store.put(row);};tx.oncomplete=()=>{db.close();resolve();};};})");
      await reload(browser);await ready(browser);assert.equal(await browser.evaluate("document.querySelector('textarea').value"),'');
      await browser.close();assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});browser=null;
      browser=await launchSystemBrowser({url:path,width:900,height:900,cookies:[browserCookies[0]]});await ready(browser);assert.equal(await browser.evaluate("document.querySelector('textarea').value"),'');
    }catch(failure){error=failure;try{console.log('T03_SCOPE_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText})'):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});

test('late original decryption and confirmed receipt preserve newer unsent input and never resend the recovered command automatically',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets})=>{
    const path=origin+'/workbench/app/items/ticket/'+tickets[5].ticket.id+'?detail=page';let browser,tab,error;
    try{
      browser=await launchSystemBrowser({url:path,width:900,height:900,cookies:[browserCookies[0]]});await ready(browser);await type(browser,'T03 original unknown input');await saved(browser);await browser.evaluate("document.querySelector('[data-action=save-internal-note]').click()");await browser.waitFor("document.querySelector('.ticket-note-state')?.textContent.includes('结果未知')");
      tab=await yxxTab(browser,'about:blank');await tab.command('Page.enable');await tab.command('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{globalThis.__notePosts=0;const fetchOriginal=fetch;globalThis.fetch=(path,init)=>{if(String(path).endsWith('/internal-notes'))globalThis.__notePosts++;return fetchOriginal(path,init);};const decrypt=crypto.subtle.decrypt.bind(crypto.subtle);crypto.subtle.decrypt=(...args)=>new Promise(resolve=>{globalThis.__releaseDecrypt=()=>decrypt(...args).then(resolve);});})()"});await tab.command('Page.navigate',{url:path});
      await tab.waitFor("Boolean(document.querySelector('textarea'))&&typeof globalThis.__releaseDecrypt==='function'");await type(tab,'T03 newer unsent input must survive');await tab.evaluate('globalThis.__releaseDecrypt()');await tab.waitFor("Boolean(document.querySelector('[data-action=check-expired-note]'))");assert.equal(await tab.evaluate("document.querySelector('textarea').value"),'T03 newer unsent input must survive');assert.equal(await tab.evaluate('globalThis.__notePosts'),0);
      await tab.evaluate("document.querySelector('[data-action=check-expired-note]').click()");await tab.waitFor("document.querySelector('.ticket-note-state')?.textContent.includes('已核对原操作结果')");assert.equal(await tab.evaluate("document.querySelector('textarea').value"),'T03 newer unsent input must survive');assert.equal(await tab.evaluate('globalThis.__notePosts'),0);
      await tab.close();tab=null;
    }catch(failure){error=failure;console.log('T03_LATE_DIAGNOSTIC '+JSON.stringify(tab?await tab.evaluate('({text:document.body.innerText})'):{}));}
    await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true,dropInternalNoteResponses:true});
});

test('missing receipt after expired unknown transport remains UNKNOWN with its original opaque ID and zero new POSTs',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets})=>{
    let browser,error;try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+tickets[5].ticket.id+'?detail=page',width:600,height:950,cookies:[browserCookies[0]]});await ready(browser);await type(browser,'T03 unknown original may not have reached server');await saved(browser);
      await browser.evaluate("(()=>{const original=fetch;globalThis.fetch=(path,init)=>String(path).endsWith('/internal-notes')?Promise.reject(new TypeError('synthetic transport unavailable')):original(path,init);document.querySelector('[data-action=save-internal-note]').click();})()");await browser.waitFor("document.querySelector('.ticket-note-state')?.textContent.includes('结果未知')");
      const readIds="new Promise(resolve=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onsuccess=()=>{const db=request.result,tx=db.transaction('operations'),read=tx.objectStore('operations').getAll();tx.oncomplete=()=>{db.close();resolve(read.result.map(row=>row.commandId));};};})";const original=await browser.evaluate(readIds);
      await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const now=Date.now;Date.now=()=>now()+86400001;globalThis.__notePosts=0;const original=fetch;globalThis.fetch=(path,init)=>{if(String(path).endsWith('/internal-notes'))globalThis.__notePosts++;return original(path,init);};})()"});await reload(browser);await browser.waitFor("Boolean(document.querySelector('[data-action=check-expired-note]'))");await browser.evaluate("document.querySelector('[data-action=check-expired-note]').click()");await browser.waitFor("document.querySelector('.ticket-note-state')?.textContent.includes('结果仍未知')");assert.equal(await browser.evaluate("document.querySelector('textarea').disabled"),true);assert.equal(await browser.evaluate('globalThis.__notePosts'),0);assert.deepEqual(await browser.evaluate(readIds),original);assert.equal(await browser.evaluate(`fetch('/api/tickets/${tickets[5].ticket.id}/events').then(r=>r.json()).then(v=>v.items.filter(e=>e.event_type==='ticket.note_added').length)`),0);
    }catch(failure){error=failure;try{console.log('T03_MISSING_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText})'):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});
