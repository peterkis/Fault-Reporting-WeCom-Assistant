import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {withT36BoundReplyFixture} from './helpers/t36-bound-reply-fixture.mjs';
import {withT36Browser,input,openReply,supplementRow} from './helpers/t36-browser-risk-journey.mjs';
import {yxxTab} from './helpers/p2-g2-yixiaoxiu-browser.mjs';

test('T36 blank observer keeps a peer failed disposition draft',{timeout:240000},()=>withT36BoundReplyFixture(async f=>{
 await withT36Browser(f,async browser=>{
  const scope={principal:f.actorId,kind:'ticket',id:f.ticketId,purpose:'supplement-disposition'},id=randomUUID(),note='T36_FAILED_PEER_DISPOSITION';
  const manifest=JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')) as Record<string,{file:string}>,recovery='/workbench/app/'+manifest['src/feedback-recovery.ts']?.file,tab=await yxxTab(browser,f.origin+'/workbench/app/');
  try{
   await browser.waitFor('document.querySelector("[data-supplement-draft-status]")?.textContent.includes("最长24小时")');
   await tab.evaluate(`(async()=>{const store=await import(${JSON.stringify(recovery)}),copy=await store.openDraft(${JSON.stringify(scope)}),target=${JSON.stringify(f.r2)},pending={client_command_id:${JSON.stringify(id)},action:'RECORD_DISPOSITION',...target,disposition_note:${JSON.stringify(note)},mark_followed_up:true};await store.saveDraft(copy.handle,JSON.stringify({schema:1,value:{target,note:${JSON.stringify(note)}},pending}),{commandId:pending.client_command_id});})()`);
   await browser.waitFor('Boolean(document.querySelector("[data-action=check-supplement-receipt]"))');
   await browser.evaluate(`(()=>{const read=fetch;fetch=(path,options)=>String(path).includes('/supplement-follow-up/commands/')?Promise.resolve(Response.json({ticket_id:${JSON.stringify(f.ticketId)},client_command_id:${JSON.stringify(id)},state:'FAILED',error:{code:'P2_016_VERSION_CONFLICT',retryable:false}})):read(path,options);})()`);
   await browser.evaluate('document.querySelector("[data-action=check-supplement-receipt]").click()');
   await browser.waitFor('!document.querySelector("[data-action=check-supplement-receipt]")');
   const saved=await tab.evaluate(`(async()=>{const store=await import(${JSON.stringify(recovery)}),copy=await store.openDraft(${JSON.stringify(scope)});return {text:copy.text,operation:copy.handle.operation};})()`) as {text:string|null;operation:unknown};
   assert.ok(saved.text);const value=JSON.parse(saved.text) as {value:{note:string};pending:unknown};assert.equal(value.value.note,note);assert.equal(value.pending,null);assert.equal(saved.operation,null);
  }finally{await tab.close();}
 });
},{recovery:true}));

