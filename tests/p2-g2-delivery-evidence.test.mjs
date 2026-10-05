import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { configurationFixture } from './helpers/p2-g2-configuration-fixture.mjs';
import { G2_ROOT } from '../src/p2-g2-candidate.mjs';
import { g2Hash } from '../src/p2-g2-validation-config.mjs';
import { writeG2SourceFile, readG2SourceFile, g2SourceBinding } from '../src/p2-g2-evidence-files.mjs';
import { captureG2ProviderReceipt, withG2ProviderReceipt } from '../src/p2-g2-provider-receipts.mjs';
import { G2_RECONCILIATION_QUERY_HASH } from '../src/p2-g2-reconciliation.mjs';
import { deriveG2DeliveryEvidence } from '../src/p2-g2-delivery-evidence.mjs';

test('synthetic evidence fixture: SENT alone, unrelated attempt, seeded startup and organic prior-group cannot prove live receipt',async t=>{
  mkdirSync(path.join(G2_ROOT,'tmp'),{recursive:true});
  const dir=mkdtempSync(path.join(G2_ROOT,'tmp','p2-g2-delivery-test-'));
  t.after(()=>{assert.ok(path.relative(path.join(G2_ROOT,'tmp'),dir).startsWith('p2-g2-'));rmSync(dir,{recursive:true,force:true});});
  const prefix=path.relative(G2_ROOT,dir).replaceAll('\\','/'),{manifest}=configurationFixture('live');
  manifest.approval.valid_from_epoch_ms=String(Date.now()-1000);manifest.approval.expires_epoch_ms=String(Date.now()+60000);
  const delivery_id='10000000-0000-4000-8000-000000000010',outbox_id='10000000-0000-4000-8000-000000000011',hash=g2Hash(delivery_id);
  await withG2ProviderReceipt({delivery_id,outbox_id,attempt_no:2},()=>captureG2ProviderReceipt({file:path.join(dir,'provider-receipts.jsonl'),manifest,send:async()=>({errcode:0})}));
  let serial=0;
  const save=(kind,value)=>{const ref=prefix+'/'+kind+'-'+(++serial)+'.json';const bytes=JSON.stringify(value);writeG2SourceFile(ref,bytes);return {ref,sha256:g2Hash(bytes)};};
  const startup={schema_version:1,kind:'G2_STARTUP_PACKET',...g2SourceBinding(manifest),
    startup_scope:{ready:true,principals_ready:true,inbox:0,intakes:0,tickets:0,sessions:0,threads:0,messages:0,incidents:0,candidates:0,competing_roles:0},
    process_count:3,readiness:{base_service_ready:true},environment:{model_environment_keys:0,model_network_unreachable:true,expose_gc:false},host:{}};
  const snapshot={schema_version:1,kind:'G2_RECONCILIATION_PACKET',...g2SourceBinding(manifest),
    database_identity_hash:manifest.scope.database_identity_hash,physical_epoch_ms:String(Date.now()),query_sha256:G2_RECONCILIATION_QUERY_HASH,
    counts:{unknown_pending:0,out_of_scope_deliveries:0},deliveries:[{delivery_ref_hash:hash,outbox_id,status:'SENT',side_effect_state:'ACKNOWLEDGED',visibility:'EXTERNAL',
      purpose:'SYSTEM_NOTIFICATION',transport:'WECOM_AIBOT_WSS',entry_mode:'DIRECT_ORGANIC',organic_without_prior_group:true,
      audience:'PERSON',destination_eligible_at_reconciliation:true,direct_leg_count:1,source_event_ref:'event-fixture',source_event_type:'ticket.accepted',ticket_id:'ticket-fixture',notification_type:'TICKET_ACCEPTED'}],
    ticket_events:[{event_id:'event-fixture',ticket_id:'ticket-fixture',event_type:'ticket.accepted'}],
    attempts:[{delivery_ref_hash:hash,attempt_no:2,outcome:'SENT',side_effect_state:'ACKNOWLEDGED'}]};
  const ref=prefix+'/provider-receipts.jsonl',proof={schema_version:1,kind:'G2_DELIVERY_PROOF',run_id:manifest.run_id,candidate_fingerprint:manifest.candidate_fingerprint,
    scenario_id:'G2-E04',delivery_ref_hashes:[hash],startup:save('startup',startup),snapshot:save('snapshot',snapshot),receipts:[{ref,sha256:g2Hash(readG2SourceFile(ref))}]};
  const result=deriveG2DeliveryEvidence(proof,manifest);
  assert.equal(result.details.provider_ack_numeric,true);assert.equal(result.details.entry_mode,'DIRECT_ORGANIC');
  assert.equal(Object.hasOwn(result.details,'client_display_confirmed'),false);
  for(const scenario_id of ['G2-N02','G2-I02','G2-I03','G2-F01'])
    assert.throws(()=>deriveG2DeliveryEvidence({...proof,scenario_id},manifest),'one unrelated ACK cannot establish '+scenario_id);
  const guided=structuredClone(snapshot);Object.assign(guided.deliveries[0],{entry_mode:'GROUP_MENTION_TO_DIRECT_GUIDED',origin_channel:'WECOM_GROUP',direct_guided_leg_count:1,old_private_created_artifacts:0});
  assert.equal(deriveG2DeliveryEvidence({...proof,scenario_id:'G2-N02',snapshot:save('snapshot',guided)},manifest).result,'PASS');
  guided.deliveries[0].old_private_created_artifacts=1;
  assert.throws(()=>deriveG2DeliveryEvidence({...proof,scenario_id:'G2-N02',snapshot:save('snapshot',guided)},manifest));
  const incident=structuredClone(snapshot);Object.assign(incident.deliveries[0],{source_event_ref:'incident-confirmation',source_event_type:'incident.confirmed',
    incident_id:'incident-fixture',incident_audience:'REPORTER_DIRECT',template_code:'INCIDENT_CONFIRMED_DIRECT',incident_report_ref:'report-one'});
  incident.incident_events=[{id:'incident-confirmation',incident_id:'incident-fixture',event_type:'incident.confirmed',actor_kind:'HUMAN'},
    {id:'link',incident_id:'incident-fixture',event_type:'incident.report.linked',actor_kind:'HUMAN',report_id:'report-one'},
    {id:'unlink',incident_id:'incident-fixture',event_type:'incident.report.unlinked',actor_kind:'HUMAN',report_id:'report-one'}];
  incident.reports=[{id:'report-one',incident_id:'incident-fixture',ticket_id:'ticket-fixture',link_state:'UNLINKED',impact_state:'IMPACTED'}];
  assert.equal(deriveG2DeliveryEvidence({...proof,scenario_id:'G2-I02',snapshot:save('snapshot',incident)},manifest).result,'PASS');
  incident.incident_events.push({id:'recovery',incident_id:'incident-fixture',event_type:'incident.report.recovered',actor_kind:'HUMAN',report_id:'report-one'});
  incident.reports[0].impact_state='RECOVERED';incident.reports.push({id:'report-two',incident_id:'incident-fixture',ticket_id:'other-ticket',impact_state:'IMPACTED'});
  assert.equal(deriveG2DeliveryEvidence({...proof,scenario_id:'G2-I03',snapshot:save('snapshot',incident)},manifest).result,'PASS');
  incident.reports[1].impact_state='RECOVERED';
  assert.throws(()=>deriveG2DeliveryEvidence({...proof,scenario_id:'G2-I03',snapshot:save('snapshot',incident)},manifest));
  const controlStart=Number(manifest.approval.valid_from_epoch_ms),controls=[
    {action:'disconnect',sequence:1,started_physical_epoch_ms:String(controlStart+100),physical_epoch_ms:String(controlStart+200),gateway_authenticated:false},
    {action:'reconnect',sequence:2,started_physical_epoch_ms:String(controlStart+500),physical_epoch_ms:String(controlStart+600),gateway_authenticated:true},
  ].map(p=>({schema_version:1,kind:'G2_CONTROL_PACKET',...g2SourceBinding(manifest),scenario_id:'G2-F01',role:'GATEWAY',...p}));
  const controlRef=prefix+'/control-sources.jsonl';writeG2SourceFile(controlRef,controls.map(p=>JSON.stringify(p)+'\n').join(''));
  const recovered=structuredClone(snapshot);recovered.attempts.unshift({delivery_ref_hash:hash,attempt_no:1,outcome:'RETRY_SCHEDULED',side_effect_state:'NOT_ATTEMPTED',
    error_code:'GATEWAY_UNAVAILABLE',started_epoch_ms:String(controlStart+300)});
  const faultProof={...proof,scenario_id:'G2-F01',snapshot:save('snapshot',recovered),controls:controls.map(p=>({ref:controlRef+':'+p.sequence,sha256:g2Hash(JSON.stringify(p))}))};
  assert.equal(deriveG2DeliveryEvidence(faultProof,manifest).result,'PASS');
  recovered.attempts[0].delivery_ref_hash='f'.repeat(64);
  assert.throws(()=>deriveG2DeliveryEvidence({...faultProof,snapshot:save('snapshot',recovered)},manifest));
  for(const modify of [s=>{s.attempts=[];},s=>{s.deliveries[0].organic_without_prior_group=false;},s=>{s.counts.unknown_pending=1;},s=>{s.deliveries[0].outbox_id='10000000-0000-4000-8000-000000000099';}]){
    const invalid=structuredClone(snapshot);modify(invalid);assert.throws(()=>deriveG2DeliveryEvidence({...proof,snapshot:save('snapshot',invalid)},manifest));
  }
  const seeded=structuredClone(startup);seeded.startup_scope.tickets=1;
  assert.throws(()=>deriveG2DeliveryEvidence({...proof,startup:save('startup',seeded)},manifest));
  assert.throws(()=>deriveG2DeliveryEvidence(proof,{...manifest,mode:'synthetic'}));
});
