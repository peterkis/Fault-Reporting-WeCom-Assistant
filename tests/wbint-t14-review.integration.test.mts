import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {randomUUID} from 'node:crypto';
import {createContactJourneyStore} from '../src/p2-015-contact-journey.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
import {appendReviewMaterial as appendBot} from './helpers/wbint-t14-review-material.mjs';


interface Fixture {origin:string;cookies:string[];pool:PostgresPool;processReviewIntake:(id:string)=>Promise<unknown>;tickets:{ticket:{id:string};intake:{intakeId:string}}[]}

function http({origin,cookies}:Fixture){
  const read=async(path:string):Promise<Record<string,unknown>>=>{const response=await fetch(origin+path,{headers:{cookie:cookies[0]}});assert.equal(response.status,200,await response.clone().text());return await response.json() as Record<string,unknown>;};
  const post=async(reviewId:string,command:Record<string,unknown>,csrf:unknown)=>fetch(origin+'/api/manual-reviews/'+reviewId+'/resolve',{method:'POST',headers:{cookie:cookies[0],origin,'content-type':'application/json',
    'idempotency-key':String(command.client_command_id),'if-match':'"'+String(command.expected_row_version)+'"','x-csrf-token':String(csrf)},body:JSON.stringify(command)});
  return {read,post};
}
async function freshReview(fixture:Fixture){
  const input=await seedPersistedIntake({pool:fixture.pool,text:'独立的全新合成待复核材料，请人工选择合法结论。'});await fixture.processReviewIntake(input.intakeId);
  const review=(await fixture.pool.query<{id:string}>('SELECT id::text FROM intake.manual_review_item WHERE service_intake_id=$1::uuid ORDER BY created_at,id',[input.intakeId])).rows[0];assert.ok(review);
  return {input,review};
}

