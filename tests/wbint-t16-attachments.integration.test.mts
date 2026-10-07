import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile,readFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {withT16Fixture,T16_PNG} from './helpers/wbint-t16-fixture.mjs';
import type {AttachmentPage} from '../contracts/workbench_attachment_contracts.js';
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
  await withT16Fixture(async({origin,cookie,outsiderCookie,tickets,asset,pool,root,save,principals,store})=>{
    const own=tickets[0],other=tickets[1];assert.ok(own);assert.ok(other);
    const path='/api/attachments/'+asset.ref+'?'+new URLSearchParams({kind:'ticket',id:own.ticket.id});
    const get=(target=path,auth=cookie)=>fetch(origin+target,{headers:{cookie:auth}});
    assert.equal((await fetch(origin+path)).status,401);assert.equal((await get(path,outsiderCookie)).status,404);
    const wrong=await get('/api/attachments/'+asset.ref+'?'+new URLSearchParams({kind:'ticket',id:other.ticket.id}));assert.equal(wrong.status,404);assert.deepEqual(await wrong.json(),{error:{code:'ATTACHMENT_NOT_FOUND',retryable:false}});
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
    // Ticket survival must not revive original sources whose linked Journey has expired.
    await pool.query('WITH expired AS MATERIALIZED(SELECT platform.physical_epoch_ms()-1 AS epoch) UPDATE intake.contact_journey SET reported_at=platform.local_from_epoch_ms(expired.epoch-86400000),retention_until_epoch_ms=expired.epoch,retention_until=platform.local_from_epoch_ms(expired.epoch) FROM expired WHERE origin_intake_id=$1::uuid',[asset.source_intake_id]);
    assert.equal((await get()).status,410);
    await pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[principals[0]?.id]);assert.equal((await get()).status,401);
    assert.deepEqual(store.ownedResourceState(),{active:0,handles:0,plaintext_bytes:0});
  });
});
