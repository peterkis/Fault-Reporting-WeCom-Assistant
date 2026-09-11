import test from 'node:test';
import assert from 'node:assert/strict';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';
import { createReporterDirectoryPort } from '../src/p2-015-contact-journey.mjs';
import { g2BusinessCounts,g2CountDelta,g2DecisionObservation } from './helpers/p2-g2-gold-observation.mjs';

const snapshot={source:'WECOM_DIRECTORY',version:'synthetic-directory-v1',valid_at:'2026-09-09 08:00:00',
  fetched_at:'2026-09-09 08:01:00',provider_user_ref:'synthetic-private-provider-reference',
  memberships:[{department_ref:'synthetic-dept-a',role:'PRIMARY'},{department_ref:'synthetic-dept-b',role:'SECONDARY'},
    {department_ref:'synthetic-dept-c',role:'ROTATION'}]};

test('D12-019/021/022/026 directory snapshot and occurrence evidence remain independent and HTTP excludes internal profile',async t=>{
  const directoryPort=createReporterDirectoryPort({resolveProfile:async()=>({status:'RESOLVED',snapshot})});
  await withG2Runtime(async f=>{
    const before=await g2BusinessCounts(f.pool);
    await f.inbound('门诊二楼打印机卡纸了',{chatType:'single'});const batch=await f.pump();
    const j=(await f.pool.query('SELECT * FROM intake.contact_journey')).rows[0];
    assert.equal(j.profile_resolution_status,'RESOLVED');assert.deepEqual(j.profile_snapshot,snapshot);
    assert.match(j.reporter_identity_hash,/^[a-f0-9]{64}$/u);assert.notEqual(j.reporter_identity_hash,f.reporters[0]);
    const message=(await f.pool.query('SELECT clean_text FROM channel.message_inbox')).rows[0];
    assert.ok(message.clean_text.includes('门诊二楼'));assert.equal(j.profile_snapshot.memberships[0].department_ref,'synthetic-dept-a');
    const views=[await f.get('/api/contact-journeys/'+j.id),await f.get('/api/contact-journeys/'+j.id+'/decisions')];
    const serialized=JSON.stringify(views);
    for(const internal of [snapshot.provider_user_ref,...snapshot.memberships.map(m=>m.department_ref),f.reporters[0]])assert.equal(serialized.includes(internal),false);
    assert.equal(Object.hasOwn(views[0],'profile_snapshot'),false);
    const delta=g2CountDelta(before,await g2BusinessCounts(f.pool));assert.equal(delta.tickets,1);assert.equal(delta.inbox,1);
    t.diagnostic(JSON.stringify({source_case_ids:['D12-019','D12-021','D12-022','D12-026'],surface:'NORMAL_FRAME_WITH_DIRECTORY_SIMULATOR',
      person_registry_implemented:false,occurrence_location_surface:'PERSISTED_REPORT_TEXT_NOT_DIRECTORY_AUTHORITY',delta,
      observation:await g2DecisionObservation({pool:f.pool,decisionId:batch.results[0].decision_id}),provider_calls:f.providerCalls.length}));
  },{directoryPort});
});

test('D12-020 actually unresolved directory does not prevent persisted Intake and minimal Ticket',async t=>{
  const directoryPort=createReporterDirectoryPort({timeoutMs:20,resolveProfile:()=>new Promise(()=>{})});
  await withG2Runtime(async f=>{
    await f.inbound('打印机卡纸了',{chatType:'single'});
    assert.equal((await g2BusinessCounts(f.pool)).inbox,1);
    const batch=await f.pump();assert.equal(batch.processed,1);
    const j=(await f.pool.query('SELECT profile_resolution_status,profile_snapshot FROM intake.contact_journey')).rows[0];
    assert.deepEqual(j,{profile_resolution_status:'DEFERRED',profile_snapshot:{}});assert.equal((await g2BusinessCounts(f.pool)).tickets,1);
    t.diagnostic(JSON.stringify({source_case_id:'D12-020',surface:'NORMAL_FRAME_WITH_UNRESOLVED_DIRECTORY',
      observation:await g2DecisionObservation({pool:f.pool,decisionId:batch.results[0].decision_id}),provider_calls:f.providerCalls.length}));
  },{directoryPort});
});