test('T14 Review recovery has its own capability and read-only scoped receipt while Notes are disabled',async()=>{
  await withWeb01Fixture(async({origin,cookies,pool}:Fixture)=>{
    const get=(path:string,index=0)=>fetch(origin+path,{headers:{cookie:cookies[index]}});
    const bootstrap=await (await get('/api/lifecycle/bootstrap')).json() as {csrf_token:string;draft_recovery_enabled:boolean;manual_review_draft_recovery_enabled:boolean;internal_notes_enabled:boolean};
    const board=await (await get('/api/workbench/board?column=pending')).json() as {items:{id:string;kind:string}[]};
    const selected=board.items.find(item=>item.kind==='review');assert.ok(selected);
    const commandId=randomUUID(),path='/api/manual-reviews/'+selected.id+'/commands/'+commandId;
    const unknown=await get(path);assert.equal(unknown.status,200,await unknown.clone().text());
    const empty={client_command_id:commandId,review_id:selected.id,state:'UNKNOWN'};
    assert.deepEqual(await unknown.json(),empty);await assertP2016Schema('workbench_review_receipt',empty);
    assert.equal(bootstrap.manual_review_draft_recovery_enabled,true);assert.equal(bootstrap.internal_notes_enabled,false);assert.equal(bootstrap.draft_recovery_enabled,false);
    assert.equal((await get(path+'?scope=other')).status,400);assert.equal((await get(path,1)).status,404);
    assert.equal((await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM pilot_ticket.ticket_command_receipt')).rows[0]?.count,0,'UNKNOWN lookup never creates a receipt');
    const review=await (await get('/api/manual-reviews/'+selected.id)).json() as {row_version:string};
    const command={client_command_id:commandId,expected_row_version:review.row_version,resolution_code:'CLASSIFY_BUSINESS_CONSULTATION',resolution_reason_code:'BUSINESS_CONSULTATION_CONFIRMED'};
    const committed=await fetch(origin+'/api/manual-reviews/'+selected.id+'/resolve',{method:'POST',headers:{cookie:cookies[0],origin,'content-type':'application/json',
      'idempotency-key':commandId,'if-match':'"'+review.row_version+'"','x-csrf-token':bootstrap.csrf_token},body:JSON.stringify(command)});
    assert.equal(committed.status,200);const result=await committed.json() as Record<string,unknown>;
    const receipt=await get(path);assert.equal(receipt.status,200);const value=await receipt.json();
    assert.deepEqual(value,{client_command_id:commandId,review_id:selected.id,state:'COMMITTED',result:{...result,replayed:true}});
    await assertP2016Schema('workbench_review_receipt',value);
    assert.equal((await get(path,1)).status,404);
    const facts=(await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM pilot_ticket.ticket_command_receipt')).rows[0]?.count;
    assert.equal(facts,1);
  },{workbenchManualReviewEnabled:true,workbenchDraftRecoveryEnabled:true});
});

test('T14 all eight lawful conclusions preserve the original Decision and classify without forcing a fault',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const {read,post}=http(fixture),bootstrap=await read('/api/lifecycle/bootstrap');
    const outcomes=[['CONFIRM_TICKET_ELIGIBLE','INCIDENT','TICKET_CREATED'],['CLASSIFY_SERVICE_REQUEST','SERVICE_REQUEST','TICKET_CREATED'],
      ['REQUEST_DESCRIPTION','UNKNOWN','WAITING_DESCRIPTION'],['CLASSIFY_BUSINESS_CONSULTATION','QUESTION','COMPLETED'],['ACKNOWLEDGE','CHATTER','COMPLETED'],
      ['MARK_OUT_OF_SCOPE','UNKNOWN','IGNORED'],['KEEP_INCIDENT_REVIEW_CANDIDATE','UNKNOWN','WAITING_TRIAGE'],['CANCEL_REVIEW','UNKNOWN','WAITING_TRIAGE']];
    for(const [resolution,requestType,status] of outcomes){
      const {input,review}=await freshReview(fixture),original=await read('/api/manual-reviews/'+review.id);
      const command={client_command_id:randomUUID(),expected_row_version:original.row_version,expected_material_basis:(original.material_basis as {current_hash:string}).current_hash,
        resolution_code:resolution,resolution_reason_code:'EXPLICIT_HUMAN_CHOICE'};
      const accepted=await post(review.id,command,bootstrap.csrf_token);assert.equal(accepted.status,200,await accepted.clone().text());
      const current=await read('/api/manual-reviews/'+review.id);assert.deepEqual(current.safe_result,original.safe_result);assert.deepEqual(current.allowed_resolutions,[]);
      const intake=(await fixture.pool.query<{request_type:string;status:string;pilot_ticket_id:string|null}>('SELECT request_type,status,pilot_ticket_id::text FROM intake.service_intake WHERE id=$1::uuid',[input.intakeId])).rows[0];
      assert.equal(intake?.request_type,requestType,resolution);assert.equal(intake?.status,status,resolution);assert.equal(Boolean(intake?.pilot_ticket_id),resolution==='CONFIRM_TICKET_ELIGIBLE'||resolution==='CLASSIFY_SERVICE_REQUEST');
      if(intake?.pilot_ticket_id)assert.equal((await fixture.pool.query<{request_type:string}>('SELECT request_type FROM pilot_ticket.ticket WHERE id=$1::uuid',[intake.pilot_ticket_id])).rows[0]?.request_type,requestType);
      const replay=await post(review.id,command,bootstrap.csrf_token);assert.equal(replay.status,200);assert.equal((await replay.json() as {replayed:boolean}).replayed,true);
      assert.equal((await fixture.pool.query<{count:number}>("SELECT count(*)::integer AS count FROM intake.deterministic_decision WHERE journey_id=$1::uuid AND status='HUMAN_OVERRIDDEN'",[original.journey_id])).rows[0]?.count,1);
      assert.equal((await post(review.id,{...command,resolution_reason_code:'CHANGED_INTENT'},bootstrap.csrf_token)).status,409);
    }
    const {review}=await freshReview(fixture),original=await read('/api/manual-reviews/'+review.id),base={client_command_id:randomUUID(),expected_row_version:original.row_version,resolution_reason_code:'UNSUPPORTED'};
    assert.equal((await post(review.id,{...base,resolution_code:'LINK_EXISTING_JOURNEY'},bootstrap.csrf_token)).status,403);
    assert.equal((await post(review.id,{...base,resolution_code:'ACKNOWLEDGE',target_journey_id:randomUUID()},bootstrap.csrf_token)).status,403);
    assert.equal((await read('/api/manual-reviews/'+review.id)).status,'PENDING');
  },{workbenchManualReviewEnabled:true});
});

