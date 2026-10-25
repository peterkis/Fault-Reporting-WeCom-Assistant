import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {object,text} from './helpers/t37-follow-up-fixture.mjs';
import {readFile} from 'node:fs/promises';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
const drafts="(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('wecom-workbench-drafts-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise((resolve,reject)=>{const tx=db.transaction(['drafts','operations'],'readonly'),d=tx.objectStore('drafts').getAll(),o=tx.objectStore('operations').getAll();tx.oncomplete=()=>resolve({drafts:d.result.map(r=>({scope:r.scope,revision:r.revision})),operations:o.result});tx.onabort=()=>reject(tx.error);});}finally{db.close();}})()";
async function recoveryPath(){const manifest=object(JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')));return '/workbench/app/'+text(object(manifest['src/feedback-recovery.ts']).file);}
test('ALL43 delayed real command403 cannot revoke a newer same-principal realtime authorization epoch',{timeout:180000},async()=>{
 await withWeb01Fixture(async(f:T11Fixture)=>{
  const selected=f.tickets[5],principal=f.principals[0],cookie=f.browserCookies[0];assert.ok(selected&&principal&&cookie&&typeof cookie.url==='string');
  const configured=(await f.pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[principal.id])).rows[0];assert.ok(configured);
  const role=(roles:('HANDLER'|'DISPATCHER')[])=>createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:configured.wecom_user_id,displayName:configured.display_name,roles,resolverTeamIds:['PILOT_IT']});
  const path='/api/tickets/'+selected.ticket.id+'/internal-notes';let browser:Browser|undefined,primary:unknown;
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+selected.ticket.id,width:1920,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);await browser.waitFor('Boolean(document.querySelector("textarea[aria-label=内部备注]"))');
   await browser.waitFor('document.body.innerText.includes("实时更新已连接")');
   await browser.evaluate(`(async()=>{const store=await import(${JSON.stringify(await recoveryPath())});globalThis.__all43Events=[];globalThis.__all43Unsubscribe=store.subscribeDrafts(event=>globalThis.__all43Events.push(event));})()`);
   await browser.evaluate(`(()=>{const send=fetch;globalThis.__all43Boots=[];globalThis.__all43Post=null;globalThis.fetch=async(input,options)=>{const p=new URL(input instanceof Request?input.url:String(input),location.href).pathname;if(options?.method==='POST'&&p===${JSON.stringify(path)}){globalThis.__all43Waiting=true;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('ALL43_PREPOST_TIMEOUT')),30000);globalThis.__all43Send=()=>{clearTimeout(timer);resolve();};});const response=await send(input,options),body=await response.arrayBuffer();globalThis.__all43Post={status:response.status,command:JSON.parse(options.body),aborted:()=>Boolean(options.signal?.aborted)};return new Response(new ReadableStream({start(controller){const timer=setTimeout(()=>controller.error(Error('ALL43_BODY_TIMEOUT')),30000);globalThis.__all43Body=()=>{clearTimeout(timer);controller.enqueue(new Uint8Array(body));controller.close();};}}),{status:response.status,headers:response.headers});}const response=await send(input,options);if(p==='/api/lifecycle/bootstrap'&&response.ok)globalThis.__all43Boots.push(await response.clone().json());return response;};})()`);
   await browser.evaluate(`(()=>{const input=document.querySelector('textarea[aria-label="内部备注"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'最终审查旧命令正文');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
   await browser.waitFor('document.querySelector("[data-action=save-internal-note]")?.disabled===false');await browser.evaluate('document.querySelector("[data-action=save-internal-note]").click()');await browser.waitFor('globalThis.__all43Waiting');
   await role(['HANDLER']);await browser.evaluate('globalThis.__all43Send()');await browser.waitFor('globalThis.__all43Post?.status===403');
   await role(['DISPATCHER']);await browser.waitFor(`globalThis.__all43Boots.filter(b=>b.principal_id===${JSON.stringify(principal.id)}&&b.roles.includes('DISPATCHER')).length>=2`);
   await browser.waitFor('document.body.innerText.includes("实时更新已连接")');const before=await browser.evaluate(drafts);
   await browser.evaluate('globalThis.__all43Body()');await browser.waitFor('globalThis.__all43Events.some(event=>event.reason==="revoked")||document.body.innerText.includes("结果未知")||document.body.innerText.includes("保存被拒绝")||!document.querySelector("dialog.detail-dialog[open]")');
   assert.deepEqual(await browser.evaluate(drafts),before,'an obsolete command failure cannot purge current recovery');
   assert.equal(await browser.evaluate('Boolean(document.querySelector("dialog.detail-dialog[open] #detail-title"))'),true,'new current Ticket READ remains visible');
   const post=object(await browser.evaluate('({status:globalThis.__all43Post.status,command:globalThis.__all43Post.command,aborted:globalThis.__all43Post.aborted(),newRoles:globalThis.__all43Boots.at(-1).roles})'));assert.equal(post.status,403);assert.equal(object(post.command).external_visible,false);assert.equal(typeof text(object(post.command).client_command_id),'string');
   console.log('ALL43_OBSOLETE_COMMAND_EPOCH '+JSON.stringify({same_principal:true,official_role_update:true,new_realtime_bootstrap:true,post,current_recovery_preserved:true}));
  }catch(error){primary=error;if(browser)try{console.log('ALL43_EPOCH_PARTIAL '+JSON.stringify(await browser.evaluate('({post:globalThis.__all43Post?{status:globalThis.__all43Post.status,aborted:globalThis.__all43Post.aborted()}:null,roles:globalThis.__all43Boots?.map(b=>b.roles),events:globalThis.__all43Events,text:document.body.innerText})')));}catch(secondary){primary=new AggregateError([error,secondary],'ALL43_EPOCH_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{if(browser)try{await browser.evaluate('globalThis.__all43Send?.();globalThis.__all43Body?.();globalThis.__all43Unsubscribe?.();');}catch{/* owned close still executes */}},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],primary);
 },{ticketSelfHandlingEnabled:true,workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true,workbenchRealtimeEnabled:true});
});
