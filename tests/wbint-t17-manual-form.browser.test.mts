import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
type Browser=Awaited<ReturnType<typeof launchSystemBrowser>>;
interface Fixture {origin:string;pool:PostgresPool;principals:{id:string}[];certificateSpki:string;browserCookies:{name:string;value:string;url:string}[]}
function object(value:unknown):Record<string,unknown>{assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function string(value:unknown):string{if(typeof value!=='string'||!value)assert.fail('nonempty string required');return value;}
const trace="(()=>{globalThis.__t17Requests=[];const original=globalThis.fetch;globalThis.fetch=(path,options)=>{globalThis.__t17Requests.push({path:String(path),method:options?.method??'GET',body:options?.body?JSON.parse(options.body):null});return original(path,options);};})()";
const copies="new Promise((resolve,reject)=>{const open=indexedDB.open('wecom-workbench-drafts-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['drafts','operations']),drafts=tx.objectStore('drafts').getAll(),operations=tx.objectStore('operations').getAll();tx.oncomplete=()=>{db.close();resolve({drafts:drafts.result.map(row=>({principal:row.principal,kind:row.kind,id:row.id,purpose:row.purpose,firstSavedAt:row.firstSavedAt,expiresAt:row.expiresAt,extractable:row.key.extractable,algorithm:row.key.algorithm.name,plaintext:JSON.stringify(row).includes('T17 browser phone draft')})),operations:operations.result.map(row=>({commandId:row.commandId,purpose:row.purpose}))});};};})";
async function fill(browser:Browser){
  await browser.evaluate("(()=>{for(const [label,value] of [['报修人姓名','合成电话报修人'],['联系方式','人工联系内线7788'],['故障描述','T17 browser phone draft：打印机无法打印']]){const input=document.querySelector('[aria-label=\"'+label+'\"]'),type=input instanceof HTMLTextAreaElement?HTMLTextAreaElement:HTMLInputElement;Object.getOwnPropertyDescriptor(type.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('[aria-label=\"位置暂不清楚\"]').click();})()");
}

test('the actual production staff form restores an encrypted manual draft and explicitly admits one telephone fault with truthful reporter and operator facts',async()=>{
  await withWeb01Fixture(async({origin,pool,principals,certificateSpki,browserCookies}:Fixture)=>{
    const principal=principals[0];assert.ok(principal);let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/',width:900,height:900,cookies:browserCookies,certificateSpki});assert.ok(browser);
      await browser.waitFor("Boolean(document.querySelector('.ticket-card'))&&document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'");
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-action=new-report]'))"),true,'the actual production workbench must expose the authorized manual report entry');
      await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:trace});await browser.evaluate(trace);
      await browser.evaluate("document.querySelector('[data-action=new-report]').click()");
      await browser.waitFor("Boolean(document.querySelector('[data-manual-report-form]'))");
      for(const label of ['身份未核实','需人工联系','不会自动通知','代录人：林舟'])assert.equal(await browser.evaluate(`document.querySelector('[data-manual-report-form]').textContent.includes(${JSON.stringify(label)})`),true);
      await fill(browser);await browser.waitFor("document.querySelector('[data-manual-report-draft-status]')?.textContent.includes('已保存恢复副本')");
      const stored=object(await browser.evaluate(copies)),drafts=stored.drafts;assert.ok(Array.isArray(drafts));assert.equal(drafts.length,1);const draft=object(drafts[0]);
      assert.equal(draft.principal,principal.id);assert.equal(draft.kind,'intake');assert.equal(draft.purpose,'manual-report');assert.equal(draft.id,'00000000-0000-4000-8000-000000000072');
      assert.equal(Number(draft.expiresAt)-Number(draft.firstSavedAt),86_400_000);assert.equal(draft.extractable,false);assert.equal(draft.algorithm,'AES-GCM');assert.equal(draft.plaintext,false);
      const before=await browser.evaluate('performance.timeOrigin');assert.equal(typeof before,'number');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${before}&&document.querySelector('[aria-label="故障描述"]')?.value==='T17 browser phone draft：打印机无法打印'`);
      assert.equal(await browser.evaluate("document.querySelector('[aria-label=\"报修人姓名\"]').value"),'合成电话报修人');assert.equal(await browser.evaluate("document.querySelector('[aria-label=\"位置暂不清楚\"]').checked"),true);
      assert.equal(await browser.evaluate("globalThis.__t17Requests.filter(row=>row.method==='POST').length"),0);
      assert.equal(await browser.evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth"),true);
      await browser.evaluate("document.querySelector('[data-action=submit-manual-report]').click()");await browser.waitFor("document.querySelector('[data-manual-report-result]')?.textContent.includes('已受理')");
      const posts=await browser.evaluate("globalThis.__t17Requests.filter(row=>row.method==='POST')");assert.ok(Array.isArray(posts));assert.equal(posts.length,1);
      const post=object(posts[0]),body=object(post.body),commandId=string(body.client_command_id);assert.equal(post.path,'/api/workbench/reports');assert.equal(body.source,'PHONE');assert.equal(object(body.reporter).verification,'UNVERIFIED');assert.ok(!Object.hasOwn(body,'actor_principal_id'));
      assert.equal(await browser.evaluate("globalThis.__t17Requests.some(row=>/yixiaoxiu|wecom/.test(row.path))"),false);
      const row=(await pool.query<{id:string;actor:string;reporter:unknown;status:string;assignee:string|null}>(`SELECT t.id::text,i.manual_actor_principal_id::text AS actor,i.manual_report_snapshot->'reporter' AS reporter,t.status,t.assignee_id::text AS assignee
        FROM intake.service_intake i JOIN pilot_ticket.ticket_command_receipt r ON r.id=i.manual_command_receipt_id JOIN pilot_ticket.ticket t ON t.source_intake_id=i.id
        WHERE r.command_scope=$1 AND r.client_command_id=$2::uuid AND r.command_type='WORKBENCH_MANUAL_REPORT'`,['P2_016:'+principal.id,commandId])).rows[0];assert.ok(row);
      assert.equal(row.actor,principal.id);assert.equal(object(row.reporter).name,'合成电话报修人');assert.equal(object(row.reporter).verification,'UNVERIFIED');assert.equal(row.status,'QUEUED');assert.equal(row.assignee,null);
      await browser.waitFor(`(async()=>{const value=await (${copies});return value.drafts.length===0&&value.operations.length===0;})()`);
      await browser.evaluate("document.querySelector('[data-action=return-workbench]').click()");await browser.waitFor(`Boolean(document.querySelector('[data-item-id="${row.id}"]'))`);
      const cardText=string(await browser.evaluate(`document.querySelector('[data-item-id="${row.id}"]').textContent`));assert.ok(cardText.includes('电话代录'));assert.ok(cardText.includes('合成电话报修人'));assert.ok(cardText.includes('未核实'));
    }catch(failure){error=failure;console.log('T17_FORM_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText,requests:globalThis.__t17Requests})'):{}));}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchManualReportsEnabled:true,workbenchDraftRecoveryEnabled:true,workbenchManualReviewEnabled:true,workbenchRealtimeEnabled:true,realWorkbenchAuthentication:true});
});
