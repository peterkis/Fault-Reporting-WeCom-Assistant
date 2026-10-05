import type {G2Manifest} from './p2-g2-validation-config.mjs';
import type {G2EvidenceSource,G2EvidenceRecord} from './p2-g2-evidence.mjs';
import type {G2SourceReadOptions} from './p2-g2-evidence-files.mjs';
import { isDeepStrictEqual } from 'node:util';
import { g2Hash, failG2 } from './p2-g2-validation-config.mjs';
import { validateG2EvidenceRecord } from './p2-g2-evidence.mjs';
import { formatEpochMsToShanghaiLocal } from './platform/time-contract.mjs';
import { readG2SourceFile, g2SourceMatches } from './p2-g2-evidence-files.mjs';

// Only consume a person's supplied assertion. No command generates an approved
// assertion, invents an observation, or changes task/Gate governance state.
export function readG2ManualAssertion(source: G2EvidenceSource,manifest: G2Manifest,options?: Omit<G2SourceReadOptions,'root'> & {root?:string|undefined}){
  const raw=readG2SourceFile(source.ref,{...options,sha256:source.sha256 as string,maxBytes:65536} as G2SourceReadOptions);
  let a: Record<string,unknown>;try{a=JSON.parse(raw.toString('utf8')) as Record<string,unknown>;}catch{failG2('MANUAL_ASSERTION_INVALID');}
  const keys=['schema_version','kind','run_id','candidate_fingerprint','run_mode','manifest_binding','scenario_id','evidence_type','authority',
    'physical_epoch_ms','result','details','fragments'];
  if(!a||Object.keys(a).length!==keys.length||keys.some(k=>!Object.hasOwn(a,k))||a.schema_version!==1||a.kind!=='G2_MANUAL_ASSERTION'
    ||!g2SourceMatches(a,manifest)||manifest.mode!=='live'
    ||!['CLIENT_OBSERVATION','PROJECT_OWNER_APPROVAL'].includes(a.evidence_type as string)
    ||!Array.isArray(a.fragments)||a.fragments.length>10)failG2('MANUAL_ASSERTION_INVALID');
  const owner=a.evidence_type==='PROJECT_OWNER_APPROVAL';
  if(source.kind!==(owner?'OWNER_FILE':'CLIENT_FILE')||a.authority!==(owner?'PROJECT_OWNER':'CLIENT_OBSERVER')
    ||owner&&a.scenario_id!=='G2-OWNER'||!owner&&a.fragments.length===0)failG2('MANUAL_ASSERTION_INVALID');
  for(const value of a.fragments as unknown[]){
    const f=value as Record<string,unknown>;
    if(!f||Object.keys(f).length!==2||!/^[a-f0-9]{64}$/u.test((f.sha256??'') as string)||! /\.(?:png|jpg|jpeg|txt|json)$/u.test((f.ref??'') as string))failG2('MANUAL_FRAGMENT_INVALID');
    readG2SourceFile(f.ref,{...options,sha256:f.sha256 as string,maxBytes:16*1024*1024} as G2SourceReadOptions);
  }
  return a;
}
export function compileG2ManualAssertion({source,manifest,root}: {source:G2EvidenceSource;manifest:G2Manifest;root?:string|undefined}){
  const a=readG2ManualAssertion(source,manifest,{root});
  const body={schema_version:1,gate:'P2-G2',run_id:manifest.run_id,run_mode:manifest.mode,candidate_fingerprint:manifest.candidate_fingerprint,
    scenario_id:a.scenario_id,evidence_type:a.evidence_type,producer:'MANUAL_ATTESTATION',occurred_at:formatEpochMsToShanghaiLocal(a.physical_epoch_ms),
    physical_epoch_ms:a.physical_epoch_ms,sequence:1,result:a.result,source_refs:[source],details:a.details,previous_hash:'0'.repeat(64)};
  return validateG2EvidenceRecord({...body,record_hash:g2Hash(JSON.stringify(body))});
}
export function verifyG2ManualSource(source: G2EvidenceSource,record: G2EvidenceRecord,manifest: G2Manifest,{root}: {root?:string|undefined}={}){
  if(!['OWNER_FILE','CLIENT_FILE'].includes(source.kind)||record.producer!=='MANUAL_ATTESTATION')return false;
  const expected=compileG2ManualAssertion({source,manifest,root});
  return isDeepStrictEqual(record,expected);
}
