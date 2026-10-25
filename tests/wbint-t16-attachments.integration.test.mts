import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID,randomBytes,createCipheriv} from 'node:crypto';
import {writeFile,readFile,unlink,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {createWorkbenchAttachmentStore} from '../app/server/src/workbench-attachment-store.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {withT16Fixture,T16_PNG} from './helpers/wbint-t16-fixture.mjs';
import type {AttachmentPage,AttachmentStore,StoredAttachment} from '../contracts/workbench_attachment_contracts.js';
test('attachment metadata rechecks parent READ in the final official Session statement after its database wait',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'pr99-final-attachment-')),key=randomBytes(32);let saved:AttachmentStore|undefined,armed=false,entered:()=>void=()=>{},resume:()=>void=()=>{};
  const reached=new Promise<void>(resolve=>{entered=resolve;}),release=new Promise<void>(resolve=>{resume=resolve;});
  const store:AttachmentStore={entries:async()=>{assert.ok(saved);const result=await saved.entries();if(armed){entered();await release;}return result;},open:async(ref,signal)=>{assert.ok(saved);return saved.open(ref,signal);},close:async()=>{await saved?.close();},ownedResourceState:()=>saved?.ownedResourceState()??{active:0,handles:0,plaintext_bytes:0}};
  try{await withWeb01Fixture(async(f:{pool:PostgresPool;origin:string;backendOrigin:string;cookies:string[];principals:{id:string}[];tickets:{ticket:{id:string};intake:{intakeId:string;messageId:string}}[]})=>{
    const selected=f.tickets[0],principal=f.principals[0],cookie=f.cookies[0];assert.ok(selected&&principal&&cookie);
    const asset:StoredAttachment={ref:randomUUID(),source_intake_id:selected.intake.intakeId,source_message_id:selected.intake.messageId,media_ref:'wmr_'+'c'.repeat(32),mime_type:'image/png',byte_size:T16_PNG.length,sha256:createHash('sha256').update(T16_PNG).digest('hex'),retention_until_epoch_ms:String(Date.now()+300000),scan_status:'PASSED',classification:'INTERNAL'};
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(JSON.stringify(asset)));
    const encrypted=Buffer.concat([cipher.update(T16_PNG),cipher.final()]);await writeFile(join(directory,asset.ref+'.asset'),Buffer.concat([iv,cipher.getAuthTag(),encrypted]));await writeFile(join(directory,'manifest.json'),JSON.stringify({version:1,assets:[asset]}));saved=createWorkbenchAttachmentStore({root:directory,key});
    await f.pool.query("UPDATE channel.message_inbox SET msg_type='image',normalized_message=jsonb_build_object('content',jsonb_build_array(jsonb_build_object('kind','media','media',jsonb_build_object('type','image','source_index',0,'download_ref',$2::text)))) WHERE id=$1::bigint",[asset.source_message_id,asset.media_ref]);
    const read=()=>fetch(f.backendOrigin+'/api/workbench/items/ticket/'+selected.ticket.id+'/attachments',{headers:{cookie}});assert.equal((await read()).status,200);armed=true;
    const pending=read(),blocker=await f.pool.connect();try{await reached;await blocker.query('BEGIN');await blocker.query('LOCK TABLE pilot_ticket.workbench_auth_session IN ACCESS EXCLUSIVE MODE');resume();
      let waiting=false;for(let attempt=0;attempt<200;attempt++){waiting=(await f.pool.query("SELECT 1 FROM pg_locks WHERE relation='pilot_ticket.workbench_auth_session'::regclass AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())")).rowCount!==0;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(waiting,'the real final official Session SQL is blocked');
      await f.pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='ADMIN'",[principal.id]);await f.pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER') ON CONFLICT DO NOTHING",[principal.id]);await f.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[principal.id]);await blocker.query('ROLLBACK');
      const response=await pending;assert.equal(response.status,404);assert.equal((await response.text()).includes(asset.ref),false);
    }finally{resume();await blocker.query('ROLLBACK');blocker.release();await pending.catch(()=>{});}
  },{realWorkbenchAuthentication:true,workbenchAttachmentsEnabled:true,attachmentStore:store});}
  finally{resume();await saved?.close();assert.deepEqual(store.ownedResourceState(),{active:0,handles:0,plaintext_bytes:0});key.fill(0);await rm(directory,{recursive:true,force:true});}
});
for(const seam of ['metadata-entries','metadata-open','content-final-source'] as const)test(`attachment ${seam} refuses disclosure when parent READ is removed during its asynchronous read`,async()=>{
  let entered:()=>void=()=>{},resume:()=>void=()=>{},entries=0;
  const reached=new Promise<void>(resolve=>{entered=resolve;}),release=new Promise<void>(resolve=>{resume=resolve;});
  const gate=async()=>{entered();await release;};
  await withT16Fixture(async({origin,cookie,tickets,asset,pool,principals,store})=>{
    const ticket=tickets[0],principal=principals[0];assert.ok(ticket&&principal);
    const path=seam==='content-final-source'?'/api/attachments/'+asset.ref+'?'+new URLSearchParams({kind:'ticket',id:ticket.ticket.id}):'/api/workbench/items/ticket/'+ticket.ticket.id+'/attachments';
    const pending=fetch(origin+path,{headers:{cookie}}).then(async response=>({status:response.status,body:Buffer.from(await response.arrayBuffer())})).catch((error:unknown)=>{if(seam==='content-final-source')return null;throw error;});
    try{
      await reached;
      await pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='ADMIN'",[principal.id]);
      await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER') ON CONFLICT DO NOTHING",[principal.id]);
      await pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[principal.id]);
      resume();const response=await pending;
      if(seam==='content-final-source')assert.equal(response,null,'a revoked final chunk must disconnect before protected bytes are released');
      else{assert.ok(response);assert.equal(response.status,404);const body=response.body.toString('utf8');assert.equal(body.includes(asset.ref),false);assert.equal(body.includes('image/png'),false);}
      assert.deepEqual(store.ownedResourceState(),{active:0,handles:0,plaintext_bytes:0});
    }finally{resume();await pending.catch(()=>{});}
  },{decorateStore:store=>({...store,entries:async()=>{const result=await store.entries();entries++;if(seam==='metadata-entries'&&entries===1||seam==='content-final-source'&&entries===3)await gate();return result;},open:async(ref,signal)=>{const lease=await store.open(ref,signal);if(seam==='metadata-open')await gate();return lease;}})});
});
test('authorized staff read an existing source-bound attachment through real HTTP and saved encrypted bytes',async()=>{
  await withT16Fixture(async({origin,cookie,tickets,asset})=>{
    const ticket=tickets[0];assert.ok(ticket);
    const metadata=await fetch(origin+'/api/workbench/items/ticket/'+ticket.ticket.id+'/attachments',{headers:{cookie}});
    assert.equal(metadata.status,200);const page=await metadata.json() as AttachmentPage;assert.equal(page.available,true);assert.equal(page.items.length,1);assert.equal(page.items[0]?.ref,asset.ref);
    assert.equal(page.items[0]?.display_name,'报修附件.png');assert.equal(page.items[0]?.available,true);
    assert.equal(JSON.stringify(page).includes('source_message_id'),false);
    const response=await fetch(origin+'/api/attachments/'+asset.ref+'?'+new URLSearchParams({kind:'ticket',id:ticket.ticket.id}),{headers:{cookie}});
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('content-disposition'),'attachment; filename="report-attachment.png"');
    assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    const bytes=Buffer.from(await response.arrayBuffer());assert.deepEqual(bytes,T16_PNG);assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
  });
});
test('every read requires its current source association, original retention and current principal',async()=>{
  await withT16Fixture(async({origin,cookie,outsiderCookie,tickets,asset,pool,root,save,principals,store,reads})=>{
    const own=tickets[0],other=tickets[1];assert.ok(own);assert.ok(other);
    const path='/api/attachments/'+asset.ref+'?'+new URLSearchParams({kind:'ticket',id:own.ticket.id});
    const get=(target=path,auth=cookie)=>fetch(origin+target,{headers:{cookie:auth}});
    assert.equal((await fetch(origin+path)).status,401);assert.equal((await get(path,outsiderCookie)).status,404);assert.deepEqual(reads,{entries:0,opens:0});
    assert.equal((await fetch(origin+path,{headers:{cookie,range:'bytes=0-1'}})).status,416);assert.equal((await get(path+'&kind=ticket')).status,400);assert.equal((await fetch(origin+path,{method:'HEAD',headers:{cookie}})).status,404);assert.equal(reads.opens,0);
    await pool.query('UPDATE intake.service_intake SET source_chat_id=(SELECT source_chat_id FROM intake.service_intake WHERE id=$1::uuid) WHERE id=$2::uuid',[asset.source_intake_id,other.intake.intakeId]);
    const wrong=await get('/api/attachments/'+asset.ref+'?'+new URLSearchParams({kind:'ticket',id:other.ticket.id}));assert.equal(wrong.status,404);assert.deepEqual(await wrong.json(),{error:{code:'ATTACHMENT_NOT_FOUND',retryable:false}});assert.equal(reads.opens,0);
    await pool.query("UPDATE channel.message_inbox SET normalized_message=jsonb_build_object('content','[]'::jsonb,'quote',jsonb_build_object('content',jsonb_build_array(jsonb_build_object('kind','media','media',jsonb_build_object('download_ref',$2::text))))) WHERE id=$1::bigint",[asset.source_message_id,asset.media_ref]);
    assert.equal((await get()).status,404);
    await pool.query("UPDATE channel.message_inbox SET normalized_message=jsonb_build_object('content',jsonb_build_array(jsonb_build_object('kind','media','media',jsonb_build_object('download_ref',$2::text)))) WHERE id=$1::bigint",[asset.source_message_id,asset.media_ref]);
    for(const [changes,code,status] of [
      [{retention_until_epoch_ms:String(Date.now()-1)},'EXPIRED',410],
      [{scan_status:'PENDING'},'UNTRUSTED',422],
      [{classification:'PATIENT_SENSITIVE'},'UNTRUSTED',422],
      [{mime_type:'text/html'},'UNSUPPORTED',422],
      [{byte_size:10*1024*1024+1},'OVERSIZED',422],
      [{sha256:'0'.repeat(64)},'INTEGRITY_FAILED',422],
    ] as const){await save([{...asset,...changes}]);const response=await get();assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:{code:'ATTACHMENT_'+code,retryable:false}});}
    await save([asset]);const file=join(root,asset.ref+'.asset'),encrypted=await readFile(file);encrypted[12]=(encrypted[12]??0)^1;await writeFile(file,encrypted);const damaged=await get();assert.equal(damaged.status,422);assert.deepEqual(await damaged.json(),{error:{code:'ATTACHMENT_INTEGRITY_FAILED',retryable:false}});
    await unlink(file);const missing=await get();assert.equal(missing.status,404);assert.deepEqual(await missing.json(),{error:{code:'ATTACHMENT_MISSING',retryable:false}});
    await save([asset]);await pool.query("UPDATE channel.message_inbox SET received_at=platform.local_now()-interval '2 days',retention_until=platform.local_now()-interval '1 day' WHERE id=$1::bigint",[asset.source_message_id]);assert.equal((await get()).status,410);
    await pool.query("UPDATE channel.message_inbox SET retention_until=platform.local_now()+interval '30 days' WHERE id=$1::bigint",[asset.source_message_id]);
    await pool.query("UPDATE intake.service_intake SET retention_until=platform.local_now()-interval '1 day' WHERE id=$1::uuid",[asset.source_intake_id]);assert.equal((await get()).status,410);await pool.query("UPDATE intake.service_intake SET retention_until=platform.local_now()+interval '30 days' WHERE id=$1::uuid",[asset.source_intake_id]);
    await pool.query("UPDATE intake.service_intake SET privacy_class='PATIENT_SENSITIVE' WHERE id=$1::uuid",[asset.source_intake_id]);assert.equal((await get()).status,422);await pool.query("UPDATE intake.service_intake SET privacy_class='INTERNAL' WHERE id=$1::uuid",[asset.source_intake_id]);
    await pool.query("UPDATE channel.message_inbox SET privacy_class='SECRET' WHERE id=$1::bigint",[asset.source_message_id]);assert.equal((await get()).status,422);await pool.query("UPDATE channel.message_inbox SET privacy_class='INTERNAL' WHERE id=$1::bigint",[asset.source_message_id]);
    // Ticket survival must not revive original sources whose linked Journey has expired.
    await pool.query('WITH expired AS MATERIALIZED(SELECT platform.physical_epoch_ms()-1 AS epoch) UPDATE intake.contact_journey SET reported_at=platform.local_from_epoch_ms(expired.epoch-86400000),retention_until_epoch_ms=expired.epoch,retention_until=platform.local_from_epoch_ms(expired.epoch) FROM expired WHERE origin_intake_id=$1::uuid',[asset.source_intake_id]);
    assert.equal((await get()).status,410);
    await pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[principals[0]?.id]);assert.equal((await get()).status,401);
    assert.deepEqual(store.ownedResourceState(),{active:0,handles:0,plaintext_bytes:0});
  });
});
test('disabled or absent storage stays explicit and performs zero storage reads',async()=>{
  for(const options of [{enabled:false},{storage:false}])await withT16Fixture(async({origin,cookie,tickets,asset,reads})=>{
    const ticket=tickets[0];assert.ok(ticket);const metadata=await fetch(origin+'/api/workbench/items/ticket/'+ticket.ticket.id+'/attachments',{headers:{cookie}});assert.equal(metadata.status,200);assert.deepEqual(await metadata.json(),{available:false,reason:'STORAGE_UNAVAILABLE',items:[],truncated:false});
    const response=await fetch(origin+'/api/attachments/'+asset.ref+'?'+new URLSearchParams({kind:'ticket',id:ticket.ticket.id}),{headers:{cookie}});assert.equal(response.status,503);assert.deepEqual(reads,{entries:0,opens:0});
  },options);
});
test('real supplementary, clarification and explicit Journey sources are authorized without same-group expansion',async()=>{
  await withT16Fixture(async({pool,origin,cookie,tickets,asset,save})=>{
    const own=tickets[0],other=tickets[1];assert.ok(own);assert.ok(other);const media='wmr_'+'e'.repeat(32),tag='t16-synthetic-'+randomUUID();
    const inserted=await pool.query<{id:string}>(`INSERT INTO channel.message_inbox(schema_version,provider,msg_id,idempotency_key,req_id,bot_id,chat_type,chat_id,sender_user_id,msg_type,received_at,raw_text,clean_text,normalized_message,processing_status,response_snapshot,privacy_class,trace_id,retention_until,completed_at)
      SELECT schema_version,provider,$1,provider||':'||$1,$1,bot_id,chat_type,chat_id,sender_user_id,'image',received_at,raw_text,clean_text,jsonb_build_object('content',jsonb_build_array(jsonb_build_object('kind','media','media',jsonb_build_object('download_ref',$3::text)))),processing_status,response_snapshot,privacy_class,$1,retention_until,completed_at FROM channel.message_inbox WHERE id=$2::bigint RETURNING id::text`,[tag,asset.source_message_id,media]);const message=inserted.rows[0];assert.ok(message);
    await pool.query("INSERT INTO intake.service_intake_message(intake_id,channel_message_id,relation_type,sequence_no,linked_at,trace_id) VALUES($1::uuid,$2::bigint,'SUPPLEMENT',2,platform.local_now(),'t16-synthetic')",[asset.source_intake_id,message.id]);await pool.query('UPDATE intake.service_intake SET message_count=2 WHERE id=$1::uuid',[asset.source_intake_id]);
    const supplemental={...asset,ref:randomUUID(),source_message_id:message.id,media_ref:media};await save([supplemental]);
    const download=async(kind:string,id:string,ref:string)=>{const response=await fetch(origin+'/api/attachments/'+ref+'?'+new URLSearchParams({kind,id}),{headers:{cookie}});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),T16_PNG);};
    await download('ticket',own.ticket.id,supplemental.ref);await pool.query("UPDATE intake.service_intake_message SET relation_type='CLARIFICATION' WHERE channel_message_id=$1::bigint",[message.id]);await download('ticket',own.ticket.id,supplemental.ref);
    const waiting=(await pool.query<{id:string;message_id:string}>("SELECT id::text,primary_message_id::text AS message_id FROM intake.service_intake WHERE status='WAITING_DESCRIPTION' LIMIT 1")).rows[0];assert.ok(waiting);
    const review=(await pool.query<{id:string;intake_id:string;message_id:string}>("SELECT r.id::text,r.service_intake_id::text AS intake_id,i.primary_message_id::text AS message_id FROM intake.manual_review_item r JOIN intake.service_intake i ON i.id=r.service_intake_id WHERE r.linked_ticket_id IS NULL LIMIT 1")).rows[0];assert.ok(review);
    for(const item of [{kind:'intake',id:waiting.id,intake_id:waiting.id,message_id:waiting.message_id},{kind:'review',id:review.id,intake_id:review.intake_id,message_id:review.message_id}]){
      const record={...asset,ref:randomUUID(),source_intake_id:item.intake_id,source_message_id:item.message_id};await pool.query("UPDATE channel.message_inbox SET normalized_message=jsonb_build_object('content',jsonb_build_array(jsonb_build_object('kind','media','media',jsonb_build_object('download_ref',$2::text)))) WHERE id=$1::bigint",[item.message_id,record.media_ref]);await save([record]);
      const response=await fetch(origin+'/api/workbench/items/'+item.kind+'/'+item.id+'/attachments',{headers:{cookie}});assert.equal(response.status,200);assert.equal((await response.json() as AttachmentPage).items[0]?.available,true);await download(item.kind,item.id,record.ref);
    }
    await pool.query('UPDATE intake.service_intake SET source_chat_id=(SELECT source_chat_id FROM intake.service_intake WHERE id=$1::uuid) WHERE id=$2::uuid',[asset.source_intake_id,waiting.id]);
    await pool.query('UPDATE channel.message_inbox SET chat_id=(SELECT chat_id FROM channel.message_inbox WHERE id=$1::bigint) WHERE id=$2::bigint',[asset.source_message_id,waiting.message_id]);
    await pool.query(`INSERT INTO intake.channel_leg(journey_id,leg_ordinal,leg_type,source_intake_id,origin_channel_message_id,provider_context_hash,channel_identity_hash,reporter_identity_hash,opened_at)
      SELECT l.journey_id,2,'GROUP_CONTINUATION',$2::uuid,$3::bigint,l.provider_context_hash,l.channel_identity_hash,l.reporter_identity_hash,platform.local_now() FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id WHERE j.origin_intake_id=$1::uuid AND l.leg_ordinal=1`,[asset.source_intake_id,waiting.id,waiting.message_id]);
    const linked={...asset,ref:randomUUID(),source_intake_id:waiting.id,source_message_id:waiting.message_id};await save([linked]);await download('ticket',own.ticket.id,linked.ref);
    const wrong=await fetch(origin+'/api/attachments/'+linked.ref+'?'+new URLSearchParams({kind:'ticket',id:other.ticket.id}),{headers:{cookie}});assert.equal(wrong.status,404);
  });
});
test('an authenticated file lease cannot silently use a different manifest registration before headers',async()=>{
  await withT16Fixture(async({origin,cookie,tickets,asset,store})=>{
    const ticket=tickets[0];assert.ok(ticket);
    const response=await fetch(origin+'/api/attachments/'+asset.ref+'?'+new URLSearchParams({kind:'ticket',id:ticket.ticket.id}),{headers:{cookie}});
    assert.equal(response.status,422);assert.deepEqual(await response.json(),{error:{code:'ATTACHMENT_INTEGRITY_FAILED',retryable:false}});
    assert.deepEqual(store.ownedResourceState(),{active:0,handles:0,plaintext_bytes:0});
  },{decorateStore:(store,save,asset)=>({...store,open:async(ref,signal)=>{
    const lease=await store.open(ref,signal);await save([{...asset,classification:'SENSITIVE_INTERNAL'}]);return lease;
  }})});
});
