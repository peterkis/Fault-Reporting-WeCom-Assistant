import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { normalizeCommand,snapshot,hash,flags,version } from '../src/p2-012-domain-contracts.mjs';
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
