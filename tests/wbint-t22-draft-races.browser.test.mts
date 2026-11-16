import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,symlink,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';
import {sourceFile,testRoots} from './helpers/migration-roots.mjs';
import {withT22Fixture} from './helpers/wbint-t22-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {yxxTab} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {build as viteBuild} from 'vite';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type Surface=Pick<Browser,'evaluate'|'waitFor'>;
const ready="document.querySelectorAll('[data-conversation-draft]').length===2&&Array.from(document.querySelectorAll('[data-conversation-draft]')).every(e=>e.textContent.includes('草稿仅在当前浏览器'))";
const input=(purpose:string,value:string)=>`(()=>{const input=document.querySelector('textarea[data-purpose="${purpose}"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`;
async function saved(surface:Surface,purpose='internal-notes'){await surface.waitFor(`document.querySelector('[data-conversation-draft="${purpose}"]').textContent.includes('草稿已保存')`);}
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
   await browser.evaluate('globalThis.__releaseEncryption()');await browser.waitFor("document.querySelector('[data-conversation-draft=internal-notes]').textContent.match(/草稿未能保存|草稿暂未恢复/u)");
   assert.ok(bootstrapReads>readsBefore,'STALE_WRITE_FRESH_AUTHORITY_BRANCH');assert.deepEqual(await tab.evaluate(snapshot(principal.id,session.id)),newer);assert.equal(await tab.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').value"),'T22 newer tab owns this saved row');
   assert.equal(Number((await pool.query<{count:string}>("SELECT count(*)::text AS count FROM communication.message WHERE session_id=$1::uuid AND purpose='INTERNAL_NOTE'",[session.id])).rows[0]?.count),0);
   await reload(browser);await browser.waitFor("document.querySelector('textarea[data-purpose=internal-notes]')?.value==='T22 newer tab owns this saved row'");
  }catch(error){failure=error;try{if(browser){await mkdir(directory);await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText})')));}}catch(diagnosticFailure){failure=new AggregateError([failure,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 });
});

