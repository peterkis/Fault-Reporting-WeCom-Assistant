import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {yxxTab} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
import {readFile} from 'node:fs/promises';

async function type(browser,text){await browser.evaluate(`(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function saved(browser){await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿已保存')");}
async function reload(browser){const previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'`);}
const counts="new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['drafts','operations']),drafts=tx.objectStore('drafts').count(),operations=tx.objectStore('operations').count();tx.oncomplete=()=>{db.close();resolve({drafts:drafts.result,operations:operations.result});};};})";

test('a competing note started during preparation preserves this page\'s unsent text',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets})=>{
    const path='/workbench/app/items/ticket/'+tickets[5].ticket.id+'?detail=page';let browser,tab,error;
    try{
      browser=await launchSystemBrowser({url:origin+path,width:1280,height:900,cookies:[browserCookies[0]]});
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");await type(browser,'T03 shared base');await saved(browser);
      tab=await yxxTab(browser,origin+path);await tab.waitFor("document.querySelector('#internal-note')?.value==='T03 shared base'");
      await browser.evaluate("(()=>{const timer=window.setTimeout;globalThis.__restoreRaceTimer=()=>{window.setTimeout=timer;};window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);const encrypt=crypto.subtle.encrypt.bind(crypto.subtle);crypto.subtle.encrypt=(...args)=>new Promise((resolve,reject)=>{globalThis.__releaseRaceEncryption=()=>encrypt(...args).then(resolve,reject);});const send=fetch;globalThis.__racePosts=0;fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes'))globalThis.__racePosts++;return send(path,options);};})()");
      await type(browser,'T03 independent pending preparation');await browser.evaluate("document.querySelector('[data-action=save-internal-note]').click()");await browser.waitFor('typeof globalThis.__releaseRaceEncryption==="function"');
      await tab.evaluate("(()=>{const send=fetch;fetch=(path,options)=>options?.method==='POST'&&String(path).endsWith('/internal-notes')?new Promise(()=>{}):send(path,options);})()");
      await tab.evaluate("document.querySelector('[data-action=save-internal-note]').click()");await browser.waitFor("Boolean(document.querySelector('[data-action=check-expired-note]'))");
      assert.equal(await browser.evaluate("document.querySelector('#internal-note').value"),'T03 independent pending preparation');assert.equal(await browser.evaluate('globalThis.__racePosts'),0);
      await browser.evaluate('globalThis.__releaseRaceEncryption();globalThis.__restoreRaceTimer()');
    }catch(failure){error=failure;}
    await closeBrowserTestResources([async()=>{await browser?.evaluate('globalThis.__releaseRaceEncryption?.();globalThis.__restoreRaceTimer?.()');await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});

for(const expired of [false,true])test('an empty observer checking a failed peer note '+(expired?'clears the expired opaque operation':'preserves the peer\'s stored text'),async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets,principals})=>{
    const ticketId=tickets[5].ticket.id,path='/workbench/app/items/ticket/'+ticketId+'?detail=page';let browser,tab,error;
    try{
      browser=await launchSystemBrowser({url:origin+path,width:1280,height:900,cookies:[browserCookies[0]]});await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");
      tab=await yxxTab(browser,origin+path);await tab.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");
      await type(tab,'T03 failed peer note to keep');await saved(tab);
      await tab.evaluate("(()=>{const send=fetch;fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes')){globalThis.__failedPeerCommand=JSON.parse(options.body);return new Promise(()=>{});}return send(path,options);};})()");
      await tab.evaluate("document.querySelector('[data-action=save-internal-note]').click()");await tab.waitFor('Boolean(globalThis.__failedPeerCommand?.client_command_id)');await browser.waitFor("Boolean(document.querySelector('[data-action=check-expired-note]'))");
      assert.equal(await browser.evaluate("document.querySelector('#internal-note').value"),'');const command=await tab.evaluate('globalThis.__failedPeerCommand');
      if(expired){const manifest=JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')),recovery='/workbench/app/'+manifest['src/feedback-recovery.ts'].file,scope={principal:principals[0].id,kind:'ticket',id:ticketId,purpose:'internal-note'};await tab.evaluate(`(async()=>{const store=await import(${JSON.stringify(recovery)}),copy=await store.openDraft(${JSON.stringify(scope)});await store.removeSensitiveDraft(copy.handle,'expired');})()`);await browser.waitFor("Boolean(document.querySelector('[data-action=check-expired-note]'))");}
      await browser.evaluate(`(()=>{const read=fetch;fetch=(path,options)=>String(path).endsWith('/internal-notes/commands/${command.client_command_id}')?Promise.resolve(Response.json({ticket_id:${JSON.stringify(ticketId)},client_command_id:${JSON.stringify(command.client_command_id)},state:'FAILED',error:{code:'P2_016_VERSION_CONFLICT',retryable:false}})):read(path,options);})()`);
      await browser.evaluate("document.querySelector('[data-action=check-expired-note]').click()");await browser.waitFor(`(async()=>{const c=await (${counts});return c.operations===0;})()`);
      assert.deepEqual(await browser.evaluate(counts),{drafts:expired?0:1,operations:0});if(!expired){await reload(browser);await browser.waitFor("document.querySelector('#internal-note')?.value==='T03 failed peer note to keep'");}
    }catch(failure){error=failure;}
    await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});

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
    }catch(failure){error=failure;try{console.log('T03_DISCARD_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText})'):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});

