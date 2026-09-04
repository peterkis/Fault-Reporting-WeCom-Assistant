import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { readFile,readdir } from 'node:fs/promises';
import { assertP2016Schema } from './helpers/p2-016-schema-assert.mjs';
import { validateP2016,p2016FrozenInputsMatch,p2016CompletionEvidenceValid } from '../scripts/validate-p2-016-ticket-lifecycle-workbench.mjs';
test('P2-016 architecture guards preserve authorization, immutable baselines and closed contracts',async()=>{
  // The full suite produces readiness Evidence; it cannot require its own future receipt.
  const r=await validateP2016({includeReadinessEvidence:false});assert.deepEqual(r.errors,[]);assert.ok(r.checks>=100);
  assert.equal(r.readiness_evidence_checked,false);
});

test('P2-016 default validator still requires readiness Evidence; deferred source checks cannot authorize live work',async()=>{
  const required=await validateP2016();assert.equal(required.state==='DONE'?required.completion_evidence_checked:required.readiness_evidence_checked,true);
  await assert.rejects(validateP2016({includeReadinessEvidence:'false'}),/P2_016_VALIDATION_MODE_INVALID/u);
});
test('P2-016 schemas and declarations exist; Reporter outputs cannot contain internal identity or credentials',async()=>{
  const files=(await readdir('contracts')).filter(n=>/^p2_016_.*\.schema\.json$/u.test(n));assert.ok(files.length>=15);
  for(const name of files){const s=JSON.parse(await readFile('contracts/'+name,'utf8'));assert.equal(s.additionalProperties,false);assert.ok(s.$id);}
  for(const name of ['p2_016_reporter_session','p2_016_reporter_ticket_view','p2_016_reporter_timeline']){
    const text=await readFile('contracts/'+name+'.schema.json','utf8');assert.doesNotMatch(text,/"(?:ticket_id|reporter_wecom_userid|chatid|nonce|token_hash|session_token_hash|internal_note|provider_error)"/u);
  }
  assert.doesNotMatch(await readFile('contracts/p2_016_contracts.d.ts','utf8'),/\bDate\b/u);
  const openapi=(await readFile('contracts/conversation_center.openapi.yaml','utf8')).replaceAll('\r\n','\n');
  const keys=[...openapi.split('  schemas:\n')[1].matchAll(/^    ([A-Za-z0-9_]+):/gmu)].map(m=>m[1]);assert.equal(new Set(keys).size,keys.length);
  assert.match(openapi,/workbench_conversation_detail\.schema\.json/u);
});
test('JSON contract rejects extra keys, noncanonical types and offset time',async()=>{
  const value={client_command_id:randomUUID(),expected_version:1,reason_code:'TEST'};
  await assertP2016Schema('p2_016_ticket_action_command',value);
  await assert.rejects(assertP2016Schema('p2_016_ticket_action_command',{...value,expected_version:'1'}));
  await assert.rejects(assertP2016Schema('p2_016_ticket_action_command',{...value,authorization:true}));
  const model={public_ref:'p'.repeat(32),suffix:'0001',status:'QUEUED',occurred_at:'2026-09-04 10:00:00',version:1,notification_type:'TICKET_CREATED',source:'DIRECT'};
  await assertP2016Schema('p2_016_template_card_view_model',model);
  await assert.rejects(assertP2016Schema('p2_016_template_card_view_model',{...model,occurred_at:'2026-09-04T10:00:00Z'}));
});

test('P2-016 closeout freezes every business input and the exact file set',()=>{
  const before=[{path:'src/p2-016-runtime.mjs',sha256:'a'.repeat(64)},{path:'scripts/validate-v1-4-architecture.mjs',sha256:'b'.repeat(64)}];
  assert.equal(p2016FrozenInputsMatch(before,before),true);
  assert.equal(p2016FrozenInputsMatch(before,[before[0],{...before[1],sha256:'c'.repeat(64)}]),true);
  assert.equal(p2016FrozenInputsMatch(before,[{...before[0],sha256:'c'.repeat(64)},before[1]]),false);
  assert.equal(p2016FrozenInputsMatch(before,[before[0]]),false);
  assert.equal(p2016FrozenInputsMatch(before,[before[0],before[0]]),false);
  assert.equal(p2016FrozenInputsMatch(before,[...before,{path:'scripts/new-unapproved.mjs',sha256:'d'.repeat(64)}]),false);
});
test('P2-016 completion requires owner approval, precise candidates, live duration and zero-skip final regression',()=>{
  const liveHash='3752596720f20524ff989ee9cf913b9e104e32a4c2095c48fc83804e7e75f863',hash='a'.repeat(64);
  const regression={status:'PASS',exit_code:0,tests:536,pass:536,fail:0,cancelled:0,skipped:0,todo:0};
  const valid={hash,ownerText:'P2_016_TARGETED_LIVE_VALIDATION=APPROVED '+liveHash,
    completion:{status:'DONE',runtime_input_sha256:hash,validated_live_candidate_sha256:liveHash,owner_approval:'APPROVED',closeout_regression:regression},
    live:{status:'PASSED',runtime_input_sha256:liveHash,owner_approval:'APPROVED',summary:{observed_ms:900000,final_pending:0,final_dead_letter:0,final_unknown:0}},
    postLive:{runtime_input_sha256:liveHash,regression}};
  assert.equal(p2016CompletionEvidenceValid(valid),true);
  for(const mutate of [x=>x.ownerText='',x=>x.completion.owner_approval='PENDING',x=>x.hash='b'.repeat(64),
    x=>x.live.summary.observed_ms=899999,x=>x.live.summary.final_unknown=1,x=>x.live.status='NOT_RUN',
    x=>x.completion.closeout_regression.skipped=1,x=>x.completion.closeout_regression.status='PENDING',
    x=>x.completion.closeout_regression.pass='536',x=>x.live.summary.observed_ms='900000',
    x=>x.postLive.regression.fail=1]){
    const broken=structuredClone(valid);mutate(broken);assert.equal(p2016CompletionEvidenceValid(broken),false);
  }
});
