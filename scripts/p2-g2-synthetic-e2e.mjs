import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { g2Hash, minimalG2Environment, failG2 } from '../src/p2-g2-validation-config.mjs';
import { g2CandidateInventory, G2_ROOT } from '../src/p2-g2-candidate.mjs';

export function g2TestFiles(suite='g2') {
  if(!['g2','integration','browser','full'].includes(suite))failG2('TEST_SUITE_INVALID');
  const root=readdirSync(path.join(G2_ROOT,'tests')).filter(n=>n.endsWith('.test.mjs')&&(suite==='full'||n.startsWith('p2-g2-'))
    &&(suite!=='integration'||n.endsWith('.integration.test.mjs'))&&(suite!=='browser'||n.includes('browser'))).sort().map(n=>'tests/'+n);
  if(suite==='full')root.push(...readdirSync(path.join(G2_ROOT,'tests/p2-007')).filter(n=>n.endsWith('.test.mjs')).sort().map(n=>'tests/p2-007/'+n));
  return root;
}
export async function runG2Tests({suite='g2',envFile='.env.pilot'}={}) {
  if(Number(process.versions.node.split('.')[0])!==24)failG2('NODE_24_REQUIRED');
  const files=g2TestFiles(suite),settings=parseEnv(readFileSync(path.resolve(G2_ROOT,envFile),'utf8'));
  let url;try{url=new URL(settings.PILOT_DATABASE_URL);}catch{failG2('DATABASE_CONFIGURATION_INVALID');}
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))failG2('LOCAL_DATABASE_REQUIRED');
  const environment={...minimalG2Environment(),PILOT_DATABASE_URL:settings.PILOT_DATABASE_URL};
  const directory='tmp/p2-g2-tests-'+randomUUID(),absolute=path.join(G2_ROOT,directory);mkdirSync(absolute,{recursive:true,mode:0o700});
  const candidate=g2CandidateInventory(),args=['--expose-gc','--test','--test-concurrency=1','--test-reporter=tap',...files],started_physical_epoch_ms=String(Date.now());
  const collected=await new Promise(resolve=>{
    const child=spawn(process.execPath,args,{cwd:G2_ROOT,env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',bytes=0,error=null;
    const capture=kind=>chunk=>{bytes+=chunk.length;if(bytes>64*1024*1024){error='OUTPUT_LIMIT';child.kill();return;}
      if(kind==='stdout')stdout+=chunk.toString('utf8');else stderr+=chunk.toString('utf8');};
    child.stdout.on('data',capture('stdout'));child.stderr.on('data',capture('stderr'));
    child.once('error',e=>{error=e.code??'PROCESS_FAILED';});
    child.once('close',(exit_code,signal)=>resolve({stdout,stderr,exit_code,signal,error}));
  });
  const redact=text=>[settings.PILOT_DATABASE_URL,url.password,decodeURIComponent(url.password)].filter(Boolean).reduce((s,secret)=>s.replaceAll(secret,'[REDACTED]'),text);
  const stdout=redact(collected.stdout),stderr=redact(collected.stderr);
  writeFileSync(path.join(absolute,'result.tap'),stdout,{mode:0o600});writeFileSync(path.join(absolute,'stderr.txt'),stderr,{mode:0o600});
  const counts={};for(const line of stdout.split(/\r?\n/u)){const m=/^# (tests|pass|fail|skipped|cancelled|todo) (\d+)$/u.exec(line);if(m)counts[m[1]]=Number(m[2]);}
  const unchanged=g2CandidateInventory().fingerprint===candidate.fingerprint;
  const record={schema_version:1,gate:'P2-G2',mode:'SYNTHETIC_AUTOMATION',suite,candidate_fingerprint:candidate.fingerprint,
    started_physical_epoch_ms,completed_physical_epoch_ms:String(Date.now()),node_version:process.versions.node,os_platform:process.platform,os_release:os.release(),architecture:process.arch,
    candidate_unchanged:unchanged,expose_gc:true,formal_natural_gc_observation:false,model_environment_keys:0,
    args,files:files.map(file=>({path:file,sha256:candidate.files.find(entry=>entry.path===file).sha256})),
    exit_code:collected.exit_code,signal:collected.signal,error:collected.error,counts,
    stdout_sha256:g2Hash(stdout),stderr_sha256:g2Hash(stderr),directory};
  writeFileSync(path.join(absolute,'run.json'),JSON.stringify(record,null,2)+'\n',{mode:0o600});
  return {ok:collected.exit_code===0&&unchanged&&counts.tests>0&&counts.pass===counts.tests
    &&['fail','skipped','cancelled','todo'].every(k=>counts[k]===0),...record};
}
export async function main(argv=process.argv.slice(2)){
  if(argv.includes('--help')){console.log('Usage: node scripts/p2-g2-synthetic-e2e.mjs [--suite=g2|integration|browser|full] [--env-file=.env.pilot]\nRuns local isolated PostgreSQL tests with mock transport; no live sends. Full includes root baseline and tests/p2-007.');return;}
  let suite='g2',envFile='.env.pilot';const seen=new Set();
  for(const arg of argv){const m=/^--(suite|env-file)=(.+)$/u.exec(arg);if(!m||seen.has(m[1]))failG2('ARGUMENT_INVALID');seen.add(m[1]);if(m[1]==='suite')suite=m[2];else envFile=m[2];}
  const result=await runG2Tests({suite,envFile});
  console.log(JSON.stringify({ok:result.ok,exit_code:result.exit_code,directory:result.directory,counts:result.counts,
    test_file_count:result.files.length,candidate_fingerprint:result.candidate_fingerprint,candidate_unchanged:result.candidate_unchanged}));
  if(!result.ok)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main().catch(e=>{console.log(JSON.stringify({ok:false,error_code:/^P2_G2_[A-Z_]+$/u.test(e?.code??'')?e.code:'P2_G2_TEST_RUN_FAILED'}));process.exitCode=1;});
