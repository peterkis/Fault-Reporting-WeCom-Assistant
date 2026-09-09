import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configurationFixture } from './helpers/p2-g2-configuration-fixture.mjs';
import { withG2ProviderReceipt, captureG2ProviderReceipt, readG2ProviderReceipts } from '../src/p2-g2-provider-receipts.mjs';

test('numeric SDK receipts survive restart, preserve errors and exclude SDK payload and identity', async t => {
  const directory=mkdtempSync(path.join(tmpdir(),'g2-receipts-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'receipts.jsonl'),{manifest}=configurationFixture();
  const binding={delivery_id:'10000000-0000-4000-8000-000000000010',outbox_id:'10000000-0000-4000-8000-000000000011',attempt_no:1};
  const invoke=send=>withG2ProviderReceipt(binding,()=>captureG2ProviderReceipt({file,manifest,send}));
  assert.equal((await invoke(async()=>({body:{errcode:0},headers:{req_id:'secret-request'},text:'secret-body'}))).body.errcode,0);
  for(const code of [45009,93000]){
    const error=Object.assign(new Error('secret-provider-error'),{errcode:code});
    await assert.rejects(invoke(async()=>{throw error;}),e=>e===error);
  }
  await invoke(async()=>({errcode:'0',secret:'secret-body'}));
  const networkError=new Error('secret-network-url');
  await assert.rejects(invoke(async()=>{throw networkError;}),e=>e===networkError);
  const rows=readG2ProviderReceipts({file,manifest});
  assert.deepEqual(rows.map(r=>[r.record.provider_errcode,r.record.outcome]),[[0,'ACKED'],[45009,'REJECTED'],[93000,'REJECTED'],[null,'UNKNOWN'],[null,'UNKNOWN']]);
  assert.ok(rows.every(r=>r.record.outbox_id===binding.outbox_id&&r.record.attempt_no===1));
  assert.ok(!readFileSync(file,'utf8').includes('secret-'));
  assert.throws(()=>readG2ProviderReceipts({file,manifest:{...manifest,run_id:'10000000-0000-4000-8000-000000000099'}}));
  appendFileSync(file,'{"partial":');assert.throws(()=>readG2ProviderReceipts({file,manifest}));
});

test('missing Delivery context refuses an SDK call before sending',async()=>{
  let calls=0;
  await assert.rejects(captureG2ProviderReceipt({file:'unused',manifest:configurationFixture().manifest,send:async()=>{calls++;}}));
  assert.equal(calls,0);
});
