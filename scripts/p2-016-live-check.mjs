import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import { readP2016LiveConfiguration,P2016_LIVE_FUSES } from '../src/p2-016-live-configuration.mjs';
import { migrateP2016 } from './p2-016-migrate.mjs';
import { validateP2016 } from './validate-p2-016-ticket-lifecycle-workbench.mjs';

export function assertP2016ReadyCandidate({state,report,hash}){
  if(state!=='READY_FOR_TARGETED_LIVE_VALIDATION'||report?.status!==state||report?.runtime_input_sha256!==hash
    ||report.all_automated_checks_passed!==true||!Number.isSafeInteger(report.regression?.pass)||report.regression.pass<462
    ||['fail','skipped','cancelled','todo'].some(k=>report.regression?.[k]!==0)
    ||report.live_validation!=='NOT_RUN'||report.second_commit_created!==false)throw new Error('P2_016_VERIFIED_READY_CANDIDATE_REQUIRED');
}
// No raw identities leave PostgreSQL: this guard also prevents a broad Worker from consuming another test's retained work.
export async function assertP2016DatabaseScope(pool,c){
  const result=await pool.query(`SELECT
    (SELECT count(*)::integer FROM intake.service_intake WHERE NOT (source_provider='WECOM_AIBOT' AND source_bot_id=$1
      AND encode(sha256(convert_to(reporter_wecom_userid,'UTF8')),'hex')=ANY($2::text[])
      AND (source_chat_type='single' OR encode(sha256(convert_to(source_chat_id,'UTF8')),'hex')=ANY($3::text[])))) AS foreign_intakes,
    (SELECT count(*)::integer FROM communication.delivery WHERE NOT (provider='WECOM_AIBOT' AND channel_account_id=$1
      AND ((target_type='PERSON' AND target_hash=ANY($2::text[])) OR (target_type='GROUP' AND target_hash=ANY($3::text[]))))) AS foreign_deliveries,
    (SELECT count(*)::integer FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
      AND application_name IN ('p2_g1_app','p2_g1_worker','p2_g1_gateway')) AS competing_roles`,
  [c.botId,c.inboundScope.person_hashes,c.inboundScope.group_hashes]);
  if(Object.values(result.rows[0]).some(v=>v!==0))throw new Error('P2_016_DEDICATED_APPROVED_DATABASE_REQUIRED');
  return result.rows[0];
}
export async function checkP2016Live(env=process.env){
  const approvals=Object.fromEntries(P2016_LIVE_FUSES.map(k=>[k,env[k]==='true']));
  const result={task:'P2-016',check_only:true,ok:false,approvals,network_started:false,listener_started:false,provider_calls:0};
  try{
    const c=readP2016LiveConfiguration(env);
    const validation=await validateP2016();if(!validation.ok||validation.readiness_evidence_checked!==true)throw new Error('P2_016_ARCHITECTURE_GATE_FAILED');
    const report=JSON.parse(await readFile(new URL('../evidence/p2-016-automated-readiness-report.json',import.meta.url),'utf8'));
    assertP2016ReadyCandidate({state:validation.state,report,hash:validation.runtime_input_sha256});
    const migration=await migrateP2016({databaseUrl:c.databaseUrl,mode:'status'});
    if(migration.status!=='NOOP_ALREADY_APPLIED')throw new Error('P2_016_COMMITTED_031_REQUIRED');
    const pool=createPostgresPool({connectionString:c.databaseUrl,max:1,connectionTimeoutMillis:3000,application_name:'p2_016_live_check'});
    try{await assertP2016DatabaseScope(pool,c);}finally{await pool.end();}
    return {...result,ok:true,runtime_input_sha256:validation.runtime_input_sha256,principal_count:c.principalIds.length,
      approved_person_count:c.inboundScope.person_hashes.length,approved_group_count:c.inboundScope.group_hashes.length,
      database_scope_verified:true,https_configuration_valid:true,client_https_reachability:'NOT_VERIFIED',client_fragment:'NOT_VERIFIED'};
  }catch(error){return {...result,error_code:/^P2_016_[A-Z0-9_]+$/u.test(error?.message??'')?error.message:'P2_016_LIVE_PREFLIGHT_FAILED'};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=process.argv.length===2?await checkP2016Live():{ok:false,error_code:'P2_016_LIVE_CHECK_ARGS_INVALID'};
  console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