test('T14 bounded current material includes the latest genuine Bot supplement while retaining original evidence',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const {read}=http(fixture),{input,review}=await freshReview(fixture),original=await read('/api/manual-reviews/'+review.id);
    for(let index=0;index<52;index++)await appendBot(fixture.pool,input.intakeId,'合成补充 '+index+(index===51?'：LATEST_RETAINED_MATERIAL':''));
    const current=await read('/api/manual-reviews/'+review.id),materials=current.materials as {text:string|null}[];
    assert.deepEqual(current.safe_result,original.safe_result);assert.equal(current.row_version,original.row_version);
    assert.equal((current.material_basis as {current_revision:string}).current_revision,'53');assert.equal(current.materials_truncated,true);
    assert.ok(materials.length<=50);assert.ok(materials.some(material=>material.text?.includes('LATEST_RETAINED_MATERIAL')),'a bounded projection must include the latest retained material');
  },{workbenchManualReviewEnabled:true});
});

test('T14 a selectable fresh Review version points to the same single canonical Item',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const {read}=http(fixture),{input,review}=await freshReview(fixture);await appendBot(fixture.pool,input.intakeId,'后来补充：这是咨询，需要重新判断。');await fixture.processReviewIntake(input.intakeId);
    const refs=(await read('/api/workbench/items/review/'+review.id)).review_refs as {id:string}[];assert.equal(refs.length,2);const next=refs.find(ref=>ref.id!==review.id);assert.ok(next);
    const current=await read('/api/manual-reviews/'+next.id);assert.equal((current.material_basis as {stale:boolean}).stale,false);
    assert.deepEqual(current.canonical_item,{kind:'review',id:review.id},'the selected Review target and canonical card identity are distinct');
  },{workbenchManualReviewEnabled:true});
});

test('T14 retiring an old Review follows the actual remaining pending Review instead of a suppressed Intake',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    const {read,post}=http(fixture),{input,review}=await freshReview(fixture),original=await read('/api/manual-reviews/'+review.id),bootstrap=await read('/api/lifecycle/bootstrap');
    await appendBot(fixture.pool,input.intakeId,'后来补充：原判断需要重新复核。');await fixture.processReviewIntake(input.intakeId);
    const refs=(await read('/api/workbench/items/review/'+review.id)).review_refs as {id:string}[],next=refs.find(ref=>ref.id!==review.id);assert.ok(next);
    const cancelled=await post(review.id,{client_command_id:randomUUID(),expected_row_version:original.row_version,resolution_code:'CANCEL_REVIEW',resolution_reason_code:'EXPLICIT_RETIREMENT'},bootstrap.csrf_token);assert.equal(cancelled.status,200);
    const current=await read('/api/manual-reviews/'+review.id);assert.deepEqual(current.canonical_item,{kind:'review',id:next.id});
    const alias=await read('/api/workbench/items/review/'+review.id);assert.equal((alias.item as {id:string}).id,next.id);assert.deepEqual(alias.requested_item,{kind:'review',id:review.id});
  },{workbenchManualReviewEnabled:true});
});

