import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { configurationFixture } from './helpers/p2-g2-configuration-fixture.mjs';
import { G2_ROOT } from '../src/p2-g2-candidate.mjs';
import { g2Hash } from '../src/p2-g2-validation-config.mjs';
import { G2_METRIC_NAMES, buildG2AutomatedEvidence } from '../src/p2-g2-evidence.mjs';
import { G2_RESOURCE_SQL } from '../src/p2-g2-resource-sampler.mjs';
import { G2_RECONCILIATION_QUERY_HASH } from '../src/p2-g2-reconciliation.mjs';
import { writeG2SourceFile, g2SourceBinding } from '../src/p2-g2-evidence-files.mjs';
import { deriveG2Finalization } from '../src/p2-g2-finalization-evidence.mjs';

test('synthetic finalization fixture rejects pending reconciliation, stale cleanup and invented browser removal',t=>{
  const dir=mkdtempSync(path.join(G2_ROOT,'tmp','p2-g2-finalization-test-'));
  t.after(()=>{assert.ok(path.relative(path.join(G2_ROOT,'tmp'),dir).startsWith('p2-g2-'));rmSync(dir,{recursive:true,force:true});});
  const prefix=path.relative(G2_ROOT,dir).replaceAll('\\','/'),{manifest}=configurationFixture('live');
  let serial=0;const save=(kind,value)=>{const ref=prefix+'/'+kind+'-'+(++serial)+'.json',bytes=JSON.stringify(value);writeG2SourceFile(ref,bytes);return {ref,sha256:g2Hash(bytes)};};
  const base=g2SourceBinding(manifest),stamp=1788800100000;
  const startup={schema_version:1,kind:'G2_STARTUP_PACKET',...base,startup_scope:{ready:true,principals_ready:true,inbox:0,intakes:0,tickets:0,
    sessions:0,threads:0,messages:0,incidents:0,candidates:0,competing_roles:0},process_count:3,readiness:{base_service_ready:true},
    environment:{model_environment_keys:0,model_network_unreachable:true,expose_gc:false},host:{}};
  const resourceRef=prefix+'/resource-sources.jsonl',packets=Array.from({length:5},(_,i)=>({schema_version:1,kind:'G2_RESOURCE_PACKET',...base,
    sequence:i+1,physical_epoch_ms:String(stamp+i*15000),query_sha256:g2Hash(G2_RESOURCE_SQL),details:{executed:true,phase:'STEADY',
      observer_instance_id:'10000000-0000-4000-8000-000000000010',sample_monotonic_ms:i*15000,sample_gap_ms:i?15000:0,
      natural_gc:true,sleep_detected:false,interrupted:false,metrics:Object.fromEntries(G2_METRIC_NAMES.map(k=>[k,0]))}}));
  writeG2SourceFile(resourceRef,packets.map(p=>JSON.stringify(p)+'\n').join(''));
  const records=buildG2AutomatedEvidence({manifest,entries:packets.map(p=>({scenario_id:'G2-O01',evidence_type:'RESOURCE_MEASUREMENT',result:'PASS',
    physical_epoch_ms:p.physical_epoch_ms,details:p.details,source_refs:[{kind:'PROCESS_IPC',ref:resourceRef+':'+p.sequence,sha256:g2Hash(JSON.stringify(p))}]}))});
  const ref=prefix+'/resource-evidence.jsonl',raw=records.map(r=>JSON.stringify(r)+'\n').join('');writeG2SourceFile(ref,raw);
  const snapshot={schema_version:1,kind:'G2_RECONCILIATION_PACKET',...base,database_identity_hash:manifest.scope.database_identity_hash,
    query_sha256:G2_RECONCILIATION_QUERY_HASH,physical_epoch_ms:String(stamp+60002),counts:{unknown_pending:0,dead_letters:0,internal_note_leaks:0,
      automatic_incident_count:0,out_of_scope_deliveries:0,communication_pending:0,safe_actions_pending:0,remaining_role_connections:0}};
  const stop={schema_version:1,kind:'G2_STOP_PACKET',...base,physical_epoch_ms:String(stamp+60001),stopped:true,process_count:0};
  const browser={kind:'G2_BROWSER_CLEANUP_ASSERTION',authority:'CLIENT_OBSERVER',...base,physical_epoch_ms:String(stamp+60003),
    owned_profile_count:1,remaining_owned_profiles:0,browser_profiles_removed:true};
  const proof={schema_version:1,kind:'G2_FINALIZATION_PROOF',...base,startup:save('startup',startup),snapshot:save('snapshot',snapshot),stop:save('stop',stop),
    resources:{ref,sha256:g2Hash(raw)},browser_cleanup:save('browser',browser)};
  assert.deepEqual(deriveG2Finalization(proof,manifest).map(e=>e.result),['PASS','PASS']);
  assert.equal(deriveG2Finalization({...proof,browser_cleanup:undefined},manifest)[1].result,'INCOMPLETE');
  const pending=structuredClone(snapshot);pending.counts.unknown_pending=1;
  assert.equal(deriveG2Finalization({...proof,snapshot:save('snapshot',pending)},manifest)[0].result,'INCOMPLETE');
  assert.throws(()=>deriveG2Finalization({...proof,browser_cleanup:save('browser',{...browser,physical_epoch_ms:String(stamp)})},manifest));
  assert.throws(()=>deriveG2Finalization({...proof,stop:save('stop',{...stop,process_count:1})},manifest));
  assert.equal(deriveG2Finalization({...proof,browser_cleanup:save('browser',{...browser,browser_profiles_removed:false})},manifest)[1].result,'INCOMPLETE');
});
