import {createPostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {createP2016ManualReviewFacade} from '../app/server/src/p2-016-manual-review-facade.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {transpileModule,ModuleKind,ScriptTarget,createSourceFile,isImportDeclaration,isStringLiteral} from 'typescript';
import type {ClosureHistoryPage} from '../contracts/unified_closure_contracts.js';
import {test} from 'node:test';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
import {normalizeP2016TicketCommand} from '../app/server/src/p2-016-ticket-command-facade.mjs';
import {normalizeClosingInput,normalizeClosureInput} from '../app/server/src/service-closure-records.mjs';
import {createP2016Runtime} from '../app/server/src/p2-016-runtime.mjs';

async function closureBrowserDecoder(){
 const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd(),cache=new Map<string,Promise<string>>();
 function moduleUrl(file:string):Promise<string>{const existing=cache.get(file);if(existing)return existing;
  const loaded=(async()=>{let code=transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022,verbatimModuleSyntax:true}}).outputText;
   for(const node of createSourceFile(file,code,ScriptTarget.ES2022,true).statements){if(!isImportDeclaration(node)||!isStringLiteral(node.moduleSpecifier))continue;const specifier=node.moduleSpecifier.text,path=resolve(dirname(file),specifier),target=specifier.startsWith('.')?await moduleUrl(path.endsWith('.mjs')?path.slice(0,-4)+'.mts':path.endsWith('.ts')?path:path+'.ts'):import.meta.resolve(specifier);code=code.replaceAll("'"+specifier+"'",JSON.stringify(target)).replaceAll('"'+specifier+'"',JSON.stringify(target));}
   return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');})();cache.set(file,loaded);return loaded;
 }
 const module:{decodeClosureHistory:(value:unknown,id:string)=>ClosureHistoryPage}=await import(await moduleUrl(resolve(root,'app/pc-admin/src/features/closure/client.ts')));return module.decodeClosureHistory;
}

test('Card 27C-B history decoding rejects cross-subject data, unknown fields and invented delivery or calendar values',async()=>{
 const decode=await closureBrowserDecoder(),id=randomUUID(),entry={id:randomUUID(),before_version:1,reason_code:'OTHER' as const,reason_label:'其他',secondary_reason:null,note:'仅内部（合成）',duplicate_of:null,source:'MANUAL' as const,closed_at:'2026-11-07 10:00:00',closed_by_display_name:'处理人（合成）',notification_state:'NOT_SENT' as const,restored_at:null,restored_by_display_name:null};
 const page:ClosureHistoryPage={subject_id:id,version:2,items:[entry],next_before_version:null,restore_target:{status:'IN_PROGRESS',column:'active',assignee_name:'处理人（合成）',notify_reporter:true,notification_state:'NOT_SENT'}};
 await assertP2016Schema('unified_closure_history',page);assert.deepEqual(decode(page,id),page);
 for(const change of [{subject_id:randomUUID()},{private_snapshot:{}},{items:[{...entry,notification_state:'QUEUED'}]},{items:[{...entry,closed_at:'2026-02-30 10:00:00'}]},{items:[{...entry,notification_message_id:randomUUID()}]},{items:[entry,entry]},{next_before_version:1},{restore_target:{...page.restore_target,status:'DISMISSED'}},{restore_target:{...page.restore_target,notify_reporter:'true'}},{restore_target:{status:'IN_PROGRESS',column:'active',assignee_name:null,notification_state:'NOT_SENT'}}])assert.throws(()=>decode({...page,...change},id));
 for(const change of [{private_snapshot:{}},{items:[{...entry,notification_state:'QUEUED'}]},{items:[{...entry,notification_message_id:randomUUID()}]}])await assert.rejects(assertP2016Schema('unified_closure_history',{...page,...change}));
});

test('four waiting command routes retain closed human internal reason, exact scalar bounds and immutable caller input copies',async()=>{
  const wire={client_command_id:randomUUID(),expected_version:2147483647,reason_code:'HUMAN_INTERNAL_REASON',note:'😀'.repeat(1000),external_visible:false};await assertP2016Schema('p2_016_waiting_action_command',wire);
  for(const action of ['request-information','wait-vendor','resume','dismiss']){const {external_visible,...cancel}=wire;const input={...(action==='dismiss'?{...cancel,reason_code:'OTHER'}:wire),action,ticket_id:randomUUID()},normalized=normalizeP2016TicketCommand(input);input.note='caller changed';assert.equal(normalized.note,wire.note);assert.equal(normalized.expected_version,2147483647);
    for(const change of [{expected_version:2147483648},{expected_version:'3'},{client_command_id:'bad'},{reason_code:'lower'},{note:'😀'.repeat(1001)},{target_principal_id:randomUUID()},{status:'DISMISSED'}])assert.throws(()=>normalizeP2016TicketCommand({...normalized,...change}),{code:'P2_016_INPUT_INVALID'});
  }
  for(const change of [{external_visible:true},{note:' '},{note:''},{handling_cycle_id:randomUUID()},{actor_principal_id:randomUUID()}])await assert.rejects(assertP2016Schema('p2_016_waiting_action_command',{...wire,...change}));
  assert.throws(()=>Reflect.apply(createP2016Runtime,undefined,[{ticketWaitingActionsEnabled:'true'}]),{code:'P2_016_FLAG_INVALID'});
});