test('a different tab finishing its note preserves and restores this tab\'s unsaved input',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets})=>{
    const path='/workbench/app/items/ticket/'+tickets[5].ticket.id+'?detail=page';let browser,tab,error;
    try{
      browser=await launchSystemBrowser({url:origin+path,width:1280,height:900,cookies:[browserCookies[0]]});
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");
      await type(browser,'T03 shared saved note');await saved(browser);
      tab=await yxxTab(browser,origin+path);await tab.waitFor("document.querySelector('#internal-note')?.value==='T03 shared saved note'");
      await browser.evaluate("(()=>{const timer=window.setTimeout;globalThis.__restoreTimer=()=>{window.setTimeout=timer;};window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);})()");
      await type(browser,'T03 independent unsaved note');
      await tab.evaluate("(()=>{const send=fetch;fetch=async(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes')){const response=await send(path,options);return new Promise(resolve=>{globalThis.__releaseNote=()=>resolve(response);});}return send(path,options);};})()");
      await tab.evaluate("document.querySelector('[data-action=save-internal-note]').click()");
      await browser.waitFor("Boolean(document.querySelector('[data-action=check-expired-note]'))");
      assert.equal(await browser.evaluate("document.querySelector('#internal-note').value"),'T03 independent unsaved note');
      await tab.waitFor('typeof globalThis.__releaseNote==="function"');await browser.evaluate('globalThis.__restoreTimer()');await tab.evaluate('globalThis.__releaseNote()');
      await browser.waitFor("document.querySelector('#internal-note')?.disabled===false&&document.querySelector('#internal-note')?.value==='T03 independent unsaved note'");
      await saved(browser);assert.deepEqual(await browser.evaluate(counts),{drafts:1,operations:0});
      await reload(browser);await browser.waitFor("document.querySelector('#internal-note')?.value==='T03 independent unsaved note'");
    }catch(failure){error=failure;try{console.log('T03_RETAIN_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText})'):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});

test('a different tab\'s refused note does not let this tab overwrite its retained draft',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets})=>{
    const path='/workbench/app/items/ticket/'+tickets[5].ticket.id+'?detail=page';let browser,tab,error;
    try{
      browser=await launchSystemBrowser({url:origin+path,width:1280,height:900,cookies:[browserCookies[0]]});
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");
      await type(browser,'T03 other page saved note');await saved(browser);
      tab=await yxxTab(browser,origin+path);await tab.waitFor("document.querySelector('#internal-note')?.value==='T03 other page saved note'");
      await browser.evaluate("(()=>{const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);})()");
      await type(browser,'T03 local unsaved note');
      await tab.evaluate("(()=>{const send=fetch;fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes'))return new Promise(resolve=>{globalThis.__rejectNote=()=>resolve(Response.json({error:{code:'P2_016_VERSION_CONFLICT'}},{status:409}));});return send(path,options);};})()");
      await tab.evaluate("document.querySelector('[data-action=save-internal-note]').click()");
      await browser.waitFor("Boolean(document.querySelector('[data-action=check-expired-note]'))");
      await tab.waitFor('typeof globalThis.__rejectNote==="function"');await tab.evaluate('globalThis.__rejectNote()');
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('另一页面仍有草稿')");
      assert.equal(await browser.evaluate("document.querySelector('#internal-note').value"),'T03 local unsaved note');
      assert.equal(await browser.evaluate("document.querySelector('#internal-note').disabled"),false);
      assert.equal(await browser.evaluate("document.querySelector('[data-action=save-internal-note]').disabled"),true);
      await browser.evaluate("document.querySelector('[data-action=discard-note-draft]').click()");
      await browser.waitFor("document.querySelector('#internal-note')?.value===''");assert.deepEqual(await browser.evaluate(counts),{drafts:1,operations:0});
      await reload(browser);await browser.waitFor("document.querySelector('#internal-note')?.value==='T03 other page saved note'");
    }catch(failure){error=failure;try{console.log('T03_RETAIN_CONFLICT_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText})'):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});

test('checking another tab\'s failed note keeps both pages\' independent input',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets})=>{
    const ticketId=tickets[5].ticket.id,path='/workbench/app/items/ticket/'+ticketId+'?detail=page';let browser,tab,error;
    try{
      browser=await launchSystemBrowser({url:origin+path,width:1280,height:900,cookies:[browserCookies[0]]});
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");
      await type(browser,'T03 other original note');await saved(browser);
      tab=await yxxTab(browser,origin+path);await tab.waitFor("document.querySelector('#internal-note')?.value==='T03 other original note'");
      await browser.evaluate("(()=>{const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);})()");
      await type(browser,'T03 independent local input');
      await tab.evaluate("(()=>{const send=fetch;fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes')){globalThis.__heldCommand=JSON.parse(options.body);return new Promise(()=>{});}return send(path,options);};})()");
      await tab.evaluate("document.querySelector('[data-action=save-internal-note]').click()");
      await tab.waitFor('Boolean(globalThis.__heldCommand?.client_command_id)');await browser.waitFor("Boolean(document.querySelector('[data-action=check-expired-note]'))");
      const command=await tab.evaluate('globalThis.__heldCommand');
      await browser.evaluate(`(()=>{const read=fetch;fetch=(path,options)=>String(path).endsWith('/internal-notes/commands/${command.client_command_id}')?Promise.resolve(Response.json({ticket_id:${JSON.stringify(ticketId)},client_command_id:${JSON.stringify(command.client_command_id)},state:'FAILED',error:{code:'P2_016_VERSION_CONFLICT',retryable:false}})):read(path,options);})()`);
      await browser.evaluate("document.querySelector('[data-action=check-expired-note]').click()");
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('另一页面仍有草稿')");
      assert.equal(await browser.evaluate("document.querySelector('#internal-note').value"),'T03 independent local input');
      assert.equal(await browser.evaluate("document.querySelector('[data-action=save-internal-note]').disabled"),true);
      await browser.evaluate("document.querySelector('[data-action=discard-note-draft]').click()");await browser.waitFor("document.querySelector('#internal-note')?.value===''");
      await reload(browser);await browser.waitFor("document.querySelector('#internal-note')?.value==='T03 other original note'");
      assert.deepEqual(await browser.evaluate(counts),{drafts:1,operations:0});
    }catch(failure){error=failure;try{console.log('T03_CHECK_OTHER_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText})'):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});

test('a peer discarding its failed draft does not discard this tab\'s independent input',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets})=>{
    const path='/workbench/app/items/ticket/'+tickets[5].ticket.id+'?detail=page';let browser,tab,error;
    try{
      browser=await launchSystemBrowser({url:origin+path,width:1280,height:900,cookies:[browserCookies[0]]});
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");
      await type(browser,'T03 peer draft');await saved(browser);
      tab=await yxxTab(browser,origin+path);await tab.waitFor("document.querySelector('#internal-note')?.value==='T03 peer draft'");
      await browser.evaluate("(()=>{const timer=window.setTimeout;globalThis.__restoreTimer=()=>{window.setTimeout=timer;};window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);})()");
      await type(browser,'T03 input kept after peer discards');
      await tab.evaluate("(()=>{const send=fetch;fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes'))return new Promise(resolve=>{globalThis.__rejectNote=()=>resolve(Response.json({error:{code:'P2_016_VERSION_CONFLICT'}},{status:409}));});return send(path,options);};})()");
      await tab.evaluate("document.querySelector('[data-action=save-internal-note]').click()");await browser.waitFor("Boolean(document.querySelector('[data-action=check-expired-note]'))");
      await tab.waitFor('typeof globalThis.__rejectNote==="function"');await tab.evaluate('globalThis.__rejectNote()');
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('另一页面仍有草稿')");
      await type(browser,'T03 later edit while peer draft remains');
      await browser.evaluate("(()=>{const read=fetch;let held=false;fetch=(path,options)=>{if(!held&&String(path)==='/api/lifecycle/bootstrap'){held=true;return new Promise((resolve,reject)=>{globalThis.__releaseRetainedAuthority=()=>read(path,options).then(resolve,reject);});}return read(path,options);};})()");
      await browser.evaluate('globalThis.__restoreTimer()');await tab.evaluate("document.querySelector('[data-action=discard-note-draft]').click()");
      await browser.waitFor('typeof globalThis.__releaseRetainedAuthority==="function"');
      await type(browser,'T03 latest edit during authority');
      await browser.evaluate("(()=>{const encrypt=crypto.subtle.encrypt.bind(crypto.subtle);let held=false;crypto.subtle.encrypt=(...args)=>{if(held)return encrypt(...args);held=true;return new Promise((resolve,reject)=>{globalThis.__releaseRetainedEncryption=()=>encrypt(...args).then(resolve,reject);});};})()");
      await browser.evaluate('globalThis.__releaseRetainedAuthority()');await browser.waitFor('typeof globalThis.__releaseRetainedEncryption==="function"');
      await type(browser,'T03 latest edit during encryption');await browser.evaluate('globalThis.__releaseRetainedEncryption()');
      await browser.waitFor("document.querySelector('#internal-note')?.value==='T03 latest edit during encryption'&&document.querySelector('[data-draft-status]')?.textContent.includes('草稿已保存')");
      assert.deepEqual(await browser.evaluate(counts),{drafts:1,operations:0});await reload(browser);
      await browser.waitFor("document.querySelector('#internal-note')?.value==='T03 latest edit during encryption'");
    }catch(failure){error=failure;try{console.log('T03_PEER_DISCARD_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText})'):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});

test('a peer finishing its note unlocks a page with no independent input',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets})=>{
    const path='/workbench/app/items/ticket/'+tickets[5].ticket.id+'?detail=page';let browser,tab,error;
    try{
      browser=await launchSystemBrowser({url:origin+path,width:1280,height:900,cookies:[browserCookies[0]]});
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");
      tab=await yxxTab(browser,origin+path);await tab.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");
      await type(tab,'T03 peer owns this note');await saved(tab);
      await tab.evaluate("(()=>{const send=fetch;fetch=async(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes')){const response=await send(path,options);return new Promise(resolve=>{globalThis.__releaseNote=()=>resolve(response);});}return send(path,options);};})()");
      await tab.evaluate("document.querySelector('[data-action=save-internal-note]').click()");await tab.waitFor('typeof globalThis.__releaseNote==="function"');
      await browser.waitFor("Boolean(document.querySelector('[data-action=check-expired-note]'))");
      await tab.evaluate('globalThis.__releaseNote()');
      await browser.waitFor("document.querySelector('#internal-note')?.disabled===false&&!document.querySelector('[data-action=check-expired-note]')");
      assert.equal(await browser.evaluate("document.querySelector('#internal-note').value"),'');
    }catch(failure){error=failure;}
    await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});

