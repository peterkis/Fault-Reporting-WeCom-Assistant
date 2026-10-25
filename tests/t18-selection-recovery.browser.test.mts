// SOURCE_READY_NOT_RUN. Two consumers of the existing authorized encrypted draft
// protocol: unsubmitted selection intent and one genuinely committed unknown POST.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {createT18Directory,applyT18ForwardCheck} from './helpers/t18-verified-fixture.mjs';
import {createP2016Runtime,type P2016EnabledRuntime} from '../app/server/src/p2-016-runtime.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface Fixture {origin:string;pool:PostgresPool;principals:{id:string}[];outsider:{id:string};runtime:P2016EnabledRuntime;
  certificateSpki?:string;browserCookies:{name:string;value:string;url:string}[]}
function isObject(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function object(value:unknown):Record<string,unknown>{if(!isObject(value))assert.fail('object required');return value;}
function string(value:unknown):string{if(typeof value!=='string'||!value)assert.fail('nonempty string required');return value;}
const description='合成恢复验证：打印机情况不明',location='合成门诊二楼',contact='人工联系内线7788';
function observe(loseCommittedResponse:boolean){return `(()=>{
  if(globalThis.__t18RecoveryInstalled)return;globalThis.__t18RecoveryInstalled=true;globalThis.__t18RecoveryRows=[];
  const original=globalThis.fetch;
  globalThis.fetch=async(input,options)=>{
    const url=new URL(input instanceof Request?input.url:String(input),location.href),method=options?.method??(input instanceof Request?input.method:'GET');
    const tracked=url.origin===location.origin&&(url.pathname==='/api/lifecycle/bootstrap'||url.pathname==='/api/workbench/reporter-candidates'||url.pathname.startsWith('/api/workbench/reports'));
    const row={path:url.pathname,method,status:null,body:method==='POST'&&options?.body?JSON.parse(options.body):null,result:null,lost:false};
    if(tracked)globalThis.__t18RecoveryRows.push(row);
    const response=await original(input,options);
    if(tracked){try{row.result=await response.clone().json();}catch{}row.status=response.status;}
    if(${JSON.stringify(loseCommittedResponse)}&&method==='POST'&&url.pathname==='/api/workbench/reports'&&response.status===202){row.lost=true;throw new TypeError('T18_ACTUAL_COMMITTED_RESPONSE_LOST');}
    return response;
  };
})()`;}
// Observe stored metadata only. Never insert a draft/operation or manufacture a
// successful receipt. The real browser keeps the original encryption key.
const copies=`new Promise((resolve,reject)=>{
  const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result,tx=db.transaction(['drafts','operations']),drafts=tx.objectStore('drafts').getAll(),operations=tx.objectStore('operations').getAll();
    tx.onerror=()=>{db.close();reject(tx.error);};tx.oncomplete=()=>{db.close();resolve({
      drafts:drafts.result.filter(row=>row.kind==='intake'&&row.purpose==='manual-report').map(row=>({principal:row.principal,id:row.id,algorithm:row.key?.algorithm?.name,extractable:row.key?.extractable,bytes:row.ciphertext?.byteLength,plaintext:JSON.stringify(row).includes('合成恢复验证')})),
      operations:operations.result.filter(row=>row.kind==='intake'&&row.purpose==='manual-report').map(row=>({principal:row.principal,id:row.id,commandId:row.commandId}))});};};
})`;
async function image(browser:Browser,evidence:string,name:string){await writeFile(join(evidence,name),Buffer.from(await browser.screenshot(),'base64'));}
async function archiveFailureImage(browser:Browser,stage:string){
  const bytes=Buffer.from(await browser.screenshot(),'base64'),width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);const file=join(directory,'new-detail-900.png');await writeFile(file,bytes);
  console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',scenario:'T18_SELECTION_FLAG_OFF_RESTART_FAILURE',stage,
    screenshots:[{file,width,height,sha256:createHash('sha256').update(bytes).digest('hex')}]}));
}
async function fill(browser:Browser,label:string,value:string){
  await browser.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify('[aria-label="'+label+'"]')});if(!input)throw Error('T18_RECOVERY_FIELD_MISSING');
    const kind=input instanceof HTMLTextAreaElement?HTMLTextAreaElement:input instanceof HTMLSelectElement?HTMLSelectElement:HTMLInputElement;
    Object.getOwnPropertyDescriptor(kind.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event(kind===HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
}
async function compiledForm(browser:Browser){
  await browser.waitFor("Boolean(document.querySelector('[data-manual-report-form]'))&&document.querySelector('[data-action=submit-manual-report]')?.disabled===false");
  const inventory:unknown=JSON.parse(await readFile(new URL('../web/admin-workbench/asset-inventory.json',import.meta.url),'utf8'));
  assert.ok(Array.isArray(inventory)&&inventory.every(item=>typeof item==='string'));
  const scripts:unknown=await browser.evaluate("[...document.scripts].filter(item=>item.src).map(item=>new URL(item.src).pathname)");
  assert.ok(Array.isArray(scripts)&&scripts.some(item=>typeof item==='string'&&item.startsWith('/workbench/app/assets/')&&item.endsWith('.js')&&inventory.includes(item.slice('/workbench/app/'.length))));
  assert.equal(await browser.evaluate('isSecureContext&&Boolean(crypto.subtle)'),true);
}
async function install(browser:Browser,loss:boolean){const source=observe(loss);await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source});await browser.evaluate(source);}
async function reload(browser:Browser){const previous=await browser.evaluate('performance.timeOrigin');assert.equal(typeof previous,'number');await browser.command('Page.reload');
  await browser.waitFor(`performance.timeOrigin!==${JSON.stringify(previous)}&&Boolean(document.querySelector('[data-manual-report-form]'))`);}