test('Card 27C-A enum and closure Schema enforce six reasons, secondary reasons, optional duplicate references and the fixed notification matrix',async()=>{
 const base={client_command_id:randomUUID(),expected_version:1};
 for(const reason_code of ['FALSE_REPORT_OR_TEST','DUPLICATE','NOT_IT_SCOPE','REPORTER_WITHDREW','REPORTER_UNREACHABLE','OTHER']){
  const value={...base,reason_code,...(reason_code==='OTHER'?{note:'其他原因（合成）'}:{}),...(reason_code==='NOT_IT_SCOPE'?{secondary_reason_code:'OUT_OF_SCOPE_CONFIRMED'}:{})};
  await assertP2016Schema('unified_closure_command',value);assert.equal(normalizeP2016TicketCommand({...value,action:'dismiss',ticket_id:randomUUID()}).reason_code,reason_code);
 }
 // Card 29 K1: closing as 「非 IT 范围」 accepts only three situations; the other five manual-review reasons are rejected on the close path.
 for(const secondary_reason_code of ['BUSINESS_CONSULTATION_CONFIRMED','OUT_OF_SCOPE_CONFIRMED','SERVICE_REQUEST_CONFIRMED']){
  const value={...base,reason_code:'NOT_IT_SCOPE',secondary_reason_code};
  await assertP2016Schema('unified_closure_command',value);await assertP2016Schema('unified_intake_closure_command',value);
  assert.equal(normalizeP2016TicketCommand({...value,action:'dismiss',ticket_id:randomUUID()}).secondary_reason_code,secondary_reason_code);assert.equal(normalizeClosingInput({reason_code:'NOT_IT_SCOPE',secondary_reason_code}).secondary_reason_code,secondary_reason_code);
 }
 for(const secondary_reason_code of ['HUMAN_CONFIRMED','INFORMATION_INSUFFICIENT','ACKNOWLEDGED','INCIDENT_REVIEW_PENDING','STALE_REVIEW_CANCELLED']){
  const value={...base,reason_code:'NOT_IT_SCOPE',secondary_reason_code};
  await assert.rejects(assertP2016Schema('unified_closure_command',value));await assert.rejects(assertP2016Schema('unified_intake_closure_command',value));
  assert.throws(()=>normalizeP2016TicketCommand({...value,action:'dismiss',ticket_id:randomUUID()}));assert.throws(()=>normalizeClosingInput({reason_code:'NOT_IT_SCOPE',secondary_reason_code}));
  assert.equal(normalizeClosureInput({reason_code:'NOT_IT_SCOPE',secondary_reason_code}).secondary_reason_code,secondary_reason_code,'stored and system closures keep the complete reason set');
 }
 for(const change of [{reason_code:'ARBITRARY_CODE'},{reason_code:'OTHER',note:' \t '},{reason_code:'NOT_IT_SCOPE'},{reason_code:'NOT_IT_SCOPE',secondary_reason_code:'UNLISTED'},{reason_code:'FALSE_REPORT_OR_TEST',notify_reporter:true},{reason_code:'DUPLICATE',notify_reporter:false},{reason_code:'REPORTER_WITHDREW',duplicate_of_ref:'IT-20261106-0001'}]){
  await assert.rejects(assertP2016Schema('unified_closure_command',{...base,...change}));assert.throws(()=>normalizeP2016TicketCommand({...base,...change,action:'dismiss',ticket_id:randomUUID()}));
 }
 await assertP2016Schema('unified_restore_command',{...base,reason_code:'RESTORE_CLOSED'});
 assert.throws(()=>normalizeP2016TicketCommand({...base,action:'dismiss',ticket_id:randomUUID(),reason_code:'CANCELLED_BY_STAFF',note:'旧技术码（合成）',external_visible:false}));
});
test('waiting capability defaults and minimal safe receipt union never admit raw reasons or private snapshots',async()=>{
  const capability:unknown=JSON.parse(await readFile(new URL('../contracts/p2_016_waiting_capability.schema.json',import.meta.url),'utf8'));assert.ok(capability&&typeof capability==='object'&&!Array.isArray(capability));const value=capability as {properties:Record<string,{default:unknown}>};for(const property of Object.values(value.properties))assert.equal(property.default,false);
  await assertP2016Schema('p2_016_waiting_capability',{ticket_waiting_actions_enabled:false,ticket_waiting_action_draft_recovery_enabled:false});
  await assert.rejects(assertP2016Schema('p2_016_waiting_capability',{ticket_waiting_actions_enabled:false,ticket_waiting_action_draft_recovery_enabled:true}));
  for(const receipt of [{state:'UNKNOWN'},{state:'COMMITTED',ticket_id:randomUUID(),ticket_version:2,ticket_event_id:randomUUID()},{state:'FAILED',error:{code:'P2_016_FORBIDDEN',retryable:false}}]){await assertP2016Schema('p2_016_waiting_action_receipt',receipt);await assert.rejects(assertP2016Schema('p2_016_waiting_action_receipt',{...receipt,note:'INTERNAL_PRIVATE'}));}
  await assert.rejects(assertP2016Schema('p2_016_waiting_action_receipt',{state:'FAILED',error:{code:'P2_016_FORBIDDEN',retryable:true}}));
});

