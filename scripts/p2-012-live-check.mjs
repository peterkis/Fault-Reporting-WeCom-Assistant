import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import { readP2012LiveConfiguration,P2012_LIVE_FUSES } from '../src/p2-012-live-configuration.mjs';
import { migrateP2012 } from './p2-012-migrate.mjs';
import { validateP2012 } from './validate-p2-012-human-confirmed-incident.mjs';
import { assertP2012ApprovedDatabaseScope } from '../src/p2-012-live-reporter-scope.mjs';
import { G2_ROOT } from '../src/p2-g2-candidate.mjs';
export async function checkP2012Live(env=process.env){
  const result={task:'P2-012',check_only:true,ok:false,approvals:Object.fromEntries(P2012_LIVE_FUSES.map(k=>[k,env[k]==='true'])),network_started:false,listener_started:false,provider_calls:0};
  try{
    const c=readP2012LiveConfiguration(env),v=await validateP2012();
    if(!v.ok||v.state!=='READY_FOR_TARGETED_LIVE_VALIDATION'||!v.readiness_evidence_checked)throw new Error('P2_012_VERIFIED_READY_CANDIDATE_REQUIRED');
    const report=JSON.parse(await readFile(path.join(G2_ROOT,'evidence/p2-012-automated-readiness-report.json')));
    if(report.runtime_input_sha256!==v.runtime_input_sha256)throw new Error('P2_012_CANDIDATE_CHANGED');
    if((await migrateP2012({databaseUrl:c.databaseUrl,mode:'status'})).status!=='NOOP_ALREADY_APPLIED')throw new Error('P2_012_COMMITTED_032_REQUIRED');
    const pool=createPostgresPool({connectionString:c.databaseUrl,max:1,connectionTimeoutMillis:3000,application_name:'p2_012_live_check'});
    try{await assertP2012ApprovedDatabaseScope(pool,c);}finally{await pool.end();}
    return {...result,ok:true,runtime_input_sha256:v.runtime_input_sha256,principal_count:c.principalIds.length,configured_person_count:c.inboundScope.person_hashes.length,approved_group_count:c.inboundScope.group_hashes.length,reporter_scope_mode:c.reporterScopeMode,dynamic_reporter_discovery:true,database_scope_verified:true,client_https_reachability:'NOT_VERIFIED',client_fragment:'NOT_VERIFIED'};
  }catch(e){const allowed=['P2_012_LIVE_APPROVAL_REQUIRED','P2_012_LIVE_CONFIGURATION_INVALID','P2_012_VERIFIED_READY_CANDIDATE_REQUIRED','P2_012_CANDIDATE_CHANGED','P2_012_COMMITTED_032_REQUIRED'];return {...result,error_code:allowed.includes(e.message)?e.message:'P2_012_LIVE_PREFLIGHT_FAILED'};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const r=process.argv.length===2?await checkP2012Live():{ok:false,error_code:'P2_012_LIVE_CHECK_ARGS_INVALID'};console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1;}
