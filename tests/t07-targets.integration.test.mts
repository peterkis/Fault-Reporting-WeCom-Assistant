import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
test('takeover targets independently expose only the current visible worker own active teams and validate explicit choice without granting notification access',async()=>{
 await withWeb01Fixture(async(f:{pool:PostgresPool;origin:string;cookies:string[];tickets:{ticket:{id:string}}[];principals:{id:string}[]})=>{
  const ticket=f.tickets[3],actor=f.principals[1],cookie=f.cookies[2],outsider=f.cookies[1];assert.ok(ticket&&actor&&cookie&&outsider);
  await f.pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name,is_active) VALUES('T07_NETWORK','合成网络组',true),('T07_FOREIGN','无本人关联组',true),('T07_INACTIVE','已停用合成组',false)");
  const principal=await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-1',displayName:'陈悦',roles:['HANDLER'],resolverTeamIds:['PILOT_IT','T07_NETWORK','T07_INACTIVE']});assert.equal(principal.id,actor.id);
  const path='/api/tickets/'+ticket.ticket.id,get=async(suffix:string,auth=cookie)=>{const r=await fetch(f.origin+path+suffix,{headers:{cookie:auth}});return {status:r.status,value:object(await r.json())};};
  assert.equal((await get('')).status,200);const deliveryBefore=await get('/deliveries');assert.equal(deliveryBefore.status,200);
  const targets=await get('/takeover-targets');assert.equal(targets.status,200,JSON.stringify(targets.value));await assertP2016Schema('p2_016_takeover_targets',targets.value);
  assert.deepEqual(targets.value.resolver_teams,[{team_id:'PILOT_IT',display_name:'Pilot 信息保障组'},{team_id:'T07_NETWORK',display_name:'合成网络组'}]);assert.equal(targets.value.resolver_team_id,null);assert.deepEqual(targets.value.allowed_actions,['takeover']);
  const selected=await get('/takeover-targets?resolver_team_id=T07_NETWORK');assert.equal(selected.status,200);assert.equal(selected.value.resolver_team_id,'T07_NETWORK');
  assert.equal((await get('/takeover-targets?resolver_team_id=T07_FOREIGN')).status,403);assert.equal((await get('/takeover-targets?resolver_team_id=T07_INACTIVE')).status,403);assert.equal((await get('/takeover-targets?target_principal_id='+actor.id)).status,400);
  assert.equal((await get('/takeover-targets',outsider)).status,404);assert.deepEqual(await get('/deliveries'),deliveryBefore,'querying targets adds no notification authority or facts');
  const bootstrap=object(await (await fetch(f.origin+'/api/lifecycle/bootstrap',{headers:{cookie}})).json()),noticeCommand={client_command_id:randomUUID(),reason_code:'OPERATOR_VERIFIED',resolution:'CANCEL'};
  const reconciliation=await fetch(f.origin+path+'/deliveries/'+randomUUID()+'/reconcile',{method:'POST',headers:{cookie,origin:f.origin,'content-type':'application/json','x-csrf-token':String(bootstrap.csrf_token),'idempotency-key':noticeCommand.client_command_id},body:JSON.stringify(noticeCommand)});assert.equal(reconciliation.status,403);assert.equal(object(object(await reconciliation.json()).error).code,'WORKBENCH_EXTERNAL_SEND_DISABLED');
 },{ticketTakeoverEnabled:true,ticketSelfHandlingWebSource:false});
});
