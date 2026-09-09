import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createG2SourceAudit} from '../src/p2-g2-source-audit.mjs';
import {G2_ROOT,verifyG2Candidate} from '../src/p2-g2-candidate.mjs';
import {parseG2Arguments} from './p2-g2-check.mjs';
import {g2Hash,failG2} from '../src/p2-g2-validation-config.mjs';

export function auditG2Run({runFile,outputFile}){
  if(typeof runFile!=='string'||!/^tmp\/p2-g2-tests-[a-f0-9-]+\/run\.json$/u.test(runFile)
    ||typeof outputFile!=='string'||!/^evidence\/p2-g2-[a-z0-9-]+\.json$/u.test(outputFile))failG2('SOURCE_AUDIT_PATH_INVALID');
  const runPath=path.join(G2_ROOT,runFile),run=JSON.parse(readFileSync(runPath,'utf8'));
  verifyG2Candidate(run.candidate_fingerprint);
  const audit=createG2SourceAudit({run,tap:readFileSync(path.join(path.dirname(runPath),'result.tap'),'utf8'),root:G2_ROOT});
  const bytes=JSON.stringify(audit,null,2)+'\n',target=path.join(G2_ROOT,outputFile);
  if(existsSync(target)){if(readFileSync(target,'utf8')!==bytes)failG2('SOURCE_AUDIT_OUTPUT_EXISTS');}
  else writeFileSync(target,bytes,{flag:'wx'});
  return {ok:audit.accounting_complete&&audit.manual_review_observation_missing.length===0,
    candidate_fingerprint:audit.candidate_fingerprint,source_cases:202,normal_input_cases:122,
    observed_normal_pass_cases:audit.observed_normal_pass_cases,execution_missing:audit.execution_missing,
    manual_review_observation_missing:audit.manual_review_observation_missing,semantic_review_required:true,
    original_semantics_all_passed:false,output_file:outputFile,output_sha256:g2Hash(bytes)};
}
export async function main(argv=process.argv.slice(2)){
  if(argv.includes('--help')){console.log('Usage: node scripts/p2-g2-source-audit.mjs --run=tmp/p2-g2-tests-ID/run.json --output=evidence/p2-g2-source-execution-ID.json\nRead actual passing TAP and candidate-bound runner record; retain all 202 references and original-path limitations. Never grants READY or live approval.');return;}
  const args=parseG2Arguments(argv,['run','output']),result=auditG2Run({runFile:args.run,outputFile:args.output});
  console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main().catch(e=>{
  console.log(JSON.stringify({ok:false,error_code:/^P2_G2_[A-Z_]+$/u.test(e?.code??'')?e.code:'P2_G2_SOURCE_AUDIT_FAILED'}));process.exitCode=1;
});
