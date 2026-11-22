import assert from 'node:assert/strict';
import {test} from 'node:test';
import {object} from './helpers/t42-board-browser-fixture.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {createPeopleProfileCache} from '../app/server/src/workbench-people-profile.mjs';
import type {ApplicationMemberVerifier} from '../app/server/src/wecom-application-member.mjs';

interface Fixture {
  backendOrigin:string; origin:string; sessionId:string; cookies:string[];
  pool:PostgresPool; principals:{id:string}[]; outsider:{id:string};
}
const endpoint='/api/workbench/people/profile';
async function client(f:Fixture){
  const cookie=f.cookies[0];assert.ok(cookie);
  const bootstrap=await fetch(f.backendOrigin+'/api/lifecycle/bootstrap',{headers:{cookie}});
  assert.equal(bootstrap.status,200);
  const {csrf_token:csrf}=object(await bootstrap.json());assert.ok(typeof csrf==='string');
  return (body:object,token:string=csrf)=>fetch(f.backendOrigin+endpoint,{
    method:'POST',headers:{cookie,origin:f.origin,'content-type':'application/json','x-csrf-token':token},body:JSON.stringify(body),
  });
}
test('37C D — real session, teammate visibility, ambiguity, projection, write isolation and revocation',async t=>{
  const calls:string[]=[];
  let entered=()=>{},resume=()=>{};
  const started=new Promise<void>(resolve=>{entered=resolve;}),release=new Promise<void>(resolve=>{resume=resolve;});
  const reader:ApplicationMemberVerifier=async openUserId=>{
    calls.push(openUserId);
    if(openUserId==='open-web01-synthetic-3'){entered();await release;}
    return {openUserId,checkedEpochMs:String(Date.now()),displayName:'目录中的新名字（合成）',
      departmentName:openUserId==='open-web01-synthetic-0'?'本人科室（合成）':'同事科室（合成）'};
  };
  await withWeb01Fixture(async(f:Fixture)=>{
    const post=await client(f);
    const [self,peer,other]=f.principals;assert.ok(self&&peer&&other);
    await t.test('same team and self expose exactly name and department',async()=>{
      for(const [name,department] of [['陈悦（合成）','同事科室（合成）'],['林舟（合成）','本人科室（合成）']]){
        const response=await post({display_name:name});
        assert.equal(response.status,200);assert.deepEqual(await response.json(),{name,department});
      }
      assert.deepEqual(calls,['open-web01-synthetic-1','open-web01-synthetic-0']);
      const persisted=await f.pool.query('SELECT display_name FROM pilot_ticket.pilot_principal WHERE id=$1',[peer.id]);
      assert.equal(persisted.rows[0]?.display_name,'陈悦（合成）');
    });
    await t.test('strict input, CSRF and success cache',async()=>{
      assert.equal((await post({display_name:'陈悦（合成）'},'bad')).status,403);
      assert.equal((await post({display_name:'陈悦（合成）',phone:'unexpected'})).status,400);
      assert.equal((await post({display_name:' 陈悦（合成） '})).status,200);
      assert.equal(calls.filter(id=>id==='open-web01-synthetic-1').length,1);
    });
    await t.test('other team, partial name and ambiguous previously cached name are hidden',async()=>{
      const elsewhere='异组处理人（合成）',peerName='陈悦（合成）';
      await f.pool.query('UPDATE pilot_ticket.pilot_principal SET display_name=$1 WHERE id=$2',[elsewhere,f.outsider.id]);
      await f.pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES ('CARD37_OTHER',$1)",[elsewhere]);
      await f.pool.query("INSERT INTO pilot_ticket.pilot_team_member(team_id,principal_id) VALUES ('CARD37_OTHER',$1)",[f.outsider.id]);
      const before=calls.length;
      for(const name of [elsewhere,'陈悦'])assert.equal((await post({display_name:name})).status,404);
      await f.pool.query('UPDATE pilot_ticket.pilot_principal SET display_name=$1 WHERE id=$2',[peerName,other.id]);
      assert.equal((await post({display_name:peerName})).status,404);
      assert.equal(calls.length,before);
    });
    await t.test('a session revoked during the directory read receives no department',{timeout:15000},async t=>{
      const pending=post({display_name:'沈然（合成）'});
      try{
        await Promise.race([started,pending.then(r=>{throw Error('reader not reached, HTTP '+r.status);}),
          new Promise<never>((_,reject)=>t.signal.addEventListener('abort',()=>reject(t.signal.reason),{once:true}))]);
        const update=await f.pool.query("UPDATE pilot_ticket.workbench_auth_session SET state='REVOKED',revoked_epoch_ms=platform.physical_epoch_ms(),revoked_at=platform.local_now() WHERE state='ACTIVE' AND session_id=$1",[f.sessionId]);
        assert.equal(update.rowCount,1);
      }finally{resume();}
      const response=await pending;assert.ok([401,403].includes(response.status));
      assert.doesNotMatch(await response.text(),/department|同事科室/u);
    });
  },{precisionV212:true,realWorkbenchAuthentication:true,profileReader:reader});
});
test('37C D — missing reader returns 503',()=>withWeb01Fixture(async(f:Fixture)=>{
  const post=await client(f),response=await post({display_name:'林舟（合成）'});
  assert.equal(response.status,503);assert.match(await response.text(),/P2_016_DISABLED/u);
},{precisionV212:true,realWorkbenchAuthentication:true}));
test('37C D — successful departments expire at five minutes and cache capacity is bounded',()=>{
  let now=0;
  const cache=createPeopleProfileCache({now:()=>now,maxEntries:2});
  cache.set('a',null);cache.set('b','科室（合成）');cache.set('c',null);
  assert.equal(cache.size(),2);assert.deepEqual(cache.get('a'),{hit:false});
  now=299999;assert.deepEqual(cache.get('b'),{hit:true,department:'科室（合成）'});
  now++;assert.deepEqual(cache.get('b'),{hit:false});
});
