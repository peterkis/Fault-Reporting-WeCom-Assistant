// SOURCE_READY_NOT_RUN. A real committed admission can still return 403 during
// the post-commit authority read. Such a response is not proof of non-admission.
// Only isolated access grants change; no response or business fact is replaced.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {chooseWorkbenchSelect} from './helpers/heroui-workbench-controls.mjs';
import {createT18Directory,applyT18ForwardCheck} from './helpers/t18-verified-fixture.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface Fixture {origin:string;pool:PostgresPool;principals:{id:string}[];certificateSpki:string;browserCookies:{name:string;value:string;url:string}[]}
function isObject(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function object(value:unknown):Record<string,unknown>{if(!isObject(value))assert.fail('object required');return value;}
function string(value:unknown):string{if(typeof value!=='string'||!value)assert.fail('nonempty string required');return value;}
const description='合成经核实代录：打印机无法打印',location='合成门诊二楼';

const trace=`(()=>{
  if(globalThis.__t18PostcommitInstalled)return;
  globalThis.__t18PostcommitInstalled=true;globalThis.__t18PostcommitRows=[];
  globalThis.__t18Postcommit403=false;globalThis.__t18PostcommitAllowCapability=false;
  const original=globalThis.fetch;
  globalThis.fetch=async(input,options)=>{
    const url=new URL(input instanceof Request?input.url:String(input),location.href),method=options?.method??(input instanceof Request?input.method:'GET');
    const tracked=url.origin===location.origin&&(url.pathname==='/api/workbench/reporter-candidates'||url.pathname.startsWith('/api/workbench/reports'));
    const row={path:url.pathname,method,status:null,body:method==='POST'&&options?.body?JSON.parse(options.body):null,result:null,held:false};
    if(tracked)globalThis.__t18PostcommitRows.push(row);
    // Scheduling barrier only: this GET has not left the browser yet. Restore
    // the actual access grant before forwarding it unchanged to the real server.
    if(tracked&&method==='GET'&&url.pathname==='/api/workbench/reports/capabilities'&&globalThis.__t18Postcommit403&&!globalThis.__t18PostcommitAllowCapability){
      row.held=true;await new Promise(resolve=>{(globalThis.__t18PostcommitCapabilityWaiters??=[]).push(resolve);});
    }
    const response=await original(input,options);
    if(tracked){try{row.result=await response.clone().json();}catch{}row.status=response.status;}
    if(tracked&&method==='POST'&&url.pathname==='/api/workbench/reports'&&response.status===403)globalThis.__t18Postcommit403=true;
    return response;
  };
})()`;
const releaseCapabilities=`(()=>{globalThis.__t18PostcommitAllowCapability=true;for(const resolve of globalThis.__t18PostcommitCapabilityWaiters??[])resolve();globalThis.__t18PostcommitCapabilityWaiters=[];})()`;
// Inspect only real IndexedDB metadata. Never seed a pending command/draft or
// alter the real encrypted contents/key, and never restore data during denial.
const copies=`new Promise((resolve,reject)=>{
  const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result,tx=db.transaction(['drafts','operations']),drafts=tx.objectStore('drafts').getAll(),operations=tx.objectStore('operations').getAll();
    tx.onerror=()=>{db.close();reject(tx.error);};tx.oncomplete=()=>{db.close();resolve({
      drafts:drafts.result.filter(row=>row.kind==='intake'&&row.purpose==='manual-report').map(row=>({principal:row.principal,id:row.id,algorithm:row.key?.algorithm?.name,extractable:row.key?.extractable,bytes:row.ciphertext?.byteLength,plaintext:JSON.stringify(row).includes('合成经核实代录')})),
      operations:operations.result.filter(row=>row.kind==='intake'&&row.purpose==='manual-report').map(row=>({principal:row.principal,id:row.id,commandId:row.commandId}))});};};
})`;
async function image(browser:Browser,evidence:string,name:string){await writeFile(join(evidence,name),Buffer.from(await browser.screenshot(),'base64'));}
async function fill(browser:Browser,label:string,value:string){
  if(label==='报修来源'){await chooseWorkbenchSelect(browser,'[data-field-label="报修来源"]',value);return;}
  await browser.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify('[aria-label="'+label+'"]')});if(!input)throw Error('T18_POSTCOMMIT_FIELD_MISSING');
    const kind=input instanceof HTMLTextAreaElement?HTMLTextAreaElement:input instanceof HTMLSelectElement?HTMLSelectElement:HTMLInputElement;
    Object.getOwnPropertyDescriptor(kind.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event(kind===HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
}
async function externalCounts(pool:PostgresPool){
  const row=(await pool.query<{communications:number;outbox:number;deliveries:number;notifications:number;notification_deliveries:number}>(`SELECT
    (SELECT count(*)::integer FROM communication.message) AS communications,(SELECT count(*)::integer FROM communication.outbox) AS outbox,
    (SELECT count(*)::integer FROM communication.delivery) AS deliveries,(SELECT count(*)::integer FROM notification.outbox) AS notifications,
    (SELECT count(*)::integer FROM notification.delivery) AS notification_deliveries`)).rows[0];assert.ok(row);return row;
}
async function admissionFacts(pool:PostgresPool,actorId:string){
  const row=(await pool.query<{receipts:number;intakes:number;tickets:number;received_events:number;created_events:number;ticket_events:number;ticket_rows:unknown}>(`WITH manual AS (
      SELECT id FROM intake.service_intake WHERE source_provider='STAFF_MANUAL_REPORT' AND manual_actor_principal_id=$1::uuid
    ), core AS (SELECT t.id,t.ticket_no,t.status,t.version FROM pilot_ticket.ticket t JOIN manual m ON m.id=t.source_intake_id)
    SELECT (SELECT count(*)::integer FROM pilot_ticket.ticket_command_receipt WHERE command_type='WORKBENCH_MANUAL_REPORT' AND actor_principal_id=$1::uuid) AS receipts,
      (SELECT count(*)::integer FROM manual) AS intakes,(SELECT count(*)::integer FROM core) AS tickets,
      (SELECT count(*)::integer FROM intake.service_intake_event e JOIN manual m ON m.id=e.intake_id WHERE e.event_type='intake.received') AS received_events,
      (SELECT count(*)::integer FROM pilot_ticket.ticket_event e JOIN core t ON t.id=e.ticket_id WHERE e.event_type='ticket.created') AS created_events,
      (SELECT count(*)::integer FROM pilot_ticket.ticket_event e JOIN core t ON t.id=e.ticket_id) AS ticket_events,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id::text,'number',ticket_no,'status',status,'version',version) ORDER BY id) FROM core),'[]'::jsonb) AS ticket_rows`,[actorId])).rows[0];assert.ok(row);return row;
}
async function installRevocation(pool:PostgresPool,actorId:string){
  assert.match(actorId,/^[0-9a-f-]{36}$/iu);
  // The AFTER trigger changes access configuration only, after admit's last
  // in-transaction authority read, in the same real transaction as COMMITTED.
  // It does not fabricate a receipt, write result_snapshot or touch business rows.
  await pool.query(`CREATE FUNCTION intake.t18_revoke_creation_after_receipt_commit() RETURNS trigger LANGUAGE plpgsql AS $t18$
    BEGIN
      IF OLD.state IS DISTINCT FROM NEW.state AND NEW.state='COMMITTED' AND NEW.command_type='WORKBENCH_MANUAL_REPORT'
        AND NEW.actor_principal_id=TG_ARGV[0]::uuid THEN
        DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=NEW.actor_principal_id;
      END IF;
      RETURN NEW;
    END;
    $t18$`);
  await pool.query(`CREATE TRIGGER t18_revoke_creation_after_receipt_commit AFTER UPDATE OF state ON pilot_ticket.ticket_command_receipt
    FOR EACH ROW EXECUTE FUNCTION intake.t18_revoke_creation_after_receipt_commit('${actorId}')`);
}
async function removeRevocation(pool:PostgresPool){
  await pool.query('DROP TRIGGER IF EXISTS t18_revoke_creation_after_receipt_commit ON pilot_ticket.ticket_command_receipt');
  await pool.query('DROP FUNCTION IF EXISTS intake.t18_revoke_creation_after_receipt_commit()');
}

test('a real post-commit 403 preserves the original verified command for explicit GET reconciliation without duplicate admission',{timeout:240000},async()=>{
  if(process.platform==='win32')assert.match(resolve(tmpdir()),/^D:[\\/]/iu,'browser profile and evidence must stay on D');
  const evidence=await mkdtemp(join(tmpdir(),'t18-postcommit-refusal-')),authority=createT18Directory();
  await withWeb01Fixture(async({origin,pool,principals,certificateSpki,browserCookies}:Fixture)=>{
    const principal=principals[0];assert.ok(principal);authority.setPrincipal(principal.id);await applyT18ForwardCheck(pool);
    const access=createPilotAccessService({pool});
    // Preserve the real authenticated principal ID while making creation depend
    // on membership. ADMIN/DISPATCHER would legitimately bypass this condition.
    const restore=()=>access.upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
    const handler=await restore();assert.equal(handler.id,principal.id);assert.deepEqual(handler.roles,['HANDLER']);assert.deepEqual(handler.resolver_team_ids,['PILOT_IT']);
    let browser:Browser|undefined,error:unknown,stage='FIXTURE_READY';
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/reports/new',width:900,height:900,cookies:browserCookies,certificateSpki});assert.ok(browser);
      await browser.waitFor("Boolean(document.querySelector('[data-manual-report-form]'))&&document.querySelector('[data-action=submit-manual-report]')?.disabled===false");
      const inventory:unknown=JSON.parse(await readFile(new URL('../web/admin-workbench/asset-inventory.json',import.meta.url),'utf8'));
      assert.ok(Array.isArray(inventory)&&inventory.every(item=>typeof item==='string'));
      const scripts:unknown=await browser.evaluate("[...document.scripts].filter(item=>item.src).map(item=>new URL(item.src).pathname)");
      assert.ok(Array.isArray(scripts)&&scripts.some(item=>typeof item==='string'&&item.startsWith('/workbench/app/assets/')&&item.endsWith('.js')&&inventory.includes(item.slice('/workbench/app/'.length))));
      assert.equal(await browser.evaluate('isSecureContext&&Boolean(crypto.subtle)'),true);
      await browser.evaluate(trace);await fill(browser,'报修来源','ON_SITE');await fill(browser,'故障描述',description);await fill(browser,'故障位置',location);
      await fill(browser,'报修人姓名','合成');
      await browser.waitFor("[...document.querySelectorAll('[role=option]')].some(row=>row.textContent.includes('合成成员甲')&&row.textContent.includes('合成门诊'))");
      await browser.evaluate("(()=>{const option=[...document.querySelectorAll('[role=option]')].find(row=>row.textContent.includes('合成成员甲')&&row.textContent.includes('合成门诊'));if(!option)throw Error('T18_POSTCOMMIT_OPTION_MISSING');option.click();})()");
      await browser.waitFor("Boolean(document.querySelector('[data-selected-reporter]'))&&document.querySelector('[data-manual-report-draft-status]')?.textContent.includes('已保存恢复副本')");
      const before=await admissionFacts(pool,principal.id),outward=await externalCounts(pool);
      assert.equal(before.receipts,0);assert.equal(before.intakes,0);assert.equal(before.tickets,0);
      assert.deepEqual(outward,{communications:0,outbox:0,deliveries:0,notifications:0,notification_deliveries:0});
      await image(browser,evidence,'01-explicit-verified-intent.png');await installRevocation(pool,principal.id);stage='ACCESS_TRIGGER_INSTALLED';
      await browser.evaluate("document.querySelector('[data-action=submit-manual-report]').click()");
      await browser.waitFor("globalThis.__t18PostcommitRows.some(row=>row.method==='POST'&&row.path==='/api/workbench/reports'&&row.status===403)&&globalThis.__t18PostcommitRows.some(row=>row.path==='/api/workbench/reports/capabilities'&&row.held)");
      const posts:unknown=await browser.evaluate("globalThis.__t18PostcommitRows.filter(row=>row.method==='POST'&&row.path==='/api/workbench/reports')");assert.ok(Array.isArray(posts)&&posts.length===1);
      const post=object(posts[0]),command=object(post.body),commandId=string(command.client_command_id);assert.equal(post.status,403);
      assert.equal(object(object(post.result).error).code,'P2_016_FORBIDDEN');
      assert.deepEqual(command.reporter,{verification:'VERIFIED_SELECTION',candidate_ref:authority.candidate.candidate_ref,candidate_version:authority.candidate.candidate_version});
      assert.equal(command.description,description);assert.deepEqual(command.location,{text:location,unknown:false});assert.equal(command.source,'ON_SITE');
      const receipt=(await pool.query<{state:string;result:unknown}>(`SELECT state,result_snapshot AS result FROM pilot_ticket.ticket_command_receipt
        WHERE command_scope=$1 AND client_command_id=$2::uuid AND command_type='WORKBENCH_MANUAL_REPORT'`,['P2_016:'+principal.id,commandId])).rows[0];assert.ok(receipt);
      assert.equal(receipt.state,'COMMITTED','the actual ledger committed before the observed 403; this is not a rejected admission');
      const admitted=object(receipt.result);assert.equal(admitted.client_command_id,commandId);assert.equal(admitted.reporter_verification,'VERIFIED');assert.equal(admitted.external_notification,false);
      assert.equal(object(admitted.ticket).status,'QUEUED');assert.equal(admitted.review,null);
      assert.equal((await pool.query('SELECT 1 FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[principal.id])).rowCount,0);
      const committed=await admissionFacts(pool,principal.id);assert.equal(committed.receipts,1);assert.equal(committed.intakes,1);assert.equal(committed.tickets,1);
      assert.equal(committed.received_events,1);assert.equal(committed.created_events,1);assert.ok(committed.ticket_events>=1);assert.deepEqual(await externalCounts(pool),outward);
      stage='ACTUAL_COMMITTED_POST_403';
      // The server has genuinely revoked creation. Restore via the existing
      // access Port, then release the still-unissued capability GET unchanged.
      // No private data is seeded or restored while creation is revoked.
      const restored=await restore();assert.equal(restored.id,principal.id);assert.deepEqual(restored.resolver_team_ids,['PILOT_IT']);
      await browser.evaluate(releaseCapabilities);
      await browser.waitFor("globalThis.__t18PostcommitRows.some(row=>row.path==='/api/workbench/reports/capabilities'&&row.held&&row.status===200&&row.result?.can_create===true)&&document.querySelector('[data-toast-source=manual-report]')?.textContent.includes('结果未知')");
      stage='ACTUAL_CREATION_GRANT_RESTORED';await image(browser,evidence,'02-committed-403-reconciliation-required.png');
      const retained=object(await browser.evaluate(copies));assert.ok(Array.isArray(retained.operations));
      assert.equal(retained.operations.length,1,'a post-commit refusal cannot erase the original operation UUID as a known failure');
      const operation=object(retained.operations[0]);assert.equal(operation.principal,principal.id);assert.equal(operation.commandId,commandId);
      assert.ok(Array.isArray(retained.drafts));for(const entry of retained.drafts){const draft=object(entry);assert.equal(draft.principal,principal.id);assert.equal(draft.algorithm,'AES-GCM');assert.equal(draft.extractable,false);assert.equal(draft.plaintext,false);}
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-action=check-manual-report-receipt]'))&&document.querySelector('[data-toast-source=manual-report]')?.textContent.includes('结果未知')"),true);
      assert.equal(await browser.evaluate("document.querySelector('[data-action=submit-manual-report]')?.disabled"),true,'fresh creation permission must not permit a second intent while the original outcome is unresolved');
      await browser.evaluate("document.querySelector('[data-action=submit-manual-report]').click()");
      assert.equal(await browser.evaluate("globalThis.__t18PostcommitRows.filter(row=>row.method==='POST'&&row.path==='/api/workbench/reports').length"),1);
      assert.equal(await browser.evaluate("globalThis.__t18PostcommitRows.filter(row=>row.path.startsWith('/api/workbench/reports/commands/')).length"),0,'receipt reconciliation remains an explicit user action');
      await browser.waitFor("document.querySelector('[data-action=check-manual-report-receipt]')?.disabled===false");
      await browser.evaluate("document.querySelector('[data-action=check-manual-report-receipt]').click()");
      const receiptPath='/api/workbench/reports/commands/'+commandId;
      await browser.waitFor(`document.querySelector('[data-toast-source=manual-report]')?.textContent.includes('已受理')&&globalThis.__t18PostcommitRows.some(row=>row.method==='GET'&&row.path===${JSON.stringify(receiptPath)}&&row.status===200&&row.result?.state==='COMMITTED')`);
      await browser.waitFor(`(async()=>{const current=await (${copies});return current.drafts.length===0&&current.operations.length===0;})()`);
      const reads:unknown=await browser.evaluate("globalThis.__t18PostcommitRows.filter(row=>row.path.startsWith('/api/workbench/reports/commands/'))");assert.ok(Array.isArray(reads)&&reads.length>=1);
      for(const read of reads){const row=object(read),result=object(row.result);assert.equal(row.path,receiptPath);assert.equal(row.method,'GET');assert.equal(row.status,200);assert.equal(result.state,'COMMITTED');assert.equal(result.client_command_id,commandId);assert.deepEqual(result.result,{...admitted,replayed:true});}
      assert.equal(await browser.evaluate("globalThis.__t18PostcommitRows.filter(row=>row.method==='POST'&&row.path==='/api/workbench/reports').length"),1);
      assert.equal(authority.calls.verify,1,'receipt GET does not rerun Directory verification or admit a second report');
      assert.deepEqual(await admissionFacts(pool,principal.id),committed,'Core, Intake, original receipt and event counts are unchanged by reconciliation');
      assert.deepEqual((await pool.query<{state:string;result:unknown}>(`SELECT state,result_snapshot AS result FROM pilot_ticket.ticket_command_receipt
        WHERE command_scope=$1 AND client_command_id=$2::uuid AND command_type='WORKBENCH_MANUAL_REPORT'`,['P2_016:'+principal.id,commandId])).rows[0],receipt,'the original committed receipt is unchanged by GET');
      assert.deepEqual(await externalCounts(pool),outward,'admission and receipt GET do not create external communication/outbox/delivery');
      stage='ORIGINAL_UUID_EXPLICIT_GET_SETTLED';await image(browser,evidence,'03-original-receipt-cleared.png');
      console.log('T18_POSTCOMMIT_REFUSAL_EVIDENCE '+JSON.stringify({evidence,stage,post_status:403,receipt_state:'COMMITTED',post_count:1,external_notification:false}));
    }catch(failure){error=failure;if(browser)try{await image(browser,evidence,'failure-actual-ui.png');}catch{/* Preserve the primary failure. */}
      console.log('T18_POSTCOMMIT_REFUSAL_DIAGNOSTIC '+JSON.stringify({evidence,stage}));}
    await closeBrowserTestResources([
      async()=>{await browser?.evaluate(releaseCapabilities).catch(()=>{});await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},
      async()=>{await removeRevocation(pool);const restored=await restore();assert.deepEqual(restored.resolver_team_ids,['PILOT_IT']);},
    ],error);
  },{workbenchManualReportsEnabled:true,workbenchReporterCandidatesEnabled:true,manualReporterDirectory:authority.directory,workbenchDraftRecoveryEnabled:true,
    workbenchManualReviewEnabled:true,workbenchRealtimeEnabled:true,realWorkbenchAuthentication:true});
});