async function select(browser:Browser){
  await fill(browser,'报修人姓名','合成');await browser.waitFor("[...document.querySelectorAll('[role=option]')].some(row=>row.textContent.includes('合成成员甲')&&row.textContent.includes('合成门诊'))");
  await browser.evaluate("(()=>{const option=[...document.querySelectorAll('[role=option]')].find(row=>row.textContent.includes('合成成员甲')&&row.textContent.includes('合成门诊'));if(!option)throw Error('T18_RECOVERY_OPTION_MISSING');option.click();})()");
  await browser.waitFor("Boolean(document.querySelector('[data-selected-reporter]'))");
}
async function prepare(browser:Browser){await fill(browser,'报修来源','ON_SITE');await fill(browser,'故障描述',description);await fill(browser,'故障位置',location);
  // A previously supplied contact must never silently authorize HAND_ENTERED
  // fallback when the selected UI hides that field and the candidate flag changes.
  await fill(browser,'联系方式',contact);await select(browser);}
async function saved(browser:Browser,principalId:string){
  await browser.waitFor("document.querySelector('[data-manual-report-draft-status]')?.textContent.includes('已保存恢复副本')");
  const stored=object(await browser.evaluate(copies));assert.ok(Array.isArray(stored.drafts)&&stored.drafts.length===1);const draft=object(stored.drafts[0]);
  assert.equal(draft.principal,principalId);assert.equal(draft.algorithm,'AES-GCM');assert.equal(draft.extractable,false);assert.equal(draft.plaintext,false);assert.ok(typeof draft.bytes==='number'&&draft.bytes>0);
  return stored;
}
async function closeRuntime(runtime:P2016EnabledRuntime){await runtime.stop();assert.equal(runtime.server.listening,false);assert.equal((await runtime.observability.metrics()).sse_clients,0);
  assert.equal(await new Promise<number>((resolve,reject)=>runtime.server.getConnections((error,count)=>error?reject(error):resolve(count))),0);}

