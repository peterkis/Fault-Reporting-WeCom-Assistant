import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Server} from 'node:http';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface Fixture {origin:string;pool:PostgresPool;runtime:{server:Server};principals:{id:string}[];certificateSpki:string;browserCookies:{name:string;value:string;url:string}[]}
function object(value:unknown):Record<string,unknown>{assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function string(value:unknown):string{assert.equal(typeof value,'string');assert.ok(value);return value as string;}
const trace="(()=>{globalThis.__t17Requests=[];const original=fetch;globalThis.fetch=(path,init)=>{globalThis.__t17Requests.push({path:String(path),method:init?.method??'GET',body:init?.body?JSON.parse(init.body):null});return original(path,init);};})()";
const copies="new Promise((resolve,reject)=>{const open=indexedDB.open('wecom-workbench-drafts-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['drafts','operations']),drafts=tx.objectStore('drafts').getAll(),operations=tx.objectStore('operations').getAll();tx.oncomplete=()=>{db.close();resolve({drafts:drafts.result.map(row=>({firstSavedAt:row.firstSavedAt,expiresAt:row.expiresAt})),operations:operations.result.map(row=>({commandId:row.commandId,purpose:row.purpose}))});};};})";
const pending="new Promise((resolve,reject)=>{const open=indexedDB.open('wecom-workbench-drafts-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,read=db.transaction('drafts').objectStore('drafts').getAll();read.onsuccess=async()=>{db.close();try{const row=read.result.find(row=>row.purpose==='manual-report'),aad=new TextEncoder().encode(JSON.stringify([row.schema,row.scope,row.firstSavedAt,row.expiresAt,row.revision]));resolve(JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:row.iv,additionalData:aad},row.key,row.ciphertext))));}catch(error){reject(error);}};};})";
async function type(browser:Browser,label:string,value:string){await browser.evaluate(`(()=>{const input=document.querySelector('[aria-label="${label}"]'),type=input instanceof HTMLTextAreaElement?HTMLTextAreaElement:HTMLInputElement;Object.getOwnPropertyDescriptor(type.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function reload(browser:Browser){const previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'`);}
test('a truly committed manual report with an unreadable HTTP acknowledgement restores its immutable intent, expires sensitive input at fixed 24h and only reads its original receipt',async()=>{
  await withWeb01Fixture(async({origin,pool,runtime,principals,certificateSpki,browserCookies}:Fixture)=>{
    const principal=principals[0];assert.ok(principal);let browser:Browser|undefined,error:unknown,posts=0;const receipts:string[]=[];
    runtime.server.prependListener('request',(request,response)=>{
      if(request.method==='POST'&&request.url==='/api/workbench/reports'){
        posts++;const end=response.end.bind(response);
        response.end=(chunk?:string|Uint8Array|(()=>void))=>response.statusCode===202?end('{'):typeof chunk==='function'?end(chunk):end(chunk);
      }
      if(request.method==='GET'&&request.url?.startsWith('/api/workbench/reports/commands/'))receipts.push(request.url);
    });
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/reports/new',width:900,height:900,cookies:browserCookies,certificateSpki});assert.ok(browser);
      await browser.waitFor("document.querySelector('[data-manual-report-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");
      await type(browser,'报修人姓名','T17 UNKNOWN actual reporter');await type(browser,'联系方式','合成人工联系5566');await type(browser,'故障描述','T17 UNKNOWN actual intent：打印机无法打印');await browser.evaluate("document.querySelector('[aria-label=\"位置暂不清楚\"]').click()");
      await browser.waitFor("document.querySelector('[data-manual-report-draft-status]')?.textContent.includes('已保存恢复副本')");const saved=object(await browser.evaluate(copies));
      await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:trace});await browser.evaluate(trace);await browser.evaluate("document.querySelector('[data-action=submit-manual-report]').click()");
      await browser.waitFor("document.querySelector('[data-manual-report-result]')?.textContent.includes('结果未知')");
      const sent=await browser.evaluate("globalThis.__t17Requests.filter(row=>row.method==='POST')");assert.ok(Array.isArray(sent));assert.equal(sent.length,1);const command=object(object(sent[0]).body),id=string(command.client_command_id);
      assert.equal(posts,1);assert.equal(command.source,'PHONE');assert.ok(!Object.hasOwn(command,'actor_principal_id'));assert.deepEqual(object(await browser.evaluate(pending)),{schema:1,pending:command});
      const facts=async()=>{const row=(await pool.query<{intakes:number;tickets:number;receipts:number;state:string;actor:string}>(`SELECT count(DISTINCT i.id)::integer AS intakes,count(DISTINCT t.id)::integer AS tickets,count(DISTINCT r.id)::integer AS receipts,min(r.state) AS state,min(i.manual_actor_principal_id::text) AS actor
        FROM pilot_ticket.ticket_command_receipt r LEFT JOIN intake.service_intake i ON i.manual_command_receipt_id=r.id LEFT JOIN pilot_ticket.ticket t ON t.source_intake_id=i.id
        WHERE r.command_scope=$1 AND r.client_command_id=$2::uuid AND r.command_type='WORKBENCH_MANUAL_REPORT'`,['P2_016:'+principal.id,id])).rows[0];assert.ok(row);return row;};
      assert.deepEqual(await facts(),{intakes:1,tickets:1,receipts:1,state:'COMMITTED',actor:principal.id});
      await reload(browser);await browser.waitFor("document.querySelector('[aria-label=\"故障描述\"]')?.value==='T17 UNKNOWN actual intent：打印机无法打印'&&Boolean(document.querySelector('[data-action=check-manual-report-receipt]'))");
      assert.equal(await browser.evaluate("document.querySelector('[aria-label=\"故障描述\"]').matches(':disabled')"),true);assert.equal(await browser.evaluate("document.querySelector('[data-action=submit-manual-report]').disabled"),true);
      assert.deepEqual(await browser.evaluate(pending),{schema:1,pending:command});assert.equal(posts,1);assert.deepEqual(receipts,[]);assert.equal(await browser.evaluate("globalThis.__t17Requests.filter(row=>row.method==='POST').length"),0);
      const restored=object(await browser.evaluate(copies));assert.deepEqual(restored.drafts,saved.drafts);assert.deepEqual(restored.operations,[{commandId:id,purpose:'manual-report'}]);
      const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);const image=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-detail-900.png');await writeFile(file,image);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',manual_report_unknown:true,screenshots:[{file,width:image.readUInt32BE(16),height:image.readUInt32BE(20),sha256:createHash('sha256').update(image).digest('hex')}]}));
      await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const now=Date.now;Date.now=()=>now()+86400001;})()"});await reload(browser);
      await browser.waitFor("document.querySelector('[data-manual-report-draft-status]')?.textContent.includes('草稿已过期')&&Boolean(document.querySelector('[data-action=check-manual-report-receipt]'))");
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[aria-label=\"故障描述\"]'))"),false);assert.equal(await browser.evaluate("document.body.innerText.includes('T17 UNKNOWN actual reporter')"),false);
      assert.deepEqual(await browser.evaluate(copies),{drafts:[],operations:[{commandId:id,purpose:'manual-report'}]});assert.equal(posts,1);assert.deepEqual(receipts,[]);
      await browser.evaluate("document.querySelector('[data-action=check-manual-report-receipt]').click()");await browser.waitFor("document.querySelector('[data-manual-report-result]')?.textContent.includes('已核对原操作结果')");
      assert.equal(posts,1);assert.deepEqual(receipts,['/api/workbench/reports/commands/'+id]);assert.equal(await browser.evaluate("globalThis.__t17Requests.filter(row=>row.method==='POST').length"),0);assert.deepEqual(await facts(),{intakes:1,tickets:1,receipts:1,state:'COMMITTED',actor:principal.id});
      await browser.waitFor(`(async()=>{const value=await (${copies});return value.drafts.length===0&&value.operations.length===0;})()`);assert.deepEqual(await browser.evaluate(copies),{drafts:[],operations:[]});
    }catch(failure){error=failure;console.log('T17_UNKNOWN_DIAGNOSTIC '+JSON.stringify(browser?{view:await browser.evaluate('({text:document.body.innerText,requests:globalThis.__t17Requests})'),copies:await browser.evaluate(copies),posts,receipts}:{}));}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchManualReportsEnabled:true,workbenchDraftRecoveryEnabled:true,realWorkbenchAuthentication:true});
});
