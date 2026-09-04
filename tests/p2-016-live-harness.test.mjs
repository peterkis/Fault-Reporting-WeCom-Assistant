import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readP2016LiveConfiguration,P2016_LIVE_FUSES } from '../src/p2-016-live-configuration.mjs';
import { checkP2016Live,assertP2016ReadyCandidate } from '../scripts/p2-016-live-check.mjs';
import { p2016LiveDuration } from '../scripts/p2-016-live-e2e.mjs';

function env(){return {...Object.fromEntries(P2016_LIVE_FUSES.map(k=>[k,'true'])),
  PILOT_DATABASE_URL:'postgres://synthetic.invalid/test',PILOT_LOG_IDENTITY_HASH_KEY:'synthetic-private-key-not-for-logging',
  WECOM_BOT_ID:'synthetic-bot',WECOM_BOT_SECRET:'synthetic-private-bot-secret',WECOM_WS_URL:'wss://synthetic.invalid',
  P2_016_TEST_PRINCIPAL_IDS:[randomUUID(),randomUUID()].join(','),P2_016_TEST_USER_TARGET_HASHES:'a'.repeat(64),
  P2_016_TEST_GROUP_TARGET_HASHES:'b'.repeat(64),P2_016_REPORTER_ORIGIN:'https://reporter.invalid',
  P2_016_REPORTER_ALLOWED_HOSTS:'reporter.invalid',P2_016_REPORTER_HMAC_SECRET:'synthetic-reporter-private-key-0001'};}
test('P2-016 live harness requires exact owner fuses and HTTPS bounded configuration, without logging secrets',async()=>{
  const e=env();assert.equal(readP2016LiveConfiguration(e).principalIds.length,2);
  for(const k of P2016_LIVE_FUSES)for(const value of [undefined,'TRUE','false',true]){
    const input={...e,[k]:value};assert.throws(()=>readP2016LiveConfiguration(input),/P2_016_LIVE_APPROVAL_REQUIRED/u);
    const checked=await checkP2016Live(input);assert.equal(checked.ok,false);assert.equal(checked.provider_calls,0);
    assert.doesNotMatch(JSON.stringify(checked),/synthetic|postgres|private-key/u);
  }
  for(const delta of [{AI_AUTO_REPLY_ENABLED:'true'},{REPORTER_TIMELINE_ENABLED:'TRUE'},{P2_016_REPORTER_ORIGIN:'http://reporter.invalid'},
    {P2_016_REPORTER_ORIGIN:'https://reporter.invalid/?token=bad'},{P2_016_REPORTER_ALLOWED_HOSTS:'wrong.invalid'},
    {P2_016_REPORTER_HMAC_SECRET:'short'},{P2_016_TEST_USER_TARGET_HASHES:''},{P2_016_TEST_GROUP_TARGET_HASHES:'raw-target'},
    {P2_016_TEST_PRINCIPAL_IDS:'not-uuid'},{P2_016_LISTEN_PORT:'0'}])assert.throws(()=>readP2016LiveConfiguration({...e,...delta}));
});
test('P2-016 live requires an exact verified candidate and at least 15 minutes; cannot claim final completion',()=>{
  const ready={state:'READY_FOR_TARGETED_LIVE_VALIDATION',hash:'c'.repeat(64),report:{status:'READY_FOR_TARGETED_LIVE_VALIDATION',runtime_input_sha256:'c'.repeat(64),
    all_automated_checks_passed:true,regression:{pass:523,fail:0,skipped:0,cancelled:0,todo:0},live_validation:'NOT_RUN',second_commit_created:false}};
  assert.doesNotThrow(()=>assertP2016ReadyCandidate(ready));
  for(const delta of [{hash:'stale'},{state:'AUTHORIZED'},{report:{...ready.report,live_validation:'PASSED'}},
    {report:{...ready.report,regression:{...ready.report.regression,skipped:1}}},{report:{...ready.report,second_commit_created:true}}])assert.throws(()=>assertP2016ReadyCandidate({...ready,...delta}));
  assert.equal(p2016LiveDuration(['--observe-seconds=900']),900000);
  assert.equal(p2016LiveDuration(['--observe-seconds=3600']),3600000);
  for(const args of [[],['--run'],['--observe-seconds=899'],['--observe-seconds=3601'],['--observe-seconds=900','extra']])assert.throws(()=>p2016LiveDuration(args));
});
test('P2-016 live CLI with no approvals exits before DB, listener, Evidence or SDK work',()=>{
  const e={...process.env};for(const k of P2016_LIVE_FUSES)delete e[k];
  for(const script of ['p2-016-live-check.mjs','p2-016-live-e2e.mjs']){
    const result=spawnSync(process.execPath,['scripts/'+script,...(script.includes('e2e')?['--observe-seconds=900']:[])],{env:e,encoding:'utf8',timeout:10000});
    assert.equal(result.status,1,result.stderr);const line=JSON.parse(result.stdout.trim());assert.equal(line.provider_calls,0);
    assert.equal(line.listener_started,false);assert.equal(line.error_code,'P2_016_LIVE_APPROVAL_REQUIRED');
  }
});