const options={workbenchManualReportsEnabled:true,workbenchReporterCandidatesEnabled:true,workbenchDraftRecoveryEnabled:true,workbenchManualReviewEnabled:true,workbenchRealtimeEnabled:true};
test('a restored explicit reporter selection cannot silently become hand entry after a real candidate-flag restart',{timeout:240000},async()=>{
  if(process.platform==='win32')assert.match(resolve(tmpdir()),/^D:[\\/]/iu);const evidence=await mkdtemp(join(tmpdir(),'t18-selection-intent-recovery-')),authority=createT18Directory();
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const {origin,pool,principals}=fixture,principal=principals[0],other=principals[1];assert.ok(principal&&other);authority.setPrincipal(principal.id);await applyT18ForwardCheck(pool);
    let runtime=fixture.runtime,browser:Browser|undefined,error:unknown,stage='FIXTURE_READY',removeRestartObserver:(()=>void)|undefined;
    const replacementBootstrapStatuses:number[]=[];
    try{
      const cookie=fixture.browserCookies[0];assert.ok(cookie);
      browser=await launchSystemBrowser({url:origin+'/workbench/app/reports/new',width:900,height:900,cookies:[cookie]});assert.ok(browser);
      await compiledForm(browser);await install(browser,false);await prepare(browser);const stored=await saved(browser,principal.id);assert.deepEqual(stored.operations,[]);
      await image(browser,evidence,'01-selected-draft.png');stage='SELECTED_DRAFT_SAVED';await reload(browser);
      await browser.waitFor(`document.querySelector('[aria-label="故障描述"]')?.value===${JSON.stringify(description)}&&document.querySelector('[data-manual-report-draft-status]')?.textContent.includes('恢复')`);
      const restored=object(await browser.evaluate("({selected:document.querySelector('[data-selected-reporter]')?.textContent??'',text:document.querySelector('.manual-report-page')?.textContent??'',disabled:document.querySelector('[data-action=submit-manual-report]')?.disabled,location:document.querySelector('[aria-label=\"故障位置\"]')?.value})"));
      assert.equal(restored.location,location);
      assert.ok(typeof restored.selected==='string'&&restored.selected.includes('合成成员甲')||typeof restored.text==='string'&&restored.text.includes('重新选择')&&restored.disabled===true,
        'restoration must retain explicit selection intent or visibly require re-selection, never silently use hand entry');
      assert.equal(await browser.evaluate("globalThis.__t18RecoveryRows.filter(row=>row.method==='POST').length"),0);stage='SELECTION_INTENT_RESTORED';
      // Choose the same authorized candidate explicitly before exercising the separate
      // flag-off boundary; both allowed restoration policies above remain valid.
      await select(browser);await saved(browser,principal.id);
      await browser.waitFor(`document.querySelector('[aria-label="故障描述"]')?.value===${JSON.stringify(description)}&&document.querySelector('[data-action=return-workbench]')?.getAttribute('aria-disabled')==='false'`);
      // Leave the document before replacing its fixture session: background reads
      // with the old cookie correctly revoke authorization and purge drafts.
      await browser.command('Page.navigate',{url:'about:blank'});await browser.waitFor("location.href==='about:blank'&&document.readyState==='complete'");
      await runtime.stop();assert.equal(runtime.server.listening,false);
      const restarted=createP2016Runtime({pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:origin,listenPort:Number(new URL(origin).port),
        principalIds:[principal.id,fixture.outsider.id,other.id],gatewayEnabled:false,senderEnabled:false,externalSendEnabled:false,
        ...options,workbenchReporterCandidatesEnabled:false,manualReporterDirectory:authority.directory});
      if('disabled' in restarted)throw Error('T18_RESTARTED_RUNTIME_DISABLED');runtime=restarted;
      const onRestartRequest=(request:IncomingMessage,response:ServerResponse)=>{if(request.url==='/api/lifecycle/bootstrap')response.once('finish',()=>replacementBootstrapStatuses.push(response.statusCode));};
      restarted.server.on('request',onRestartRequest);removeRestartObserver=()=>{restarted.server.off('request',onRestartRequest);};
      const started=await runtime.start();assert.ok(started.cookies);const nextCookie=started.cookies[0];assert.ok(nextCookie&&typeof nextCookie.url==='string');
      await browser.command('Network.setCookies',{cookies:[{...nextCookie,url:nextCookie.url}]});await browser.command('Page.navigate',{url:origin+'/workbench/app/reports/new'});
      await browser.waitFor("Boolean(document.querySelector('[data-manual-report-form]'))");
      await browser.waitFor(`globalThis.__t18RecoveryRows.some(row=>row.path==='/api/lifecycle/bootstrap'&&row.status===200&&row.result?.reporter_candidates_enabled===false)
        &&document.querySelector('[aria-label="故障描述"]')?.value===${JSON.stringify(description)}`);
      stage='REAL_CANDIDATE_FLAG_OFF';
      const switched=object(await browser.evaluate("({text:document.querySelector('.manual-report-page')?.textContent??'',disabled:document.querySelector('[data-action=submit-manual-report]')?.disabled,fallback:Boolean(document.querySelector('[data-action=manual-reporter-fallback]')),posts:globalThis.__t18RecoveryRows.filter(row=>row.method==='POST').length,principal:globalThis.__t18RecoveryRows.find(row=>row.path==='/api/lifecycle/bootstrap'&&row.status===200)?.result?.principal_id})"));
      assert.equal(switched.principal,principal.id);assert.equal(switched.posts,0);
      assert.ok(typeof switched.text==='string'&&/手填/u.test(switched.text)&&/关闭|不可用|未开放|重新选择|停用|不可选择|无法选择/u.test(switched.text),'a disabled candidate path must explicitly explain the restored choice and request manual fallback');
      assert.equal(switched.disabled,true,'hidden contact data must not allow an implicit HAND_ENTERED submission');assert.equal(switched.fallback,true);
      await image(browser,evidence,'02-real-flag-off-explicit-choice.png');await browser.evaluate("document.querySelector('[data-action=manual-reporter-fallback]').click()");
      await browser.waitFor("Boolean(document.querySelector('[aria-label=\"联系方式\"]'))&&!document.querySelector('[aria-label=\"联系方式\"]').matches(':disabled')");
      await fill(browser,'联系方式',contact);await browser.waitFor("document.querySelector('[data-action=submit-manual-report]')?.disabled===false");
      await browser.evaluate("document.querySelector('[data-action=submit-manual-report]').click()");
      await browser.waitFor("document.querySelector('[data-manual-report-result]')?.textContent.includes('已受理')&&globalThis.__t18RecoveryRows.some(row=>row.method==='POST'&&row.status===202&&row.result?.reporter_verification==='UNVERIFIED')");
      const posts:unknown=await browser.evaluate("globalThis.__t18RecoveryRows.filter(row=>row.method==='POST')");assert.ok(Array.isArray(posts)&&posts.length===1);
      const body=object(object(posts[0]).body);assert.equal(object(body.reporter).verification,'UNVERIFIED');assert.equal(body.description,description);assert.deepEqual(body.location,{text:location,unknown:false});assert.equal(authority.calls.verify,0);
      stage='EXPLICIT_HAND_ENTRY_ADMITTED';await image(browser,evidence,'03-explicit-hand-entry-result.png');console.log('T18_SELECTION_RECOVERY_EVIDENCE '+JSON.stringify({case:'SELECTION_FLAG_OFF',evidence,stage}));
    }catch(failure){
      error=failure;
      if(browser){
        try{await archiveFailureImage(browser,stage);}catch{}
        try{await image(browser,evidence,'failure-actual-ui.png');}catch{}
        try{
          const view:unknown=await browser.evaluate(`(()=>({path:location.pathname,form:Boolean(document.querySelector('[data-manual-report-form]')),description_matches:document.querySelector('[aria-label="故障描述"]')?.value===${JSON.stringify(description)},description_length:document.querySelector('[aria-label="故障描述"]')?.value?.length??null,selected:Boolean(document.querySelector('[data-selected-reporter]')),fallback:Boolean(document.querySelector('[data-action=manual-reporter-fallback]')),draft_status:document.querySelector('[data-manual-report-draft-status]')?.textContent?.slice(0,300)??null,bootstrap:(globalThis.__t18RecoveryRows??[]).filter(row=>row.path==='/api/lifecycle/bootstrap').slice(-16).map(row=>({status:row.status,flag:row.result?.reporter_candidates_enabled??null})),post_count:(globalThis.__t18RecoveryRows??[]).filter(row=>row.method==='POST').length}))()`);
          const stored:unknown=await browser.evaluate(copies);console.log('T18_SELECTION_RECOVERY_STATE '+JSON.stringify({stage,view,stored,replacement_bootstrap_statuses:replacementBootstrapStatuses}));
        }catch{}
      }
      console.log('T18_SELECTION_RECOVERY_DIAGNOSTIC '+JSON.stringify({case:'SELECTION_FLAG_OFF',evidence,stage}));
    }finally{removeRestartObserver?.();}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},()=>closeRuntime(runtime)],error);
  },{...options,manualReporterDirectory:authority.directory});
});

