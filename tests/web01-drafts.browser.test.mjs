import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

async function reload(browser){const previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'`);}

test('same-profile internal note draft is restored after refresh using current server authority',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets})=>{
    let browser,error;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+tickets[5].ticket.id+'?detail=page',width:1920,height:1080,cookies:[browserCookies[0]]});
      await browser.waitFor("Boolean(document.querySelector('[aria-label=\"内部备注\"]'))");
      await browser.evaluate("(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'T03 refresh synthetic private note');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
      // Wait on the public durable-save feedback; the original memory-only form has no recoverable copy.
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('已保存恢复副本')");
      await reload(browser);
      await browser.waitFor("document.querySelector('textarea')?.value==='T03 refresh synthetic private note'");
      assert.equal(await browser.evaluate("document.querySelector('.ticket-command-version').textContent"),'工单版本 2');
      assert.equal(await browser.evaluate("document.querySelector('[data-action=save-internal-note]').disabled"),false);
    }catch(failure){error=failure;try{console.log('T03_REFRESH_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate("({text:document.body.innerText})"):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});

test('expired unknown payload and key are purged while the original opaque operation remains read-only until its receipt is checked',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets})=>{
    const ticketId=tickets[5].ticket.id;let browser,error;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+ticketId+'?detail=page',width:900,height:900,cookies:[browserCookies[0]]});
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");
      await browser.evaluate("(()=>{const original=globalThis.fetch;globalThis.__t03Commands=[];globalThis.fetch=(path,options)=>{if(String(path).endsWith('/internal-notes'))globalThis.__t03Commands.push(JSON.parse(options.body));return original(path,options);};const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'T03 expired unknown synthetic private note');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('已保存恢复副本')");
      await browser.evaluate("document.querySelector('[data-action=save-internal-note]').click()");
      await browser.waitFor("document.querySelector('.ticket-note-state')?.textContent.includes('结果未知')");
      const original=await browser.evaluate('globalThis.__t03Commands[0]');
      const storage=await browser.evaluate("(async()=>{const record=await new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,read=db.transaction('drafts').objectStore('drafts').getAll();read.onsuccess=()=>{db.close();resolve(read.result[0]);};};});let exportError=null;try{await crypto.subtle.exportKey('raw',record.key);}catch(error){exportError=error.name;}return {extractable:record.key.extractable,exportError,algorithm:record.key.algorithm,cipherBytes:record.ciphertext.byteLength,hasPlainCanary:JSON.stringify(record).includes('T03 expired unknown synthetic private note'),ttl:record.expiresAt-record.firstSavedAt};})()");
      assert.equal(storage.extractable,false);assert.equal(storage.exportError,'InvalidAccessError');assert.deepEqual(storage.algorithm,{name:'AES-GCM',length:256});assert.equal(storage.hasPlainCanary,false);assert.equal(storage.ttl,86400000);assert.ok(storage.cipherBytes>16&&storage.cipherBytes<=16400);
      await browser.command('Page.enable');
      await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const now=Date.now;Date.now=()=>now()+86400001;globalThis.__t03Commands=[];const original=globalThis.fetch;globalThis.fetch=(path,options)=>{if(String(path).endsWith('/internal-notes'))globalThis.__t03Commands.push(JSON.parse(options.body));return original(path,options);};})()"});
      await reload(browser);
      await browser.waitFor("Boolean(document.querySelector('[data-action=check-expired-note]'))&&document.body.innerText.includes('草稿已过期')");
      assert.equal(await browser.evaluate("document.querySelector('textarea').value"),'');assert.equal(await browser.evaluate("document.querySelector('[data-action=save-internal-note]').disabled"),true);
      const retained=await browser.evaluate("new Promise((resolve,reject)=>{const open=indexedDB.open('wecom-workbench-drafts-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['drafts','operations']),drafts=tx.objectStore('drafts').getAll(),operations=tx.objectStore('operations').getAll();tx.oncomplete=()=>{db.close();resolve({draftCount:drafts.result.length,operations:operations.result});};};})");
      assert.equal(retained.draftCount,0);assert.equal(retained.operations.length,1);assert.equal(retained.operations[0].commandId,original.client_command_id);assert.equal(JSON.stringify(retained).includes(original.note),false);
      await browser.evaluate("document.querySelector('[data-action=check-expired-note]').click()");
      await browser.waitFor("document.querySelector('.ticket-note-state')?.textContent.includes('已核对原操作结果')");
      assert.equal(await browser.evaluate('globalThis.__t03Commands.length'),0);
      assert.equal(await browser.evaluate(`fetch('/api/tickets/${ticketId}/events').then(r=>r.json()).then(v=>v.items.filter(e=>e.event_type==='ticket.note_added').length)`),1);
    }catch(failure){error=failure;try{console.log('T03_EXPIRY_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate("({text:document.body.innerText,commandCount:globalThis.__t03Commands?.length})"):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true,dropInternalNoteResponses:true});
});

test('unknown internal note submission survives refresh with the immutable original command and no automatic resend',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets,restoreInternalNoteResponses})=>{
    const ticketId=tickets[5].ticket.id;let browser,error;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+ticketId+'?detail=page',width:1920,height:1080,cookies:[browserCookies[0]]});
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");
      await browser.evaluate("(()=>{const original=globalThis.fetch;globalThis.__t03Commands=[];globalThis.fetch=(path,options)=>{if(String(path).endsWith('/internal-notes'))globalThis.__t03Commands.push(JSON.parse(options.body));return original(path,options);};const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,' T03 unknown synthetic private note ');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('已保存恢复副本')");
      await browser.evaluate("document.querySelector('[data-action=save-internal-note]').click()");
      await browser.waitFor("document.querySelector('.ticket-note-state')?.textContent.includes('结果未知')");
      const original=await browser.evaluate('globalThis.__t03Commands[0]');
      assert.equal(original.expected_version,2);assert.equal(original.note,'T03 unknown synthetic private note');
      await browser.command('Page.enable');
      await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{globalThis.__t03Commands=[];const original=globalThis.fetch;globalThis.fetch=(path,options)=>{if(String(path).endsWith('/internal-notes'))globalThis.__t03Commands.push(JSON.parse(options.body));return original(path,options);};})()"});
      await reload(browser);
      await browser.waitFor("document.querySelector('.ticket-note-state')?.textContent.includes('结果未知')&&Boolean(document.querySelector('[data-action=check-internal-note]'))");
      assert.equal(await browser.evaluate("document.querySelector('textarea').value"),' T03 unknown synthetic private note ');
      assert.equal(await browser.evaluate("document.querySelector('textarea').disabled"),true);
      assert.equal(await browser.evaluate('globalThis.__t03Commands.length'),0);
      restoreInternalNoteResponses();
      await browser.evaluate("document.querySelector('[data-action=check-internal-note]').click()");
      await browser.waitFor("document.querySelector('.ticket-note-state')?.textContent.includes('已保存')");
      assert.deepEqual(await browser.evaluate('globalThis.__t03Commands'),[original]);
      assert.equal(await browser.evaluate(`fetch('/api/tickets/${ticketId}/events').then(r=>r.json()).then(v=>v.items.filter(e=>e.event_type==='ticket.note_added').length)`),1);
      assert.equal(await browser.evaluate("document.querySelector('textarea').value"),'');
    }catch(failure){error=failure;try{console.log('T03_UNKNOWN_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate("({text:document.body.innerText,commandCount:globalThis.__t03Commands?.length})"):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true,dropInternalNoteResponses:true});
});
