import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readG2Evidence } from '../src/p2-g2-evidence.mjs';
import { readG2SourceFile, readG2SourceJson, g2SourceMatches } from '../src/p2-g2-evidence-files.mjs';
import { verifyG2LiveSource } from '../src/p2-g2-live-evidence.mjs';
import { G2_ROOT, verifyG2Candidate, verifyG2ApprovalFile } from '../src/p2-g2-candidate.mjs';
import { failG2 } from '../src/p2-g2-validation-config.mjs';
import { parseG2Arguments, readG2ManifestFile } from './p2-g2-check.mjs';

export function inspectG2Observation({manifest,directory}){
  if(!/^tmp\/p2-g2-[A-Za-z0-9-]+$/u.test(directory))failG2('PRIVATE_RUN_DIRECTORY_REQUIRED');
  verifyG2Candidate(manifest.candidate_fingerprint);
  if(manifest.mode==='live')verifyG2ApprovalFile(manifest);
  const state=readG2SourceJson(directory+'/state.json');
  if(!g2SourceMatches(state,manifest))failG2('RUN_BINDING_INVALID');
  const ref=directory+'/resource-evidence.jsonl';readG2SourceFile(ref);
  const records=readG2Evidence(path.join(G2_ROOT,ref));
  if(records.some(r=>r.source_refs.some(s=>!verifyG2LiveSource(s,r,manifest))))failG2('SOURCE_NOT_VERIFIED');
  const last=records.at(-1);
  return {ok:true,mode:'observe',run_mode:manifest.mode,run_id:manifest.run_id,candidate_fingerprint:manifest.candidate_fingerprint,
    status:state.status,samples:records.length,incomplete_samples:records.filter(r=>r.result!=='PASS').length,
    last_sample_epoch_ms:last?.physical_epoch_ms??null,metrics:last?.details.metrics??null,
    database_connection_started:false,database_writes:false,listener_started:false,provider_calls:0,gate_passed:false};
}
export async function main(argv=process.argv.slice(2)){
  if(argv.includes('--help')||!argv.length){console.log('Usage: node scripts/p2-g2-resource-observation.mjs --mode=observe --manifest=path.json --run-directory=tmp/p2-g2-run\nRead one snapshot of the controller-owned, source-verified observation stream. No new sampler, DB connection, listener, send or Gate approval. Repeat explicitly while the approved run is active.');if(!argv.length)process.exitCode=2;return;}
  const a=parseG2Arguments(argv,['mode','manifest','run-directory']);
  if(a.mode!=='observe'||!a.manifest)failG2('ARGUMENT_INVALID');
  console.log(JSON.stringify(inspectG2Observation({manifest:readG2ManifestFile(a.manifest),directory:a['run-directory']})));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main().catch(e=>{
  console.log(JSON.stringify({ok:false,error_code:/^P2_G2_[A-Z_]+$/u.test(e?.code??'')?e.code:'P2_G2_OBSERVATION_READ_FAILED',database_writes:false,listener_started:false,provider_calls:0}));process.exitCode=1;
});