for(const terminal of ['COMMITTED','FAILED'] as const)test(`T36 late ${terminal} receipt for A adopts peer operation B`,{timeout:240000},()=>withT36BoundReplyFixture(async f=>{
 await withT36Browser(f,async browser=>{
  const scope={principal:f.actorId,kind:'ticket',id:f.ticketId,purpose:'supplement-disposition'},oldId=randomUUID(),nextId=randomUUID(),note='T36_NEWER_PEER_OPERATION';
  const manifest=JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')) as Record<string,{file:string}>,recovery='/workbench/app/'+manifest['src/feedback-recovery.ts']?.file,tab=await yxxTab(browser,f.origin+'/workbench/app/');
  try{
   await tab.evaluate(`(async()=>{const store=await import(${JSON.stringify(recovery)}),copy=await store.openDraft(${JSON.stringify(scope)}),target=${JSON.stringify(f.r2)},pending={client_command_id:${JSON.stringify(oldId)},action:'RECORD_DISPOSITION',...target,disposition_note:${JSON.stringify(note)},mark_followed_up:true};await store.saveDraft(copy.handle,JSON.stringify({schema:1,value:{target,note:${JSON.stringify(note)}},pending}),{commandId:pending.client_command_id});})()`);
   await browser.waitFor('Boolean(document.querySelector("[data-action=check-supplement-receipt]"))');
   await browser.evaluate(`(()=>{const read=fetch;fetch=(path,options)=>{const target=String(path);if(target.endsWith('/commands/${oldId}'))return new Promise(resolve=>{globalThis.__releaseT36Old=()=>resolve(Response.json(${terminal==='FAILED'?`{ticket_id:${JSON.stringify(f.ticketId)},client_command_id:${JSON.stringify(oldId)},state:'FAILED',error:{code:'P2_016_VERSION_CONFLICT',retryable:false}}`:`{ticket_id:${JSON.stringify(f.ticketId)},client_command_id:${JSON.stringify(oldId)},state:'COMMITTED',result:{ok:true,client_command_id:${JSON.stringify(oldId)},ticket_id:${JSON.stringify(f.ticketId)},source_ref:${JSON.stringify(f.r2.source_ref)},revision:${JSON.stringify(f.r2.revision)},follow_up_state:'FOLLOWED_UP',resolution_id:crypto.randomUUID(),basis:'RECORDED_DISPOSITION',replayed:true}}`}));});if(target.endsWith('/commands/${nextId}')){globalThis.__checkedT36New=true;return Promise.resolve(Response.json({ticket_id:${JSON.stringify(f.ticketId)},client_command_id:${JSON.stringify(nextId)},state:'UNKNOWN'}));}return read(path,options);};})()`);
   await browser.evaluate('document.querySelector("[data-action=check-supplement-receipt]").click()');await browser.waitFor('typeof globalThis.__releaseT36Old==="function"');
   await tab.evaluate(`(async()=>{const store=await import(${JSON.stringify(recovery)}),old=await store.openDraft(${JSON.stringify(scope)}),value=JSON.parse(old.text),post=BroadcastChannel.prototype.postMessage;BroadcastChannel.prototype.postMessage=function(){};try{await store.settleDraft(old.handle,${JSON.stringify(oldId)},old.handle.record.revision);const copy=await store.openDraft(${JSON.stringify(scope)});value.pending.client_command_id=${JSON.stringify(nextId)};await store.saveDraft(copy.handle,JSON.stringify(value),{commandId:${JSON.stringify(nextId)}});}finally{BroadcastChannel.prototype.postMessage=post;}})()`);
   await browser.evaluate('globalThis.__releaseT36Old()');await browser.waitFor('document.querySelector("[data-action=check-supplement-receipt]")?.disabled===false');
   await browser.evaluate('document.querySelector("[data-action=check-supplement-receipt]").click()');await browser.waitFor('globalThis.__checkedT36New===true');
   const saved=await tab.evaluate(`(async()=>{const store=await import(${JSON.stringify(recovery)}),copy=await store.openDraft(${JSON.stringify(scope)});return {text:copy.text,operation:copy.handle.operation?.commandId};})()`) as {text:string|null;operation:string|null};assert.ok(saved.text);assert.equal(saved.operation,nextId);
  }finally{await tab.close();}
 });
},{recovery:true}));

