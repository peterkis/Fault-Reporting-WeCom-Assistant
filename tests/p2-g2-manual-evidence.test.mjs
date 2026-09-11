import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { configurationFixture } from './helpers/p2-g2-configuration-fixture.mjs';
import { G2_ROOT } from '../src/p2-g2-candidate.mjs';
import { g2Hash } from '../src/p2-g2-validation-config.mjs';
import { compileG2ManualAssertion, verifyG2ManualSource } from '../src/p2-g2-manual-evidence.mjs';
import { readG2SourceFile, writeG2SourceFile, g2SourceBinding } from '../src/p2-g2-evidence-files.mjs';

test('manual evidence consumes exact human assertion and preserved fragment; ACK, altered claim and changed fragment are rejected',t=>{
  const dir=mkdtempSync(path.join(G2_ROOT,'tmp','p2-g2-manual-test-'));
  t.after(()=>{assert.ok(path.relative(path.join(G2_ROOT,'tmp'),dir).startsWith('p2-g2-'));rmSync(dir,{recursive:true,force:true});});
  const prefix=path.relative(G2_ROOT,dir).replaceAll('\\','/'),{manifest}=configurationFixture('live');
  const fragment='Synthetic test fixture only; not a real client observation.';
  writeG2SourceFile(prefix+'/fragment.txt',fragment);
  const assertion={schema_version:1,kind:'G2_MANUAL_ASSERTION',...g2SourceBinding(manifest),
    scenario_id:'G2-E01',evidence_type:'CLIENT_OBSERVATION',authority:'CLIENT_OBSERVER',physical_epoch_ms:'1788800100000',result:'PASS',
    details:{executed:true,client_display_confirmed:true,client_fragment_preserved:true},fragments:[{ref:prefix+'/fragment.txt',sha256:g2Hash(fragment)}]};
  const raw=JSON.stringify(assertion),source={kind:'CLIENT_FILE',ref:prefix+'/assertion.json',sha256:g2Hash(raw)};
  writeG2SourceFile(source.ref,raw);const record=compileG2ManualAssertion({source,manifest});
  assert.equal(verifyG2ManualSource(source,record,manifest),true);
  assert.equal(verifyG2ManualSource(source,{...record,producer:'AUTOMATED'},manifest),false);
  assert.equal(verifyG2ManualSource(source,{...record,details:{executed:true,owner_approved:true}},manifest),false);
  assert.throws(()=>compileG2ManualAssertion({source,manifest:{...manifest,run_id:'10000000-0000-4000-8000-000000000099'}}));
  assert.throws(()=>writeG2SourceFile(source.ref,raw));
  assert.throws(()=>readG2SourceFile(prefix+'/../private.env'));
  writeFileSync(path.join(dir,'fragment.txt'),'changed');
  assert.throws(()=>compileG2ManualAssertion({source,manifest}),{code:'P2_G2_SOURCE_CHANGED'});
});
