import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTargetedCreationConfig} from '../src/p2-g2-yxx-targeted-creation.mjs';
import {targetedCreationConfigHash} from '../src/p2-g2-yxx-targeted-creation.mjs';
import {main} from '../scripts/p2-g2-yxx-targeted-create.mjs';
import {g2CandidateInventory} from '../src/p2-g2-candidate.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

export function syntheticCreationConfig(){
  const start=Date.now();
  return {profile:'YXX_TARGETED_TICKET_CREATION',runId:'yxx-create-synthetic01',
    botId:'bot-test',groupId:'group-test',members:{A:'synthetic-A',B:'synthetic-B'},
    startEpochMs:String(start),endEpochMs:String(start+1800000),
    cases:[['A1','A','group'],['A2','A','single'],['B1','B','group'],['B2','B','single']]
      .map(([id,member,chatType])=>({id,member,chatType,text:`新故障：HIS无法登录，定向测试 synthetic01-${id}`}))};
}
test('targeted creation config fixes four A/B cases and rejects broader scope',()=>{
  assert.equal(validateTargetedCreationConfig(syntheticCreationConfig()).cases.length,4);
  for(const mutate of [c=>c.cases.push(c.cases[0]),c=>c.members.B=c.members.A,
    c=>c.endEpochMs=String(Number(c.startEpochMs)+1800001),c=>c.sendEnabled=true,
    c=>c.cases[0].member='B',c=>c.cases[0].text='hello']){
    const config=syntheticCreationConfig();mutate(config);
    assert.throws(()=>validateTargetedCreationConfig(config),/YXX_CREATION_CONFIG_INVALID/);
  }
});

test('targeted launcher stops at fifth concurrent frame without queuing further input',async()=>{
 const config=syntheticCreationConfig(),root=mkdtempSync(path.join(tmpdir(),'yxx-launch-'));
 const database='p2_g2_live_0123456789abcdef';
 const file=path.join(root,'config.json');
 writeFileSync(file,JSON.stringify({config,config_sha256:targetedCreationConfigHash(config),candidate_fingerprint:g2CandidateInventory().fingerprint,
  authorization:'PROJECT_OWNER_TARGETED_CREATION_APPROVED',database_name:database,database_oid:'123'}));
 let onFrame,stops=0,ends=0,connections=0;
 const lock={on(){},release(){},async query(sql){
  if(sql.includes('current_database()'))return {rows:[{name:database,oid:'123',owner:true}]};
  if(sql.includes('pg_try_advisory_lock'))return {rows:[{acquired:true}]};
  return {rows:[]};
 }};
 try{
  const launched=await main(['--serve'],{YXX_CREATION_CONFIG:file,YXX_CREATION_APPROVED:'true',WECOM_BOT_ID:'bot-test',
   WECOM_BOT_SECRET:'synthetic-secret',WECOM_WS_URL:'wss://openws.work.weixin.qq.com',
   P2_G2_REPORTER_HMAC_SECRET:'synthetic-only-32-bytes-hmac-secret',PILOT_DATABASE_URL:`postgres://${database}:synthetic@127.0.0.1/${database}`},
   {PoolFactory:()=>({connect:async()=>{connections++;return lock;},query:async()=>({rows:[]}),end:async()=>{ends++;}}),
    GatewayFactory:options=>{onFrame=options.onFrame;return {start:async()=>{},stop:async()=>{stops++;},getStatus:()=>({authenticated:true})};}});
  for(let i=0;i<20;i++)onFrame({});
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(stops,1);assert.equal(ends,1);assert.equal(connections,1);
  await launched.stop('TEST_END');assert.equal(stops,1);
 }finally{
  assert.equal(path.dirname(path.resolve(root)),path.resolve(tmpdir()));
  assert.ok(path.basename(root).startsWith('yxx-launch-'));
  rmSync(root,{recursive:true,force:true});
 }
});
