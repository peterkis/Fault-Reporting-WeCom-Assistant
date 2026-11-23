import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import type {Server,IncomingMessage,ServerResponse} from 'node:http';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {yxxTab} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';
import {acceptedSetup,acceptedOptions,object,rows,text,version} from './helpers/t07-public-fixture.mjs';
import type {T07Fixture} from './helpers/t07-public-fixture.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type Fixture=T07Fixture&{browserCookies:{name:string;value:string;url:string}[];runtime:T07Fixture['runtime']&{server:Server;observability:{metrics:()=>Promise<{sse_clients:number}>}}};
const stored="new Promise((resolve,reject)=>{const open=indexedDB.open('wecom-workbench-drafts-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['drafts','operations']),drafts=tx.objectStore('drafts').getAll(),operations=tx.objectStore('operations').getAll();tx.oncomplete=()=>{db.close();resolve({drafts:drafts.result.filter(row=>row.purpose==='ticket-takeover').map(row=>({purpose:row.purpose,keys:Object.keys(row)})),operations:operations.result.filter(row=>row.purpose==='ticket-takeover')});};};})";
test('takeover keeps independent input visible when a failed peer draft meets temporary target failure',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const s=await acceptedSetup(f),cookie=f.browserCookies[2];assert.ok(cookie);const bootstrap=(await s.b.get('/api/lifecycle/bootstrap')).value;
  let browser:Browser|undefined,tab:Awaited<ReturnType<typeof yxxTab>>|undefined,primary:unknown;
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+s.first.ticket.id,width:1280,height:900,cookies:[cookie]});assert.ok(browser);
   await browser.waitFor("document.querySelector('.ticket-takeover select')?.options.length>2&&document.querySelector('.ticket-takeover select').disabled===false");
   await browser.evaluate("(()=>{const input=document.querySelector('.ticket-takeover select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,'T07_NETWORK');input.dispatchEvent(new Event('change',{bubbles:true}));})()");
   await browser.waitFor("document.querySelector('.ticket-takeover input[value=RETAIN_CURRENT]')?.disabled===false");await browser.evaluate("document.querySelector('.ticket-takeover input[value=RETAIN_CURRENT]').click()");
   await browser.waitFor("document.querySelector('[data-takeover-draft-status]')?.textContent.includes('草稿已保存')");
   const manifest=JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')) as Record<string,{file:string}>,recovery='/workbench/app/'+manifest['src/feedback-recovery.ts']?.file,scope={principal:text(bootstrap.principal_id),kind:'ticket',id:s.first.ticket.id,purpose:'ticket-takeover'};
   tab=await yxxTab(browser,f.origin+'/workbench/app/');await browser.evaluate("(()=>{const timer=window.setTimeout;globalThis.__restoreT07Timer=()=>{window.setTimeout=timer;};window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);})()");
   await browser.evaluate("document.querySelector('.ticket-takeover input[value=TAKE_SELECTED]').click()");
   await tab.evaluate(`(async()=>{const store=await import(${JSON.stringify(recovery)}),copy=await store.openDraft(${JSON.stringify(scope)}),id=crypto.randomUUID();await store.saveDraft(copy.handle,copy.text,{commandId:id});globalThis.__t07PeerText=copy.text;globalThis.__failT07Peer=()=>store.saveDraft(copy.handle,copy.text,{settledCommandId:id});})()`);
   await browser.waitFor("Boolean(document.querySelector('[data-action=check-takeover-command]'))");
   await browser.evaluate("(()=>{const read=fetch;let used=false;fetch=(path,options)=>{if(!used&&String(path).includes('/takeover-targets')){used=true;return Promise.resolve(new Response('{}',{status:503,headers:{'content-type':'application/json'}}));}return read(path,options);};})()");
   await browser.evaluate('globalThis.__restoreT07Timer()');await tab.evaluate('globalThis.__failT07Peer()');
   await browser.waitFor("document.querySelector('[data-takeover-draft-status]')?.textContent.includes('草稿暂未恢复')");
   assert.equal(await browser.evaluate("document.querySelector('.ticket-takeover select')?.value"),'T07_NETWORK');assert.equal(await browser.evaluate("document.querySelector('.ticket-takeover input[value=TAKE_SELECTED]')?.checked"),true);
   assert.equal(await browser.evaluate("document.querySelector('[data-action=takeover-and-start]')?.disabled"),true);
   const peer=object(await tab.evaluate(`(async()=>{const store=await import(${JSON.stringify(recovery)}),copy=await store.openDraft(${JSON.stringify(scope)});return {text:copy.text,original:globalThis.__t07PeerText,operation:copy.handle.operation};})()`));assert.equal(peer.text,peer.original);assert.equal(peer.operation,null);
  }catch(error){primary=error;}
  await closeBrowserTestResources([async()=>{await browser?.evaluate('globalThis.__restoreT07Timer?.()');await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],primary);
 },{...acceptedOptions,workbenchDraftRecoveryEnabled:true});
});
for(const mode of ['authorized','expired','context-503'] as const)test('UNKNOWN self takeover freezes its original intent through '+mode,async()=>{
 const expired=mode==='expired';let unavailable=false,faults=0;
 await withWeb01Fixture(async(f:Fixture)=>{
  const s=await acceptedSetup(f),cookie=f.browserCookies[2];assert.ok(cookie);assert.equal((await s.b.get('/api/lifecycle/bootstrap')).value.ticket_takeover_draft_recovery_enabled,true);const requests:{method:string;path:string;status:number|null;body:unknown}[]=[];
  const observe=(request:IncomingMessage,response:ServerResponse)=>{if(!request.headers.cookie?.includes(cookie.name+'='+cookie.value))return;const path=new URL(request.url??'/',f.origin).pathname;if(!path.startsWith('/api/'))return;const fact={method:request.method??'',path,status:null as number|null,body:null as unknown};requests.push(fact);response.once('finish',()=>{fact.status=response.statusCode;});if(fact.method==='POST'){request.pause();const chunks:Buffer[]=[];request.on('data',(chunk:unknown)=>{if(Buffer.isBuffer(chunk))chunks.push(chunk);});request.once('end',()=>{try{fact.body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fact.body=null;}});if(path===s.path+'/takeover-and-start'){const end=response.end.bind(response);response.end=((...args:Parameters<ServerResponse['end']>)=>response.statusCode===200?end('{"ok":true}'):end(...args)) as ServerResponse['end'];}}};
  const restoreUnavailable=(request:IncomingMessage,response:ServerResponse)=>{if(!unavailable||request.method!=='GET'||new URL(request.url??'/',f.origin).pathname!==s.path||!request.headers.cookie?.includes(cookie.name+'='+cookie.value))return;const head=response.writeHead.bind(response),end=response.end.bind(response);response.writeHead=((...args:Parameters<ServerResponse['writeHead']>)=>{if(args[0]===200){args[0]=503;faults++;}return head(...args);}) as ServerResponse['writeHead'];response.end=((...args:Parameters<ServerResponse['end']>)=>response.statusCode===503?end(JSON.stringify({error:{code:'P2_016_ACTION_FAILED',retryable:false}})):end(...args)) as ServerResponse['end'];};
  f.runtime.server.on('request',restoreUnavailable);f.runtime.server.on('request',observe);const directory=join(tmpdir(),'t07-draft-ui-'+randomUUID());await mkdir(directory);const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];let browser:Browser|undefined,primary:unknown;
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+s.first.ticket.id,width:1280,height:900,cookies:[cookie]});assert.ok(browser);const active=browser,capture=async(name:string)=>{await active.evaluate("document.querySelector('.ticket-takeover')?.scrollIntoView({block:'center'})");const bytes=Buffer.from(text(await active.screenshot()),'base64'),file=join(directory,name);await writeFile(file,bytes);screenshots.push({file:file.replaceAll('\\','/'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};await browser.waitFor("Boolean(document.querySelector('.ticket-takeover'))");assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-takeover-draft-status]'))"),true,'enabled recovery must expose its actual encrypted purpose status before any command');
   await browser.waitFor("document.querySelector('.ticket-takeover select')?.options.length>2&&document.querySelector('.ticket-takeover select').disabled===false&&document.querySelector('.ticket-takeover input[value=RETAIN_CURRENT]').disabled===false&&document.querySelector('.ticket-takeover input[value=RETAIN_CURRENT]').disabled===false");await browser.evaluate("(()=>{const input=document.querySelector('.ticket-takeover select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,'T07_NETWORK');input.dispatchEvent(new Event('change',{bubbles:true}));})()");await browser.waitFor("document.querySelector('.ticket-takeover select')?.value==='T07_NETWORK'&&document.querySelector('.ticket-takeover select').disabled===false&&document.querySelector('.ticket-takeover input[value=RETAIN_CURRENT]').disabled===false");await browser.evaluate("document.querySelector('.ticket-takeover input[value=RETAIN_CURRENT]').click()");await browser.waitFor("document.querySelector('[data-takeover-draft-status]')?.textContent.includes('草稿已保存')&&document.querySelector('.ticket-takeover [data-action=takeover-and-start]').disabled===false");
   const crypto=object(await browser.evaluate("(async()=>{const row=await new Promise((resolve,reject)=>{const open=indexedDB.open('wecom-workbench-drafts-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,read=db.transaction('drafts').objectStore('drafts').getAll();read.onsuccess=()=>{db.close();resolve(read.result.find(row=>row.purpose==='ticket-takeover'));};};});let exportError=null;try{await globalThis.crypto.subtle.exportKey('raw',row.key);}catch(error){exportError=error.name;}return {purpose:row.purpose,extractable:row.key.extractable,algorithm:row.key.algorithm.name,exportError,ttl:row.expiresAt-row.firstSavedAt,bytes:row.ciphertext.byteLength,plaintext:JSON.stringify(row).includes('T07_NETWORK')};})()"));assert.deepEqual({...crypto,bytes:undefined},{purpose:'ticket-takeover',extractable:false,algorithm:'AES-GCM',exportError:'InvalidAccessError',ttl:86400000,plaintext:false,bytes:undefined});assert.ok(Number(crypto.bytes)<=16400);
   await browser.evaluate("document.querySelector('.ticket-takeover [data-action=takeover-and-start]').click()");await browser.waitFor("document.querySelector('[data-toast-source=ticket-takeover]')?.innerText.match(/结果未知|结果未确认/u)");const posts=requests.filter(row=>row.method==='POST');assert.equal(posts.length,1);const original=object(posts[0]?.body);assert.equal(original.expected_version,version(s.before.version));assert.equal(original.resolver_team_id,'T07_NETWORK');const after=await s.b.get(s.path);assert.equal(after.value.version,version(s.before.version)+2);assert.equal(after.value.assignee_id,s.actor.id);assert.equal(after.value.status,'IN_PROGRESS');await capture('unknown-original-intent.png');
   unavailable=mode==='context-503';await browser.command('Page.enable');if(expired)await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:'(()=>{const now=Date.now;Date.now=()=>now()+86400001;})()'});const timeOrigin=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${timeOrigin}&&document.readyState==='complete'`);await browser.waitFor("Boolean(document.querySelector('[data-action=check-takeover-command]'))&&document.querySelector('[data-toast-source=ticket-takeover]')?.innerText.match(/结果未知|结果未确认/u)");const state=object(await browser.evaluate(stored)),operations=rows(state.operations);assert.equal(operations.length,1);assert.equal(operations[0]?.commandId,original.client_command_id);assert.deepEqual(Object.keys(operations[0]??{}).sort(),['commandId','createdAt','id','kind','principal','purpose','scope']);assert.equal(JSON.stringify(operations).includes('T07_NETWORK'),false);assert.equal(requests.filter(row=>row.method==='POST').length,1);assert.equal(requests.some(row=>row.path.includes('/takeover/commands/')),false,'reload never automatically submits or reconciles the original intent');
   // Card 35A (PR #192) keeps read-only actions focusable to explain why activation is blocked.
   const startButton = "document.querySelector('.ticket-takeover [data-action=takeover-and-start]')";
   assert.equal(await browser.evaluate(startButton + ".getAttribute('aria-disabled')"), 'true');
   await browser.evaluate(startButton + '.click()');
   await browser.evaluate(startButton + '.focus()');
   for (const [key, code, windowsVirtualKeyCode] of [['Enter', 'Enter', 13], [' ', 'Space', 32]] as const) {
     assert.equal(await browser.evaluate('document.activeElement === ' + startButton), true);
     for (const type of ['keyDown', 'keyUp']) {
       await browser.command('Input.dispatchKeyEvent', {type, key, code, windowsVirtualKeyCode});
     }
   }
   await browser.evaluate(startButton + ".scrollIntoView({block:'center',behavior:'instant'})");
   await waitForAnimationsSettled(browser);
   const point = object(await browser.evaluate(`(() => {
     const button = ${startButton}, rect = button.getBoundingClientRect();
     const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
     return {x, y, onControl: button.closest('[data-readonly-disabled]')?.contains(document.elementFromPoint(x, y))};
   })()`));
   assert.equal(point.onControl, true, 'the mouse must hit the read-only takeover control');
   for (const type of ['mousePressed', 'mouseReleased']) {
     await browser.command('Input.dispatchMouseEvent', {type, x:point.x, y:point.y, button:'left', clickCount:1});
   }
   const retained = object(await browser.evaluate(stored));
   assert.deepEqual(rows(retained.operations).map(row => row.commandId), [original.client_command_id]);
   const current = await s.a.get(s.path);
   assert.equal(current.status, 200);
   assert.equal(current.value.version, after.value.version);
   assert.deepEqual(requests.filter(row => row.method === 'POST').map(row => object(row.body).client_command_id), [original.client_command_id]);
   assert.equal(requests.some(row => row.path.includes('/takeover/commands/')), false, 'activation must not reconcile');
   if(expired){assert.deepEqual(state.drafts,[]);assert.equal(await browser.evaluate("document.querySelector('.ticket-takeover select').value"),'');assert.ok(await browser.evaluate("['过期','敏感恢复内容不可用'].some(message=>document.querySelector('[data-takeover-draft-status]').textContent.includes(message))"),'a different mounted purpose may already sweep expired ciphertext; opaque uncertainty must remain explicit');}else if(mode==='context-503'){assert.ok(faults>0);assert.equal(rows(state.drafts).length,1);assert.equal(await browser.evaluate("document.querySelector('.ticket-takeover select').value"),'');assert.ok(await browser.evaluate("document.querySelector('[data-takeover-draft-status]').textContent.includes('草稿暂未恢复')"));}else{assert.equal(rows(state.drafts).length,1);await browser.waitFor("document.querySelector('.ticket-takeover select')?.value==='T07_NETWORK'&&document.querySelector('.ticket-takeover input[value=RETAIN_CURRENT]').checked===true");assert.equal(await browser.evaluate("document.querySelector('.ticket-takeover select').value"),'T07_NETWORK');}
   await capture('restored-read-only-original.png');unavailable=false;
   if(mode==='authorized'){
    await browser.evaluate("(()=>{const remove=IDBObjectStore.prototype.delete;IDBObjectStore.prototype.delete=function(key){if(this.name==='operations')throw new DOMException('T07 synthetic cleanup failure','UnknownError');return remove.call(this,key);};globalThis.__restoreTakeoverDelete=()=>{IDBObjectStore.prototype.delete=remove;};})()");
    await browser.evaluate("document.querySelector('[data-action=check-takeover-command]').click()");
    await browser.waitFor("document.querySelector('[data-toast-source=ticket-takeover]')?.innerText.includes('已提交；草稿未能清空')");
    const receiptPath=s.path+'/takeover/commands/'+original.client_command_id;
    await browser.evaluate("globalThis.__restoreTakeoverDelete()");
    await browser.evaluate(`(()=>{const read=fetch;fetch=async(path,init)=>{if(String(path)===${JSON.stringify(receiptPath)}&&(!init?.method||init.method==='GET')){fetch=read;throw new TypeError('T07_SYNTHETIC_RECEIPT_FAILURE');}return read(path,init);};})()`);
    await browser.evaluate("document.querySelector('[data-action=check-takeover-command]').click()");
    await browser.waitFor("document.querySelector('[data-toast-source=ticket-takeover]')?.innerText.includes('已提交；本次核对未完成')");
    assert.equal(requests.filter(row=>row.method==='POST').length,1);
   }
   await browser.evaluate("document.querySelector('[data-action=check-takeover-command]').click()");await browser.waitFor("document.querySelector('[data-toast-source=ticket-takeover]')?.innerText.includes('已核对原操作：已提交')");assert.equal(requests.filter(row=>row.method==='POST').length,1);assert.equal(requests.filter(row=>row.method==='GET'&&row.path===s.path+'/takeover/commands/'+original.client_command_id).length,mode==='authorized'?2:1);assert.deepEqual(object(await browser.evaluate(stored)),{drafts:[],operations:[]});assert.equal((await s.b.get(s.path)).value.version,version(s.before.version)+2);await capture('acknowledged-and-cleared.png');const diagnostic=join(directory,'receipt.json');await writeFile(diagnostic,JSON.stringify({mode,expired,faults,requests,screenshots,purpose:'ticket-takeover',original_uuid:true,read_only_ack:true}));console.log('T07_DRAFT_BROWSER '+JSON.stringify({file:diagnostic.replaceAll('\\','/'),mode,expired,faults,original_uuid:true,one_post:true,read_only_ack:true,screenshots}));
  }catch(error){primary=error;console.error('T07_DRAFT_PRIMARY '+JSON.stringify({message:error instanceof Error?error.message:String(error),directory:directory.replaceAll('\\','/')}));}
  await closeBrowserTestResources([async()=>{if(primary&&browser){await writeFile(join(directory,'failure.png'),Buffer.from(text(await browser.screenshot()),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify({requests,page:await browser.evaluate("({text:document.body.innerText,url:location.pathname,form:{team:document.querySelector('.ticket-takeover select')?.value,teamDisabled:document.querySelector('.ticket-takeover select')?.disabled,fieldsetDisabled:document.querySelector('.ticket-takeover input[value=RETAIN_CURRENT]')?.disabled,choice:document.querySelector('.ticket-takeover input:checked')?.value,status:document.querySelector('[data-takeover-draft-status]')?.textContent}})")}));}},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{f.runtime.server.removeListener('request',observe);f.runtime.server.removeListener('request',restoreUnavailable);assert.equal((await f.runtime.observability.metrics()).sse_clients,0);}],primary);
 },{...acceptedOptions,workbenchDraftRecoveryEnabled:true});
});
