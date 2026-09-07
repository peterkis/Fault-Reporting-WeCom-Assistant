import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { normalizeCommand,snapshot,hash,flags,version,ERROR_CODES,p2012HttpStatusForErrorCode,p2012HttpStatusForCommandResult } from '../src/p2-012-domain-contracts.mjs';
test('P2-012 closes input shapes, rejects hostile values and preserves deterministic command hashes',()=>{
  const c={action:'START_REVIEW',client_command_id:randomUUID(),candidate_review_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'};
  assert.equal(hash(c),hash(Object.fromEntries(Object.entries(c).reverse())));
  assert.equal(normalizeCommand(c).expected_row_version,'1');
  for(const invalid of [{...c,patient_id:'x'},{...c,expected_row_version:1},{...c,reason_code:'x\n'}])assert.throws(()=>normalizeCommand(invalid));
  let calls=0;const accessor={};Object.defineProperty(accessor,'x',{enumerable:true,get(){calls++;return 1;}});
  const cyclic={};cyclic.self=cyclic;
  for(const bad of [accessor,new Proxy({},{get(){calls++;}}),{[Symbol('x')]:1},{toJSON(){calls++;}},cyclic,JSON.parse('{"__proto__":{}}')])assert.throws(()=>snapshot(bad));
  assert.equal(calls,0);assert.equal(Object.values(flags()).every(x=>x===false),true);
  for(const bad of ['0','01','-1','1.0','9223372036854775808'])assert.throws(()=>version(bad));
});

test('P2-012 stable HTTP matrix is exhaustive, deterministic and rejects hostile results without executing code',()=>{
  const matrix={400:['INPUT_INVALID','LIMIT_INVALID','CURSOR_INVALID'],403:['FORBIDDEN','LIVE_APPROVAL_REQUIRED'],404:['NOT_FOUND','SOURCE_NOT_FOUND'],
    409:['COMMAND_CONFLICT','VERSION_CONFLICT','STATE_CONFLICT','EXPIRY_CONFLICT','SOURCE_CONFLICT','OWNER_INVALID','PRIMARY_NOT_LINKED','PRIMARY_STILL_LINKED','REPORT_ALREADY_LINKED','TICKET_ALREADY_LINKED','DIRECT_DESTINATION_REQUIRED','SOURCE_EVIDENCE_INCOMPLETE'],
    503:['NOTIFICATION_FAILED','COMMAND_FAILED','NOTIFICATION_EVENT_INVALID','DISABLED','FLAG_INVALID']};
  assert.deepEqual(Object.values(matrix).flat().map(c=>'P2_012_'+c).sort(),[...ERROR_CODES].sort());
  for(let i=0;i<100;i++)for(const [status,codes] of Object.entries(matrix))for(const code of codes){
    const stable='P2_012_'+code;assert.equal(p2012HttpStatusForErrorCode(stable),Number(status));
    for(const replayed of [false,true])assert.equal(p2012HttpStatusForCommandResult({ok:false,error:{code:stable,retryable:false},replayed}),Number(status));
  }
  const success={ok:true,result_ref_type:'INCIDENT',result_ref_id:randomUUID(),result_row_version:'1',result_event_id:randomUUID(),replayed:false};
  assert.equal(p2012HttpStatusForCommandResult(success),200);
  let calls=0;const trap=()=>{calls++;throw new Error('must not execute');};
  const accessor={};Object.defineProperty(accessor,'ok',{get:trap});
  const proxy=new Proxy({},{get:trap,getPrototypeOf:trap,ownKeys:trap,getOwnPropertyDescriptor:trap});
  const revoked=Proxy.revocable({},{});revoked.revoke();
  const cyclic={};cyclic.self=cyclic;
  for(const value of [null,undefined,[],{},'P2_012_FORBIDDEN',proxy,revoked.proxy,accessor,cyclic,{toJSON:trap},
    {ok:true},{...success,result_event_id:'bad'},{...success,status:201},
    {ok:false,error:{code:'P2_012_FORBIDDEN',retryable:false}},
    {ok:false,error:{code:'P2_012_FORBIDDEN',retryable:false,status:403},replayed:false},
    {ok:false,error:proxy,replayed:false},{ok:false,error:{code:'UNKNOWN',retryable:false},replayed:false}]){
    assert.equal(p2012HttpStatusForCommandResult(value),503);
  }
  for(const code of [null,undefined,proxy,accessor,'UNKNOWN','toString','__proto__'])assert.equal(p2012HttpStatusForErrorCode(code),503);
  assert.equal(calls,0);
});
