import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Server} from 'node:http';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {createTicketActionService} from '../src/p1-006-ticket-state-actions.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface Fixture {origin:string;backendOrigin:string;cookies:string[];pool:PostgresPool;principals:{id:string}[];runtime:{server:Server};certificateSpki:string;browserCookies:{name:string;value:string;url:string}[]}
function obj(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
const copies="new Promise((resolve,reject)=>{const open=indexedDB.open('wecom-workbench-drafts-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['drafts','operations']),drafts=tx.objectStore('drafts').getAll(),operations=tx.objectStore('operations').getAll();tx.oncomplete=()=>{db.close();resolve({drafts:drafts.result.map(row=>({purpose:row.purpose,firstSavedAt:row.firstSavedAt,expiresAt:row.expiresAt,algorithm:row.key.algorithm.name,extractable:row.key.extractable,plaintext:JSON.stringify(row).includes('T19 UNKNOWN original')})),operations:operations.result.map(row=>({commandId:row.commandId,purpose:row.purpose}))});};};})";
const pending="new Promise((resolve,reject)=>{const open=indexedDB.open('wecom-workbench-drafts-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,read=db.transaction('drafts').objectStore('drafts').getAll();read.onsuccess=async()=>{db.close();try{const row=read.result.find(row=>row.purpose==='manual-report-self-handling'),aad=new TextEncoder().encode(JSON.stringify([row.schema,row.scope,row.firstSavedAt,row.expiresAt,row.revision]));resolve(JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:row.iv,additionalData:aad},row.key,row.ciphertext))));}catch(error){reject(error);}};};})";
async function fill(browser:Browser){
  await browser.waitFor("document.querySelector('[data-manual-report-draft-status]')?.textContent.includes('草稿仅在当前浏览器')&&Boolean(document.querySelector('[aria-label=\"本人处理组\"] option[value=PILOT_IT]'))");
  await browser.evaluate("(()=>{const e=document.querySelector('[aria-label=\"本人处理组\"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'PILOT_IT');e.dispatchEvent(new Event('change',{bubbles:true}));})()");
  for(const [label,value] of [['报修人姓名','T19 UNKNOWN original reporter'],['联系方式','合成人工联系1900'],['故障描述','T19 UNKNOWN original：打印机无法打印']])await browser.evaluate(`(()=>{const e=document.querySelector('[aria-label="${label}"]'),p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement:HTMLInputElement;Object.getOwnPropertyDescriptor(p.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await browser.evaluate("document.querySelector('[aria-label=\"位置暂不清楚\"]').click()");await browser.waitFor("document.querySelector('[data-manual-report-draft-status]')?.textContent.includes('已保存恢复副本')");
}
async function reload(browser:Browser){const prior=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${prior}&&document.readyState==='complete'`);}
test('T19 a committed lost ACK retains the full original command, restores its exact valid group beyond the first 100 and expires sensitive content without another POST',async()=>{
  await withWeb01Fixture(async(f:Fixture)=>{
    let browser:Browser|undefined,error:unknown,posts=0;const receiptReads:string[]=[],actor=f.principals[0];assert.ok(actor);
    f.runtime.server.prependListener('request',(request,response)=>{
      if(request.method==='POST'&&request.url==='/api/workbench/reports/take-and-start'){posts++;const end=response.end.bind(response);response.end=(chunk?:string|Uint8Array|(()=>void))=>response.statusCode===202?end('{'):typeof chunk==='function'?end(chunk):end(chunk);}
      if(request.method==='GET'&&request.url?.startsWith('/api/workbench/reports/commands/'))receiptReads.push(request.url);
    });
    try{
      browser=await launchSystemBrowser({url:f.origin+'/workbench/app/reports/new?handling=self',width:900,height:900,cookies:f.browserCookies,certificateSpki:f.certificateSpki});assert.ok(browser);await fill(browser);
      const saved=obj(await browser.evaluate(copies));assert.ok(Array.isArray(saved.drafts));assert.equal(saved.drafts.length,1);const record=obj(saved.drafts[0]);assert.equal(record.purpose,'manual-report-self-handling');assert.equal(Number(record.expiresAt)-Number(record.firstSavedAt),86400000);assert.equal(record.algorithm,'AES-GCM');assert.equal(record.extractable,false);assert.equal(record.plaintext,false);
      await browser.evaluate("document.querySelector('[data-action=submit-manual-self-handling]').click()");await browser.waitFor("document.querySelector('[data-manual-report-result]')?.textContent.includes('结果未知')");
      const copy=obj(await browser.evaluate(pending)),command=obj(copy.pending);assert.deepEqual(Object.keys(copy).sort(),['pending','schema']);assert.equal(command.resolver_team_id,'PILOT_IT');assert.equal(command.description,'T19 UNKNOWN original：打印机无法打印');const id=String(command.client_command_id);
      assert.equal(posts,1);assert.deepEqual(receiptReads,[]);
      const cookie=f.cookies[0];assert.ok(cookie);const initialReceipt=await fetch(f.backendOrigin+'/api/workbench/reports/commands/'+id,{headers:{cookie}});assert.equal(initialReceipt.status,200);
      const original=obj(obj(await initialReceipt.json()).result),ticketId=String(obj(original.ticket).id),actions=createTicketActionService({pool:f.pool,authorize:({actor:who,ticket})=>who.type==='PILOT_USER'&&who.id===actor.id&&ticket.assignee_id===actor.id});
      const resolved=await actions.perform({ticketId,action:'resolve',actor:{type:'PILOT_USER',id:actor.id},expectedVersion:3,note:'合成历史回执验证，已恢复',reasonCode:'T19_HISTORY',traceId:'t19-history-resolve'});assert.equal(resolved.ok,true);
      const closed=await actions.perform({ticketId,action:'confirm',actor:{type:'PILOT_USER',id:actor.id},expectedVersion:4,note:'合成历史回执验证，确认关闭',reasonCode:'T19_HISTORY',traceId:'t19-history-confirm'});assert.equal(closed.ok,true);
      receiptReads.length=0;
      await f.pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name,is_active) SELECT 'A_T19_'||lpad(n::text,3,'0'),'合成组'||n,true FROM generate_series(1,101)n");
      await f.pool.query("INSERT INTO pilot_ticket.pilot_team_member(principal_id,team_id) SELECT $1::uuid,team_id FROM pilot_ticket.resolver_team WHERE team_id LIKE 'A_T19_%'",[actor.id]);
      await reload(browser);await browser.waitFor("document.querySelector('[aria-label=\"故障描述\"]')?.value==='T19 UNKNOWN original：打印机无法打印'&&document.querySelector('[aria-label=\"本人处理组\"]')?.value==='PILOT_IT'");
      assert.deepEqual(await browser.evaluate(pending),copy);assert.equal(posts,1);assert.deepEqual(receiptReads,[]);assert.equal(await browser.evaluate("document.querySelector('[data-action=submit-manual-self-handling]').disabled"),true);
      const restored=obj(await browser.evaluate(copies));assert.deepEqual(restored.drafts,saved.drafts);assert.deepEqual(restored.operations,[{commandId:id,purpose:'manual-report-self-handling'}]);
      await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const now=Date.now;Date.now=()=>now()+86400001;})()"});await reload(browser);
      await browser.waitFor("document.querySelector('[data-manual-report-draft-status]')?.textContent.includes('草稿已过期')&&Boolean(document.querySelector('[data-action=check-manual-report-receipt]'))");
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[aria-label=\"故障描述\"]'))"),false);assert.deepEqual(await browser.evaluate(copies),{drafts:[],operations:[{commandId:id,purpose:'manual-report-self-handling'}]});
      await browser.evaluate("document.querySelector('[data-action=check-manual-report-receipt]').click()");await browser.waitFor("document.querySelector('[data-manual-report-result]')?.textContent.includes('已由本人开始处理')");assert.equal(posts,1);assert.deepEqual(receiptReads,['/api/workbench/reports/commands/'+id]);
      assert.equal(await browser.evaluate("document.querySelector('[data-manual-report-result]').textContent.includes('本人处理中')"),false,'a historical IN_PROGRESS receipt must not claim the current closed Ticket is still being handled');
      assert.equal(await browser.evaluate("document.querySelector('[data-manual-report-result]').textContent.includes('历史结果')"),true);
      await browser.waitFor(`(async()=>{const c=await (${copies});return c.drafts.length===0&&c.operations.length===0;})()`);
      const row=(await f.pool.query<{state:string;intakes:number;tickets:number;status:string}>(`SELECT r.state,count(DISTINCT i.id)::integer AS intakes,count(DISTINCT t.id)::integer AS tickets,min(t.status) AS status FROM pilot_ticket.ticket_command_receipt r JOIN intake.service_intake i ON i.manual_command_receipt_id=r.id JOIN pilot_ticket.ticket t ON t.source_intake_id=i.id WHERE r.command_scope=$1 AND r.client_command_id=$2::uuid GROUP BY r.state`,['P2_016:'+actor.id,id])).rows[0];assert.deepEqual(row,{state:'COMMITTED',intakes:1,tickets:1,status:'CLOSED'});
    }catch(failure){error=failure;try{console.log('T19_UNKNOWN_DIAGNOSTIC '+JSON.stringify({posts,receiptReads,view:browser?await browser.evaluate('document.body.innerText'):null}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchManualReportsEnabled:true,ticketSelfHandlingEnabled:true,workbenchDraftRecoveryEnabled:true,realWorkbenchAuthentication:true});
});
