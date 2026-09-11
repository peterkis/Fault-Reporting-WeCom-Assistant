import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateG2Gate } from '../src/p2-g2-gate-evaluator.mjs';
import { readG2Evidence, buildG2AutomatedEvidence } from '../src/p2-g2-evidence.mjs';
import { readG2SourceFile, readG2SourceJson, writeG2SourceFile } from '../src/p2-g2-evidence-files.mjs';
import { verifyG2LiveSource } from '../src/p2-g2-live-evidence.mjs';
import { compileG2ManualAssertion, verifyG2ManualSource } from '../src/p2-g2-manual-evidence.mjs';
import { deriveG2DeliveryEvidence, verifyG2DeliverySource } from '../src/p2-g2-delivery-evidence.mjs';
import { deriveG2Finalization, verifyG2FinalizationSource } from '../src/p2-g2-finalization-evidence.mjs';
import { deriveG2TestEvidence, verifyG2TestSource } from '../src/p2-g2-test-evidence.mjs';
import { G2_ROOT, verifyG2Candidate, verifyG2ApprovalFile } from '../src/p2-g2-candidate.mjs';
import { g2Hash, failG2 } from '../src/p2-g2-validation-config.mjs';
import { parseG2Arguments, readG2ManifestFile } from './p2-g2-check.mjs';

export async function main(argv=process.argv.slice(2)){
  if(argv.includes('--help')||!argv.length){console.log('Usage: node scripts/p2-g2-evaluate.mjs --mode=evaluate --manifest=path.json --streams=relative.jsonl,relative.jsonl [--output=evidence/p2-g2-gate-result-run.json]\n       node scripts/p2-g2-evaluate.mjs --mode=attest --manifest=path.json --source=relative.json --authority=client|owner --output=tmp/p2-g2-run/manual-evidence.jsonl\nReceipt compiler: --mode=receipts --manifest=path.json --source=tmp/p2-g2-run/delivery-proof-scenario.json --output=tmp/p2-g2-run/receipt-evidence.jsonl\nFinalization compiler: --mode=finalize --manifest=path.json --source=tmp/p2-g2-run/finalization-proof-run.json --output=tmp/p2-g2-run/finalization-evidence.jsonl\nAutomation compiler: --mode=automation --manifest=path.json --source=tmp/p2-g2-run/test-proof-startup.json --output=tmp/p2-g2-run/automation-evidence.jsonl\nOffline source verification and pure Gate evaluation. attest only consumes an independently supplied G2_MANUAL_ASSERTION with preserved fragment hashes; it never generates an affirmative assertion. No DB, SDK, task-state update or permission grant. Outputs are write-once.');if(!argv.length)process.exitCode=2;return;}
  const a=parseG2Arguments(argv,['mode','manifest','streams','output','source','authority']);
  if(!['evaluate','attest','receipts','finalize','automation'].includes(a.mode)||!a.manifest)failG2('ARGUMENT_INVALID');
  const manifest=readG2ManifestFile(a.manifest);verifyG2Candidate(manifest.candidate_fingerprint);
  if(manifest.mode==='live')verifyG2ApprovalFile(manifest);
  if(a.output&&! /^(?:evidence\/p2-g2-[a-z0-9-]+\.json|tmp\/p2-g2-[A-Za-z0-9-]+\/[a-z0-9-]+\.jsonl)$/u.test(a.output))failG2('OUTPUT_PATH_INVALID');
  if(['receipts','finalize','automation'].includes(a.mode)){
    if(!a.source||!a.output?.endsWith('.jsonl')||a.authority||a.streams)failG2('ARGUMENT_INVALID');
    const source={kind:a.mode==='automation'?'TEST_OUTPUT':'DB_QUERY',ref:a.source,sha256:g2Hash(readG2SourceFile(a.source))};
    const proof=readG2SourceJson(a.source),expected=a.mode==='receipts'?[deriveG2DeliveryEvidence(proof,manifest)]
      :a.mode==='automation'?deriveG2TestEvidence(proof,manifest):deriveG2Finalization(proof,manifest);
    const records=buildG2AutomatedEvidence({manifest:a.mode==='automation'?{...manifest,mode:'synthetic'}:manifest,entries:expected.map(e=>({...e,source_refs:[source]}))});
    writeG2SourceFile(a.output,records.map(r=>JSON.stringify(r)+'\n').join(''));
    console.log(JSON.stringify({ok:true,mode:a.mode,output:a.output,results:records.map(r=>({scenario_id:r.scenario_id,result:r.result})),client_observation_created:false,task_state_changed:false}));return;
  }
  if(a.mode==='attest'){
    if(!a.source||!a.output?.endsWith('.jsonl')||!['client','owner'].includes(a.authority)||a.streams)failG2('ARGUMENT_INVALID');
    const source={kind:a.authority==='client'?'CLIENT_FILE':'OWNER_FILE',ref:a.source,sha256:g2Hash(readG2SourceFile(a.source))};
    const record=compileG2ManualAssertion({source,manifest});
    writeG2SourceFile(a.output,JSON.stringify(record)+'\n');
    console.log(JSON.stringify({ok:true,mode:'attest',output:a.output,assertion_result:record.result,source_sha256:source.sha256,task_state_changed:false}));return;
  }
  if(!a.streams||a.source||a.authority)failG2('ARGUMENT_INVALID');
  const files=a.streams.split(',');if(files.length>64||new Set(files).size!==files.length)failG2('EVIDENCE_STREAMS_INVALID');
  const streams=files.map(file=>{readG2SourceFile(file);return readG2Evidence(path.join(G2_ROOT,file));});
  const result=evaluateG2Gate({manifest,candidateFingerprint:manifest.candidate_fingerprint,streams,
    verifySource:(s,r,m)=>verifyG2LiveSource(s,r,m)||verifyG2ManualSource(s,r,m)||verifyG2DeliverySource(s,r,m)||verifyG2FinalizationSource(s,r,m)||verifyG2TestSource(s,r,m)});
  if(a.output)writeG2SourceFile(a.output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({...result,database_writes:false,provider_calls:0,task_state_changed:false}));
  if(result.status!=='PASSED')process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main().catch(e=>{
  console.log(JSON.stringify({ok:false,error_code:/^P2_G2_[A-Z_]+$/u.test(e?.code??'')?e.code:'P2_G2_EVALUATION_FAILED',database_writes:false,provider_calls:0,task_state_changed:false}));process.exitCode=1;
});