test('T14 a later genuine Channel Leg fences the unchanged original Review and permits explicit cancellation',async()=>{
  await withWeb01Fixture(async({origin,cookies,pool}:Fixture)=>{
    const read=async(path:string):Promise<Record<string,unknown>>=>{const response=await fetch(origin+path,{headers:{cookie:cookies[0]}});assert.equal(response.status,200);return await response.json() as Record<string,unknown>;};
    const bootstrap=await read('/api/lifecycle/bootstrap'),board=await read('/api/workbench/board?column=pending');
    const selected=(board.items as {kind:string;id:string}[]).find(item=>item.kind==='review');assert.ok(selected);
    const original=await read('/api/manual-reviews/'+selected.id);
    const second=await seedPersistedIntake({pool,chatType:'single',text:'后来单聊补充的新材料，原判断没有评估。'});
    const transaction=await pool.connect();
    try{
      await transaction.query('BEGIN');
      const journey=(await transaction.query<{reporter_identity_hash:string}>('SELECT reporter_identity_hash FROM intake.contact_journey WHERE id=$1::uuid FOR UPDATE',[original.journey_id])).rows[0];assert.ok(journey);
      await createContactJourneyStore().ensureLeg({transaction,input:{journey_id:original.journey_id as string,source_intake_id:second.intakeId,
        leg_type:'DIRECT_GUIDED',origin_channel_message_id:second.messageId,provider_context_hash:'1'.repeat(64),channel_identity_hash:'2'.repeat(64),
        reporter_identity_hash:journey.reporter_identity_hash,opened_at:second.receivedAt}});
      await transaction.query('COMMIT');
    }catch(error){await transaction.query('ROLLBACK');throw error;}finally{transaction.release();}
    const current=await read('/api/manual-reviews/'+selected.id);assert.equal(current.row_version,original.row_version);assert.deepEqual(current.safe_result,original.safe_result);
    assert.equal((current.material_basis as {reason:string}).reason,'NEW_CHANNEL_LEG');
    assert.ok((current.materials as {text:string|null;in_original_basis:boolean}[]).some(value=>value.text?.includes('后来单聊')&&!value.in_original_basis));
    assert.deepEqual(current.allowed_resolutions,['CANCEL_REVIEW']);
    const post=async(resolution:string)=>{
      const command={client_command_id:randomUUID(),expected_row_version:original.row_version,resolution_code:resolution,resolution_reason_code:'EXPLICIT_REVIEW_CHOICE'};
      const response=await fetch(origin+'/api/manual-reviews/'+selected.id+'/resolve',{method:'POST',headers:{cookie:cookies[0],origin,'content-type':'application/json',
        'idempotency-key':command.client_command_id,'if-match':'"'+command.expected_row_version+'"','x-csrf-token':bootstrap.csrf_token as string},body:JSON.stringify(command)});
      return await response.json() as {ok:boolean;error?:{code:string}};
    };
    const rejected=await post('CONFIRM_TICKET_ELIGIBLE');assert.equal(rejected.ok,false);assert.equal(rejected.error?.code,'P2_016_VERSION_CONFLICT');
    assert.equal((await pool.query<{count:number}>("SELECT count(*)::integer AS count FROM intake.deterministic_decision WHERE status='HUMAN_OVERRIDDEN'")).rows[0]?.count,0);
    assert.equal((await post('CANCEL_REVIEW')).ok,true);
  },{workbenchManualReviewEnabled:true});
});

test('T14 same Item exposes safe Review evidence with independent Journey authorization',async()=>{
  await withWeb01Fixture(async({origin,cookies,tickets,pool}:Fixture)=>{
    const read=async(path:string,index=0):Promise<Record<string,unknown>>=>{const response=await fetch(origin+path,{headers:{cookie:cookies[index]}});assert.equal(response.status,200,await response.clone().text());return await response.json() as Record<string,unknown>;};
    const first=tickets[0],other=tickets[5];assert.ok(first);assert.ok(other);
    const bootstrap=await read('/api/lifecycle/bootstrap');assert.equal(bootstrap.manual_review_enabled,true);
    const ticketId=first.ticket.id,detail=await read('/api/workbench/items/ticket/'+ticketId);
    const refs=detail.review_refs as {id:string;status:string;row_version:string}[];assert.equal(refs.length,1);assert.equal(refs[0]?.status,'PENDING');
    const review=await read('/api/manual-reviews/'+refs[0]?.id);
    const basis=review.material_basis as {stale:boolean;original_hash:string;current_hash:string;source_kind:string};
    assert.equal(basis.stale,false);assert.equal(basis.source_kind,'BOT');assert.match(basis.original_hash,/^[a-f0-9]{64}$/u);
    const materials=review.materials as {source_ref:string;text:string|null;in_original_basis:boolean}[];
    assert.ok(materials.some(material=>material.text?.includes('门诊二楼打印机')&&material.in_original_basis));
    assert.deepEqual(review.canonical_item,{kind:'ticket',id:ticketId});assert.ok((review.allowed_resolutions as string[]).includes('CLASSIFY_BUSINESS_CONSULTATION'));
    assert.deepEqual(review.unsupported_resolutions,['LINK_EXISTING_JOURNEY']);
    // Visible Ticket relation never grants materials belonging to another Journey.
    const foreign=(await pool.query<{id:string}>(`SELECT r.id::text FROM intake.manual_review_item r WHERE r.service_intake_id<>$1::uuid LIMIT 1`,[first.intake.intakeId])).rows[0];assert.ok(foreign);
    await pool.query(`UPDATE intake.manual_review_item SET linked_ticket_id=$2::uuid WHERE id=$1::uuid`,[foreign.id,other.ticket.id]);
    await pool.query(`INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES('OTHER_TEAM','另一合成处理组')`);
    await pool.query(`UPDATE pilot_ticket.ticket SET resolver_team_id='OTHER_TEAM',assignee_id=NULL WHERE id=$1::uuid`,[first.ticket.id]);
    await pool.query(`UPDATE intake.contact_journey SET linked_ticket_id=$2::uuid WHERE id=(SELECT journey_id FROM intake.manual_review_item WHERE id=$1::uuid)`,[foreign.id,first.ticket.id]);
    const scoped=await read('/api/workbench/items/ticket/'+other.ticket.id,2);
    assert.ok(!(scoped.review_refs as {id:string}[]).some(ref=>ref.id===foreign.id));
    assert.equal((await fetch(origin+'/api/manual-reviews/'+foreign.id,{headers:{cookie:cookies[2]}})).status,404);
  },{workbenchManualReviewEnabled:true});
});