test('clearing independent input during a shared conflict does not restore the old text',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets})=>{
    const path='/workbench/app/items/ticket/'+tickets[5].ticket.id+'?detail=page';let browser,tab,error;
    try{
      browser=await launchSystemBrowser({url:origin+path,width:1280,height:900,cookies:[browserCookies[0]]});
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");await type(browser,'T03 peer original');await saved(browser);
      tab=await yxxTab(browser,origin+path);await tab.waitFor("document.querySelector('#internal-note')?.value==='T03 peer original'");
      await browser.evaluate("(()=>{const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);})()");await type(browser,'T03 local text to clear');
      await tab.evaluate("(()=>{const send=fetch;fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes'))return new Promise(resolve=>{globalThis.__rejectNote=()=>resolve(Response.json({error:{code:'P2_016_VERSION_CONFLICT'}},{status:409}));});return send(path,options);};})()");
      await tab.evaluate("document.querySelector('[data-action=save-internal-note]').click()");await tab.waitFor('typeof globalThis.__rejectNote==="function"');await browser.waitFor("Boolean(document.querySelector('[data-action=check-expired-note]'))");await tab.evaluate('globalThis.__rejectNote()');
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('另一页面仍有草稿')");await type(browser,'');
      await tab.evaluate("document.querySelector('[data-action=discard-note-draft]').click()");
      await browser.waitFor("document.querySelector('#internal-note')?.value===''&&document.querySelector('[data-draft-status]')?.textContent.includes('草稿已保存')");
      await reload(browser);await browser.waitFor("document.querySelector('#internal-note')?.value===''&&document.querySelector('#internal-note')?.disabled===false");
    }catch(failure){error=failure;}
    await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});