test('Card 27C-A MARK_OUT_OF_SCOPE accepts only NOT_IT_SCOPE in both Schema and runtime normalization',async()=>{
  const pool=createPostgresPool({connectionString:'postgresql://postgres@127.0.0.1:1/t10_review_contract_never_connected',max:1});
  const storageBoundary=new Error('T10_REVIEW_NORMALIZATION_ACCEPTED');let acquisitions=0;
  // The real lazy Pool cannot open a socket: valid normalization stops at acquisition.
  pool.query=():never=>{throw new Error('T10_UNEXPECTED_QUERY');};
  pool.connect=():never=>{acquisitions++;throw storageBoundary;};
  try{
    const facade=createP2016ManualReviewFacade({pool,enabled:true}),input={authContext:{principal_id:randomUUID()},reviewId:randomUUID()},base={client_command_id:randomUUID(),expected_row_version:'1',resolution_code:'MARK_OUT_OF_SCOPE'};
    for(const secondary_reason_code of ['HUMAN_CONFIRMED','INFORMATION_INSUFFICIENT','BUSINESS_CONSULTATION_CONFIRMED','ACKNOWLEDGED','OUT_OF_SCOPE_CONFIRMED','SERVICE_REQUEST_CONFIRMED','INCIDENT_REVIEW_PENDING','STALE_REVIEW_CANCELLED']){
      const value={...base,reason_code:'NOT_IT_SCOPE',secondary_reason_code,resolution_reason_code:secondary_reason_code};
      await assertP2016Schema('p2_016_manual_review_resolution',value);
      const before=acquisitions;await assert.rejects(facade.resolveManualReview({...input,body:value}),error=>error===storageBoundary);assert.equal(acquisitions,before+1,'the same valid schema sample passes the real normalization boundary');
    }
    const invalid:Record<string,unknown>[]=['FALSE_REPORT_OR_TEST','DUPLICATE','REPORTER_WITHDREW','REPORTER_UNREACHABLE','OTHER'].map(reason_code=>({...base,reason_code,resolution_reason_code:reason_code,...(reason_code==='OTHER'?{note:'其他原因（合成）'}:{})}));
    const valid={...base,reason_code:'NOT_IT_SCOPE',secondary_reason_code:'ACKNOWLEDGED',resolution_reason_code:'ACKNOWLEDGED'};
    invalid.push({...base,reason_code:'NOT_IT_SCOPE',resolution_reason_code:'ACKNOWLEDGED'},{...valid,secondary_reason_code:'UNLISTED'},{...valid,secondary_reason_code:null},{...valid,notify_reporter:false},{...valid,duplicate_of_ref:'IT-20261107-0001'});
    for(const value of invalid){
      await assert.rejects(assertP2016Schema('p2_016_manual_review_resolution',value));
      const before=acquisitions;await assert.rejects(facade.resolveManualReview({...input,body:value}),{code:'P2_016_INPUT_INVALID'});assert.equal(acquisitions,before,'the same invalid schema sample is rejected before any storage acquisition');
    }
    assert.equal(pool.totalCount,0);assert.equal(pool.idleCount,0);assert.equal(pool.waitingCount,0);
  }finally{await pool.end();}
});