test('another tab starting an operation keeps this page\'s unsaved independent input',async()=>{
 await withT22Fixture(async({origin,browserCookie,sessions})=>{
  const session=sessions[0];assert.ok(session);const path=origin+'/workbench/app/conversations/'+session.id;
  let browser:Browser|undefined,tab:Awaited<ReturnType<typeof yxxTab>>|undefined,failure:unknown;
  try{
   browser=await launchSystemBrowser({url:path,width:900,height:900,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);await browser.waitFor(ready);
   await browser.evaluate(input('internal-notes','T22 shared saved base'));await saved(browser);
   tab=await yxxTab(browser,path);await tab.waitFor("document.querySelector('textarea[data-purpose=internal-notes]')?.value==='T22 shared saved base'");
   await browser.evaluate("(()=>{const timer=window.setTimeout;globalThis.__restoreDraftTimer=()=>{window.setTimeout=timer;};window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);})()");
   await browser.evaluate(input('internal-notes','T22 independent unsaved input'));
   await tab.evaluate("(()=>{const send=fetch;fetch=async(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes')){globalThis.__newOperationStarted=true;const response=await send(path,options);return new Promise(resolve=>{globalThis.__releaseNewOperation=()=>resolve(response);});}return send(path,options);};})()");
   await tab.evaluate("document.querySelector('[data-action=save-conversation-note]').click()");
   await tab.waitFor('globalThis.__newOperationStarted===true');
   await browser.waitFor("Boolean(document.querySelector('[data-action=check-internal-notes]'))");
   assert.equal(await browser.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').value"),'T22 independent unsaved input');
   assert.equal(await browser.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').disabled"),true);
   assert.equal(await browser.evaluate("[...document.querySelectorAll('section[aria-label=内部备注] button')].some(button=>button.textContent==='重新提交')"),false);
   await tab.waitFor('typeof globalThis.__releaseNewOperation==="function"');await browser.evaluate('globalThis.__restoreDraftTimer()');await tab.evaluate('globalThis.__releaseNewOperation()');
   await browser.waitFor("document.querySelector('textarea[data-purpose=internal-notes]')?.disabled===false&&document.querySelector('textarea[data-purpose=internal-notes]')?.value==='T22 independent unsaved input'");
   await saved(browser);
  }catch(error){failure=error;}
  await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 });
});

test('independent conversation input stays locked until peer settlement is reauthorized',async()=>{
 await withT22Fixture(async({origin,browserCookie,sessions})=>{
  const session=sessions[0];assert.ok(session);const path=origin+'/workbench/app/conversations/'+session.id;
  let browser:Browser|undefined,tab:Awaited<ReturnType<typeof yxxTab>>|undefined,failure:unknown;
  try{
   browser=await launchSystemBrowser({url:path,width:900,height:900,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);await browser.waitFor(ready);
   await browser.evaluate(input('internal-notes','T22 peer settlement base'));await saved(browser);
   tab=await yxxTab(browser,path);await tab.waitFor("document.querySelector('textarea[data-purpose=internal-notes]')?.value==='T22 peer settlement base'");
   await browser.evaluate("(()=>{const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);})()");
   await browser.evaluate(input('internal-notes','T22 local input awaiting authority'));
   await tab.evaluate("(()=>{const send=fetch;fetch=async(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes')){const response=await send(path,options);return new Promise(resolve=>{globalThis.__releasePeer=()=>resolve(response);});}return send(path,options);};})()");
   await tab.evaluate("document.querySelector('[data-action=save-conversation-note]').click()");await tab.waitFor('typeof globalThis.__releasePeer==="function"');
   await browser.waitFor("Boolean(document.querySelector('[data-action=check-internal-notes]'))");await browser.evaluate(holdNextAuthority);await tab.evaluate('globalThis.__releasePeer()');
   await browser.waitFor('globalThis.__authorityHeld===1');
   await browser.waitFor("document.querySelector('textarea[data-purpose=internal-notes]')?.disabled===true");
   assert.equal(await browser.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').disabled"),true);
   assert.equal(await browser.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').value"),'T22 local input awaiting authority');
   await browser.evaluate('globalThis.__releaseAuthority()');await saved(browser);
   await browser.waitFor("document.querySelector('textarea[data-purpose=internal-notes]')?.disabled===false");
   assert.equal(await browser.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').value"),'T22 local input awaiting authority');
  }catch(error){failure=error;}
  await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 });
});

test('a delayed refused conversation command cannot restore itself after a peer replaces it',async()=>{
 await withT22Fixture(async({origin,browserCookie,sessions})=>{
  const session=sessions[0];assert.ok(session);const path=origin+'/workbench/app/conversations/'+session.id;
  let browser:Browser|undefined,tab:Awaited<ReturnType<typeof yxxTab>>|undefined,failure:unknown;
  try{
   browser=await launchSystemBrowser({url:path,width:900,height:900,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);await browser.waitFor(ready);
   await browser.evaluate(input('internal-notes','T22 first command'));await saved(browser);
   await browser.evaluate("(()=>{const send=fetch;fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes'))return new Promise(resolve=>{globalThis.__rejectFirst=()=>resolve(Response.json({error:{code:'CONVERSATION_VERSION_CONFLICT'}},{status:409}));});return send(path,options);};})()");
   await browser.evaluate("document.querySelector('[data-action=save-conversation-note]').click()");await browser.waitFor('typeof globalThis.__rejectFirst==="function"');
   tab=await yxxTab(browser,path);await tab.waitFor("[...document.querySelectorAll('section[aria-label=内部备注] button')].some(button=>button.textContent==='重新提交')");
   await tab.evaluate("(()=>{const post=BroadcastChannel.prototype.postMessage;BroadcastChannel.prototype.postMessage=function(){};globalThis.__resumeBroadcast=()=>{BroadcastChannel.prototype.postMessage=post;};const send=fetch;let count=0;fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes')){count++;if(count===1)return Promise.resolve(Response.json({error:{code:'CONVERSATION_VERSION_CONFLICT'}},{status:409}));return new Promise(resolve=>{globalThis.__rejectSecond=()=>resolve(Response.json({error:{code:'CONVERSATION_VERSION_CONFLICT'}},{status:409}));});}return send(path,options);};})()");
   await tab.evaluate("[...document.querySelectorAll('section[aria-label=内部备注] button')].find(button=>button.textContent==='重新提交').click()");
   await tab.waitFor("document.querySelector('textarea[data-purpose=internal-notes]')?.disabled===false");
   await tab.evaluate(input('internal-notes','T22 replacement command'));await saved(tab);
   await tab.evaluate("document.querySelector('[data-action=save-conversation-note]').click()");await tab.waitFor('typeof globalThis.__rejectSecond==="function"');
   await browser.evaluate('globalThis.__rejectFirst()');
   await browser.waitFor("Boolean(document.querySelector('[data-action=check-internal-notes]'))&&![...document.querySelectorAll('section[aria-label=内部备注] button')].some(button=>button.textContent==='重新提交')");
   await tab.evaluate('globalThis.__resumeBroadcast();globalThis.__rejectSecond()');
   await browser.waitFor("document.querySelector('textarea[data-purpose=internal-notes]')?.disabled===false&&!document.querySelector('[data-action=check-internal-notes]')");
   assert.equal(await browser.evaluate("[...document.querySelectorAll('section[aria-label=内部备注] button')].some(button=>button.textContent==='重新提交')"),false);
  }catch(error){failure=error;}
  await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 });
});

test('peer settlement cancels a conversation failure waiting on draft encryption',async()=>{
 await withT22Fixture(async({origin,browserCookie,sessions,principals})=>{
  const session=sessions[0],principal=principals[0];assert.ok(session&&principal);const path=origin+'/workbench/app/conversations/'+session.id;
  let browser:Browser|undefined,tab:Awaited<ReturnType<typeof yxxTab>>|undefined,failure:unknown;
  try{
   browser=await launchSystemBrowser({url:path,width:900,height:900,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);await browser.waitFor(ready);
   await browser.evaluate(input('internal-notes','T22 old command awaiting cleanup'));await saved(browser);
   await browser.evaluate("(()=>{const send=fetch;fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes'))return new Promise(resolve=>{globalThis.__rejectOld=()=>resolve(Response.json({error:{code:'CONVERSATION_VERSION_CONFLICT'}},{status:409}));});return send(path,options);};})()");
   await browser.evaluate("document.querySelector('[data-action=save-conversation-note]').click()");await browser.waitFor('typeof globalThis.__rejectOld==="function"');
   tab=await yxxTab(browser,path);await tab.waitFor("[...document.querySelectorAll('section[aria-label=内部备注] button')].some(button=>button.textContent==='重新提交')");
   await browser.evaluate("(()=>{const encrypt=crypto.subtle.encrypt.bind(crypto.subtle);let held=false;globalThis.__oldEncryptionDone=false;crypto.subtle.encrypt=(...args)=>{if(held)return encrypt(...args);held=true;return new Promise((resolve,reject)=>{globalThis.__releaseOldEncryption=()=>encrypt(...args).then(value=>{globalThis.__oldEncryptionDone=true;resolve(value);},reject);});};})()");
   await browser.evaluate('globalThis.__rejectOld()');await browser.waitFor('typeof globalThis.__releaseOldEncryption==="function"');
   await tab.evaluate("(()=>{const send=fetch;let count=0;fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes')){count++;if(count===1)return Promise.resolve(Response.json({error:{code:'CONVERSATION_VERSION_CONFLICT'}},{status:409}));globalThis.__newCommand=JSON.parse(options.body);return new Promise(()=>{});}return send(path,options);};})()");
   await tab.evaluate("[...document.querySelectorAll('section[aria-label=内部备注] button')].find(button=>button.textContent==='重新提交').click()");await tab.waitFor("document.querySelector('textarea[data-purpose=internal-notes]')?.disabled===false");
   await browser.waitFor("!document.querySelector('[data-action=check-internal-notes]')");
   await tab.evaluate("(()=>{const post=BroadcastChannel.prototype.postMessage;BroadcastChannel.prototype.postMessage=function(){};globalThis.__resumeBroadcast=()=>{BroadcastChannel.prototype.postMessage=post;};})()");
   await tab.evaluate(input('internal-notes','T22 replacement after old settlement'));await saved(tab);await tab.evaluate("document.querySelector('[data-action=save-conversation-note]').click()");await tab.waitFor('Boolean(globalThis.__newCommand?.client_command_id)');
   const newId=await tab.evaluate('globalThis.__newCommand.client_command_id');await browser.evaluate('globalThis.__releaseOldEncryption()');await browser.waitFor('globalThis.__oldEncryptionDone===true');
   await tab.evaluate("(()=>{globalThis.__resumeBroadcast();const channel=new BroadcastChannel('wecom-workbench-drafts-v1');channel.postMessage({principal:"+JSON.stringify(principal.id)+",kind:'conversation',id:"+JSON.stringify(session.id)+",purpose:'conversation-note',reason:'settled'});channel.close();})()");
   await browser.waitFor("Boolean(document.querySelector('[data-action=check-internal-notes]'))&&!([...document.querySelectorAll('section[aria-label=内部备注] button')].some(button=>button.textContent==='重新提交'))");
   await browser.evaluate("(()=>{const read=fetch;fetch=(path,options)=>{const url=String(path);if(url.includes('/internal-notes/commands/')){globalThis.__checkedId=url.split('/').at(-1);return Promise.resolve(Response.json({session_id:url.split('/')[3],client_command_id:globalThis.__checkedId,state:'UNKNOWN'}));}return read(path,options);};})()");
   await browser.waitFor("document.querySelector('[data-action=check-internal-notes]')?.disabled===false");await browser.evaluate("document.querySelector('[data-action=check-internal-notes]').click()");await browser.waitFor('Boolean(globalThis.__checkedId)');assert.equal(await browser.evaluate('globalThis.__checkedId'),newId);
  }catch(error){failure=error;}
  await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 });
});

test('a refused operation does not replace another tab\'s independent conversation input',async()=>{
 await withT22Fixture(async({origin,browserCookie,sessions})=>{
  const session=sessions[0];assert.ok(session);const path=origin+'/workbench/app/conversations/'+session.id;
  let browser:Browser|undefined,tab:Awaited<ReturnType<typeof yxxTab>>|undefined,failure:unknown;
  try{
   browser=await launchSystemBrowser({url:path,width:900,height:900,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);await browser.waitFor(ready);
   await browser.evaluate(input('internal-notes','T22 other page saved note'));await saved(browser);
   tab=await yxxTab(browser,path);await tab.waitFor("document.querySelector('textarea[data-purpose=internal-notes]')?.value==='T22 other page saved note'");
   await browser.evaluate("(()=>{const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);})()");
   await browser.evaluate(input('internal-notes','T22 local unsaved note'));
   await tab.evaluate("(()=>{const send=fetch;fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes'))return new Promise(resolve=>{globalThis.__rejectNote=()=>resolve(Response.json({error:{code:'CONVERSATION_VERSION_CONFLICT'}},{status:409}));});return send(path,options);};})()");
   await tab.evaluate("document.querySelector('[data-action=save-conversation-note]').click()");await browser.waitFor("Boolean(document.querySelector('[data-action=check-internal-notes]'))");
   await tab.waitFor('typeof globalThis.__rejectNote==="function"');await tab.evaluate('globalThis.__rejectNote()');
   await browser.waitFor("document.querySelector('[data-conversation-draft=internal-notes]')?.textContent.includes('另一页面仍有草稿')");
   assert.equal(await browser.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').value"),'T22 local unsaved note');
   assert.equal(await browser.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').disabled"),false);
   assert.equal(await browser.evaluate("document.querySelector('[data-action=save-conversation-note]').disabled"),true);
   await browser.evaluate("document.querySelector('[data-action=discard-internal-notes]').click()");await browser.waitFor("document.querySelector('textarea[data-purpose=internal-notes]')?.value===''");
   await reload(browser);await browser.waitFor("document.querySelector('textarea[data-purpose=internal-notes]')?.value==='T22 other page saved note'");
  }catch(error){failure=error;}
  await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 });
});

test('consecutive peer operations do not hide the independent input',async()=>{
 await withT22Fixture(async({origin,browserCookie,sessions,principals})=>{
  const session=sessions[0],principal=principals[0];assert.ok(session);assert.ok(principal);const path=origin+'/workbench/app/conversations/'+session.id;
  const source=await readFile(sourceFile('app/pc-admin/src/features/drafts/encrypted-drafts.ts'),'utf8');
  const storage=transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022}}).outputText.replace(/^export /gmu,'');
  let browser:Browser|undefined,tab:Awaited<ReturnType<typeof yxxTab>>|undefined,failure:unknown;
  try{
   browser=await launchSystemBrowser({url:path,width:900,height:900,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);await browser.waitFor(ready);
   await browser.evaluate(input('internal-notes','T22 first peer note'));await saved(browser);
   tab=await yxxTab(browser,path);await tab.waitFor("document.querySelector('textarea[data-purpose=internal-notes]')?.value==='T22 first peer note'");
   await browser.evaluate("(()=>{const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);})()");
   await browser.evaluate(input('internal-notes','T22 independent input through two operations'));
   await tab.evaluate("(()=>{const send=fetch;fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes')){globalThis.__firstCommand=JSON.parse(options.body);return new Promise(()=>{});}return send(path,options);};})()");
   await tab.evaluate("document.querySelector('[data-action=save-conversation-note]').click()");
   await tab.waitFor('Boolean(globalThis.__firstCommand?.client_command_id)');await browser.waitFor("Boolean(document.querySelector('[data-action=check-internal-notes]'))");
   const nextId=await tab.evaluate(`(async()=>{${storage}
    const scope={principal:${JSON.stringify(principal.id)},kind:'conversation',id:${JSON.stringify(session.id)},purpose:'conversation-note'},first=await openDraft(scope);
    const post=BroadcastChannel.prototype.postMessage;BroadcastChannel.prototype.postMessage=function(){};
    try{await settleDraft(first.handle,globalThis.__firstCommand.client_command_id,first.handle.record.revision);
      const next=await openDraft(scope),id=crypto.randomUUID(),value='T22 second peer note',pending={session_id:scope.id,purpose:'internal-notes',command:{client_command_id:id,expected_row_version:globalThis.__firstCommand.expected_row_version,text:value}};
      await saveDraft(next.handle,JSON.stringify({schema:1,value,pending}),{commandId:id});
      globalThis.__finishSecond=()=>saveDraft(next.handle,JSON.stringify({schema:1,value,pending:null}),{settledCommandId:id});
      globalThis.__secondScope=scope;return id;
    }finally{BroadcastChannel.prototype.postMessage=post;}
   })()`);
   await tab.evaluate("(()=>{const channel=new BroadcastChannel('wecom-workbench-drafts-v1');channel.postMessage({...globalThis.__secondScope,reason:'released'});channel.close();})()");
   await browser.evaluate(`(()=>{const read=fetch;fetch=(path,options)=>{const url=String(path);if(url.includes('/internal-notes/commands/')){const id=url.split('/').at(-1);if(id===${JSON.stringify(nextId)})globalThis.__checkedSecond=true;return Promise.resolve(Response.json({session_id:${JSON.stringify(session.id)},client_command_id:id,state:'UNKNOWN'}));}return read(path,options);};})()`);
   await browser.waitFor("(()=>{const button=document.querySelector('[data-action=check-internal-notes]');if(!globalThis.__checkedSecond&&button&&!button.disabled)button.click();return globalThis.__checkedSecond===true;})()");
   assert.equal(await browser.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').value"),'T22 independent input through two operations');
   await tab.evaluate('(async()=>{await globalThis.__finishSecond();return true;})()');
   await browser.waitFor("document.querySelector('[data-conversation-draft=internal-notes]')?.textContent.includes('另一页面仍有草稿')");
   assert.equal(await browser.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').value"),'T22 independent input through two operations');
   assert.equal(await browser.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').disabled"),false);
  }catch(error){failure=error;}
  await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 });
});

test('a prepared reply starts its POST before the replayable command is claimed',async()=>{
 await withT22Fixture(async({origin,browserCookie,sessions})=>{
  const session=sessions[0];assert.ok(session);let browser:Browser|undefined,failure:unknown;
  try{
   browser=await launchSystemBrowser({url:origin+'/workbench/app/conversations/'+session.id,width:900,height:900,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);await browser.waitFor(ready);
   await browser.evaluate(input('internal-notes','T22 send before claim'));await saved(browser);
   await browser.evaluate("(()=>{const send=fetch,get=IDBObjectStore.prototype.get;globalThis.__postStarted=false;globalThis.__claimSawPost=null;fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes')){globalThis.__postStarted=true;globalThis.__postedCommand=JSON.parse(options.body);return new Promise(()=>{});}return send(path,options);};IDBObjectStore.prototype.get=function(key){if(this.name==='control'&&typeof key==='string'&&key.startsWith('prepared:'))globalThis.__claimSawPost=globalThis.__postStarted;return get.call(this,key);};})()");
   await browser.evaluate("document.querySelector('[data-action=save-conversation-note]').click()");
   await browser.waitFor('globalThis.__claimSawPost!==null');
   assert.equal(await browser.evaluate('globalThis.__claimSawPost'),true,'a cancelled preparation cannot expose a replayable command before its POST starts');
   assert.equal(await browser.evaluate("globalThis.__postedCommand.text"),'T22 send before claim');
  }catch(error){failure=error;}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 });
});

test('a real newer-tab row defeats a delayed notification-time blank refresh and is never overwritten',async()=>{
 await withT22Fixture(async({origin,browserCookie,sessions,principals})=>{
  const session=sessions[0],principal=principals[0];assert.ok(session);assert.ok(principal);const path=origin+'/workbench/app/conversations/'+session.id,directory=join(tmpdir(),'web01-ui-'+randomUUID());let browser:Browser|undefined,tab:Awaited<ReturnType<typeof yxxTab>>|undefined,failure:unknown;
  try{browser=await launchSystemBrowser({url:path,width:900,height:900,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);await browser.waitFor(ready);await browser.evaluate(holdBlankAuthority);await settleReply(browser,'T22 settle before delayed blank authority');await browser.waitFor('globalThis.__authorityHeld===1');
   tab=await yxxTab(browser,path);await tab.waitFor(ready);await tab.evaluate(input('internal-notes','T22 newer tab first note'));await saved(tab);const newer=await tab.evaluate(snapshot(principal.id,session.id));
   await browser.evaluate(input('internal-notes','T22 delayed blank must not overwrite'));await browser.evaluate('globalThis.__releaseAuthority()');await browser.waitFor("document.querySelector('[data-conversation-draft=internal-notes]').textContent.match(/草稿未能保存|草稿暂未恢复/u)");
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



test('an unsent preparation releases both stored references without deleting a claimed replay',async()=>{
 await withT22Fixture(async({origin,browserCookie})=>{
  // Exercise current storage code with Chromium IndexedDB and no business POST.
  const source=await readFile(sourceFile('app/pc-admin/src/features/drafts/encrypted-drafts.ts'),'utf8');
  const storage=transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022}}).outputText.replace(/^export /gmu,'');
  let browser:Browser|undefined,failure:unknown;
  try{
   browser=await launchSystemBrowser({url:origin+'/workbench/app/',width:900,height:900,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);
   const result=await browser.evaluate(`(async()=>{${storage}
    const principal=crypto.randomUUID();
    const scope={principal,kind:'conversation',id:crypto.randomUUID(),purpose:'conversation-reply'};
    const commandId=crypto.randomUUID(),plain=JSON.stringify({value:'synthetic draft',pending:null});
    const pending=JSON.stringify({value:'synthetic draft',pending:{id:commandId}});
    const {handle:original}=await openDraft(scope);
    await saveDraft(original,plain,{commandId,prepared:true});
    const preparedRaw=await new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('operations','readonly'),row=tx.objectStore('operations').get(draftScopeKey(scope));tx.oncomplete=()=>{resolve(row.result);db.close();};};});
    const staged=await openDraft(scope);
    const oldTabCanRead=Object.keys(preparedRaw).length===7&&JSON.parse(staged.text).pending===null;
    const expiry=original.record.expiresAt;
    await releaseUnsentOperation(original,commandId,plain);
    const editable=await openDraft(scope);
    const released={text:JSON.parse(editable.text),operation:editable.handle.operation,expiryPreserved:editable.handle.record.expiresAt===expiry};
    const missingCannotReplay=!await claimDraftReplay(scope,commandId);
    await saveDraft(editable.handle,plain,{commandId,prepared:true});
    await saveDraft(editable.handle,pending,{commandId,claimPrepared:true});
    const claimed=await claimDraftReplay(scope,commandId);
    await releaseUnsentOperation(editable.handle,commandId,plain);
    const replay=await openDraft(scope);
    const retained={sameText:replay.text===pending,sameOperation:replay.handle.operation.commandId===commandId};
    await settleDraft(replay.handle,commandId,replay.handle.record.revision);

    const opaque=await openDraft(scope);
    await saveDraft(opaque.handle,plain,{commandId,prepared:true});
    await removeSensitiveDraft(opaque.handle,'discard');
    const other=await openDraft({...scope,purpose:'conversation-note'});
    let notified=false;
    const unsubscribe=subscribeDrafts(event=>{if(matchesDraft(event,scope)&&event.reason==='released')notified=true;});
    try{await releaseUnsentOperation(opaque.handle,commandId,plain);}finally{unsubscribe();}
    const cleared=await openDraft(scope);
    await saveDraft(other.handle,plain);
    return {oldTabCanRead,released,missingCannotReplay,claimed,retained,opaqueCleared:!cleared.handle.operation&&!cleared.handle.record,notified,otherSaved:Boolean(other.handle.record)};
   })()`);
   assert.deepEqual(result,{
    oldTabCanRead:true,released:{text:{value:'synthetic draft',pending:null},operation:null,expiryPreserved:true},
    missingCannotReplay:true,claimed:true,retained:{sameText:true,sameOperation:true},
    opaqueCleared:true,notified:true,otherSaved:true,
   });
  }catch(error){failure=error;}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 });
});

test('prepared commands stay encrypted for replay while a legacy tab can read and observe release',async()=>{
 await withT22Fixture(async({origin,browserCookie})=>{
  const source=await readFile(sourceFile('app/pc-admin/src/features/drafts/encrypted-drafts.ts'),'utf8');
  const storage=transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022}}).outputText.replace(/^export /gmu,'');
  let browser:Browser|undefined,tab:Awaited<ReturnType<typeof yxxTab>>|undefined,failure:unknown;
  try{
   const path=origin+'/workbench/app/';browser=await launchSystemBrowser({url:path,width:900,height:900,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);tab=await yxxTab(browser,path);
   const staged=await browser.evaluate(`(async()=>{${storage}
    const scope={principal:crypto.randomUUID(),kind:'conversation',id:crypto.randomUUID(),purpose:'conversation-reply'},commandId=crypto.randomUUID();
    const plain=JSON.stringify({value:'synthetic protected text',pending:null}),pending=JSON.stringify({value:'synthetic protected text',pending:{id:commandId}});
    const opened=await openDraft(scope);
    await saveDraft(opened.handle,plain,{commandId,prepared:true,preparedText:pending});
    globalThis.__stagedScope=scope;globalThis.__stagedId=commandId;
    globalThis.__releaseStaged=()=>releaseUnsentOperation(opened.handle,commandId,plain);
    globalThis.__stageAgain=async()=>{const next=await openDraft(scope);await saveDraft(next.handle,plain,{commandId,prepared:true,preparedText:pending});globalThis.__releaseAgain=()=>releaseUnsentOperation(next.handle,commandId,plain);};
    globalThis.__claimStaged=()=>claimDraftReplay(scope,commandId);
    const modern=await openDraft(scope);
    return {scope,commandId,modernPending:JSON.parse(modern.text).pending};
   })()`) as {scope:unknown;commandId:string;modernPending:null};
   assert.equal(staged.modernPending,null);
   const legacy=await tab.evaluate(`(async()=>{const scope=${JSON.stringify(staged.scope)},key=JSON.stringify([scope.principal,scope.kind,scope.id,scope.purpose]);
    globalThis.__legacyEvents=[];globalThis.__legacyChannel=new BroadcastChannel('wecom-workbench-drafts-v1');globalThis.__legacyChannel.onmessage=event=>globalThis.__legacyEvents.push(event.data);
    const row=await new Promise((resolve,reject)=>{const open=indexedDB.open('wecom-workbench-drafts-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['drafts','operations','control'],'readonly'),draft=tx.objectStore('drafts').get(key),operation=tx.objectStore('operations').get(key),marker=tx.objectStore('control').get('prepared:'+JSON.stringify([key,${JSON.stringify(staged.commandId)}]));tx.oncomplete=()=>{db.close();resolve({draft:draft.result,operation:operation.result,marker:marker.result});};};});
    const d=row.draft,aad=new TextEncoder().encode(JSON.stringify([d.schema,d.scope,d.firstSavedAt,d.expiresAt,d.revision]));
    const clear=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:d.iv,additionalData:aad,tagLength:128},d.key,d.ciphertext)));
    return {operationFields:Object.keys(row.operation).length,pending:clear.pending,markerHasKey:Object.hasOwn(row.marker,'key'),markerHasText:JSON.stringify(row.marker).includes('synthetic protected text')};
   })()`);
   assert.deepEqual(legacy,{operationFields:7,pending:null,markerHasKey:false,markerHasText:false});
   await browser.evaluate('(async()=>{await globalThis.__releaseStaged();return true;})()');
   await tab.waitFor(`globalThis.__legacyEvents.some(event=>event.reason==='settled'&&event.id===${JSON.stringify((staged.scope as {id:string}).id)})`);
   await browser.evaluate('(async()=>{await globalThis.__stageAgain();return true;})()');
   await tab.waitFor(`globalThis.__legacyEvents.some(event=>event.reason==='released'&&event.id===${JSON.stringify((staged.scope as {id:string}).id)})`);
   assert.equal(await browser.evaluate('globalThis.__claimStaged()'),true);
   await browser.evaluate('(async()=>{await globalThis.__releaseAgain();return true;})()');
   const retained=await browser.evaluate(`(async()=>{${storage}const opened=await openDraft(${JSON.stringify(staged.scope)});return {id:opened.handle.operation?.commandId,pending:JSON.parse(opened.text).pending.id};})()`);
   assert.deepEqual(retained,{id:staged.commandId,pending:staged.commandId});
   const before=await tab.evaluate('globalThis.__legacyEvents.length') as number;
   await browser.evaluate(`(async()=>{${storage}const opened=await openDraft(${JSON.stringify(staged.scope)});await saveDraft(opened.handle,JSON.stringify({value:'synthetic protected text',pending:null}),{settledCommandId:${JSON.stringify(staged.commandId)}});return true;})()`);
   await tab.waitFor(`globalThis.__legacyEvents.slice(${before}).some(event=>event.reason==='settled'&&event.id===${JSON.stringify((staged.scope as {id:string}).id)})`);
   const revoked=await browser.evaluate(`(async()=>{${storage}
    const scope={principal:crypto.randomUUID(),kind:'conversation',id:crypto.randomUUID(),purpose:'conversation-note'},commandId=crypto.randomUUID();
    const opened=await openDraft(scope);await saveDraft(opened.handle,JSON.stringify({value:'private',pending:null}),{commandId,prepared:true,preparedText:JSON.stringify({value:'private',pending:{id:commandId}})});
    await removeSensitiveDraft(opened.handle,'revoked');
    const marker=await new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('control','readonly'),row=tx.objectStore('control').get('prepared:'+JSON.stringify([draftScopeKey(scope),commandId]));tx.oncomplete=()=>{db.close();resolve(row.result);};};});
    const after=await openDraft(scope,{restore:false});return {marker,hasDraft:Boolean(after.handle.record),operation:after.handle.operation?.commandId};
   })()`) as {marker:unknown;hasDraft:boolean;operation:string};
   assert.equal(revoked.marker,true,'revocation removes the encrypted command while keeping its opaque operation');
   assert.equal(revoked.hasDraft,false);assert.ok(revoked.operation);
  }catch(error){failure=error;}
  await closeBrowserTestResources([async()=>{await tab?.evaluate('globalThis.__legacyChannel?.close()');await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 });
});

test('an actually bundled base-version draft hook keeps its unsaved input across a peer failure',{timeout:240000},async()=>{
 const base='0004c53689e5f038e3e9359b59347c7180e58d48',sourceRoot=testRoots().sourceRoot,fixture=await mkdtemp(join(tmpdir(),'legacy-pc-hook-'));
 const draftDir=join(fixture,'app/pc-admin/src/features/drafts'),apiDir=join(fixture,'app/pc-admin/src/api'),appDir=join(fixture,'app/pc-admin/src/app');
 await Promise.all([mkdir(draftDir,{recursive:true}),mkdir(apiDir,{recursive:true}),mkdir(appDir,{recursive:true})]);
 const old=(file:string)=>execFileSync('git',['show',base+':'+file],{cwd:sourceRoot,encoding:'utf8',windowsHide:true});
 await Promise.all([
  writeFile(join(draftDir,'use-note-draft.ts'),old('app/pc-admin/src/features/drafts/use-note-draft.ts')),
  writeFile(join(draftDir,'encrypted-drafts.ts'),old('app/pc-admin/src/features/drafts/encrypted-drafts.ts')),
  writeFile(join(apiDir,'client.ts'),"export class ApiError extends Error {} export const api={};"),
  writeFile(join(appDir,'authorization.ts'),"export const clearSessionAuthorization=()=>{};export const clearTicketAuthorization=()=>{};"),
  symlink(join(sourceRoot,'node_modules'),join(fixture,'node_modules'),'junction'),
 ]);
 const entry=join(fixture,'legacy.ts');
 await writeFile(entry,`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {useAuthorizedDraft} from './app/pc-admin/src/features/drafts/use-note-draft';
 const scope=globalThis.__legacyScope;
 function Page(){const [note,setNote]=useState(''),[state,setState]=useState('idle');
 const draft=useAuthorizedDraft({scope,enabled:true,value:note,pending:null,emptyValue:'',hasInput:value=>Boolean(value),serialise:copy=>JSON.stringify(copy),decode:text=>JSON.parse(text),commandId:command=>command.client_command_id,authorize:async()=>true,onAuthorityFailure:()=>{},onRestore:copy=>{setNote(copy.value);if(copy.pending)setState('unknown');},onOperation:()=>setState('unknown'),onSensitiveClear:()=>{setNote('');setState('idle');}});
 globalThis.__legacySnapshot={state,status:draft.status,operationId:draft.operationId,canSubmit:draft.canSubmit};
 globalThis.__legacyAttempt=async()=>{try{await draft.prepare({client_command_id:crypto.randomUUID()});return 'prepared';}catch(error){return error.message;}};
 return React.createElement('textarea',{id:'legacy-note',value:note,disabled:state==='unknown',onChange:event=>setNote(event.target.value)});}
 const host=document.createElement('div');host.id='legacy-fixture';document.body.appendChild(host);createRoot(host).render(React.createElement(Page));`);
 const built=await viteBuild({root:fixture,configFile:false,logLevel:'silent',define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{write:false,minify:false,lib:{entry,formats:['iife'],name:'LegacyDraftFixture'}}});
 const chunks=Array.isArray(built)?built:[built];const chunk=chunks.flatMap(item=>'output' in item?item.output:[]).find(item=>item.type==='chunk');assert.ok(chunk&&chunk.type==='chunk');
 await withT22Fixture(async({origin,browserCookie})=>{
  let browser:Browser|undefined,tab:Awaited<ReturnType<typeof yxxTab>>|undefined,failure:unknown;
  try{
   browser=await launchSystemBrowser({url:origin+'/workbench/app/',width:900,height:900,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);
   tab=await yxxTab(browser,origin+'/workbench/app/');await tab.waitFor('document.readyState==="complete"&&Boolean(document.body)');
   const scope={principal:randomUUID(),kind:'ticket',id:randomUUID(),purpose:'internal-note'};
   await tab.evaluate('globalThis.__legacyScope='+JSON.stringify(scope));
   const mountError=await tab.evaluate("(()=>{try{"+chunk.code+"\n;return null;}catch(error){return String(error?.stack??error);}})()");assert.equal(mountError,null);
   await tab.waitFor('globalThis.__legacySnapshot?.status==="ready"&&Boolean(document.querySelector("#legacy-note"))');
   const set=(value:string)=>`(()=>{const input=document.querySelector('#legacy-note');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`;
   await tab.evaluate(set('old saved input'));await tab.waitFor('globalThis.__legacySnapshot?.status==="saved"');
   await tab.evaluate("(()=>{const timer=window.setTimeout;globalThis.__legacyRestoreTimer=()=>{window.setTimeout=timer;};window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);globalThis.__legacyEvents=[];const channel=new BroadcastChannel('wecom-workbench-drafts-v1');channel.onmessage=event=>globalThis.__legacyEvents.push(event.data);globalThis.__legacyClose=()=>channel.close();})()");
   await tab.evaluate(set('old independent unsaved input'));
   const manifest=JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')) as Record<string,{file:string}>,recovery='/workbench/app/'+manifest['src/feedback-recovery.ts']?.file;
   const id=await browser.evaluate('(async()=>{const store=await import('+JSON.stringify(recovery)+'),copy=await store.openDraft('+JSON.stringify(scope)+'),id=crypto.randomUUID();await store.saveDraft(copy.handle,copy.text,{commandId:id});globalThis.__legacyPeer={store,copy,id};return id;})()') as string;
   await tab.waitFor(`globalThis.__legacyEvents.some(event=>event.id===${JSON.stringify(scope.id)}&&event.reason==='released')`);
   assert.equal(await tab.evaluate('globalThis.__legacySnapshot.state'),'idle');assert.equal(await tab.evaluate('document.querySelector("#legacy-note").value'),'old independent unsaved input');
   assert.notEqual(await tab.evaluate('globalThis.__legacyAttempt()'),'prepared','the older page cannot start another operation while the peer operation exists');
   await tab.evaluate('globalThis.__legacyRestoreTimer()');
   await browser.evaluate('(async()=>{const {store,copy,id}=globalThis.__legacyPeer;await store.saveDraft(copy.handle,copy.text,{settledCommandId:id});})()');
   await tab.waitFor(`globalThis.__legacyEvents.some(event=>event.id===${JSON.stringify(scope.id)}&&event.reason==='settled')&&globalThis.__legacySnapshot.operationId===null&&globalThis.__legacySnapshot.canSubmit===true`);
   assert.equal(await tab.evaluate('globalThis.__legacySnapshot.state'),'idle');assert.equal(await tab.evaluate('document.querySelector("#legacy-note").disabled'),false);assert.equal(await tab.evaluate('document.querySelector("#legacy-note").value'),'old independent unsaved input');assert.equal(await tab.evaluate('globalThis.__legacySnapshot.canSubmit'),true);assert.ok(id);
  }catch(error){failure=error;}
  await closeBrowserTestResources([async()=>{await tab?.evaluate('globalThis.__legacyRestoreTimer?.();globalThis.__legacyClose?.()');await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 });
});

test('legacy prepared records remain unresolved and expiry notices are bounded',async()=>{
 await withT22Fixture(async({origin,browserCookie})=>{
  const source=await readFile(sourceFile('app/pc-admin/src/features/drafts/encrypted-drafts.ts'),'utf8');
  const storage=transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022}}).outputText.replace(/^export /gmu,'');
  let browser:Browser|undefined,failure:unknown;
  try{
   browser=await launchSystemBrowser({url:origin+'/workbench/app/',width:900,height:900,cookies:[{...browserCookie,url:origin+'/'}]});assert.ok(browser);
   const result=await browser.evaluate(`(async()=>{${storage}
    const scope={principal:crypto.randomUUID(),kind:'conversation',id:crypto.randomUUID(),purpose:'conversation-reply'};
    const id=crypto.randomUUID(),plain=JSON.stringify({value:'private',pending:null}),pending=JSON.stringify({value:'private',pending:{id}});
    const original=await openDraft(scope);
    await saveDraft(original.handle,pending,{commandId:id,prepared:true});
    const change=await new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['operations','control'],'readwrite'),store=tx.objectStore('operations'),row=store.get(draftScopeKey(scope));row.onsuccess=()=>{store.put({...row.result,prepared:true});const control=tx.objectStore('control');for(let i=0;i<25;i++){const key=JSON.stringify([scope.principal,'conversation',crypto.randomUUID(),'conversation-note']);control.put(Date.now()-i*1000,'expired:'+key);if(i===0)globalThis.__newestScope=JSON.parse(key);}control.put(Date.now()-172800001,'expired:old-sensitive-scope');};tx.oncomplete=()=>{db.close();resolve(true);};};});
    const migrated=await openDraft(scope);
    await releaseUnsentOperation(migrated.handle,id,plain);
    const retained=await openDraft(scope);
    const notice=await openDraft({principal:globalThis.__newestScope[0],kind:globalThis.__newestScope[1],id:globalThis.__newestScope[2],purpose:globalThis.__newestScope[3]});
    const snapshot=await new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['operations','control'],'readonly'),row=tx.objectStore('operations').get(draftScopeKey(scope)),keys=tx.objectStore('control').getAllKeys();tx.oncomplete=()=>{resolve({row:row.result,keys:keys.result});db.close();};};});
    return {change,legacyRetained:retained.handle.operation?.commandId===id&&retained.text===pending,legacyCompatible:Object.keys(snapshot.row).length===7,noticed:notice.expired,notices:snapshot.keys.filter(key=>String(key).startsWith('expired:')).length,oldRemoved:!snapshot.keys.includes('expired:old-sensitive-scope')};
   })()`);
   assert.deepEqual(result,{change:true,legacyRetained:true,legacyCompatible:true,noticed:true,notices:19,oldRemoved:true});
  }catch(error){failure=error;}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
 });
});