test('a committed verified admission with a lost response reloads and settles its original UUID by GET without a second POST',{timeout:240000},async()=>{
  if(process.platform==='win32')assert.match(resolve(tmpdir()),/^D:[\\/]/iu);const evidence=await mkdtemp(join(tmpdir(),'t18-verified-unknown-recovery-')),authority=createT18Directory();
  await withWeb01Fixture(async(raw:Fixture)=>{
    const {origin,pool,principals,certificateSpki,browserCookies}=raw,principal=principals[0];assert.ok(principal);authority.setPrincipal(principal.id);await applyT18ForwardCheck(pool);
    let browser:Browser|undefined,error:unknown,stage='FIXTURE_READY';
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/reports/new',width:900,height:900,cookies:browserCookies,...(certificateSpki?{certificateSpki}:{})});assert.ok(browser);
      await compiledForm(browser);await install(browser,true);await prepare(browser);await saved(browser,principal.id);
      await browser.waitFor("document.querySelector('[data-action=submit-manual-report]')?.disabled===false");await browser.evaluate("document.querySelector('[data-action=submit-manual-report]').click()");
      await browser.waitFor("document.querySelector('[data-manual-report-result]')?.textContent.includes('结果未知')&&globalThis.__t18RecoveryRows.some(row=>row.method==='POST'&&row.status===202&&row.lost)");
      const posts:unknown=await browser.evaluate("globalThis.__t18RecoveryRows.filter(row=>row.method==='POST')");assert.ok(Array.isArray(posts)&&posts.length===1);
      const post=object(posts[0]),command=object(post.body),result=object(post.result),commandId=string(command.client_command_id),intakeId=string(result.intake_id);
      assert.equal(result.reporter_verification,'VERIFIED');assert.equal(result.external_notification,false);
      assert.deepEqual(command.reporter,{verification:'VERIFIED_SELECTION',candidate_ref:authority.candidate.candidate_ref,candidate_version:authority.candidate.candidate_version});
      const before=object(await browser.evaluate(copies));assert.ok(Array.isArray(before.operations)&&before.operations.length===1);assert.equal(object(before.operations[0]).commandId,commandId);
      const retained=async()=>{const row=(await pool.query<{selection:unknown;receipts:number}>(`SELECT i.manual_reporter_verification->'selection' AS selection,
        (SELECT count(*)::integer FROM pilot_ticket.ticket_command_receipt r WHERE r.command_scope=$2 AND r.client_command_id=$3::uuid AND r.command_type='WORKBENCH_MANUAL_REPORT') AS receipts
        FROM intake.service_intake i WHERE i.id=$1::uuid AND i.source_provider='STAFF_MANUAL_REPORT'`,[intakeId,'P2_016:'+principal.id,commandId])).rows[0];assert.ok(row);return row;};
      const committed=await retained();assert.equal(committed.receipts,1);assert.deepEqual(committed.selection,command.reporter);
      stage='ACTUAL_COMMIT_RESPONSE_LOST';await image(browser,evidence,'01-committed-result-unknown.png');await reload(browser);
      await browser.waitFor("Boolean(document.querySelector('[data-action=check-manual-report-receipt]'))&&document.querySelector('[data-manual-report-result]')?.textContent.includes('结果未知')");
      const restored=object(await browser.evaluate(copies));assert.ok(Array.isArray(restored.operations)&&restored.operations.length===1);assert.equal(object(restored.operations[0]).commandId,commandId);
      assert.equal(await browser.evaluate("globalThis.__t18RecoveryRows.filter(row=>row.method==='POST').length"),0);
      await browser.waitFor("document.querySelector('[data-action=check-manual-report-receipt]')?.disabled===false");await browser.evaluate("document.querySelector('[data-action=check-manual-report-receipt]').click()");
      const receiptPath='/api/workbench/reports/commands/'+commandId;
      await browser.waitFor(`document.querySelector('[data-manual-report-result]')?.textContent.includes('已受理')&&globalThis.__t18RecoveryRows.some(row=>row.method==='GET'&&row.path===${JSON.stringify(receiptPath)}&&row.status===200&&row.result?.state==='COMMITTED')`);
      await browser.waitFor(`(async()=>{const current=await (${copies});return current.drafts.length===0&&current.operations.length===0;})()`);
      const reads:unknown=await browser.evaluate("globalThis.__t18RecoveryRows.filter(row=>row.path.startsWith('/api/workbench/reports/commands/'))");assert.ok(Array.isArray(reads)&&reads.length>=1);
      for(const read of reads){const row=object(read);assert.equal(row.path,receiptPath);assert.equal(row.method,'GET');assert.equal(row.status,200);assert.equal(object(row.result).client_command_id,commandId);}
      assert.equal(await browser.evaluate("globalThis.__t18RecoveryRows.filter(row=>row.method==='POST').length"),0);assert.equal(authority.calls.verify,1);assert.deepEqual(await retained(),committed);
      stage='ORIGINAL_UUID_GET_SETTLED';await image(browser,evidence,'02-original-receipt-cleared.png');console.log('T18_SELECTION_RECOVERY_EVIDENCE '+JSON.stringify({case:'VERIFIED_UNKNOWN',evidence,stage}));
    }catch(failure){error=failure;if(browser)try{await image(browser,evidence,'failure-actual-ui.png');}catch{}console.log('T18_SELECTION_RECOVERY_DIAGNOSTIC '+JSON.stringify({case:'VERIFIED_UNKNOWN',evidence,stage}));}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{...options,manualReporterDirectory:authority.directory,realWorkbenchAuthentication:true});
});