test('a delayed ticket note failure cannot replace a newer peer operation',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets})=>{
    const ticketId=tickets[5].ticket.id,path='/workbench/app/items/ticket/'+ticketId+'?detail=page';let browser,tab,error;
    try{
      browser=await launchSystemBrowser({url:origin+path,width:1280,height:900,cookies:[browserCookies[0]]});
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");await type(browser,'T03 original pending note');await saved(browser);
      await browser.evaluate("(()=>{const send=fetch;fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes'))return new Promise(resolve=>{globalThis.__rejectFirst=()=>resolve(Response.json({error:{code:'P2_016_VERSION_CONFLICT'}},{status:409}));});return send(path,options);};})()");
      await browser.evaluate("document.querySelector('[data-action=save-internal-note]').click()");await browser.waitFor('typeof globalThis.__rejectFirst==="function"');
      tab=await yxxTab(browser,origin+path);await tab.waitFor("[...document.querySelectorAll('button')].some(button=>button.textContent==='重新提交')");
      await tab.evaluate("(()=>{const send=fetch;let count=0;fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes')){count++;if(count===1)return Promise.resolve(Response.json({error:{code:'P2_016_VERSION_CONFLICT'}},{status:409}));globalThis.__newCommand=JSON.parse(options.body);return new Promise(resolve=>{globalThis.__rejectNew=()=>resolve(Response.json({error:{code:'P2_016_VERSION_CONFLICT'}},{status:409}));});}return send(path,options);};})()");
      await tab.evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='重新提交').click()");await tab.waitFor("document.querySelector('#internal-note')?.disabled===false");
      await browser.evaluate("(()=>{globalThis.__peerEvents=[];globalThis.__peerChannel=new BroadcastChannel('wecom-workbench-drafts-v1');globalThis.__peerChannel.onmessage=event=>globalThis.__peerEvents.push(event.data);})()");
      await type(tab,'T03 newer peer note');await saved(tab);await tab.evaluate("document.querySelector('[data-action=save-internal-note]').click()");await tab.waitFor('Boolean(globalThis.__newCommand?.client_command_id)');
      const newId=await tab.evaluate('globalThis.__newCommand.client_command_id');await browser.waitFor(`globalThis.__peerEvents.some(event=>event.reason==='released'&&event.id===${JSON.stringify(ticketId)})&&Boolean(document.querySelector('[data-action=check-expired-note]'))`);
      await browser.evaluate('globalThis.__rejectFirst()');
      await browser.evaluate(`(()=>{const read=fetch;fetch=(path,options)=>{const url=String(path);if(url.includes('/internal-notes/commands/')){globalThis.__checkedId=url.split('/').at(-1);return Promise.resolve(Response.json({ticket_id:${JSON.stringify(ticketId)},client_command_id:globalThis.__checkedId,state:'UNKNOWN'}));}return read(path,options);};})()`);
      await browser.waitFor("document.querySelector('[data-action=check-expired-note]')?.disabled===false");await browser.evaluate("document.querySelector('[data-action=check-expired-note]').click()");
      await browser.waitFor('Boolean(globalThis.__checkedId)');assert.equal(await browser.evaluate('globalThis.__checkedId'),newId);
    }catch(failure){error=failure;}
    await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.evaluate('globalThis.__peerChannel?.close()');await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});

