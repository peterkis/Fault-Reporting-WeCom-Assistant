import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {object,rows} from './helpers/t41-search-risk-fixture.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';

interface Fixture {pool:PostgresPool;origin:string;backendOrigin?:string;cookies:string[];sessionId?:string;
 tickets:{ticket:{id:string};intake:{intakeId:string}}[]}
function text(value:unknown):string {assert.ok(typeof value==='string');return value;}
function request(f:Fixture,path:string,init:RequestInit={}){
 return fetch((f.backendOrigin??f.origin)+path,{...init,headers:{cookie:f.cookies[0]??'',...init.headers},signal:AbortSignal.timeout(15000)});
}
async function read(f:Fixture,path:string){const response=await request(f,path);assert.equal(response.status,200,await response.clone().text());return object(await response.json());}

test('T41 all/closed/status/number search includes original readable completed and ignored Intakes without changing the board',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  for(const status of ['COMPLETED','IGNORED']){
   const intake=await seedPersistedIntake({pool:f.pool,text:'T41 retained '+status,status});
   const detail=await read(f,'/api/workbench/items/intake/'+intake.intakeId),item=object(detail.item);
   assert.equal(item.kind,'intake');assert.equal(item.status,status);
   for(const column of ['all','closed']){
    const found=await read(f,'/api/workbench/search?column='+column+'&range=all&statuses='+status+'&q='+encodeURIComponent(text(item.number)));
    assert.deepEqual(rows(found.items).map(row=>[row.kind,row.id,row.status]),[['intake',intake.intakeId,status]]);
    assert.equal(found.next_cursor,null);assert.equal(Object.hasOwn(found,'total'),false);
   }
   const board=await read(f,'/api/workbench/board?column=closed&range=all');
   assert.ok(!rows(board.items).some(row=>row.id===intake.intakeId),'search must not change ordinary board membership');
  }
 },{manualProjection:true,workbenchSearchEnabled:true,workbenchManualReviewEnabled:true});
});

for(const invalidation of ['logout','physical-expiry'] as const)test('T41 rechecks the real COOKIE session after an authenticated query wait: '+invalidation,async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  assert.ok(f.sessionId);const bootstrap=await read(f,'/api/lifecycle/bootstrap'),gate=await f.pool.connect();let held=false,pending:Promise<Response>|undefined;
  try{
   if(invalidation==='physical-expiry')await f.pool.query(`UPDATE pilot_ticket.workbench_auth_session SET expires_epoch_ms=platform.physical_epoch_ms()+1000,expires_at=platform.local_from_epoch_ms(platform.physical_epoch_ms()+1000) WHERE session_id=$1::uuid`,[f.sessionId]);
   await gate.query('BEGIN');held=true;await gate.query('LOCK TABLE pilot_ticket.ticket IN ACCESS EXCLUSIVE MODE');
   const blocker=(await gate.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(blocker);
   pending=request(f,'/api/workbench/search?limit=2');void pending.catch(()=>undefined);
   let waiting=false;const bound=performance.now()+1000;
   while(performance.now()<bound){
    if((await f.pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1::integer=ANY(pg_blocking_pids(pid)) AND query LIKE '%WITH cards AS%'`,[blocker])).rowCount){waiting=true;break;}await delay(10);
   }
   assert.equal(waiting,true,'the actual authenticated search must reach its query wait');
   if(invalidation==='logout'){
    const loggedOut=await request(f,'/workbench/logout',{method:'POST',headers:{origin:f.origin,'x-csrf-token':text(bootstrap.csrf_token)}});assert.equal(loggedOut.status,200);
   }else{
    let expired=false;const expiryBound=performance.now()+1300;
    while(performance.now()<expiryBound){
     const value=(await f.pool.query<{expired:boolean}>('SELECT expires_epoch_ms<=platform.physical_epoch_ms() AS expired FROM pilot_ticket.workbench_auth_session WHERE session_id=$1::uuid',[f.sessionId])).rows[0];
     if(value?.expired){expired=true;break;}await delay(10);
    }assert.equal(expired,true);
   }
   await gate.query('COMMIT');held=false;const response=await pending;
   assert.equal(response.status,401,await response.clone().text());const denied=object(await response.json());
   assert.equal(Object.hasOwn(denied,'items'),false);assert.equal(Object.hasOwn(denied,'next_cursor'),false);
  }finally{if(held)await gate.query('ROLLBACK');await pending?.catch(()=>undefined);gate.release();}
 },{realWorkbenchAuthentication:true,workbenchSearchEnabled:true});
});

test('T41 does not return an earlier safe reporter projection after its Journey expires while another card is being read',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const first=f.tickets[0];assert.ok(first);
  const journey=(await f.pool.query<{id:string}>('SELECT id::text FROM intake.contact_journey WHERE origin_intake_id=$1::uuid',[first.intake.intakeId])).rows[0];assert.ok(journey);
  await f.pool.query(`UPDATE intake.contact_journey SET profile_resolution_status='RESOLVED',profile_snapshot=jsonb_build_object('source','WECOM_DIRECTORY','version','T41_TTL','contact',jsonb_build_object('name','T41即将到期姓名'),'memberships','[]'::jsonb) WHERE id=$1::uuid`,[journey.id]);
  const before=await read(f,'/api/workbench/items/ticket/'+first.ticket.id);assert.equal(object(before.item).reporter_name,'T41即将到期姓名');
  let release:()=>void=()=>{},entered:()=>void=()=>{};
  const held=new Promise<void>(resolve=>{release=resolve;}),reached=new Promise<void>(resolve=>{entered=resolve;});
  const original=f.pool.query;let projections=0;
  f.pool.query=new Proxy(original,{apply(target,thisArg,args:unknown[]){
   const sql=typeof args[0]==='string'?args[0]:'';
   if(sql.includes('SELECT * FROM cards WHERE kind=$4 AND id=$5')&&++projections===2){entered();return held.then(()=>Reflect.apply(target,thisArg,args));}
   return Reflect.apply(target,thisArg,args);
  }});
  let pending:Promise<Response>|undefined;
  try{
   pending=request(f,'/api/workbench/search?column=all&q='+encodeURIComponent('全新合成开发材料')+'&limit=2');void pending.catch(()=>undefined);
   await Promise.race([reached,delay(5000).then(()=>assert.fail('the second real card projection was not reached'))]);
   await original.call(f.pool,`UPDATE intake.contact_journey SET retention_until=platform.local_from_epoch_ms(platform.physical_epoch_ms()-1000),retention_until_epoch_ms=platform.physical_epoch_ms()-1000 WHERE id=$1::uuid`,[journey.id]);
   release();const response=await pending;assert.equal(response.status,400,await response.clone().text());
   assert.ok(!(await response.text()).includes('T41即将到期姓名'));
  }finally{release();await pending?.catch(()=>undefined);f.pool.query=original;}
  const after=await read(f,'/api/workbench/items/ticket/'+first.ticket.id);assert.equal(object(after.item).reporter_name,null);
 },{manualProjection:true,workbenchSearchEnabled:true});
});