test('T14 consultation records the lawful non-fault outcome and keeps its canonical Item readable',async()=>{
  await withWeb01Fixture(async({origin,cookies,pool}:Fixture)=>{
    const read=async(path:string):Promise<Record<string,unknown>>=>{const response=await fetch(origin+path,{headers:{cookie:cookies[0]}});assert.equal(response.status,200,await response.clone().text());return await response.json() as Record<string,unknown>;};
    const bootstrap=await read('/api/lifecycle/bootstrap');assert.equal(typeof bootstrap.csrf_token,'string');
    const board=await read('/api/workbench/board?column=pending'),selected=(board.items as {kind:string;id:string;intake_id:string}[]).find(item=>item.kind==='review');assert.ok(selected);
    const before=await read('/api/manual-reviews/'+selected.id),command={client_command_id:randomUUID(),expected_row_version:before.row_version as string,
      resolution_code:'CLASSIFY_BUSINESS_CONSULTATION',resolution_reason_code:'BUSINESS_CONSULTATION_CONFIRMED'};
    const post=()=>fetch(origin+'/api/manual-reviews/'+selected.id+'/resolve',{method:'POST',headers:{cookie:cookies[0],origin,'content-type':'application/json',
      'idempotency-key':command.client_command_id,'if-match':'"'+command.expected_row_version+'"','x-csrf-token':bootstrap.csrf_token as string},body:JSON.stringify(command)});
    const response=await post();assert.equal(response.status,200,await response.clone().text());
    const review=await read('/api/manual-reviews/'+selected.id);assert.equal(review.status,'RESOLVED');assert.deepEqual(review.safe_result,before.safe_result);
    assert.deepEqual(review.canonical_item,{kind:'intake',id:selected.intake_id});assert.deepEqual(review.allowed_resolutions,[]);
    const current=await read('/api/workbench/items/intake/'+selected.intake_id);assert.equal((current.item as {status:string}).status,'COMPLETED');
    const alias=await read('/api/workbench/items/review/'+selected.id);assert.deepEqual(alias.requested_item,{kind:'review',id:selected.id});
    assert.equal((alias.item as {id:string}).id,selected.intake_id);
    const replay=await post();assert.equal(replay.status,200);assert.equal((await replay.json() as {replayed:boolean}).replayed,true);
    const facts=(await pool.query<{tickets:number;decisions:number}>(`SELECT (SELECT count(*)::integer FROM pilot_ticket.ticket) AS tickets,
      (SELECT count(*)::integer FROM intake.deterministic_decision WHERE id IN(SELECT resolution_decision_id FROM intake.manual_review_item WHERE id=$1::uuid)) AS decisions`,[selected.id])).rows[0];
    assert.deepEqual(facts,{tickets:13,decisions:1});
    assert.ok((await read('/api/workbench/board?column=pending')).items instanceof Array);
    assert.ok(!((await read('/api/workbench/board?column=pending')).items as {id:string}[]).some(item=>item.id===selected.id||item.id===selected.intake_id));
  },{workbenchManualReviewEnabled:true});
});