for(const mode of ['late','unavailable','failed'] as const)test('T36 pending disposition '+(mode==='late'?'does not return after peer settlement':`unlocks after ${mode==='failed'?'failed':'committed'} receipt following temporary restore failure`),{timeout:240000},()=>withT36BoundReplyFixture(async f=>{
 await withT36Browser(f,async browser=>{
  const scope={principal:f.actorId,kind:'ticket',id:f.ticketId,purpose:'supplement-disposition'},id=randomUUID(),note='T36_PENDING_SYNTHETIC_NOTE';
  const manifest=JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')) as Record<string,{file:string}>,recovery='/workbench/app/'+manifest['src/feedback-recovery.ts']?.file,tab=await yxxTab(browser,f.origin+'/workbench/app/');
  try{
   await tab.evaluate(`(async()=>{const store=await import(${JSON.stringify(recovery)}),copy=await store.openDraft(${JSON.stringify(scope)}),target=${JSON.stringify(f.r2)},pending={client_command_id:${JSON.stringify(id)},action:'RECORD_DISPOSITION',...target,disposition_note:${JSON.stringify(note)},mark_followed_up:true};await store.saveDraft(copy.handle,JSON.stringify({schema:1,value:{target,note:${JSON.stringify(note)}},pending}),{commandId:pending.client_command_id});globalThis.__t36PendingPeer={store,copy,pending};})()`);
   await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const read=fetch;let used=false;fetch=async(path,options)=>{if(!used&&String(path).includes('/supplement-follow-up/material?')){used=true;${mode==='late'?"const response=await read(path,options);await new Promise(resolve=>{globalThis.__releaseT36Restore=resolve;});return response;":"return new Response('{}',{status:503,headers:{'content-type':'application/json'}});"}}return read(path,options);};})()`});
   const before=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${JSON.stringify(before)}&&document.readyState==='complete'`);
   if(mode==='late'){
    await browser.waitFor('typeof globalThis.__releaseT36Restore==="function"');
    await tab.evaluate('(async()=>{const {store,copy,pending}=globalThis.__t36PendingPeer;await store.settleDraft(copy.handle,pending.client_command_id,copy.handle.record.revision);})()');
    await browser.waitFor('!document.querySelector("[data-action=check-supplement-receipt]")');await browser.evaluate('globalThis.__releaseT36Restore()');
    await browser.evaluate('new Promise(resolve=>setTimeout(resolve,100))');
    assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-action=check-supplement-receipt]"))'),false);assert.notEqual(await browser.evaluate('document.querySelector('+JSON.stringify(supplementRow(f.r2)+' textarea')+')?.value'),note);
   }else{
    await browser.waitFor('document.querySelector("[data-supplement-draft-status]")?.textContent.includes("草稿暂未恢复")&&Boolean(document.querySelector("[data-action=check-supplement-receipt]"))');
    await browser.evaluate(`(()=>{const read=fetch;fetch=(path,options)=>String(path).includes('/supplement-follow-up/commands/')?Promise.resolve(Response.json(${mode==='failed'?`{ticket_id:${JSON.stringify(f.ticketId)},client_command_id:${JSON.stringify(id)},state:'FAILED',error:{code:'P2_016_VERSION_CONFLICT',retryable:false}}`:`{ticket_id:${JSON.stringify(f.ticketId)},client_command_id:${JSON.stringify(id)},state:'COMMITTED',result:{ok:true,client_command_id:${JSON.stringify(id)},ticket_id:${JSON.stringify(f.ticketId)},source_ref:${JSON.stringify(f.r2.source_ref)},revision:${JSON.stringify(f.r2.revision)},follow_up_state:'FOLLOWED_UP',resolution_id:crypto.randomUUID(),basis:'RECORDED_DISPOSITION',replayed:true}}`})):read(path,options);})()`);
    await browser.evaluate('document.querySelector("[data-action=check-supplement-receipt]").click()');
    await browser.waitFor('!document.querySelector("[data-action=check-supplement-receipt]")&&document.querySelector('+JSON.stringify(supplementRow(f.r2)+' textarea')+')?.disabled===false');
    assert.equal(await browser.evaluate('document.querySelector("[data-supplement-draft-status]")?.textContent.includes("草稿暂未恢复")'),false);
   }
  }finally{await tab.close();}
 });
},{recovery:true}));
test('T36 loss of only Session REPLY preserves readable Ticket and independent disposition input',{timeout:240000},()=>withT36BoundReplyFixture(async f=>{
 await withT36Browser(f,async(browser,capture)=>{const row=supplementRow(f.r2),internal='T36_STILL_AUTHORIZED_INTERNAL_DISPOSITION';await input(browser,row+' textarea',internal);await browser.waitFor('document.querySelector("[data-supplement-draft-status]")?.textContent.includes("已保存")');await openReply(browser,f.r2);await input(browser,'[data-supplement-bound-reply] textarea','T36原Session回复独立正文');await browser.waitFor('document.querySelector("[data-conversation-draft=messages]")?.textContent.includes("已保存")');
  await f.setActorRoles(['DISPATCHER']);const session=await f.read<{capabilities:string[]}>('/api/workbench/conversations/'+f.sessionId);assert.equal(session.capabilities.includes('REPLY'),false);assert.equal((await f.get('/api/tickets/'+f.ticketId)).status,200);assert.equal((await f.page()).items.some(item=>item.source_ref===f.r2.source_ref),true);
  await browser.evaluate('document.querySelector("[data-action=send-conversation-reply]").click()');await browser.waitFor('document.querySelector("[data-reply-outcome]")?.textContent.length>0||!document.querySelector("[data-supplement-bound-reply]")||!document.querySelector("[data-supplement-follow-up-state] li")');await capture();
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(row+' textarea')})?.value`),internal,'REPLY loss cannot purge an independently authorized disposition draft or readable Ticket view');assert.equal(await browser.evaluate('globalThis.__t36Risk.filter(row=>row.method==="POST").length'),0);
 });
},{recovery:true}));

test('T36 temporary material restore failure retains the saved independent disposition and blocks overwrite',{timeout:240000},()=>withT36BoundReplyFixture(async f=>{
 await withT36Browser(f,async browser=>{
  const row=supplementRow(f.r2),scope={principal:f.actorId,kind:'ticket',id:f.ticketId,purpose:'supplement-disposition'};
  await input(browser,row+' textarea','T36 peer saved');await browser.waitFor('document.querySelector("[data-supplement-draft-status]")?.textContent.includes("草稿已保存")');
  const manifest=JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')) as Record<string,{file:string}>,recovery='/workbench/app/'+manifest['src/feedback-recovery.ts']?.file,tab=await yxxTab(browser,f.origin+'/workbench/app/');
  try{
   await browser.evaluate("(()=>{const timer=window.setTimeout;globalThis.__restoreT36Timer=()=>{window.setTimeout=timer;};window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);})()");
   const local='T36 independent retained';await input(browser,row+' textarea',local);
   await tab.evaluate('(async()=>{const store=await import('+JSON.stringify(recovery)+'),copy=await store.openDraft('+JSON.stringify(scope)+'),id=crypto.randomUUID();await store.saveDraft(copy.handle,copy.text,{commandId:id});globalThis.__finishT36Peer=()=>store.settleDraft(copy.handle,id,copy.handle.record.revision);})()');
   await browser.waitFor('Boolean(document.querySelector("[data-action=check-supplement-receipt]"))');
   await browser.evaluate("(()=>{const read=fetch;let count=0;fetch=(path,options)=>{if(String(path).includes('/supplement-follow-up/material?')&&++count===2)return Promise.resolve(new Response('{}',{status:503,headers:{'content-type':'application/json'}}));return read(path,options);};})()");
   await browser.evaluate('globalThis.__restoreT36Timer()');await tab.evaluate('globalThis.__finishT36Peer()');
   await browser.waitFor('document.querySelector("[data-supplement-draft-status]")?.textContent.includes("草稿暂未恢复")');
   assert.equal(await browser.evaluate('document.querySelector('+JSON.stringify(row+' textarea')+')?.disabled'),true);
   await browser.waitFor('Boolean(document.querySelector("#internal-note"))&&document.querySelector("[data-draft-status]")?.textContent.includes("最长24小时")');
   await browser.evaluate("(()=>{const read=fetch;globalThis.__t36SessionChanged=false;fetch=async(path,options)=>{const response=await read(path,options);if(String(path)==='/api/lifecycle/bootstrap'&&response.ok){const body=await response.json();body.expires_epoch_ms=String(BigInt(body.expires_epoch_ms)+60000n);globalThis.__t36SessionChanged=true;return Response.json(body);}return response;};})()");
   await tab.evaluate(`(()=>{const channel=new BroadcastChannel('wecom-workbench-drafts-v1');channel.postMessage({principal:${JSON.stringify(f.actorId)},kind:'ticket',id:${JSON.stringify(f.ticketId)},purpose:'other-test-purpose',reason:'settled'});channel.close();})()`);
   await browser.waitFor('globalThis.__t36SessionChanged===true');await browser.evaluate('new Promise(resolve=>setTimeout(resolve,300))');
   assert.equal(await browser.evaluate('document.querySelector('+JSON.stringify(row+' textarea')+')?.disabled'),true,'session metadata refresh must not clear the unresolved recovery lock');
   const saved=await tab.evaluate('(async()=>{const store=await import('+JSON.stringify(recovery)+'),copy=await store.openDraft('+JSON.stringify(scope)+');return JSON.parse(copy.text);})()') as {value:{note:string}};
   assert.equal(saved.value.note,local);
   const before=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');
   await browser.waitFor(`performance.timeOrigin!==${JSON.stringify(before)}&&document.querySelector(${JSON.stringify(row+' textarea')})?.value===${JSON.stringify(local)}`);
  }finally{await tab.close();}
 });
},{recovery:true,internalNotes:true}));