test('checking a committed peer note rechecks write authority before retaining local input',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets})=>{
    const ticketId=tickets[5].ticket.id,path='/workbench/app/items/ticket/'+ticketId+'?detail=page';let browser,tab,error;
    try{
      browser=await launchSystemBrowser({url:origin+path,width:1280,height:900,cookies:[browserCookies[0]]});
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");
      await type(browser,'T03 peer committed note');await saved(browser);
      tab=await yxxTab(browser,origin+path);await tab.waitFor("document.querySelector('#internal-note')?.value==='T03 peer committed note'");
      await browser.evaluate("(()=>{const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);})()");
      await type(browser,'T03 must not save after write loss');
      await tab.evaluate("(()=>{const send=fetch;fetch=async(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes')){const response=await send(path,options);return new Promise(resolve=>{globalThis.__releaseNote=()=>resolve(response);});}return send(path,options);};})()");
      await tab.evaluate("document.querySelector('[data-action=save-internal-note]').click()");await tab.waitFor('typeof globalThis.__releaseNote==="function"');
      await browser.waitFor("Boolean(document.querySelector('[data-action=check-expired-note]'))");
      await browser.evaluate(`(()=>{const read=fetch;fetch=async(path,options)=>{const response=await read(path,options);if((options?.method??'GET')==='GET'&&new URL(String(path),location.href).pathname===${JSON.stringify('/api/tickets/'+ticketId)}&&response.ok){const body=await response.json();return Response.json({...body,allowed_actions:body.allowed_actions.filter(action=>action!=='add-note')});}return response;};})()`);
      await browser.evaluate("document.querySelector('[data-action=check-expired-note]').click()");
      await browser.waitFor(`(async()=>{const state=await (${counts});return state.drafts===0&&state.operations===0;})()`);
      await browser.waitFor("!document.querySelector('#internal-note')||document.querySelector('#internal-note').value===''");
      assert.equal(await browser.evaluate(`fetch(${JSON.stringify('/api/tickets/'+ticketId)}).then(response=>response.status)`),200,'Ticket READ remains available');
    }catch(failure){error=failure;try{console.log('T03_RETAIN_AUTH_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText})'):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});
