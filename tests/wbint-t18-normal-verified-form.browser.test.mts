// NEXT_PUBLIC_PRODUCTION_UI_FIRST_NOT_BUILT_NOT_RUN.
// One tracer: actual compiled staff UI search -> explicit candidate choice -> real
// verified HTTP admission -> retained safe Review reader/UI -> Directory change.
// Frozen f83f original HTTP tests already passed; no production implementation is
// added here. Missing current combobox is a future actual UI RED, never static PASS.
// Later reader/decoder/snapshot assertions remain NOT_REACHED at the first failure.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {hashP2016,transactionP2016} from '../src/p2-016-domain-contracts.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {formatEpochMsToShanghaiLocal} from '../src/platform/time-contract.mjs';
import type {ManualReporterDirectoryOptions} from '../contracts/workbench_reporter_candidates_contracts.js';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface Fixture {origin:string;pool:PostgresPool;principals:{id:string}[];certificateSpki:string;browserCookies:{name:string;value:string;url:string}[]}
function isObject(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function object(value:unknown):Record<string,unknown>{if(!isObject(value))assert.fail('object required');return value;}
function string(value:unknown):string{if(typeof value!=='string'||!value)assert.fail('nonempty string required');return value;}
const trace=`(()=>{
  if(globalThis.__t18NormalTraceInstalled)return;globalThis.__t18NormalTraceInstalled=true;globalThis.__t18NormalRequests=[];
  const original=globalThis.fetch;
  globalThis.fetch=async(input,options)=>{
    const url=new URL(input instanceof Request?input.url:String(input),location.href);
    const method=options?.method??(input instanceof Request?input.method:'GET');
    const row={path:url.pathname,query:url.search,method,status:null,body:null,result:null,idempotencyKey:null};
    if(method==='POST'&&url.pathname==='/api/workbench/reports'){
      row.body=options?.body?JSON.parse(options.body):null;
      row.idempotencyKey=new Headers(options?.headers).get('idempotency-key');
    }
    if(url.origin===location.origin&&url.pathname.startsWith('/api/'))globalThis.__t18NormalRequests.push(row);
    // Forward the actual request once; never synthesize/replace a response or mock the page.
    const response=await original(input,options);row.status=response.status;
    if(url.pathname==='/api/workbench/reports'||(method==='GET'&&url.pathname.startsWith('/api/manual-reviews/')&&url.pathname.slice('/api/manual-reviews/'.length).length===36)){
      try{row.result=await response.clone().json();}catch{}
    }
    return response;
  };
})()`;
async function image(browser:Browser,evidence:string,name:string){await writeFile(join(evidence,name),Buffer.from(await browser.screenshot(),'base64'));}

const application={sourceCorpScope:'wbint-t18-synthetic-corp',sourceAppScope:'wbint-t18-synthetic-app'};
const directoryScope='WBINT_T18_SYNTHETIC_DIRECTORY',mappingHash='c'.repeat(64),mappingProof='T18_SYNTHETIC_MAPPING_PROOF';
// Controlled isolated authority represents an explicit mapped canonical member;
// this HMAC follows the existing member-purpose convention and is not live proof.
const targetScope={scopeHash:createHmac('sha256','T18_ISOLATED_SCOPE_SECRET_NOT_A_LIVE_CREDENTIAL').update(JSON.stringify(['member',application.sourceCorpScope,application.sourceAppScope,'T18_SYNTHETIC_CANONICAL_MEMBER_A'])).digest('hex'),
  ...application,proofRef:mappingProof};
const stableObservation={scope:targetScope,mapping_config_hash:mappingHash,verification_method:'VERIFIED_DELEGATED_MAPPING',profile_source:'THIRD_PARTY_STAFF_DIRECTORY',
  directory_source_scope:directoryScope,directory_snapshot_version:'T18_SYNTHETIC_DIRECTORY_V1',profile_at_report:{display_name:'合成成员甲',departments:['合成门诊']},
  binding_proof_ref:'T18_SYNTHETIC_BINDING_PROOF',account_status:'ACTIVE',binding_state:'VERIFIED',proof_kind:'SYNTHETIC',
  reachability:{status:'REACHABLE',target_scope_hash:targetScope.scopeHash}};
const candidate={candidate_ref:'t18_synthetic_allowed_candidate_01',candidate_version:hashP2016({candidate_ref:'t18_synthetic_allowed_candidate_01',...stableObservation}),
  display_name:'合成成员甲',departments:['合成门诊'],profile_source:'THIRD_PARTY_STAFF_DIRECTORY',binding_verified:true,message_reachability:'REACHABLE'};
test('the actual production form explicitly selects an authorized reporter and admits one verified Review whose safe original profile remains visible after Directory changes',{timeout:240000},async()=>{
  // The grants/runner supply D-only TEMP/TMP/cache. Refuse evidence creation elsewhere.
  if(process.platform==='win32')assert.match(resolve(tmpdir()),/^D:[\\/]/iu,'browser profile and evidence must stay on D');
  const evidence=await mkdtemp(join(tmpdir(),'wbint-t18-normal-production-ui-'));
  let authorizedPrincipalId:string|null=null,verifyCalls=0,searchCalls=0;
  let profile={display_name:'合成成员甲',departments:['合成门诊']};
  let directoryVersion='T18_SYNTHETIC_DIRECTORY_V1';
  const directory:ManualReporterDirectoryOptions={
    application,
    directorySourceScope:directoryScope,
    verificationAuthority:{mappingConfigHash:mappingHash,mappingProofRef:mappingProof,proofKind:'SYNTHETIC',validationProfile:'ISOLATED_TEST'},
    port:{
      async searchAuthorizedCandidates(input){
        searchCalls++;assert.equal(input.query,'合成');
        assert.equal(input.principal_id,authorizedPrincipalId);
        assert.deepEqual(input.application,directory.application);
        assert.equal(input.directory_source_scope,directory.directorySourceScope);
        input.signal.throwIfAborted();
        return {schema_version:1,candidates:[candidate],next_cursor:null,manual_fallback_available:true};
      },
      async verifyAuthorizedCandidate(input){
        verifyCalls++;
        assert.ok(authorizedPrincipalId);assert.equal(input.principal_id,authorizedPrincipalId);
        assert.deepEqual(input.application,directory.application);
        assert.equal(input.directory_source_scope,directory.directorySourceScope);
        assert.deepEqual(input.selection,{verification:'VERIFIED_SELECTION',candidate_ref:candidate.candidate_ref,candidate_version:candidate.candidate_version});
        assert.equal(input.purpose,'ADMISSION');assert.equal(input.committed_target_scope,null);
        input.signal.throwIfAborted();
        // Only a controlled synthetic authority supplies the identity/proof. No browser name,
        // phone, directory ID or raw WeCom ID is used to manufacture a binding.
        const epoch=String(Date.now()),local=formatEpochMsToShanghaiLocal(epoch),until=String(BigInt(epoch)+300_000n);
        return {schema_version:1,purpose:'ADMISSION',selection:input.selection,application:directory.application,directory_source_scope:directory.directorySourceScope,
          actor_principal_id:authorizedPrincipalId,object_access:'ALLOWED',authorized_at:local,authorized_at_epoch_ms:epoch,
          valid_until:formatEpochMsToShanghaiLocal(until),valid_until_epoch_ms:until,
          proof:{source:'VERIFIED_DIRECTORY_SELECTION',...stableObservation,directory_snapshot_version:directoryVersion,profile_at_report:profile,
            reachability:{...stableObservation.reachability,checked_at:local,checked_at_epoch_ms:epoch,proof_ref:'T18_SYNTHETIC_REACHABILITY_PROOF'},
            verified_at:local,verified_at_epoch_ms:epoch,actor_principal_id:authorizedPrincipalId}};
      },
    },
  };
  await withWeb01Fixture(async({origin,pool,principals,certificateSpki,browserCookies}:Fixture)=>{
    // Fixture-only forward migration after the shared fixture's original 045.
    // Read the compiled resource and retain existing migration ledger conventions.
    const migrationId='051_workbench_verified_manual_report_candidate_ref_check';
    const migrationSql=await readFile(new URL('../database/migrations/'+migrationId+'.sql',import.meta.url),'utf8');
    const migrationBody=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(migrationSql)?.[1];
    if(!migrationBody)throw new Error('T18_051_MIGRATION_BODY_INVALID');
    const checksum=createHash('sha256').update(migrationSql).digest('hex');
    await transactionP2016(pool,async tx=>{
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('VERIFIED_MANUAL_REPORTS_MIGRATION'))");
      if((await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='045_workbench_verified_manual_reports'")).rowCount!==1)throw new Error('T18_051_PREREQUISITE_MISSING');
      const old=(await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[migrationId])).rows[0];
      if(old){if(old.checksum_sha256!==checksum)throw new Error('T18_051_CHECKSUM_CONFLICT');return;}
      await tx.query(migrationBody);
      await tx.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch) INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms) SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[migrationId,checksum]);
    });
    const principal=principals[0];assert.ok(principal);authorizedPrincipalId=principal.id;
    let browser:Browser|undefined,error:unknown,stage='FIXTURE_READY';
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/',width:900,height:900,cookies:browserCookies,certificateSpki});assert.ok(browser);
      await browser.waitFor("Boolean(document.querySelector('.ticket-card'))&&document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'");
      const inventory:unknown=JSON.parse(await readFile(new URL('../web/admin-workbench/asset-inventory.json',import.meta.url),'utf8'));
      assert.ok(Array.isArray(inventory)&&inventory.every(item=>typeof item==='string'));
      const scripts:unknown=await browser.evaluate("[...document.scripts].filter(item=>item.src).map(item=>new URL(item.src).pathname)");
      assert.ok(Array.isArray(scripts)&&scripts.some(item=>typeof item==='string'&&item.startsWith('/workbench/app/assets/')&&item.endsWith('.js')&&inventory.includes(item.slice('/workbench/app/'.length))),'actual production page must load this compiled asset inventory');
      stage='COMPILED_BUNDLE_LOADED';
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-action=new-report]'))"),true,'actual current-authorized entry');
      await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:trace});await browser.evaluate(trace);
      await browser.evaluate("document.querySelector('[data-action=new-report]').click()");
      await browser.waitFor("Boolean(document.querySelector('[data-manual-report-form]'))");await image(browser,evidence,'01-actual-form.png');stage='ACTUAL_FORM_VISIBLE';
      // This is a staged accessible control contract, not a claim about frozen f83f markup.
      // Missing actual role/controls is only a real UI RED after this case is registered/run.
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[aria-label=\"报修人姓名\"][role=combobox]'))"),true,'reporter search must expose a real explicit-selection combobox');
      await browser.evaluate("(()=>{const input=document.querySelector('[aria-label=\"报修人姓名\"][role=combobox]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'合成');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
      await browser.waitFor("globalThis.__t18NormalRequests.some(row=>row.method==='GET'&&row.path==='/api/workbench/reporter-candidates'&&row.status===200)&&[...document.querySelectorAll('[role=option]')].some(row=>row.textContent.includes('合成成员甲')&&row.textContent.includes('合成门诊'))");
      assert.ok(searchCalls>=1,'configured Directory public Port sees real authenticated current principal');stage='AUTHORIZED_CANDIDATE_VISIBLE';
      assert.equal(await browser.evaluate("globalThis.__t18NormalRequests.filter(row=>row.method==='POST'&&row.path==='/api/workbench/reports').length"),0,'search cannot silently admit or choose a reporter');
      await browser.evaluate("(()=>{const rows=[...document.querySelectorAll('[role=option]')].filter(row=>row.textContent.includes('合成成员甲')&&row.textContent.includes('合成门诊'));if(rows.length!==1)throw Error('EXPECTED_ONE_AUTHORIZED_OPTION');rows[0].click();})()");
      await browser.evaluate("(()=>{const source=document.querySelector('[aria-label=\"报修来源\"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(source,'ON_SITE');source.dispatchEvent(new Event('change',{bubbles:true}));const description=document.querySelector('[aria-label=\"故障描述\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(description,'合成现场代录：打印机情况不明');description.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[aria-label=\"位置暂不清楚\"]').click();})()");
      const sensitive=[targetScope.scopeHash,mappingHash,mappingProof,'T18_SYNTHETIC_BINDING_PROOF','T18_SYNTHETIC_REACHABILITY_PROOF','T18_SYNTHETIC_CANONICAL_MEMBER_A'];
      for(const value of sensitive)assert.equal(await browser.evaluate(`document.documentElement.outerHTML.includes(${JSON.stringify(value)})`),false,'private server authority never enters the page');
      await browser.waitFor("document.querySelector('[data-action=submit-manual-report]')?.disabled===false");await image(browser,evidence,'02-explicit-selected-report.png');stage='EXPLICIT_SELECTION_READY';
      await browser.evaluate("document.querySelector('[data-action=submit-manual-report]').click()");
      await browser.waitFor("globalThis.__t18NormalRequests.some(row=>row.method==='POST'&&row.path==='/api/workbench/reports'&&row.status!==null&&row.result!==null)");
      const posts=await browser.evaluate("globalThis.__t18NormalRequests.filter(row=>row.method==='POST'&&row.path==='/api/workbench/reports')");assert.ok(Array.isArray(posts));assert.equal(posts.length,1);
      const post=object(posts[0]),body=object(post.body),commandId=string(body.client_command_id),admission=object(post.result);
      stage='POST_RETURNED';assert.equal(post.status,202);assert.equal(post.idempotencyKey,commandId);assert.match(commandId,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
      assert.deepEqual(Object.keys(body).sort(),['schema_version','client_command_id','source','description','location','reporter'].sort());
      assert.equal(body.schema_version,1);assert.equal(body.source,'ON_SITE');assert.equal(body.description,'合成现场代录：打印机情况不明');assert.deepEqual(body.location,{text:null,unknown:true});
      assert.deepEqual(body.reporter,{verification:'VERIFIED_SELECTION',candidate_ref:candidate.candidate_ref,candidate_version:candidate.candidate_version});
      assert.equal(admission.client_command_id,commandId);assert.equal(admission.ok,true);assert.equal(admission.reporter_verification,'VERIFIED');
      assert.equal(admission.notification_eligibility,'ELIGIBLE');assert.equal(admission.manual_contact_required,false);assert.equal(admission.external_notification,false);assert.equal(admission.replayed,false);
      assert.equal(admission.result_code,'NEEDS_DESCRIPTION');assert.equal(admission.ticket,null);
      assert.deepEqual(Object.keys(admission).sort(),['ok','client_command_id','intake_id','intake_no','source','reporter_verification','manual_contact_required','notification_eligibility','external_notification','result_code','ticket','review','replayed'].sort());
      const review=object(admission.review),reviewId=string(review.id);assert.equal(review.status,'PENDING');assert.equal(verifyCalls,1);
      await browser.waitFor("document.querySelector('[data-manual-report-result]')?.textContent.includes('已受理')");
      assert.equal(await browser.evaluate("document.querySelector('[data-manual-report-result]').textContent.includes('进入人工复核')"),true,'visible success must name the real admitted object');
      assert.equal(await browser.evaluate("/已通知|已送达/.test(document.querySelector('[data-manual-report-result]').textContent)"),false,'qualification cannot promise message delivery');
      await browser.evaluate("document.querySelector('[data-action=return-workbench]').click()");
      await browser.waitFor(`Boolean(document.querySelector('[data-item-id="${reviewId}"] .card-open'))`);
      await browser.evaluate(`document.querySelector('[data-item-id="${reviewId}"] .card-open').click()`);
      await browser.waitFor(`globalThis.__t18NormalRequests.some(row=>row.method==='GET'&&row.path==='/api/manual-reviews/${reviewId}'&&row.status!==null&&row.result!==null)`);
      const attemptedReads:unknown=await browser.evaluate(`globalThis.__t18NormalRequests.filter(row=>row.method==='GET'&&row.path==='/api/manual-reviews/${reviewId}'&&row.status!==null&&row.result!==null)`);
      assert.ok(Array.isArray(attemptedReads)&&attemptedReads.length>0);stage='ACTUAL_REVIEW_READ_RETURNED';
      assert.equal(object(attemptedReads[attemptedReads.length-1]).status,200,'existing public Review reader must return this real admission retained material');
      await browser.waitFor("Boolean(document.querySelector('[data-review-manual-report]'))");
      const expected={source_kind:'MANUAL_REPORT',source:'ON_SITE',description:'合成现场代录：打印机情况不明',location:{text:null,unknown:true},
        reporter:{verification:'VERIFIED',name:'合成成员甲',departments:['合成门诊']},identity_source:'VERIFIED_DIRECTORY_SELECTION',actor_principal_id:principal.id,
        manual_contact_required:false,external_notification:false,notification_eligibility:'ELIGIBLE'};
      const reads=await browser.evaluate(`globalThis.__t18NormalRequests.filter(row=>row.method==='GET'&&row.path==='/api/manual-reviews/${reviewId}'&&row.status===200&&row.result!==null)`);assert.ok(Array.isArray(reads));assert.ok(reads.length>=1);
      const detail=object(object(reads[reads.length-1]).result);assert.deepEqual(detail.manual_report,expected);assert.deepEqual(detail.canonical_item,{kind:'review',id:reviewId});
      const text=string(await browser.evaluate("document.querySelector('[data-review-manual-report]').textContent"));
      assert.ok(text.includes('现场代录'));assert.ok(text.includes('合成成员甲'));assert.ok(text.includes('合成门诊'));assert.ok(text.includes('代录人：林舟'));
      assert.equal(text.includes('身份未核实'),false);assert.equal(text.includes('联系方式'),false,'verified public profile must not display contact fields');
      for(const value of sensitive)assert.equal(await browser.evaluate(`document.documentElement.outerHTML.includes(${JSON.stringify(value)})`),false);
      await image(browser,evidence,'03-real-retained-verified-review.png');stage='RETAINED_PROFILE_VISIBLE';
      // Refresh only the current object's actual reader. No new admission or Directory snapshot write.
      profile={display_name:'目录后来更名',departments:['目录后来调岗']};directoryVersion='T18_SYNTHETIC_DIRECTORY_V2';
      const previousDocument=await browser.evaluate('performance.timeOrigin');assert.equal(typeof previousDocument,'number');
      await browser.command('Page.reload');
      await browser.waitFor(`performance.timeOrigin!==${JSON.stringify(previousDocument)}&&globalThis.__t18NormalRequests?.some(row=>row.method==='GET'&&row.path==='/api/manual-reviews/${reviewId}'&&row.status===200&&row.result!==null)&&document.querySelector('[data-review-manual-report]')?.textContent.includes('合成成员甲')&&document.querySelector('[data-review-manual-report]')?.textContent.includes('合成门诊')`);
      const refreshedReads:unknown=await browser.evaluate(`globalThis.__t18NormalRequests.filter(row=>row.method==='GET'&&row.path==='/api/manual-reviews/${reviewId}'&&row.status===200&&row.result!==null)`);
      assert.ok(Array.isArray(refreshedReads)&&refreshedReads.length>0,'reload must read the same real Review through current HTTP');
      assert.deepEqual(object(object(refreshedReads[refreshedReads.length-1]).result).manual_report,expected);stage='DIRECTORY_CHANGED_CURRENT_READ';
      const retained=string(await browser.evaluate("document.querySelector('[data-review-manual-report]').textContent"));assert.equal(retained.includes('目录后来'),false);assert.equal(verifyCalls,1);
      await image(browser,evidence,'04-directory-changed-original-profile.png');
      assert.equal(await browser.evaluate("globalThis.__t18NormalRequests.some(row=>row.method==='POST'&&row.path==='/api/workbench/reports')"),false,'reload must not submit a new report');
      assert.equal(await browser.evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth"),true);
      console.log('T18_NORMAL_UI_EVIDENCE '+JSON.stringify({evidence,stage,source:'ON_SITE',reporter_verification:'VERIFIED',external_notification:false}));
    }catch(failure){
      error=failure;
      if(browser){try{await image(browser,evidence,'failure-actual-ui.png');
        const pixels=await readFile(join(evidence,'failure-actual-ui.png')),receiptDirectory=join(tmpdir(),'ss010-ui-'+randomUUID());await mkdir(receiptDirectory);const file=join(receiptDirectory,randomUUID()+'.png');await writeFile(file,pixels);
        console.log('SS010_BROWSER '+JSON.stringify({screenshots:[{file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')}]}));
        console.log('T18_NORMAL_UI_DIAGNOSTIC '+JSON.stringify({evidence,stage,state:await browser.evaluate("({path:location.pathname,form:Boolean(document.querySelector('[data-manual-report-form]')),selector:Boolean(document.querySelector('[aria-label=\"报修人姓名\"][role=combobox]')),requests:(globalThis.__t18NormalRequests??[]).map(row=>({path:row.path,method:row.method,status:row.status}))})")}));}catch{console.log('T18_NORMAL_UI_DIAGNOSTIC_UNAVAILABLE '+JSON.stringify({evidence,stage}));}}
    }
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchManualReportsEnabled:true,workbenchReporterCandidatesEnabled:true,manualReporterDirectory:directory,workbenchDraftRecoveryEnabled:true,
    workbenchManualReviewEnabled:true,workbenchRealtimeEnabled:true,realWorkbenchAuthentication:true});
});
