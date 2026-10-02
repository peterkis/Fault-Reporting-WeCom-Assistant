import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const entryRoot=fileURLToPath(new URL('../',import.meta.url));
const stagedEntry=path.basename(path.resolve(entryRoot))==='runtime'
  &&path.basename(path.dirname(path.resolve(entryRoot)))==='.build';
const sourceRoot=stagedEntry?path.resolve(entryRoot,'../..'):entryRoot;

export async function main(argv=process.argv.slice(2)){
  if(argv.length===1&&argv[0]==='--help'){
    console.log('Usage: node scripts/yxx-self-service-readiness.mjs [--require-ready]\nOffline current technical preparation. Historical SS009 uses its fixed checkout. READY never authorizes live work.');return;
  }
  if(argv.length>1||argv.some(arg=>arg!=='--require-ready'))throw Object.assign(new Error('SS010_ARGUMENT_INVALID'),{code:'SS010_ARGUMENT_INVALID'});
  try{
    const {verifyArtifact}=await import(pathToFileURL(path.join(sourceRoot,'.build/tools/verify-artifact.mjs')).href);
    verifyArtifact(sourceRoot);
    if(!stagedEntry){
      const {installSourceHost}=await import(pathToFileURL(path.join(sourceRoot,'.build/tools/source-host.mjs')).href);
      installSourceHost(sourceRoot);
    }
  }catch{throw Object.assign(new Error('CURRENT_BUILD_INVALID'),{code:'CURRENT_BUILD_INVALID'});}
  const {checkSS010}=await import('../src/yxx-self-service-readiness.mjs');
  const result=checkSS010({root:sourceRoot,requireReady:argv.includes('--require-ready')});
  console.log(JSON.stringify(result));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)try{await main();}catch(error){
  const known={SS010_ARGUMENT_INVALID:['ARGUMENTS','ARGUMENT_INVALID'],CURRENT_BUILD_INVALID:['BUILD','CURRENT_BUILD_INVALID'],
    CURRENT_SCOPE_INVALID:['SCOPE','CURRENT_SCOPE_INVALID'],CURRENT_EVIDENCE_HISTORY_INVALID:['HISTORY','CURRENT_EVIDENCE_HISTORY_INVALID'],
    CURRENT_EVIDENCE_REQUIRED:['EVIDENCE','CURRENT_EVIDENCE_REQUIRED'],CURRENT_EVIDENCE_INVALID:['EVIDENCE','CURRENT_EVIDENCE_INVALID'],
    CURRENT_EVIDENCE_INCOMPLETE:['EVIDENCE','CURRENT_EVIDENCE_INCOMPLETE'],CURRENT_CANDIDATE_MISMATCH:['CANDIDATE','CURRENT_CANDIDATE_MISMATCH'],
    CURRENT_EXECUTION_INVALID:['EXECUTION','CURRENT_EXECUTION_INVALID'],CURRENT_REVIEW_INVALID:['REVIEW','CURRENT_REVIEW_INVALID'],
    CURRENT_CLEANUP_INVALID:['CLEANUP','CURRENT_CLEANUP_INVALID'],
    CURRENT_HISTORICAL_PROOF_INVALID:['HISTORICAL_PROOF','CURRENT_HISTORICAL_PROOF_INVALID'],
    CURRENT_SPECIALIZED_PROOF_INVALID:['SPECIALIZED_PROOF','CURRENT_SPECIALIZED_PROOF_INVALID']};
  const [stage,reason_code]=Object.hasOwn(known,error?.code??'')?known[error.code]:['VALIDATION','VALIDATION_REJECTED'];
  console.log(JSON.stringify({ok:false,error_code:'SS010_NOT_READY',stage,reason_code,live_authorized:false}));process.exitCode=1;
}
