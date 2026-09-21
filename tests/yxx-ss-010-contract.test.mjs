import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync,spawn} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {limitedTemplate,validateLimitedManifest,parseLimitedArguments,databaseIdentity,approvalScope,verifyLimitedApproval,digest} from '../src/yxx-limited-write-contract.mjs';
import {manifestFixture} from './helpers/yxx-ss-010-fixture.mjs';
import {readSS010Artifact} from '../src/yxx-self-service-readiness.mjs';
import {stopLimitedChild} from '../src/yxx-limited-write-runner.mjs';

test('SS010 AC092 offline defaults and unapproved template never start runtime capabilities',()=>{
  validateLimitedManifest(limitedTemplate(),{template:true});
  assert.throws(()=>validateLimitedManifest(limitedTemplate()));
  const folder=mkdtempSync(path.join(tmpdir(),'ss010-offline-'));
  try{
    const hook=path.join(folder,'guard.mjs');
    writeFileSync(hook,"import net from 'node:net';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const fail=()=>{throw Error('FORBIDDEN_RUNTIME_IO');};net.Socket.prototype.connect=fail;net.Server.prototype.listen=fail;cp.fork=fail;cp.spawn=fail;globalThis.fetch=fail;syncBuiltinESMExports();");
    for(const args of [[],['--check']]){
      const result=JSON.parse(execFileSync(process.execPath,['--import',pathToFileURL(hook).href,'scripts/yxx-self-service-live.mjs',...args],{encoding:'utf8',windowsHide:true}));
      assert.equal(result.status,'TEMPLATE_VALID_NOT_AUTHORIZED');for(const key of ['database_connections','provider_calls','processes_started'])assert.equal(result[key],0);
    }
    const result=JSON.parse(execFileSync(process.execPath,['--import',pathToFileURL(hook).href,'scripts/yxx-self-service-readiness.mjs'],{encoding:'utf8',windowsHide:true}));
    assert.equal(result.status,'SS010_STRUCTURE_VALID_NOT_READY');assert.equal(result.live_authorized,false);
  }finally{rmSync(folder,{recursive:true,force:true});}
});
test('SS010 AC092 closed permissions identity window and conservative budget reject unsafe manifests',()=>{
  const fixture=manifestFixture();validateLimitedManifest(fixture);
  const mutations=[m=>m.extra=true,m=>m.permissions.extra=true,m=>m.permissions.real_message_send=true,m=>m.permissions.parent_p2_g2_live=true,
    m=>m.permissions.database_connect=false,m=>m.kind='TEMPLATE_NOT_AUTHORIZATION',m=>m.approval_record_sha256=null,m=>m.candidate_tree='wrong',
    m=>m.app_version='b'.repeat(40),m=>m.limits.max_new_intakes=7,m=>m.limits.per_member_intakes=7,m=>m.limits.max_supplements=0,
    m=>m.database.name='production',m=>m.database.dedicated_test_only=false,m=>m.principal_ids[1]=m.principal_ids[0],m=>m.window.ends_epoch_ms=m.window.starts_epoch_ms];
  for(const mutate of mutations){const value=structuredClone(fixture);mutate(value);assert.throws(()=>validateLimitedManifest(value));}
  assert.throws(()=>validateLimitedManifest(fixture,{now:Number(fixture.window.ends_epoch_ms)}));
  assert.throws(()=>validateLimitedManifest(fixture,{now:Number(fixture.window.starts_epoch_ms)-1}));
  assert.throws(()=>databaseIdentity('postgres://u@hospital/production'));
});
test('SS010 AC094 unknown duplicate and run arguments fail without implicit authorization',()=>{
  for(const args of [['--run','--check'],['--wat'],['--resume'],['--manifest=a','--manifest=b']])assert.throws(()=>parseLimitedArguments(args));
  for(const args of [['--run'],['--run','--resume'],['--require-ready']]){
    const result=spawnSync(process.execPath,['scripts/yxx-self-service-live.mjs',...args],{encoding:'utf8',windowsHide:true});assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).live_authorized,false);
  }
});
test('SS010 AC092 owner approval cannot be reused for changed window actors database or quotas',()=>{
  const manifest=manifestFixture(),record=JSON.stringify({kind:'SS011_LIMITED_WRITE_APPROVED',run_id:manifest.run_id,scope_sha256:approvalScope(manifest),candidate_commit:manifest.candidate_commit,owner:manifest.owner,approver:manifest.approver});
  manifest.approval_record_sha256=digest(record);verifyLimitedApproval(manifest,record);
  for(const mutate of [m=>m.run_id+='a',m=>m.window.ends_epoch_ms='1999999999000',m=>m.limits.max_supplements++,m=>m.principal_ids.reverse(),m=>m.database.oid='4']){
    const changed=structuredClone(manifest);mutate(changed);assert.throws(()=>verifyLimitedApproval(changed,record),{code:'SS010_APPROVAL_SCOPE_MISMATCH'});
  }
});
test('SS010 AC091 artifact references reject path traversal missing and corrupted execution data',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'ss010-artifact-'));
  try{
    mkdirSync(path.join(root,'evidence'));const file='evidence/yxx-ss-010-sample.json';writeFileSync(path.join(root,file),'{}');
    assert.equal(readSS010Artifact(root,{path:file,sha256:digest('{}')}),'{}');
    writeFileSync(path.join(root,file),'{"forged":true}');assert.throws(()=>readSS010Artifact(root,{path:file,sha256:digest('{}')}));
    for(const ref of [{path:'../report',sha256:'a'.repeat(64)},{path:'evidence/yxx-ss-010-missing.json',sha256:'a'.repeat(64)}])assert.throws(()=>readSS010Artifact(root,ref));
    assert.throws(()=>readSS010Artifact(process.cwd(),{path:'evidence/yxx-ss-010-report.json',sha256:'0'.repeat(64)}));
    const plan=JSON.parse(readFileSync('plans/yxx-self-service-ticket-plan.json'));assert.equal(plan.tickets.find(t=>t.id==='YXX-SS-011').status,'NOT_AUTHORIZED');
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('SS010 AC094 unresponsive owned child is hard-stopped with a bounded wait',async()=>{
  const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.on('message',()=>{});setInterval(()=>{},1000);process.send({ready:true});"],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
  const exited=new Promise(resolve=>child.once('exit',resolve));
  try{await new Promise(resolve=>child.once('message',resolve));const result=await stopLimitedChild(child,exited,{graceMs:50,killMs:2000});assert.deepEqual(result,{forced:true,exited:true});}
  finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;}
});