test('D12-024 inactive directory account retains fault Ticket and enqueues actual identity review',async t=>{
  const directoryPort=createReporterDirectoryPort({resolveProfile:async()=>({status:'RESOLVED',snapshot:{...snapshot,account_status:'INACTIVE'}})});
  await withG2Runtime(async f=>{
    await f.inbound('打印机卡纸了',{chatType:'single'});const batch=await f.pump();
    const counts=await g2BusinessCounts(f.pool);assert.equal(counts.inbox,1);assert.equal(counts.tickets,1);assert.equal(counts.reviews,1);
    const observed=await g2DecisionObservation({pool:f.pool,decisionId:batch.results[0].decision_id});
    assert.equal(observed.reason_code,'DIRECTORY_ACCOUNT_INACTIVE');assert.equal(observed.result_code,'MANUAL_REVIEW_REQUIRED');
    const review=(await f.get('/api/manual-reviews')).items;assert.equal(review.length,1);
    await f.pump();assert.equal((await g2BusinessCounts(f.pool)).reviews,1);
    t.diagnostic(JSON.stringify({source_case_id:'D12-024',surface:'NORMAL_FRAME_WITH_INACTIVE_DIRECTORY',counts,observed,provider_calls:f.providerCalls.length}));
  },{directoryPort});
});

test('D12-025 directory refresh never overwrites previous Journey report-time snapshot',async t=>{
  let current=snapshot;
  const directoryPort=createReporterDirectoryPort({resolveProfile:async()=>({status:'RESOLVED',snapshot:current})});
  await withG2Runtime(async f=>{
    await f.inbound('打印机卡纸了',{chatType:'single'});await f.pump();
    const old=(await f.pool.query('SELECT id,profile_snapshot,profile_snapshot_hash FROM intake.contact_journey')).rows[0];
    current={...snapshot,version:'synthetic-directory-v2',memberships:[{department_ref:'synthetic-new-dept',role:'PRIMARY'}]};
    await f.inbound('补充：打印机还是卡纸',{chatType:'single'});await f.pump();
    assert.deepEqual((await f.pool.query('SELECT id,profile_snapshot,profile_snapshot_hash FROM intake.contact_journey WHERE id=$1',[old.id])).rows[0],old);
    await f.inbound('另外门诊系统也登录不了',{chatType:'single'});await f.pump();
    const next=(await f.pool.query('SELECT profile_snapshot FROM intake.contact_journey WHERE id<>$1',[old.id])).rows[0];assert.deepEqual(next.profile_snapshot,current);
    assert.equal((await g2BusinessCounts(f.pool)).tickets,2);
    t.diagnostic(JSON.stringify({source_case_id:'D12-025',surface:'NORMAL_FRAME_WITH_DIRECTORY_REVISION',old_snapshot_unchanged:true,
      new_journey_has_new_snapshot:true,shared_current_person_profile_implemented:false,provider_calls:f.providerCalls.length}));
  },{directoryPort});
});


test('D12-024 later inactive directory assertion stays auditable without replacing report snapshot',async()=>{
  let current={...snapshot,account_status:'ACTIVE'};
  const directoryPort=createReporterDirectoryPort({resolveProfile:async()=>({status:'RESOLVED',snapshot:current})});
  await withG2Runtime(async f=>{
    await f.inbound('打印机卡纸了',{chatType:'single'});await f.pump();
    const initial=(await f.pool.query('SELECT profile_snapshot,profile_snapshot_hash FROM intake.contact_journey')).rows[0];
    current={...snapshot,version:'synthetic-disabled-v2',account_status:'INACTIVE'};
    await f.inbound('补充：还是卡纸',{chatType:'single'});const batch=await f.pump();
    const result=(await f.pool.query('SELECT safe_result FROM intake.deterministic_decision WHERE id=$1',[batch.results[0].decision_id])).rows[0].safe_result;
    assert.deepEqual(result.identity_review.directory_assertion,{source:'WECOM_DIRECTORY',version:current.version,
      account_status:'INACTIVE',valid_at:current.valid_at,fetched_at:current.fetched_at});
    assert.deepEqual((await f.pool.query('SELECT profile_snapshot,profile_snapshot_hash FROM intake.contact_journey')).rows[0],initial);
    const review=(await f.get('/api/manual-reviews')).items[0];
    const http=await f.get('/api/manual-reviews/'+review.id);
    assert.equal(http.safe_result.identity_review.directory_assertion.version,current.version);
    assert.equal(JSON.stringify(http).includes(snapshot.provider_user_ref),false);
    const journey=(await f.pool.query('SELECT id FROM intake.contact_journey')).rows[0];
    assert.equal(JSON.stringify(await f.get('/api/contact-journeys/'+journey.id+'/decisions')).includes(current.version),false);
  },{directoryPort});
});
