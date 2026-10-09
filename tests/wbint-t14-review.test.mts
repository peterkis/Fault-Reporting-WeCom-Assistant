import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
import {createManualReviewStore} from '../src/p2-015-manual-review.mjs';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import {createP2016ManualReviewFacade} from '../src/p2-016-manual-review-facade.mjs';
import type {ManualReviewFacadeOptions} from '../src/p2-016-manual-review-facade.mjs';

test('T14 receipt and captured Review intent schemas reject unrelated facts and unsafe versions',async()=>{
  const base={review_id:randomUUID(),client_command_id:randomUUID()},unknown={...base,state:'UNKNOWN'};
  const committed={...base,state:'COMMITTED',result:{ok:true,review_id:base.review_id,status:'RESOLVED',resolution_decision_id:randomUUID(),action_count:0,replayed:true}};
  const failed={...base,state:'FAILED',error:{code:'P2_016_VERSION_CONFLICT',retryable:false}};
  for(const value of [unknown,committed,failed])await assertP2016Schema('workbench_review_receipt',value);
  for(const value of [{...unknown,result:committed.result},{...committed,note:'private'},{...failed,error:{...failed.error,retryable:true}},
    {...committed,result:{...committed.result,replayed:false}},{...committed,result:{...committed.result,action_count:21}}, {...committed,result:{...committed.result,ticket_id:randomUUID()}}])await assert.rejects(assertP2016Schema('workbench_review_receipt',value));
  const command={client_command_id:base.client_command_id,expected_row_version:'9007199254740993',resolution_code:'CLASSIFY_BUSINESS_CONSULTATION',resolution_reason_code:'HUMAN_CONFIRMED',expected_material_basis:'a'.repeat(64)};
  await assertP2016Schema('p2_016_manual_review_resolution',command);
  for(const value of [{...command,expected_row_version:9007199254740992},{...command,expected_row_version:'01'}, {...command,expected_material_basis:'A'.repeat(64)}, {...command,expected_material_basis:'a'.repeat(63)}, {...command,target_journey_id:randomUUID()}, {...command,resolution_code:'EXECUTE_SUGGESTION'}])await assert.rejects(assertP2016Schema('p2_016_manual_review_resolution',value));
});

test('T14 safe material read requires its own Review authority before any storage access',async()=>{
  let queries=0;
  const transaction={query:async():Promise<never>=>{queries++;throw new Error('UNEXPECTED_STORAGE');}};
  await assert.rejects(createManualReviewStore().material({transaction,principal:{principal_id:randomUUID()},review_id:randomUUID()}),{code:'P2_015_AUTHORIZATION_DENIED'});
  assert.equal(queries,0);
});

test('T14 disabled workspace and recovery guards acquire no storage capability',async()=>{
  const pool=createPostgresPool({connectionString:'postgresql://postgres@127.0.0.1:1/t14_never_connected',max:1});
  let calls=0;
  // Real lazy Pool; its two acquisition operations throw synchronously before any native socket.
  pool.query=():never=>{calls++;throw new Error('UNEXPECTED_STORAGE');};
  pool.connect=():never=>{calls++;throw new Error('UNEXPECTED_STORAGE');};
  const input={authContext:{principal_id:randomUUID()},reviewId:randomUUID(),commandId:randomUUID()};
  try{
    const disabled=createP2016ManualReviewFacade({pool});
    await assert.rejects(disabled.getManualReviewDetail(input),{code:'P2_016_DISABLED'});
    await assert.rejects(disabled.manualReviewReceipt(input),{code:'P2_016_DISABLED'});
    const profiles:ManualReviewFacadeOptions[]=[{pool,enabled:true},{pool,enabled:true,workspaceEnabled:true},{pool,enabled:true,draftRecoveryEnabled:true}];
    for(const profile of profiles)
      await assert.rejects(createP2016ManualReviewFacade(profile).manualReviewReceipt(input),{code:'P2_016_DISABLED'});
    await assert.rejects(createP2016ManualReviewFacade({pool,enabled:true}).resolveManualReview({...input,body:{client_command_id:input.commandId,
      expected_row_version:'1',resolution_code:'CANCEL_REVIEW',resolution_reason_code:'EXPLICIT_CANCEL',expected_material_basis:'a'.repeat(64)}}),{code:'P2_016_DISABLED'});
    assert.equal(calls,0);assert.equal(pool.totalCount,0);assert.equal(pool.idleCount,0);assert.equal(pool.waitingCount,0);
  }finally{await pool.end();}
});
