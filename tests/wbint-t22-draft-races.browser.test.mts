import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {withT22Fixture} from './helpers/wbint-t22-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {yxxTab} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type Surface=Pick<Browser,'evaluate'|'waitFor'>;
const ready="document.querySelectorAll('[data-conversation-draft]').length===2&&Array.from(document.querySelectorAll('[data-conversation-draft]')).every(e=>e.textContent.includes('草稿仅在当前浏览器'))";
const input=(purpose:string,value:string)=>`(()=>{const input=document.querySelector('textarea[data-purpose="${purpose}"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`;
async function saved(surface:Surface,purpose='internal-notes'){await surface.waitFor(`document.querySelector('[data-conversation-draft="${purpose}"]').textContent.includes('已保存恢复副本')`);}
function snapshot(principal:string,id:string){const scope=JSON.stringify([principal,'conversation',id,'conversation-note']);return `new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1',2);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['drafts','operations'],'readonly'),record=tx.objectStore('drafts').get(${JSON.stringify(scope)}),operation=tx.objectStore('operations').get(${JSON.stringify(scope)});tx.oncomplete=()=>{resolve({revision:record.result?.revision??null,operation:operation.result?.commandId??null});db.close();};};})`;}
async function reload(browser:Browser){const before=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${before}&&document.readyState==='complete'`);}
const holdNextAuthority="(()=>{const original=fetch;globalThis.__holdNextAuthority=true;globalThis.__authorityHeld=0;globalThis.fetch=(path,init)=>{if(String(path)==='/api/lifecycle/bootstrap'&&globalThis.__holdNextAuthority){globalThis.__holdNextAuthority=false;globalThis.__authorityHeld++;return new Promise((resolve,reject)=>{globalThis.__releaseAuthority=()=>original(path,init).then(resolve,reject);});}return original(path,init);};})()";
const holdBlankAuthority="(()=>{const original=fetch;globalThis.__holdNextAuthority=false;globalThis.__authorityHeld=0;globalThis.fetch=(path,init)=>{if(String(path)==='/api/lifecycle/bootstrap'&&globalThis.__holdNextAuthority){globalThis.__holdNextAuthority=false;globalThis.__authorityHeld++;return new Promise((resolve,reject)=>{globalThis.__releaseAuthority=()=>original(path,init).then(resolve,reject);});}return original(path,init).then(response=>{if(String(path).endsWith('/messages')&&init?.method==='POST'&&response.status===202)globalThis.__holdNextAuthority=true;return response;});};})()";
async function settleReply(browser:Browser,text:string){await browser.evaluate(input('messages',text));await saved(browser,'messages');await browser.evaluate("document.querySelector('[data-action=send-conversation-reply]').click()");await browser.waitFor("document.querySelector('[data-reply-outcome]').textContent.includes('已受理发送')");}

// Real browser edits use the encrypted store; role changes use the existing Access Port.
test('a newer tab real saved revision defeats a delayed stale writer and its freshly authorized rebase',async()=>{
 await withT22Fixture(async({origin,browserCookie,pool,runtime,sessions,principals})=>{
  const session=sessions[0],principal=principals[0];assert.ok(session);assert.ok(principal);const path=origin+'/workbench/app/conversations/'+session.id,directory=join(tmpdir(),'web01-ui-'+randomUUID());let browser:Browser|undefined,tab:Awaited<ReturnType<typeof yxxTab>>|undefined,failure:unknown,bootstrapReads=0;
  runtime.server.on('request',request=>{if(request.method==='GET'&&request.url==='/api/lifecycle/bootstrap')bootstrapReads++;});
  try{browser=await launchSystemBrowser({url:path,width:900,height:900,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);await browser.waitFor(ready);await browser.evaluate(input('internal-notes','T22 original note row'));await saved(browser);
   tab=await yxxTab(browser,path);await tab.waitFor("document.querySelector('textarea[data-purpose=internal-notes]')?.value==='T22 original note row'");
   await browser.evaluate("(()=>{const encrypt=crypto.subtle.encrypt.bind(crypto.subtle);crypto.subtle.encrypt=(...args)=>new Promise((resolve,reject)=>{globalThis.__releaseEncryption=()=>encrypt(...args).then(resolve,reject);});})()");
   await browser.evaluate(input('internal-notes','T22 stale writer must not overwrite'));await browser.waitFor("typeof globalThis.__releaseEncryption==='function'");
   await tab.evaluate(input('internal-notes','T22 newer tab owns this saved row'));await saved(tab);const newer=await tab.evaluate(snapshot(principal.id,session.id)) as {revision:string|null;operation:string|null};assert.ok(newer.revision);const readsBefore=bootstrapReads;
   await browser.evaluate('globalThis.__releaseEncryption()');await browser.waitFor("document.querySelector('[data-conversation-draft=internal-notes]').textContent.includes('恢复不可用')");
   assert.ok(bootstrapReads>readsBefore,'STALE_WRITE_FRESH_AUTHORITY_BRANCH');assert.deepEqual(await tab.evaluate(snapshot(principal.id,session.id)),newer);assert.equal(await tab.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').value"),'T22 newer tab owns this saved row');
   assert.equal(Number((await pool.query<{count:string}>("SELECT count(*)::text AS count FROM communication.message WHERE session_id=$1::uuid AND purpose='INTERNAL_NOTE'",[session.id])).rows[0]?.count),0);
   await reload(browser);await browser.waitFor("document.querySelector('textarea[data-purpose=internal-notes]')?.value==='T22 newer tab owns this saved row'");
  }catch(error){failure=error;try{if(browser){await mkdir(directory);await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText})')));}}catch(diagnosticFailure){failure=new AggregateError([failure,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 });
});

test('a real newer-tab row defeats a delayed notification-time blank refresh and is never overwritten',async()=>{
 await withT22Fixture(async({origin,browserCookie,sessions,principals})=>{
  const session=sessions[0],principal=principals[0];assert.ok(session);assert.ok(principal);const path=origin+'/workbench/app/conversations/'+session.id,directory=join(tmpdir(),'web01-ui-'+randomUUID());let browser:Browser|undefined,tab:Awaited<ReturnType<typeof yxxTab>>|undefined,failure:unknown;
  try{browser=await launchSystemBrowser({url:path,width:900,height:900,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);await browser.waitFor(ready);await browser.evaluate(holdBlankAuthority);await settleReply(browser,'T22 settle before delayed blank authority');await browser.waitFor('globalThis.__authorityHeld===1');
   tab=await yxxTab(browser,path);await tab.waitFor(ready);await tab.evaluate(input('internal-notes','T22 newer tab first note'));await saved(tab);const newer=await tab.evaluate(snapshot(principal.id,session.id));
   await browser.evaluate(input('internal-notes','T22 delayed blank must not overwrite'));await browser.evaluate('globalThis.__releaseAuthority()');await browser.waitFor("document.querySelector('[data-conversation-draft=internal-notes]').textContent.includes('恢复不可用')");
   assert.deepEqual(await tab.evaluate(snapshot(principal.id,session.id)),newer);assert.equal(await tab.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').value"),'T22 newer tab first note');
   await reload(browser);await browser.waitFor("document.querySelector('textarea[data-purpose=internal-notes]')?.value==='T22 newer tab first note'");
  }catch(error){failure=error;try{if(browser){await mkdir(directory);await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText})')));}}catch(diagnosticFailure){failure=new AggregateError([failure,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 });
});

test('current role removal through the real Access Port defeats delayed blank authority and queued new input',async()=>{
 await withT22Fixture(async({origin,browserCookie,pool,sessions,principals})=>{
  const session=sessions[0],principal=principals[0];assert.ok(session);assert.ok(principal);const directory=join(tmpdir(),'web01-ui-'+randomUUID());let browser:Browser|undefined,failure:unknown;
  try{browser=await launchSystemBrowser({url:origin+'/workbench/app/conversations/'+session.id,width:900,height:900,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);await browser.waitFor(ready);await browser.evaluate(holdBlankAuthority);await settleReply(browser,'T22 settle before actual role loss');await browser.waitFor('globalThis.__authorityHeld===1');await browser.evaluate(input('internal-notes','T22 revoked input must never persist'));
   const identity=(await pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[principal.id])).rows[0];assert.ok(identity);const access=createPilotAccessService({pool});await access.upsertPrincipal({wecomUserId:identity.wecom_user_id,displayName:identity.display_name,roles:['REPORTER'],resolverTeamIds:[]});
   await browser.waitFor("!document.querySelector('textarea')&&(document.body.innerText.includes('会话已失效')||document.body.innerText.includes('没有'))");await browser.evaluate('globalThis.__releaseAuthority()');
   assert.deepEqual(await browser.evaluate(snapshot(principal.id,session.id)),{revision:null,operation:null});
   await access.upsertPrincipal({wecomUserId:identity.wecom_user_id,displayName:identity.display_name,roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});await reload(browser);await browser.waitFor(ready);assert.equal(await browser.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').value"),'');
   assert.deepEqual(await browser.evaluate(snapshot(principal.id,session.id)),{revision:null,operation:null});
  }catch(error){failure=error;try{if(browser){await mkdir(directory);await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText})')));}}catch(diagnosticFailure){failure=new AggregateError([failure,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 });
});

test('expiry during fresh authority defeats stored-row rebase and never writes the edited expired payload',async()=>{
 await withT22Fixture(async({origin,browserCookie,sessions,principals})=>{
  const session=sessions[0],principal=principals[0];assert.ok(session);assert.ok(principal);const directory=join(tmpdir(),'web01-ui-'+randomUUID());let browser:Browser|undefined,failure:unknown;
  try{browser=await launchSystemBrowser({url:origin+'/workbench/app/conversations/'+session.id,width:900,height:900,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);await browser.waitFor(ready);await browser.evaluate(input('internal-notes','T22 note before expiry'));await saved(browser);const before=await browser.evaluate(snapshot(principal.id,session.id));
   await settleReply(browser,'T22 settle before expiry rebase');await browser.evaluate(holdNextAuthority);await browser.evaluate(input('internal-notes','T22 expired edit must not persist'));await browser.waitFor('globalThis.__authorityHeld===1');
   await browser.evaluate('(()=>{const now=Date.now;Date.now=()=>now()+86400001;})()');await browser.evaluate('globalThis.__releaseAuthority()');await browser.waitFor("document.querySelector('[data-conversation-draft=internal-notes]').textContent.includes('草稿已过期')&&document.querySelector('textarea[data-purpose=internal-notes]').value===''");
   assert.ok((before as {revision:string|null}).revision);assert.deepEqual(await browser.evaluate(snapshot(principal.id,session.id)),{revision:null,operation:null});
   await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:'(()=>{const now=Date.now;Date.now=()=>now()+86400001;})()'});await reload(browser);await browser.waitFor("document.querySelector('textarea[data-purpose=internal-notes]')?.value===''");assert.deepEqual(await browser.evaluate(snapshot(principal.id,session.id)),{revision:null,operation:null});
  }catch(error){failure=error;try{if(browser){await mkdir(directory);await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText})')));}}catch(diagnosticFailure){failure=new AggregateError([failure,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 });
});


