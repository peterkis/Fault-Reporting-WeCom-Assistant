import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { G2_ROOT, g2CandidateInventory, requirePreparedG2Candidate } from '../src/p2-g2-candidate.mjs';
import { G2_FROZEN_MERGE, g2PredecessorScopeValid } from '../src/p2-g2-predecessor-verification.mjs';
import { G2_SCENARIO_IDS } from '../src/p2-g2-gate-evaluator.mjs';
import { G2_REQUIRED_FLAGS, G2_FORBIDDEN_FLAGS, g2Hash } from '../src/p2-g2-validation-config.mjs';

export function validateG2({requireReady=false}={}) {
  const errors=[];let checks=0;
  const check=(ok,name)=>{checks++;if(!ok)errors.push(name);};
  const read=file=>readFileSync(path.join(G2_ROOT,file),'utf8');
  const json=file=>JSON.parse(read(file));
  const git=args=>execFileSync('git',['-c','safe.directory='+G2_ROOT.replaceAll('\\','/'),...args],
    {cwd:G2_ROOT,encoding:'utf8',windowsHide:true});
  const current=json('plans/current_phase.json');
  for(const file of ['MANIFEST.json','plans/current_phase.json','plans/master_backlog.json','plans/parallel_workstreams.json','tasks/master_backlog.json','project_summary.json']){
    const value=json(file);check(g2PredecessorScopeValid(file==='project_summary.json'?value.project:value),'successor state: '+file);
  }
  check(git(['merge-base',G2_FROZEN_MERGE,'HEAD']).trim()===G2_FROZEN_MERGE,'frozen merge ancestry');
  check(!git(['diff','--name-only',G2_FROZEN_MERGE,'--','database/migrations']).trim(),'unchanged migrations 001-032');
  check(!git(['ls-files','--others','--exclude-standard','--','database/migrations']).trim(),'no new migration');
  check(!git(['diff','--name-only','--diff-filter=MDR',G2_FROZEN_MERGE,'--','evidence']).trim(),'historical evidence immutable');
  const policy=json('config_examples/p2-g2-validation-policy.example.json');
  check([...G2_REQUIRED_FLAGS,...G2_FORBIDDEN_FLAGS].every(flag=>policy.default_feature_flags[flag]===false),'persistent feature defaults off');
  const text=read('tests/fixtures/p2-g2/scenarios.v1.jsonl'),fixture=text.trim().split(/\r?\n/u).map(line=>JSON.parse(line));
  const manifest=json('tests/fixtures/p2-g2/scenarios-manifest.v1.json');
  check(manifest.sha256===g2Hash(text.replaceAll('\r\n','\n'))&&manifest.count===fixture.length,'scenario fixture integrity');
  check(fixture.length===G2_SCENARIO_IDS.length&&new Set(fixture.map(v=>v.scenario_id)).size===G2_SCENARIO_IDS.length
    &&fixture.every(v=>G2_SCENARIO_IDS.includes(v.scenario_id)&&v.required_proof&&v.live_status==='NOT_RUN'),'all 37 scenario obligations');
  for(const name of ['validation_manifest','evidence_record','gate_result']){
    const schema=json('contracts/p2_g2_'+name+'.schema.json');check(schema.type==='object'&&schema.additionalProperties===false,'closed schema: '+name);
  }
  const inventory=g2CandidateInventory();
  const readyRequired=requireReady||current.p2_g2_status==='READY_FOR_LIVE_E2E';
  if(readyRequired){try{requirePreparedG2Candidate(inventory.fingerprint);check(true,'current candidate readiness');}
    catch(e){check(false,'current candidate readiness: '+(e.code??'INVALID'));}}
  return {ok:errors.length===0,gate:'P2-G2',checks,errors,candidate_fingerprint:inventory.fingerprint,
    readiness_checked:readyRequired,live_validation:'NOT_RUN',database_writes:false,provider_calls:0};
}
export function main(argv=process.argv.slice(2)){
  if(argv.includes('--help')){console.log('Usage: node scripts/validate-p2-g2-service-loop.mjs [--require-ready]\nOffline governance, frozen history, scenario integrity and candidate checks. READY state always requires current full regression and two independent reviews.');return;}
  if(argv.length>1||argv.some(a=>a!=='--require-ready'))throw Error('ARGUMENT_INVALID');
  const result=validateG2({requireReady:argv.includes('--require-ready')});console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{main();}catch{console.log(JSON.stringify({ok:false,error_code:'P2_G2_VALIDATION_FAILED'}));process.exitCode=1;}}
