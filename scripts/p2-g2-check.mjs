import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import { G2_ROOT, g2CandidateInventory, verifyG2Candidate, verifyG2ApprovalFile, requirePreparedG2Candidate } from '../src/p2-g2-candidate.mjs';
import { G2_LIVE_FUSES, G2_REQUIRED_FLAGS, G2_FORBIDDEN_FLAGS, g2DatabaseIdentity, g2Hash,
  readG2Configuration, validateG2Manifest, minimalG2Environment, failG2 } from '../src/p2-g2-validation-config.mjs';
import { inspectG2DatabaseScope } from '../src/p2-g2-database-scope.mjs';

export function parseG2Arguments(argv,allowed){
  const out={};for(const arg of argv){const m=/^--([a-z-]+)=(.+)$/u.exec(arg);
    if(!m||!allowed.includes(m[1])||Object.hasOwn(out,m[1]))failG2('ARGUMENT_INVALID');out[m[1]]=m[2];}return out;
}
export function loadG2PrivateEnvironment(file='.env.pilot',environment=process.env){
  const saved=parseEnv(readFileSync(path.resolve(G2_ROOT,file),'utf8')),out=minimalG2Environment(environment);
  for(const k of ['PILOT_DATABASE_URL','WECOM_BOT_ID','WECOM_BOT_SECRET','WECOM_WS_URL',
    'PILOT_LOG_IDENTITY_HASH_KEY','P2_G2_REPORTER_HMAC_SECRET','P2_012_REPORTER_HMAC_SECRET','P2_G2_GROUP_WEBHOOK_ROUTES','P2_G2_DIRECTORY_ACCESS_TOKEN'])if(saved[k])out[k]=saved[k];
  // Live switches are intentionally supplied for this invocation; old/file-stored approvals are not inherited.
  for(const k of G2_LIVE_FUSES)if(environment[k]!==undefined)out[k]=environment[k];
  return out;
}
export const readG2ManifestFile=file=>validateG2Manifest(JSON.parse(readFileSync(path.resolve(G2_ROOT,file),'utf8')));
export async function checkG2({mode='check',manifest=null,env=null}={}){
  const result={gate:'P2-G2',mode,ok:false,database_connection_started:false,database_writes:false,listener_started:false,provider_calls:0};
  try{
    if(!['check','check-db','live-check'].includes(mode))failG2('MODE_INVALID');
    const candidate=g2CandidateInventory();
    const policy=JSON.parse(readFileSync(path.join(G2_ROOT,'config_examples/p2-g2-validation-policy.example.json'),'utf8'));
    if([...G2_REQUIRED_FLAGS,...G2_FORBIDDEN_FLAGS].some(k=>policy.default_feature_flags[k]!==false))failG2('PERSISTENT_FLAGS_NOT_OFF');
    if(manifest){manifest=validateG2Manifest(manifest);verifyG2Candidate(manifest.candidate_fingerprint);}
    if(mode==='check')return {...result,ok:true,candidate_fingerprint:candidate.fingerprint,candidate_file_count:candidate.file_count,
      persistent_flags_off:true,live_scope_checked:false};
    if(!manifest||!env)failG2('MANIFEST_REQUIRED');
    const db=g2DatabaseIdentity(env.PILOT_DATABASE_URL);
    if(db.fingerprint!==manifest.scope.database_identity_hash)failG2('DATABASE_SCOPE_MISMATCH');
    if(mode==='live-check'){
      if(manifest.mode!=='live')failG2('LIVE_MANIFEST_REQUIRED');
      readG2Configuration({manifest,env,candidateFingerprint:candidate.fingerprint});
      if((manifest.scope.group_webhook_routes??[]).length!==manifest.scope.group_hashes.length)failG2('GROUP_CLOSURE_ROUTES_REQUIRED');
      verifyG2ApprovalFile(manifest);requirePreparedG2Candidate(candidate.fingerprint);
    }
    const pool=createPostgresPool({connectionString:env.PILOT_DATABASE_URL,max:1,connectionTimeoutMillis:3000,
      application_name:'p2_g2_readonly_check'});
    let client;
    try{
      result.database_connection_started=true;client=await pool.connect();await client.query('BEGIN READ ONLY');
      const schema=await client.query("SELECT count(*)::integer AS n FROM platform.schema_migration WHERE migration_id='032_p2_012_human_confirmed_incident'");
      if(schema.rows[0].n!==1)failG2('SCHEMA_032_REQUIRED');
      const scope=await inspectG2DatabaseScope({transaction:client,manifest});await client.query('ROLLBACK');
      return {...result,ok:scope.ready,database_scope:scope,candidate_fingerprint:candidate.fingerprint,
        reporter_https_reachability:'NOT_VERIFIED',physical_environment:'NOT_VERIFIED',
        ...(scope.ready?{}:{error_code:'P2_G2_DEDICATED_EMPTY_DATABASE_REQUIRED'})};
    }finally{client?.release(true);await pool.end();}
  }catch(e){return {...result,error_code:/^P2_G2_[A-Z_]+$/u.test(e?.code??'')?e.code:'P2_G2_CHECK_FAILED'};}
}
export async function main(argv=process.argv.slice(2)){
  if(argv.includes('--help')){console.log('Usage: node scripts/p2-g2-check.mjs [--mode=check|check-db|live-check] [--manifest=path.json] [--env-file=.env.pilot]\ncheck is offline. check-db is explicit read-only SQL. live-check requires a prepared candidate and fresh owner approval, and never starts SDK/listeners.');return;}
  const a=parseG2Arguments(argv,['mode','manifest','env-file']),mode=a.mode??'check';
  const r=await checkG2({mode,manifest:a.manifest?readG2ManifestFile(a.manifest):null,
    env:mode==='check'?null:loadG2PrivateEnvironment(a['env-file'])});
  console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main().catch(e=>{
  console.log(JSON.stringify({ok:false,error_code:/^P2_G2_[A-Z_]+$/u.test(e?.code??'')?e.code:'P2_G2_ARGUMENT_OR_FILE_INVALID',
    database_writes:false,listener_started:false,provider_calls:0}));process.exitCode=1;});
