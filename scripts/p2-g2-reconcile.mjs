import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import { collectG2Reconciliation } from '../src/p2-g2-reconciliation.mjs';
import { readG2SourceJson, writeG2SourceFile, g2SourceMatches } from '../src/p2-g2-evidence-files.mjs';
import { verifyG2Candidate, verifyG2ApprovalFile } from '../src/p2-g2-candidate.mjs';
import { g2DatabaseIdentity, failG2 } from '../src/p2-g2-validation-config.mjs';
import { g2StartupFacts } from '../src/p2-g2-live-evidence.mjs';
import { parseG2Arguments, readG2ManifestFile, loadG2PrivateEnvironment } from './p2-g2-check.mjs';

export async function main(argv=process.argv.slice(2)){
  if(argv.includes('--help')||!argv.length){console.log('Usage: node scripts/p2-g2-reconcile.mjs --mode=reconcile --manifest=path.json --run-directory=tmp/p2-g2-run [--env-file=.env.pilot] --output=reconciliation-source.json\nAfter controller shutdown, collect a read-only repeatable-read DB ledger into a new private file. No retry, status mutation, migrations, approval or fabricated Provider ACK.');if(!argv.length)process.exitCode=2;return;}
  const a=parseG2Arguments(argv,['mode','manifest','run-directory','env-file','output']);
  if(a.mode!=='reconcile'||!a.manifest||!/^tmp\/p2-g2-[A-Za-z0-9-]+$/u.test(a['run-directory']??'')
    ||!/^reconciliation-source(?:-[a-z0-9-]+)?\.json$/u.test(a.output??''))failG2('ARGUMENT_INVALID');
  const manifest=readG2ManifestFile(a.manifest);verifyG2Candidate(manifest.candidate_fingerprint);
  if(manifest.mode==='live')verifyG2ApprovalFile(manifest);
  const state=readG2SourceJson(a['run-directory']+'/state.json'),startup=readG2SourceJson(a['run-directory']+'/startup-source.json');
  for(const packet of [state,startup])if(!g2SourceMatches(packet,manifest))failG2('RUN_BINDING_INVALID');
  if(state.status!=='STOPPED_AWAITING_RECONCILIATION'||state.process_count!==0||g2StartupFacts(startup,manifest).start.result!=='PASS')failG2('STOPPED_RUN_REQUIRED');
  const env=loadG2PrivateEnvironment(a['env-file']);
  if(g2DatabaseIdentity(env.PILOT_DATABASE_URL).fingerprint!==manifest.scope.database_identity_hash)failG2('DATABASE_SCOPE_MISMATCH');
  const pool=createPostgresPool({connectionString:env.PILOT_DATABASE_URL,max:1,connectionTimeoutMillis:3000,application_name:'p2_g2_reconciliation'});
  let tx,snapshot;
  try{tx=await pool.connect();await tx.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    snapshot=await collectG2Reconciliation({transaction:tx,manifest});await tx.query('ROLLBACK');}
  finally{tx?.release(true);await pool.end();}
  const output=a['run-directory']+'/'+a.output;
  writeG2SourceFile(output,JSON.stringify(snapshot,null,2)+'\n');
  console.log(JSON.stringify({ok:true,mode:'reconcile',run_id:manifest.run_id,output,counts:snapshot.counts,
    delivery_count:snapshot.deliveries.length,attempt_count:snapshot.attempts.length,database_writes:false,provider_calls:0,gate_passed:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main().catch(e=>{
  console.log(JSON.stringify({ok:false,error_code:/^P2_G2_[A-Z_]+$/u.test(e?.code??'')?e.code:'P2_G2_RECONCILIATION_FAILED',database_writes:false,provider_calls:0}));process.exitCode=1;
});
