import type {G2Manifest} from './p2-g2-validation-config.mjs';
import type {G2EvidenceSource,G2EvidenceRecord} from './p2-g2-evidence.mjs';
import type {ReconciliationCounts} from './p2-g2-reconciliation.mjs';
type SourceInput = {ref:unknown;sha256:unknown};
type FinalizationInput = {schema_version?:unknown;kind?:unknown;run_id?:unknown;candidate_fingerprint?:unknown;snapshot:SourceInput;stop:SourceInput;startup:SourceInput;resources:SourceInput;browser_cleanup?:SourceInput};
type FinalPacketInput = Record<string,unknown> & {counts:ReconciliationCounts};
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { G2_ROOT } from './p2-g2-candidate.mjs';
import { failG2 } from './p2-g2-validation-config.mjs';
import { G2_RECONCILIATION_QUERY_HASH } from './p2-g2-reconciliation.mjs';
import { readG2SourceFile, readG2SourceJson, g2SourceMatches } from './p2-g2-evidence-files.mjs';
import { g2StartupFacts, verifyG2LiveSource } from './p2-g2-live-evidence.mjs';
import { readG2Evidence } from './p2-g2-evidence.mjs';

export function deriveG2Finalization(input: unknown,manifest: G2Manifest,{root=G2_ROOT}={}){
  const proof=input as FinalizationInput;
  if(proof?.schema_version!==1||proof.kind!=='G2_FINALIZATION_PROOF'||manifest.mode!=='live'
    ||proof.run_id!==manifest.run_id||proof.candidate_fingerprint!==manifest.candidate_fingerprint)failG2('FINALIZATION_PROOF_INVALID');
  const read=(ref: SourceInput)=>readG2SourceJson(ref.ref,{root,sha256:ref.sha256 as string}) as FinalPacketInput;
  const snapshot=read(proof.snapshot),stop=read(proof.stop),startup=read(proof.startup);
  for(const p of [snapshot,stop,startup])if(!g2SourceMatches(p,manifest))failG2('RUN_BINDING_INVALID');
  if(snapshot.kind!=='G2_RECONCILIATION_PACKET'||snapshot.query_sha256!==G2_RECONCILIATION_QUERY_HASH
    ||snapshot.database_identity_hash!==manifest.scope.database_identity_hash||stop.kind!=='G2_STOP_PACKET'
    ||stop.stopped!==true||stop.process_count!==0||g2StartupFacts(startup,manifest).start.result!=='PASS'
    ||BigInt(snapshot.physical_epoch_ms as string)<BigInt(stop.physical_epoch_ms as string))failG2('FINALIZATION_ORDER_INVALID');
  readG2SourceFile(proof.resources.ref,{root,sha256:proof.resources.sha256 as string});
  const samples=readG2Evidence(path.join(root,proof.resources.ref as string));
  if(!samples.length||samples.some(r=>r.scenario_id!=='G2-O01'||r.source_refs.some(s=>!verifyG2LiveSource(s,r,manifest,{root}))))failG2('SOURCE_NOT_VERIFIED');
  if(BigInt((samples.at(-1) as G2EvidenceRecord).physical_epoch_ms)>BigInt(stop.physical_epoch_ms as string))failG2('FINALIZATION_ORDER_INVALID');
  const counts=snapshot.counts,tail=samples.slice(-5),queues=['projection_backlog','communication_pending','safe_actions_pending','manual_review_pending'] as const;
  const drained=tail.length===5&&tail.every(r=>r.result==='PASS'&&r.details.phase==='STEADY'&&queues.every(k=>(r.details.metrics as NonNullable<G2EvidenceRecord['details']['metrics']>)[k]===0))
    &&counts.communication_pending===0&&counts.safe_actions_pending===0;
  const safety=counts.unknown_pending===0&&counts.dead_letters===0&&counts.internal_note_leaks===0
    &&counts.automatic_incident_count===0&&counts.out_of_scope_deliveries===0;
  const end={scenario_id:'G2-END',evidence_type:'POSTGRES_HTTP_INTEGRATION',physical_epoch_ms:snapshot.physical_epoch_ms,
    result:drained&&safety?'PASS':'INCOMPLETE',details:{executed:true,unknown_pending:counts.unknown_pending,unexpected_dead_letters:counts.dead_letters,
      model_provider_calls:0,internal_note_leaks:counts.internal_note_leaks,automatic_incident_creation:(counts.automatic_incident_count as number)>0,
      assertions:[{code:'BOUNDED_QUEUES_NO_SUSTAINED_BACKLOG',passed:drained},{code:'NO_OUT_OF_SCOPE_DELIVERIES',passed:counts.out_of_scope_deliveries===0}]}};
  let browserRemoved=false,stamp=snapshot.physical_epoch_ms;
  if(proof.browser_cleanup){
    const b=read(proof.browser_cleanup);
    if(b.kind!=='G2_BROWSER_CLEANUP_ASSERTION'||b.authority!=='CLIENT_OBSERVER'||!g2SourceMatches(b,manifest)||!/^\d{13}$/u.test((b.physical_epoch_ms??'') as string)
      ||BigInt(b.physical_epoch_ms as string)<BigInt(snapshot.physical_epoch_ms as string)||!Number.isSafeInteger(b.owned_profile_count)||(b.owned_profile_count as number)<0
      ||!Number.isSafeInteger(b.remaining_owned_profiles)||(b.remaining_owned_profiles as number)<0)failG2('BROWSER_CLEANUP_ASSERTION_INVALID');
    browserRemoved=b.browser_profiles_removed===true&&b.remaining_owned_profiles===0;stamp=b.physical_epoch_ms;
  }
  const cleanup={scenario_id:'G2-CLEANUP',evidence_type:'POSTGRES_HTTP_INTEGRATION',physical_epoch_ms:stamp,
    result:counts.remaining_role_connections===0&&browserRemoved?'PASS':'INCOMPLETE',
    details:{executed:true,handles_remaining:0,pool_connections_remaining:counts.remaining_role_connections,browser_profiles_removed:browserRemoved}};
  return [end,cleanup];
}
export function verifyG2FinalizationSource(source: G2EvidenceSource,record: G2EvidenceRecord,manifest: G2Manifest,{root=G2_ROOT}={}){
  if(source.kind!=='DB_QUERY'||! /\/finalization-proof-[a-z0-9-]+\.json$/u.test(source.ref))return false;
  const proof=readG2SourceJson(source.ref,{root,sha256:source.sha256 as string}),expected=deriveG2Finalization(proof,manifest,{root}).find(e=>e.scenario_id===record.scenario_id);
  return Boolean(expected&&record.producer==='AUTOMATED'&&record.evidence_type===expected.evidence_type
    &&record.physical_epoch_ms===expected.physical_epoch_ms&&record.result===expected.result&&isDeepStrictEqual(record.details,expected.details));
}
