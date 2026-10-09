import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withT22Fixture} from './helpers/wbint-t22-fixture.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import type {ConversationTextCommand,ConversationCommandReceipt} from '../contracts/workbench_conversation_workspace_contracts.js';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
const ready="Boolean(document.querySelector('[data-conversation-ready]'))&&document.querySelectorAll('[data-conversation-draft]').length===2&&document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'";
const input=(purpose:string,text:string)=>`(()=>{const input=document.querySelector('textarea[data-purpose="${purpose}"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(3,8);})()`;
const recordCommands="(()=>{globalThis.__t22TracerCommands=[];const original=fetch;globalThis.fetch=(path,options)=>{if(String(path).endsWith('/messages')&&options?.method==='POST')globalThis.__t22TracerCommands.push(JSON.parse(options.body));return original(path,options);};})()";
function draftRevision(principal:string,session:string){const key=JSON.stringify([principal,'conversation',session,'conversation-note']);return `new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1',2);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['drafts'],'readonly'),row=tx.objectStore('drafts').get(${JSON.stringify(key)});tx.oncomplete=()=>{resolve(row.result?.revision??null);db.close();};})`;}

// One public tracer, original routed240s budget. Only owned HTTP output is faulted,
// after real authorization/query/commit; real EventSource bytes and facts are never substituted.
test('one real stream refreshes conversation families and exact Delivery while preserving input, UNKNOWN and scoped authority',async()=>{
 await withT22Fixture(async f=>{
  const a=f.sessions[0],b=f.sessions[1],principal=f.principals[0],colleague=f.principals[1];assert.ok(a&&b&&principal&&colleague);
  await f.runtime.stop();
  const runtime=createP2016Runtime({pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),principalIds:[principal.id,f.outsider.id,colleague.id],externalSendEnabled:false,workbenchConversationsEnabled:true,workbenchRealtimeEnabled:true,workbenchDraftRecoveryEnabled:true});
  const directory=await mkdtemp(join(tmpdir(),'web01-ui-'));let browser:Browser|undefined,failure:unknown,started=false,unreadable=false,loseReply=false;
  const requests:{path:string;method:string;browser:boolean}[]=[],events:string[]=[];
  runtime.server.on('request',(request,response)=>{
   const path=new URL(request.url??'/',f.origin).pathname;requests.push({path,method:request.method??'',browser:typeof request.headers['sec-fetch-site']==='string'});
   if(path==='/api/realtime/events'){const write=response.write;response.write=(...args:Parameters<typeof response.write>)=>{const text=String(args[0]);for(const name of ['conversation.assigned','conversation.item.created','communication.delivery.changed'])if(text.includes('event: '+name))events.push(name);return Reflect.apply(write,response,args);};}
   if(request.method==='GET'&&path.startsWith('/api/workbench/conversations')){const end=response.end;response.end=(...args:unknown[])=>{Reflect.apply(end,response,unreadable?['{']:args);return response;};}
   if(request.method==='POST'&&path.endsWith('/messages')){const end=response.end;response.end=(...args:unknown[])=>{if(loseReply&&response.statusCode===202){loseReply=false;request.socket.destroy();return response;}Reflect.apply(end,response,args);return response;};}
  });
  const gets=(path:string)=>requests.filter(row=>row.browser&&row.method==='GET'&&row.path===path).length;
  const posts=()=>requests.filter(row=>row.method==='POST').length;
  try{
   const launch=await runtime.start();started=true;const cookies=launch.cookies??[],admin=cookies[0],handler=cookies[2];assert.ok(admin&&handler);
   const cookie=(index=0)=>{const value=cookies[index];assert.ok(value);return value.name+'='+value.value;};
   const read=async<T,>(path:string,index=0):Promise<T>=>{const response=await fetch(f.origin+path,{headers:{cookie:cookie(index)}});assert.equal(response.status,200);return response.json() as Promise<T>;};
   const command=async(session:string,action:string,extra:Record<string,unknown>={},index=0)=>{const bootstrap=await read<{csrf_token:string}>('/api/lifecycle/bootstrap',index),detail=await read<{session:{row_version:number}}>('/api/workbench/conversations/'+session,index),body={client_command_id:randomUUID(),expected_row_version:detail.session.row_version,...extra};const response=await fetch(f.origin+'/api/workbench/conversations/'+session+'/'+action,{method:'POST',headers:{cookie:cookie(index),origin:f.origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':body.client_command_id,'if-match':'"'+body.expected_row_version+'"'},body:JSON.stringify(body)});assert.equal(response.status,action==='internal-notes'?201:200);await response.json();};
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+b.ticketId+'?detail=page',width:1280,height:900,cookies:[{...admin,url:f.origin+'/'}]});assert.ok(browser);
   const links='/api/workbench/items/ticket/'+b.ticketId+'/conversations';await browser.waitFor(`Boolean(document.querySelector('[aria-label="关联服务会话"] a[href$="/${b.id}"]'))&&document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'`);
   assert.equal((await runtime.observability.metrics()).sse_clients,1);const priorLinks=gets(links);await command(b.id,'takeover');
   await browser.waitFor(`Boolean(document.querySelector('[aria-label="关联服务会话"] a[href$="/${b.id}"]'))`);
   for(let i=0;i<100&&gets(links)===priorLinks;i++)await new Promise(resolve=>setTimeout(resolve,50));assert.ok(gets(links)>priorLinks,'real assignment event must re-read the active canonical links family');
   await command(a.id,'takeover',{},2);
   await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+a.id});await browser.waitFor(ready);await browser.evaluate(recordCommands);
   const view='/api/workbench/conversations/'+a.id,eligible=view+'/eligible-principals';await browser.waitFor(`Boolean(document.querySelector('[data-conversation-id="${a.id}"]'))`);assert.ok(gets(eligible)>0);
   await browser.evaluate(input('internal-notes','T22 realtime unsent A note'));await browser.waitFor("document.querySelector('[data-conversation-draft=internal-notes]').textContent.includes('已保存恢复副本')");
   const before=await browser.evaluate("(()=>{const input=document.querySelector('textarea[data-purpose=internal-notes]');return {value:input.value,start:input.selectionStart,end:input.selectionEnd,focused:document.activeElement===input};})()");
   const listBefore=gets('/api/workbench/conversations'),viewBefore=gets(view),eligibleBefore=gets(eligible);
   await command(a.id,'internal-notes',{text:'T22 colleague committed realtime material'},2);await runtime.coordinator.runOnce();
   await browser.waitFor("document.querySelector('[data-conversation-timeline]').textContent.includes('T22 colleague committed realtime material')");
   assert.ok(gets('/api/workbench/conversations')>listBefore&&gets(view)>viewBefore&&gets(eligible)>eligibleBefore,'one controller must refresh all active conversation families');
   assert.deepEqual(await browser.evaluate("(()=>{const input=document.querySelector('textarea[data-purpose=internal-notes]');return {value:input.value,start:input.selectionStart,end:input.selectionEnd,focused:document.activeElement===input};})()"),before);assert.equal(posts(),3);
   await browser.evaluate(input('messages','T22 realtime immutable reply'));await browser.waitFor("document.querySelector('[data-conversation-draft=messages]').textContent.includes('已保存恢复副本')");loseReply=true;await browser.evaluate("document.querySelector('[data-action=send-conversation-reply]').click()");await browser.waitFor("document.querySelector('[data-reply-outcome]').textContent.includes('结果未知')");
   const original=await browser.evaluate('globalThis.__t22TracerCommands[0]') as ConversationTextCommand;assert.ok(original.client_command_id);assert.equal(original.text,'T22 realtime immutable reply');assert.equal(posts(),4);
   unreadable=true;await browser.waitFor("document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='offline'");assert.equal((await runtime.observability.metrics()).sse_clients,1);
   assert.equal(await browser.evaluate("document.querySelector('textarea[data-purpose=messages]').value"),original.text);assert.ok(await browser.evaluate("document.querySelector('[data-reply-outcome]').textContent.includes('结果未知')"));
   await browser.evaluate("document.querySelector('[data-action=save-conversation-note]').click()");await browser.waitFor("document.querySelector('[data-note-outcome]').textContent.includes('尚未准备或发送')");assert.equal(posts(),4,'failed complete GET cycle cannot create another intent or retry UNKNOWN');
   unreadable=false;await browser.waitFor("document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'");assert.equal(await browser.evaluate('globalThis.__t22TracerCommands.length'),1);
   await browser.evaluate("document.querySelector('[data-action=check-messages]').click()");await browser.waitFor("document.querySelector('[data-reply-outcome]').textContent.includes('已受理发送')");assert.equal(posts(),4);assert.equal(await browser.evaluate('globalThis.__t22TracerCommands.length'),1);
   const receipt=await read<ConversationCommandReceipt>(view+'/messages/commands/'+original.client_command_id);assert.equal(receipt.state,'COMMITTED');assert.ok(receipt.state==='COMMITTED');assert.equal(receipt.result.delivery_ids.length,1);
   const delivery=receipt.result.delivery_ids[0];assert.ok(delivery);const deliveryBefore=gets(view+'/deliveries');
   const worker=createCommunicationDeliveryWorker({pool:f.pool,enabled:true,sender:{send:async()=>({outcome:'ACKNOWLEDGED',provider_message_id:'t22-tracer-synthetic-ack',error_code:null,retryable:false})}});await worker.deliver({deliveryId:delivery});await runtime.coordinator.runOnce();
   await browser.waitFor(`document.querySelector('[data-delivery-message="${receipt.result.message_id}"] [data-delivery-id="${delivery}"]')?.textContent.includes('已发送')`);assert.ok(gets(view+'/deliveries')>deliveryBefore);assert.equal(posts(),4);assert.equal(await browser.evaluate("document.querySelector('textarea[data-purpose=internal-notes]').value"),'T22 realtime unsent A note');
   await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+b.id});await browser.waitFor(ready);await browser.evaluate(input('internal-notes','T22 realtime authorized B note'));await browser.waitFor("document.querySelector('[data-conversation-draft=internal-notes]').textContent.includes('已保存恢复副本')");const bRevision=await browser.evaluate(draftRevision(principal.id,b.id));assert.ok(bRevision);
   await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+a.id});await browser.waitFor(ready);await browser.waitFor("document.querySelector('textarea[data-purpose=internal-notes]').value==='T22 realtime unsent A note'");
   const identity=(await f.pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[principal.id])).rows[0];assert.ok(identity);await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:identity.wecom_user_id,displayName:identity.display_name,roles:['HANDLER'],resolverTeamIds:[]});
   await browser.waitFor("!document.querySelector('textarea[data-purpose]')&&!document.querySelector('[data-conversation-ready]')");await browser.waitFor(`(async()=>await (${draftRevision(principal.id,a.id)})===null)()`);assert.equal(await browser.evaluate(draftRevision(principal.id,b.id)),bRevision);
   const retained=await read<{assignment:{assigned_to_me:boolean}}>('/api/workbench/conversations/'+b.id);assert.equal(retained.assignment.assigned_to_me,true);
   await browser.command('Page.navigate',{url:f.origin+'/workbench/app/conversations/'+b.id});await browser.waitFor("document.querySelector('textarea[data-purpose=internal-notes]')?.value==='T22 realtime authorized B note'");assert.equal(await browser.evaluate(draftRevision(principal.id,b.id)),bRevision);assert.equal(posts(),4);
   assert.ok(events.includes('conversation.assigned')&&events.includes('conversation.item.created')&&events.includes('communication.delivery.changed'),'observed real SSE bytes must accompany committed Control/Item/Delivery facts');assert.equal((await runtime.observability.metrics()).sse_clients,1);
   console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',conversation_realtime_tracer:true,real_sse:true,query_families:4,explicit_posts:4,automatic_posts:0,unknown_get_only:true,scoped_draft_revoke:true,screenshots:[]}));
  }catch(error){failure=error;if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,url:location.href})')));}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{if(started)assert.equal((await runtime.observability.metrics()).sse_clients,0);await runtime.stop();assert.equal(runtime.server.listening,false);}],failure);
  if(!failure)await rmdir(directory);
 });
});
