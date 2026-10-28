// SOURCE_READY_NOT_RUN: scoped Directory refusals must retain a still-authorized
// manual report. This uses real HTTP/production assets; no response replacement.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {createT18Directory,applyT18ForwardCheck} from './helpers/t18-verified-fixture.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface Fixture {origin:string;pool:PostgresPool;principals:{id:string}[];certificateSpki:string;browserCookies:{name:string;value:string;url:string}[]}
function isObject(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function object(value:unknown):Record<string,unknown>{if(!isObject(value))assert.fail('object required');return value;}
function string(value:unknown):string{if(typeof value!=='string'||!value)assert.fail('nonempty string required');return value;}
const trace=`(()=>{
  if(globalThis.__t18CandidateRefusalInstalled)return;globalThis.__t18CandidateRefusalInstalled=true;globalThis.__t18CandidateRefusalRows=[];
  const original=globalThis.fetch;
  globalThis.fetch=async(input,options)=>{
    const url=new URL(input instanceof Request?input.url:String(input),location.href),method=options?.method??(input instanceof Request?input.method:'GET');
    const tracked=url.origin===location.origin&&(url.pathname==='/api/workbench/reporter-candidates'||url.pathname.startsWith('/api/workbench/reports'));
    const row={path:url.pathname,method,status:null,body:method==='POST'&&options?.body?JSON.parse(options.body):null,result:null};
    if(tracked)globalThis.__t18CandidateRefusalRows.push(row);
    const response=await original(input,options);
    if(tracked){try{row.result=await response.clone().json();}catch{}row.status=response.status;}
    return response;
  };
})()`;
async function image(browser:Browser,evidence:string,name:string){await writeFile(join(evidence,name),Buffer.from(await browser.screenshot(),'base64'));}
async function fill(browser:Browser,label:string,value:string){
  await browser.evaluate(`(()=>{const input=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');if(!input)throw Error('T18_FIELD_MISSING');
    const kind=input instanceof HTMLTextAreaElement?HTMLTextAreaElement:input instanceof HTMLSelectElement?HTMLSelectElement:HTMLInputElement;
    Object.getOwnPropertyDescriptor(kind.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event(kind===HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
}
async function capabilities(browser:Browser){
  const response=object(await browser.evaluate("(async()=>{const response=await fetch('/api/workbench/reports/capabilities',{credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}});return {status:response.status,value:await response.json()};})()"));
  assert.equal(response.status,200,'the actual creation authority remains available');assert.equal(object(response.value).can_create,true);
}
async function externalCounts(pool:PostgresPool){
  const row=(await pool.query<{communications:number;outbox:number;deliveries:number;notifications:number;notification_deliveries:number}>(`SELECT
    (SELECT count(*)::integer FROM communication.message) AS communications,(SELECT count(*)::integer FROM communication.outbox) AS outbox,
    (SELECT count(*)::integer FROM communication.delivery) AS deliveries,(SELECT count(*)::integer FROM notification.outbox) AS notifications,
    (SELECT count(*)::integer FROM notification.delivery) AS notification_deliveries`)).rows[0];assert.ok(row);return row;
}

for(const refusal of ['SEARCH','VERIFY'] as const)test(`a real ${refusal} object refusal preserves authorized input for an explicit hand-entered report without external delivery`,{timeout:240000},async()=>{
  if(process.platform==='win32')assert.match(resolve(tmpdir()),/^D:[\\/]/iu,'all browser profiles and evidence must stay on D');
  const evidence=await mkdtemp(join(tmpdir(),'t18-candidate-refusal-'+refusal.toLowerCase()+'-')),authority=createT18Directory(refusal);
  const description='合成现场代录：打印机情况不明',location='合成门诊二楼';
  await withWeb01Fixture(async({origin,pool,principals,certificateSpki,browserCookies}:Fixture)=>{
    const principal=principals[0];assert.ok(principal);authority.setPrincipal(principal.id);await applyT18ForwardCheck(pool);
    let browser:Browser|undefined,error:unknown,stage='FIXTURE_READY';
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/',width:900,height:900,cookies:browserCookies,certificateSpki});assert.ok(browser);
      await browser.waitFor("Boolean(document.querySelector('.ticket-card'))&&document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'");
      const inventory:unknown=JSON.parse(await readFile(new URL('../web/admin-workbench/asset-inventory.json',import.meta.url),'utf8'));
      assert.ok(Array.isArray(inventory)&&inventory.every(item=>typeof item==='string'));
      const scripts:unknown=await browser.evaluate("[...document.scripts].filter(item=>item.src).map(item=>new URL(item.src).pathname)");
      assert.ok(Array.isArray(scripts)&&scripts.some(item=>typeof item==='string'&&item.startsWith('/workbench/app/assets/')&&item.endsWith('.js')&&inventory.includes(item.slice('/workbench/app/'.length))));
      await browser.evaluate(trace);await browser.evaluate("document.querySelector('[data-action=new-report]').click()");
      await browser.waitFor("Boolean(document.querySelector('[data-manual-report-form]'))");await capabilities(browser);
      await fill(browser,'报修来源','ON_SITE');await fill(browser,'故障描述',description);await fill(browser,'故障位置',location);
      const before=await externalCounts(pool);await image(browser,evidence,'01-preserved-input-before-refusal.png');stage='INPUT_CAPTURED';
      await fill(browser,'报修人姓名','合成');
      if(refusal==='VERIFY'){
        await browser.waitFor("[...document.querySelectorAll('[role=option]')].some(row=>row.textContent.includes('合成成员甲')&&row.textContent.includes('合成门诊'))");
        await browser.evaluate("(()=>{const option=[...document.querySelectorAll('[role=option]')].find(row=>row.textContent.includes('合成成员甲')&&row.textContent.includes('合成门诊'));if(!option)throw Error('T18_ALLOWED_OPTION_MISSING');option.click();})()");
        await browser.waitFor("Boolean(document.querySelector('[data-selected-reporter]'))&&document.querySelector('[data-action=submit-manual-report]')?.disabled===false");
        await browser.evaluate("document.querySelector('[data-action=submit-manual-report]').click()");
      }
      const refusedPath=refusal==='SEARCH'?'/api/workbench/reporter-candidates':'/api/workbench/reports';
      await browser.waitFor(`globalThis.__t18CandidateRefusalRows.some(row=>row.path===${JSON.stringify(refusedPath)}&&row.status===403)
        &&[...document.querySelectorAll('[data-manual-report-result],[data-manual-report-form] [role=status]')].some(node=>node.textContent.trim()&&!node.textContent.includes('正在'))`);
      stage='SCOPED_403_OBSERVED';await capabilities(browser);
      const current=object(await browser.evaluate("({description:document.querySelector('[aria-label=\"故障描述\"]')?.value??null,location:document.querySelector('[aria-label=\"故障位置\"]')?.value??null,source:document.querySelector('[aria-label=\"报修来源\"]')?.value??null,name:document.querySelector('[aria-label=\"报修人姓名\"]')?.value??null})"));
      assert.equal(current.description,description,'a candidate object refusal must preserve the authorized report description');
      assert.equal(current.location,location,'a candidate object refusal must preserve the authorized report location');assert.equal(current.source,'ON_SITE');
      assert.equal(current.name,refusal==='SEARCH'?'合成':'合成成员甲');assert.ok(authority.calls.search>=1);assert.equal(authority.calls.verify,refusal==='VERIFY'?1:0);
      assert.deepEqual(await externalCounts(pool),before,'a Directory refusal cannot create external communication or delivery');
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-action=manual-reporter-fallback]'))&&!document.querySelector('[data-action=manual-reporter-fallback]').matches(':disabled')"),true,'manual fallback must remain an explicit available choice');
      await image(browser,evidence,'02-scoped-refusal-input-retained.png');
      await browser.evaluate("document.querySelector('[data-action=manual-reporter-fallback]').click()");
      await browser.waitFor("Boolean(document.querySelector('[aria-label=\"联系方式\"]'))&&!document.querySelector('[aria-label=\"联系方式\"]').matches(':disabled')");
      await fill(browser,'联系方式','人工联系内线7788');await fill(browser,'报修人科室','合成门诊');
      await browser.waitFor("document.querySelector('[data-action=submit-manual-report]')?.disabled===false");
      await browser.evaluate("document.querySelector('[data-action=submit-manual-report]').click()");
      await browser.waitFor("document.querySelector('[data-toast-source=manual-report]')?.textContent.includes('已受理')&&globalThis.__t18CandidateRefusalRows.some(row=>row.method==='POST'&&row.path==='/api/workbench/reports'&&row.status===202&&row.result?.reporter_verification==='UNVERIFIED')");
      stage='HAND_ENTERED_ADMITTED';
      const posts:unknown=await browser.evaluate("globalThis.__t18CandidateRefusalRows.filter(row=>row.method==='POST'&&row.path==='/api/workbench/reports')");assert.ok(Array.isArray(posts));assert.equal(posts.length,refusal==='SEARCH'?1:2);
      const admitted=object(posts[posts.length-1]),body=object(admitted.body),result=object(admitted.result),id=string(body.client_command_id);
      assert.equal(admitted.status,202);assert.equal(result.client_command_id,id);assert.equal(result.reporter_verification,'UNVERIFIED');assert.equal(result.manual_contact_required,true);assert.equal(result.external_notification,false);
      assert.equal(body.source,'ON_SITE');assert.equal(body.description,description);assert.deepEqual(body.location,{text:location,unknown:false});
      assert.deepEqual(body.reporter,{verification:'UNVERIFIED',name:current.name,contact:'人工联系内线7788',department:'合成门诊'});
      if(refusal==='VERIFY'){const rejected=object(posts[0]);assert.equal(rejected.status,403);assert.equal(object(object(rejected.body).reporter).verification,'VERIFIED_SELECTION');assert.notEqual(object(rejected.body).client_command_id,id);}
      const saved=(await pool.query<{snapshot:unknown;actor:string}>(`SELECT manual_report_snapshot AS snapshot,manual_actor_principal_id::text AS actor
        FROM intake.service_intake WHERE id=$1::uuid AND source_provider='STAFF_MANUAL_REPORT'`,[string(result.intake_id)])).rows[0];assert.ok(saved);
      assert.equal(saved.actor,principal.id);const snapshot=object(saved.snapshot);assert.equal(snapshot.identity_source,'HAND_ENTERED');assert.deepEqual(snapshot.reporter,body.reporter);
      assert.deepEqual(await externalCounts(pool),before,'an explicit unverified fallback must not produce any external message/outbox/delivery');
      const observedCapabilities:unknown=await browser.evaluate("globalThis.__t18CandidateRefusalRows.filter(row=>row.path==='/api/workbench/reports/capabilities'&&row.status!==null).map(row=>({status:row.status,can_create:row.result?.can_create}))");
      assert.ok(Array.isArray(observedCapabilities)&&observedCapabilities.length>=2);for(const row of observedCapabilities)assert.deepEqual(row,{status:200,can_create:true});
      assert.equal(authority.calls.verify,refusal==='VERIFY'?1:0,'hand entry must not silently retry Directory verification');
      await image(browser,evidence,'03-hand-entered-result.png');
      console.log('T18_CANDIDATE_REFUSAL_EVIDENCE '+JSON.stringify({refusal,evidence,stage,external_notification:false}));
    }catch(failure){error=failure;if(browser)try{await image(browser,evidence,'failure-actual-ui.png');}catch{/* Preserve the primary test failure. */}
      console.log('T18_CANDIDATE_REFUSAL_DIAGNOSTIC '+JSON.stringify({refusal,evidence,stage}));}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchManualReportsEnabled:true,workbenchReporterCandidatesEnabled:true,manualReporterDirectory:authority.directory,workbenchDraftRecoveryEnabled:true,
    workbenchManualReviewEnabled:true,workbenchRealtimeEnabled:true,realWorkbenchAuthentication:true});
});
