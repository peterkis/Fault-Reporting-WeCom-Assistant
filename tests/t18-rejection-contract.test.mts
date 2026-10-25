// SOURCE_NOT_RUN: proposed public rejection contract. The named decoder is not
// implemented/registered by this source-only preparation; no receipt is persisted.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeVerifiedManualReportRejection,ManualReportContractError} from '../app/pc-admin/src/contracts/workbench-manual-report-browser-contracts.mjs';

const commandId='00000000-0000-4000-8000-000000000018';
const otherId='00000000-0000-4000-8000-000000000019';
const code='P2_016_VERSION_CONFLICT';
function rejection(){return {error:{code,retryable:false},receipt:{client_command_id:commandId,state:'FAILED',error:{code,retryable:false}}};}

test('the verified rejection decoder accepts only a closed explicit FAILED receipt for the original command',()=>{
  // Acceptance is the public parsing contract; its return shape is left to the
  // existing caller/type design rather than inventing another receipt authority.
  assert.doesNotThrow(()=>decodeVerifiedManualReportRejection(rejection(),commandId));
});

test('a rejection cannot substitute outcome, command identity, privacy fields or retry semantics',()=>{
  const valid=rejection();
  const invalid:[string,unknown][]=[
    ['unknown outcome',{...valid,receipt:{...valid.receipt,state:'UNKNOWN'}}],
    ['committed outcome',{...valid,receipt:{...valid.receipt,state:'COMMITTED'}}],
    ['different UUID',{...valid,receipt:{...valid.receipt,client_command_id:otherId}}],
    ['missing receipt',{error:valid.error}],
    ['extra top-level private field',{...valid,raw_member_id:'PRIVATE_TEST_ONLY'}],
    ['extra error detail',{...valid,error:{...valid.error,details:'PRIVATE_TEST_ONLY'}}],
    ['extra receipt private field',{...valid,receipt:{...valid.receipt,proof:'PRIVATE_TEST_ONLY'}}],
    ['extra receipt error detail',{...valid,receipt:{...valid.receipt,error:{...valid.receipt.error,details:'PRIVATE_TEST_ONLY'}}}],
    ['outer retry allowed',{...valid,error:{...valid.error,retryable:true}}],
    ['receipt retry allowed',{...valid,receipt:{...valid.receipt,error:{...valid.receipt.error,retryable:true}}}],
    ['contradictory error codes',{...valid,receipt:{...valid.receipt,error:{...valid.receipt.error,code:'P2_016_FORBIDDEN'}}}],
    ['non-contract error code',{error:{code:'FORBIDDEN',retryable:false},receipt:{...valid.receipt,error:{code:'FORBIDDEN',retryable:false}}}],
    ['missing required retry marker',{...valid,receipt:{...valid.receipt,error:{code}}}],
  ];
  for(const [name,input] of invalid)assert.throws(()=>decodeVerifiedManualReportRejection(input,commandId),ManualReportContractError,name);
});
