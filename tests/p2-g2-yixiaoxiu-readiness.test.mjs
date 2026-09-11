import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {requirePreparedYxxCandidate,allowYxxReadinessReportRefresh} from '../src/p2-g2-yixiaoxiu-readiness.mjs';
import {readYxxG2AppConfiguration} from '../src/p2-g2-yixiaoxiu-g2-config.mjs';
import {validateYxxEntryConfig} from '../src/p2-g2-yixiaoxiu-contract.mjs';
import {validateG2Manifest} from '../src/p2-g2-validation-config.mjs';
import {configurationFixture} from './helpers/p2-g2-configuration-fixture.mjs';
import {entryConfig} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {installG2NetworkBoundary} from '../src/p2-g2-network-boundary.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
test('member readiness refresh permits only authorized modifications with exact preserved baseline bytes',()=>{
  const changes=['json','md'].map(suffix=>({status:'M',path:'evidence/p2-g2-automated-readiness-report.'+suffix}));
  const input={changes,authorized:true,readBaseline:()=>Buffer.from('original\r\n'),readSnapshot:()=>Buffer.from('original\r\n')};
  assert.equal(allowYxxReadinessReportRefresh({...input,authorized:false}),false);
  for(const status of ['D','R100','A'])assert.equal(allowYxxReadinessReportRefresh({...input,changes:[{...changes[0],status}]}),false);
  assert.equal(allowYxxReadinessReportRefresh({...input,changes:[{status:'M',path:'evidence/p2-g2-pr7-regression.tap'}]}),false);
  assert.equal(allowYxxReadinessReportRefresh({...input,readSnapshot:()=>Buffer.from('original\n')}),false);
  assert.equal(allowYxxReadinessReportRefresh({...input,readSnapshot:()=>{throw Error('missing');}}),false);
  assert.equal(allowYxxReadinessReportRefresh(input),true);
  assert.equal(allowYxxReadinessReportRefresh({...input,ready:true,verifyReady:()=>{throw Error('stale candidate');}}),false);
  let verified=0;assert.equal(allowYxxReadinessReportRefresh({...input,ready:true,verifyReady:()=>{verified++;}}),true);assert.equal(verified,1);
  assert.equal(allowYxxReadinessReportRefresh({...input,changes:[],ready:true,verifyReady:()=>{throw Error('stale candidate');}}),false);
  assert.equal(allowYxxReadinessReportRefresh({...input,changes:[],authorized:false,ready:true,verifyReady:()=>{throw Error('stale candidate');}}),false);
});
test('member readiness refuses old976, missing48, bypass gaps, missing baseline and false live claims',async t=>{
  const root=mkdtempSync(path.join(tmpdir(),'yxx-ready-'));mkdirSync(path.join(root,'evidence'));
  t.after(()=>{const relative=path.relative(tmpdir(),root);assert.match(relative,/^yxx-ready-[A-Za-z0-9]+$/u);rmSync(root,{recursive:true,force:true});});
  const fingerprint='a'.repeat(64),name='unrelated synthetic passing test';
  const definitions=Array.from({length:48},(_,i)=>({scenario_id:'YXX-'+String(i+1).padStart(2,'0'),requirement:'synthetic requirement '+i,required_assertion:'synthetic assertion '+i}));
  const names=definitions.map(s=>s.scenario_id+' synthetic proof');
  mkdirSync(path.join(root,'tests/fixtures'),{recursive:true});
  writeFileSync(path.join(root,'tests/fixtures/p2-g2-yixiaoxiu-scenarios.json'),JSON.stringify({scenarios:definitions}));
  const baseline=Array.from({length:158},(_,i)=>{
    const file='tests/fixture-'+i+'.test.mjs',content=i===0?names.join('\n'):'';writeFileSync(path.join(root,file),content);
    return {path:file,sha256:sha(content)};
  });
  writeFileSync(path.join(root,'evidence/p2-g2-pr7-regression-run.json'),JSON.stringify({files:baseline}));
  const report={work_item:'P2-G2-YXX-TICKET-ENTRY',candidate_fingerprint:fingerprint,implementation:'IMPLEMENTED',automation:'VERIFIED',
    entry_live_authorized:false,entry_live_result:'NOT_RUN',p2_g2_live_result:'NOT_RUN',identity_namespace_live_verified:false,
    entry_status:'IDENTITY_NAMESPACE_LIVE_VERIFICATION_PENDING',persistent_flags_all_off:true,no_ddl:true,real_provider_calls:0,
    real_business_data_access:false,reporter_policy:'MEMBER_REQUIRED',full_regression:{tests:977}};
  const matrix={candidate_fingerprint:fingerprint,scenarios:definitions.map((s,i)=>({...s,automation:'VERIFIED',live_result:'NOT_RUN',test_names:[names[i]],test_files:[baseline[0]]}))};
  const routes={candidate_fingerprint:fingerprint,access_policy:'MEMBER_REQUIRED',legacy_cookie_bypass:false,legacy_exchange_bypass:false,identity_namespace_live_verified:false,routes:Array.from({length:17},(_,i)=>({path:'/synthetic/'+i}))};
  const run={candidate_fingerprint:fingerprint,suite:'full',exit_code:0,candidate_unchanged:true,stdout_sha256:'b'.repeat(64),files:baseline,counts:{tests:977,pass:977,fail:0,skipped:0,cancelled:0,todo:0}};
  const review={candidate_fingerprint:fingerprint,reviews:['SPEC','STANDARDS'].map(axis=>({axis,verdict:'PASS',unresolved_findings:0}))};
  for(const value of [report,matrix,routes,run,review])Object.assign(value,{event_time:'2026-09-11 12:00:00',event_epoch_ms:'1789099200000'});
  const verifiedRunReference={path:'evidence/p2-g2-yxx-entry-regression-run.json',sha256:sha(JSON.stringify(run))};
  const read=()=>requirePreparedYxxCandidate({fingerprint,root,fullRegression:{tests:977},passedNames:new Set([...names,name]),verifiedRun:run,verifiedRunReference});
  assert.throws(read,{code:'YXX_ENTRY_CURRENT_EVIDENCE_REQUIRED'});
  const save=(r=report,m=matrix,a=routes,u=run,v=review)=>{
    const sources={};for(const [key,value] of Object.entries({scenario_matrix:m,route_audit:a,regression_run:u,independent_review:v})){
      const file='evidence/p2-g2-yxx-entry-'+key.replaceAll('_','-')+'.json',raw=JSON.stringify(value);writeFileSync(path.join(root,file),raw);sources[key]={path:file,sha256:sha(raw)};
    }writeFileSync(path.join(root,'evidence/p2-g2-yxx-entry-report.json'),JSON.stringify({...r,sources}));
  };
  save();assert.equal(read().automation,'VERIFIED'); // Synthetic validation fixture; never copied to repository Evidence.
  await t.test('PR8 current member readiness rejects missing or noncanonical evidence time pairs',()=>{
    for(const patch of [{event_time:undefined},{event_epoch_ms:undefined},{event_time:'2026-09-11T04:00:00.000Z'},
      {event_epoch_ms:1789099200000},{event_epoch_ms:'1789099201000'},{recorded_at:'2026-09-11T04:00:00Z'}]){
      save({...report,...patch});assert.throws(read,{code:'YXX_ENTRY_CURRENT_EVIDENCE_REQUIRED'});
    }
    save(report,{...matrix,event_time:'2026-09-11T04:00:00Z'});assert.throws(read,{code:'YXX_ENTRY_CURRENT_EVIDENCE_REQUIRED'});
  });
  await t.test('member readiness refuses unrelated passing names',()=>{
    save(report,{...matrix,scenarios:matrix.scenarios.map(s=>({...s,test_names:[name]}))});assert.throws(read,{code:'YXX_ENTRY_CURRENT_EVIDENCE_REQUIRED'});
  });
  await t.test('member readiness refuses a different TAP receipt',()=>{
    save(report,matrix,routes,{...run,stdout_sha256:'c'.repeat(64)});assert.throws(read,{code:'YXX_ENTRY_CURRENT_EVIDENCE_REQUIRED'});
  });
  await t.test('member readiness refuses different regression file hashes',()=>{
    save(report,matrix,routes,{...run,files:baseline.map(f=>({...f,sha256:'d'.repeat(64)}))});assert.throws(read,{code:'YXX_ENTRY_CURRENT_EVIDENCE_REQUIRED'});
  });
  await t.test('member readiness refuses unrelated scenario files',()=>{
    save(report,{...matrix,scenarios:matrix.scenarios.map(s=>({...s,test_files:[baseline[1]]}))});assert.throws(read,{code:'YXX_ENTRY_CURRENT_EVIDENCE_REQUIRED'});
  });
  for(const patch of [{full_regression:{tests:976}},{entry_live_authorized:true},{identity_namespace_live_verified:true},{real_provider_calls:1},{reporter_policy:'LEGACY_BOUND_GRANT'}]){
    save({...report,...patch});assert.throws(read,{code:'YXX_ENTRY_CURRENT_EVIDENCE_REQUIRED'});
  }
  save(report,{...matrix,scenarios:matrix.scenarios.slice(1)});assert.throws(read,{code:'YXX_ENTRY_CURRENT_EVIDENCE_REQUIRED'});
  save(report,matrix,{...routes,legacy_cookie_bypass:true});assert.throws(read,{code:'YXX_ENTRY_CURRENT_EVIDENCE_REQUIRED'});
  save(report,matrix,routes,{...run,files:baseline.slice(1)});assert.throws(read,{code:'YXX_ENTRY_CURRENT_EVIDENCE_REQUIRED'});
  save(report,matrix,routes,run,{...review,reviews:review.reviews.slice(1)});assert.throws(read,{code:'YXX_ENTRY_CURRENT_EVIDENCE_REQUIRED'});
});
test('YXX-33 complete G2 live configuration requires member policy and binds the server identity proof configuration',()=>{
  const {manifest,env}=configurationFixture('live');
  assert.throws(()=>validateG2Manifest({...manifest,scope:{...manifest.scope,reporter_access_policy:'LEGACY_BOUND_GRANT'}}),{code:'P2_G2_MEMBER_POLICY_REQUIRED'});
  assert.throws(()=>readYxxG2AppConfiguration({manifest,env}),{code:'YXX_ENTRY_CONFIG_INVALID'});
  const config=validateYxxEntryConfig({...entryConfig,botId:env.WECOM_BOT_ID,validationProfile:'DEPLOYMENT',proofKind:'LIVE',proofRef:'synthetic-unit-proof-not-a-live-approval'});
  manifest.scope.member_entry_config_sha256=sha(JSON.stringify(config));
  Object.assign(env,{YIXIAOXIU_MEMBER_TICKET_ENTRY_ENABLED:'true',WECOM_WEB_OAUTH_ENABLED:'true',CORP_ID:config.corpId,APP_ID:config.agentId,APP_SECRET:'synthetic-only-app-secret',YIXIAOXIU_MEMBER_TICKET_ENTRY_CONFIG_JSON:JSON.stringify(config)});
  assert.deepEqual(readYxxG2AppConfiguration({manifest,env}),config);
  for(const patch of [{WECOM_WEB_OAUTH_ENABLED:'false'},{YIXIAOXIU_MEMBER_TICKET_ENTRY_ENABLED:'false'},{CORP_ID:'other-corp'},{APP_ID:'999'},{APP_SECRET:''}])assert.throws(()=>readYxxG2AppConfiguration({manifest,env:{...env,...patch}}));
  assert.throws(()=>readYxxG2AppConfiguration({manifest:{...manifest,scope:{...manifest.scope,member_entry_config_sha256:'f'.repeat(64)}},env}));
});
test('member App HTTP allowlist admits only fixed OAuth endpoints with bounded GET parameters through a local fake transport',async()=>{
  const {manifest}=configurationFixture('live');let calls=0;const native=globalThis.fetch;globalThis.fetch=async()=>{calls++;return new Response('{}');};
  const restore=installG2NetworkBoundary(manifest,{memberOAuthEnabled:true});
  try{
    const auth='https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=synthetic&code=synthetic';
    await fetch(auth);await fetch('https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=synthetic&corpsecret=synthetic');
    for(const [url,options] of [[auth,{method:'POST'}],[auth+'&code=duplicate',{}],[auth.replace('/auth/getuserinfo','/user/delete'),{}],[auth,{headers:{Host:'evil.invalid'}}]])await assert.rejects(fetch(url,options));
    assert.equal(calls,2);
  }finally{restore();globalThis.fetch=native;}
});
