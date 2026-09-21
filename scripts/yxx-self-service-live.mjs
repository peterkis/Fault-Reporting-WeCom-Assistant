import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {g2CandidateInventory,G2_ROOT} from '../src/p2-g2-candidate.mjs';
import {checkSS010,SS010_TEMPLATE} from '../src/yxx-self-service-readiness.mjs';
import {validateLimitedManifest,readLimitedConfiguration,parseLimitedArguments,verifyLimitedApproval,reject} from '../src/yxx-limited-write-contract.mjs';

export async function main(argv=process.argv.slice(2)){
  const args=parseLimitedArguments(argv);
  if(args.mode==='help'){console.log('Usage: node scripts/yxx-self-service-live.mjs [--check|--run] [--manifest=path] [--env-file=path] [--state-dir=absolute-path] [--resume]\nDefault offline check uses an unapproved template. Run requires current readiness and separate SS011 owner approval. No deployment or migration is performed.');return;}
  if(!['check','run'].includes(args.mode))reject('ARGUMENT_INVALID');
  const manifest=JSON.parse(readFileSync(args.manifest??new URL('../'+SS010_TEMPLATE,import.meta.url),'utf8'));
  const template=manifest.kind==='TEMPLATE_NOT_AUTHORIZATION';
  validateLimitedManifest(manifest,{template,checkWindow:args.mode==='run'});
  if(args.mode==='check'){
    if(args['env-file']){if(template)reject('AUTHORIZATION_REQUIRED');readLimitedConfiguration(args['env-file'],manifest);}
    const result={ok:true,status:template?'TEMPLATE_VALID_NOT_AUTHORIZED':'OFFLINE_CONFIG_VALID_NOT_AUTHORIZED',live_authorized:false,database_connections:0,provider_calls:0,listener_started:false,processes_started:0};console.log(JSON.stringify(result));return result;
  }
  if(template||!args['env-file']||!args['state-dir'])reject('AUTHORIZATION_REQUIRED');
  const gitEnv={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_'))),GIT_NO_REPLACE_OBJECTS:'1'};
  const git=values=>execFileSync('git',values,{cwd:G2_ROOT,env:gitEnv,encoding:'utf8',windowsHide:true}).trim();
  if(git(['status','--porcelain'])||git(['rev-parse','HEAD'])!==manifest.candidate_commit||git(['rev-parse','HEAD^{tree}'])!==manifest.candidate_tree
    ||g2CandidateInventory().fingerprint!==manifest.candidate_fingerprint)reject('CANDIDATE_CHANGED');
  checkSS010({requireReady:true});
  verifyLimitedApproval(manifest,readFileSync(manifest.approval_record_ref,'utf8'));
  const configuration=readLimitedConfiguration(args['env-file'],manifest);
  const {startLimitedRuntime}=await import('../src/yxx-limited-write-runner.mjs');
  const runtime=await startLimitedRuntime({manifest,configuration,stateDirectory:args['state-dir'],resume:args.resume});
  console.log(JSON.stringify({ok:true,event:'SS011_LIMITED_RUNTIME_STARTED',run_id:manifest.run_id,live_result:'NOT_RUN'}));
  process.once('SIGINT',()=>void runtime.stop());process.once('SIGTERM',()=>void runtime.stop());
  return runtime;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.log(JSON.stringify({ok:false,error_code:/^SS010_[A-Z_]+$/u.test(error.code??'')?error.code:'SS010_LAUNCH_FAILED',live_authorized:false}));process.exitCode=1;});
