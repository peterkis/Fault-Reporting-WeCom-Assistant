import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { configurationFixture } from './helpers/p2-g2-configuration-fixture.mjs';
import { G2_ROOT, g2CandidateInventory } from '../src/p2-g2-candidate.mjs';
import { minimalG2Environment } from '../src/p2-g2-validation-config.mjs';
import { installG2NetworkBoundary, probeG2NetworkBoundary } from '../src/p2-g2-network-boundary.mjs';
import { loadG2PrivateEnvironment } from '../scripts/p2-g2-check.mjs';
import { testRoots } from './helpers/migration-roots.mjs';
import { g2SourceBinding } from '../src/p2-g2-evidence-files.mjs';

const { sourceRoot, runtimeRoot } = testRoots();
const runtimeScript = file => path.join(runtimeRoot, 'scripts', file);

test('process HTTP policy permits owned health traffic and blocks model endpoints, redirects and option overrides',async()=>{
  let requests=0;const server=http.createServer((req,res)=>{requests++;if(req.url==='/redirect'){res.writeHead(302,{location:'https://api.openai.com/v1/models'});res.end();}else res.end('ready');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  const {manifest}=configurationFixture();manifest.listen_port=port;manifest.reporter_origin='http://127.0.0.1:'+port;
  const restore=installG2NetworkBoundary(manifest);
  try{
    assert.equal(await(await fetch(manifest.reporter_origin+'/health')).text(),'ready');
    const probes=await probeG2NetworkBoundary();assert.equal(probes.model_network_unreachable,true);assert.equal(probes.blocked_model_http_probes,2);
    await assert.rejects(fetch(manifest.reporter_origin+'/redirect'));
    assert.throws(()=>http.request(manifest.reporter_origin,{hostname:'api.openai.com',port:80}),{code:'P2_G2_NETWORK_ENDPOINT_NOT_APPROVED'});
    assert.throws(()=>http.request({hostname:'127.0.0.1',port,socketPath:'/not-an-approved-socket'}),{code:'P2_G2_NETWORK_ENDPOINT_NOT_APPROVED'});
    await assert.rejects(fetch(manifest.reporter_origin,{headers:{Host:'api.openai.com'}}),{code:'P2_G2_NETWORK_ENDPOINT_NOT_APPROVED'});
    assert.equal(requests,2);
  }finally{restore();await new Promise(r=>server.close(r));}
});

test('documented CLI help and no-argument live invocation never start a listener or provider',()=>{
  for(const file of ['p2-g2-check.mjs','p2-g2-live-e2e.mjs','p2-g2-synthetic-e2e.mjs','p2-g2-resource-observation.mjs','p2-g2-reconcile.mjs','p2-g2-evaluate.mjs']){
    const result=spawnSync(process.execPath,[runtimeScript(file),'--help'],{cwd:sourceRoot,env:minimalG2Environment(),encoding:'utf8',windowsHide:true,timeout:15000});
    assert.equal(result.status,0,file);assert.match(result.stdout,/Usage:/u);
  }
  const result=spawnSync(process.execPath,[runtimeScript('p2-g2-live-e2e.mjs')],{cwd:sourceRoot,env:minimalG2Environment(),encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(result.status,2);assert.doesNotMatch(result.stdout,/LIVE_ROLES_READY/u);
});

test('missing fresh live approval is rejected before any database connection even with a bound manifest and private configuration',()=>{
  mkdirSync(path.join(G2_ROOT,'tmp'),{recursive:true});
  const directory=mkdtempSync(path.join(G2_ROOT,'tmp','p2-g2-cli-boundary-'));
  try{
    const {manifest,env}=configurationFixture('live');manifest.reporter_origin='https://synthetic-g2.invalid';
    manifest.candidate_fingerprint=g2CandidateInventory().fingerprint;env.WECOM_WS_URL='wss://openws.work.weixin.qq.com';
    const manifestFile=path.join(directory,'manifest.json'),envFile=path.join(directory,'private.env');
    writeFileSync(manifestFile,JSON.stringify(manifest));
    writeFileSync(envFile,Object.entries(env).filter(([,v])=>typeof v==='string').map(([k,v])=>k+'='+v).join('\n')+'\nOPENAI_API_KEY=must-not-enter-roles\nP2_012_REAL_WECOM_SEND_APPROVED=true\n',{mode:0o600});
    const filtered=loadG2PrivateEnvironment(envFile,{});assert.equal(filtered.OPENAI_API_KEY,undefined);assert.equal(filtered.P2_012_REAL_WECOM_SEND_APPROVED,undefined);
    const result=spawnSync(process.execPath,[runtimeScript('p2-g2-check.mjs'),'--mode=live-check','--manifest='+manifestFile,'--env-file='+envFile],
      {cwd:sourceRoot,env:minimalG2Environment(),encoding:'utf8',windowsHide:true,timeout:15000});
    const report=JSON.parse(result.stdout);assert.equal(result.status,1);assert.equal(report.error_code,'P2_G2_LIVE_APPROVAL_REQUIRED');
    assert.equal(report.database_connection_started,false);assert.equal(report.database_writes,false);assert.equal(report.provider_calls,0);assert.equal(report.listener_started,false);
  }finally{const relative=path.relative(path.join(G2_ROOT,'tmp'),path.resolve(directory));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));rmSync(directory,{recursive:true,force:true});}
});

test('staged G2 observation, reconciliation and evaluation use canonical source evidence paths',()=>{
  mkdirSync(path.join(sourceRoot,'tmp'),{recursive:true});
  const directory=mkdtempSync(path.join(sourceRoot,'tmp','p2-g2-cli-source-root-'));
  const prefix=path.relative(sourceRoot,directory).replaceAll('\\','/');
  try{
    const {manifest}=configurationFixture();manifest.candidate_fingerprint=g2CandidateInventory().fingerprint;
    const binding=g2SourceBinding(manifest),manifestFile=path.join(directory,'manifest.json');
    writeFileSync(manifestFile,JSON.stringify(manifest));
    writeFileSync(path.join(directory,'state.json'),JSON.stringify({...binding,status:'CREATED',process_count:0}));
    writeFileSync(path.join(directory,'startup-source.json'),JSON.stringify(binding));
    writeFileSync(path.join(directory,'resource-evidence.jsonl'),'');
    const run=(file,...args)=>spawnSync(process.execPath,[runtimeScript(file),'--manifest='+manifestFile,...args],
      {cwd:runtimeRoot,env:minimalG2Environment(),encoding:'utf8',windowsHide:true,timeout:15000});
    let result=run('p2-g2-resource-observation.mjs','--mode=observe','--run-directory='+prefix);
    assert.equal(result.status,0,result.stdout+result.stderr);
    let report=JSON.parse(result.stdout);assert.equal(report.ok,true);assert.equal(report.samples,0);assert.equal(report.gate_passed,false);
    result=run('p2-g2-reconcile.mjs','--mode=reconcile','--run-directory='+prefix,'--output=reconciliation-source.json');
    assert.equal(result.status,1);report=JSON.parse(result.stdout);
    assert.equal(report.error_code,'P2_G2_STOPPED_RUN_REQUIRED');assert.equal(report.database_writes,false);assert.equal(report.provider_calls,0);
    const output=prefix+'/gate-result.jsonl';
    result=run('p2-g2-evaluate.mjs','--mode=evaluate','--streams='+prefix+'/resource-evidence.jsonl','--output='+output);
    assert.equal(result.status,1,result.stdout+result.stderr);report=JSON.parse(result.stdout);
    assert.equal(report.status,'BLOCKED');assert.equal(report.database_writes,false);assert.equal(report.provider_calls,0);assert.equal(report.task_state_changed,false);
    assert.deepEqual(JSON.parse(readFileSync(path.join(sourceRoot,output),'utf8')),
      Object.fromEntries(Object.entries(report).filter(([key])=>!['database_writes','provider_calls','task_state_changed'].includes(key))));
    if(sourceRoot!==runtimeRoot)assert.equal(existsSync(path.join(runtimeRoot,output)),false);
  }finally{const relative=path.relative(path.join(sourceRoot,'tmp'),path.resolve(directory));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));rmSync(directory,{recursive:true,force:true});}
});
