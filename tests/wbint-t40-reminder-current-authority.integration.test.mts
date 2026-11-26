import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import type {T40ReminderRiskFixture} from './helpers/t40-reminder-risk-fixture.mjs';
import {withT40ReminderRiskFixture,object,text} from './helpers/t40-reminder-risk-fixture.mjs';
import type {PostgresPoolClient,PostgresQuery} from '../app/server/src/platform/postgres-pool.mjs';

const increment=(baseline:Record<string,unknown>)=>'/api/workbench/reminders?'+new URLSearchParams({after_event_id:text(baseline.as_of_event_id),baseline_token:text(baseline.baseline_token)});
async function atRealTicketTableWait(f:T40ReminderRiskFixture,path:string,whileBlocked:()=>Promise<void>){
  const gate=await f.pool.connect();let held=false,pending:ReturnType<typeof f.http.get>|undefined;
  try{
    await gate.query('BEGIN');held=true;await gate.query('LOCK TABLE pilot_ticket.ticket IN ACCESS EXCLUSIVE MODE');
    const pid=(await gate.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(pid);
    pending=f.http.get(path);void pending.catch(()=>undefined);let blocked=false;const until=performance.now()+5000;
    do{
      const waiting=await f.pool.query<{query:string}>(`SELECT query FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND $1::integer=ANY(pg_blocking_pids(pid)) AND (query LIKE '%WITH cards AS (%' OR query LIKE 'WITH window_events AS MATERIALIZED (%')`,[pid]);
      if(waiting.rowCount===1){blocked=true;break;}await delay(10);
    }while(performance.now()<until);
    assert.equal(blocked,true,'actual public reminder read has resolved its original principal and is waiting on its canonical Ticket table');
    await whileBlocked();await gate.query('COMMIT');held=false;return await pending;
  }finally{if(held)await gate.query('ROLLBACK');await pending?.catch(()=>undefined);gate.release();}
}

test('T40 a genuine READ team withdrawal during its original table wait resets the stale reminder window',{timeout:240_000},()=>withT40ReminderRiskFixture(async f=>{
  await f.setTeams(['PILOT_IT']);const baseline=await f.http.get('/api/workbench/reminders');assert.equal(baseline.status,200);
  const target=await f.createTeamReport(),path=increment(baseline.value),before=await f.http.get(path);assert.equal(before.status,200);
  assert.ok(Array.isArray(before.value.items)&&before.value.items.map(object).some(row=>object(row.canonical_item).id===target));
  const response=await atRealTicketTableWait(f,path,()=>f.setTeams([]));assert.equal(response.status,200);
  assert.deepEqual(response.value.items,[]);assert.equal(response.value.reset_required,true);
  assert.equal((await f.http.get('/api/workbench/items/ticket/'+target)).status,404);
  assert.equal((await f.http.get('/api/workbench/items/ticket/'+f.ticketId)).status,200,'the assignee still has lawful original READ elsewhere');
}));
test('T40 removing the only staff role during its original reminder table wait returns no old canonical item',{timeout:240_000},()=>withT40ReminderRiskFixture(async f=>{
  const baseline=await f.http.get('/api/workbench/reminders');assert.equal(baseline.status,200);
  assert.deepEqual(await f.runtime.runFollowUpDueBatch({limit:20}),{scanned:1,emitted:1,skipped:0});
  const response=await atRealTicketTableWait(f,increment(baseline.value),()=>f.removeStaffRole());
  assert.ok([401,403].includes(response.status));assert.doesNotMatch(JSON.stringify(response.value),/canonical_item|reminder_id|source_key/u);
  assert.equal((await f.http.get('/api/workbench/items/ticket/'+f.ticketId)).status,401);
}));

test('T40 a team granted immediately before the final facts statement requires a new reminder baseline',{timeout:240_000},()=>withT40ReminderRiskFixture(async f=>{
  await f.pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES ('R15_A','旧提醒范围（合成）')");
  const both=['R15_A','PILOT_IT'];
  await f.setTeams(both);const control=await f.http.get('/api/workbench/reminders');assert.equal(control.status,200);
  await f.setTeams(['R15_A']);const baseline=await f.http.get('/api/workbench/reminders');assert.equal(baseline.status,200);
  const target=await f.createTeamReport(),old=increment(baseline.value);
  assert.equal((await f.http.get('/api/workbench/items/ticket/'+target)).status,404);
  const queries=new Map<PostgresPoolClient,PostgresQuery>();let factsReads=0;
  const observe=(client:PostgresPoolClient)=>{
    if(queries.has(client))return;const query=client.query;queries.set(client,query);
    client.query=new Proxy(query,{apply(fn,owner,args){
      if(typeof args[0]==='string'&&args[0].includes('window_events AS MATERIALIZED (')&&++factsReads===2)
        return f.setTeams(both).then(()=>Reflect.apply(fn,owner,args));
      return Reflect.apply(fn,owner,args);
    }});
  };
  f.pool.on('acquire',observe);
  try{
    const response=await f.http.get(old);assert.equal(factsReads,2);assert.equal(response.status,200);
    assert.equal(response.value.reset_required,true);assert.deepEqual(response.value.items,[]);assert.equal(response.value.next_cursor,null);
    assert.notEqual(response.value.baseline_token,baseline.value.baseline_token);
    const fresh=await f.http.get(increment(response.value));assert.equal(fresh.status,200);assert.equal(fresh.value.reset_required,false);assert.deepEqual(fresh.value.items,[]);
  }finally{f.pool.off('acquire',observe);for(const [client,query] of queries)client.query=query;}
  const allowed=await f.http.get(increment(control.value));assert.equal(allowed.status,200);assert.equal(allowed.value.reset_required,false);
  assert.ok(Array.isArray(allowed.value.items)&&allowed.value.items.map(object).some(row=>row.reason==='AUTHORIZED_TEAM_NEW_REPORT'&&object(row.canonical_item).id===target));
}));
test('T40 official current Cookie logout during the original reminder table wait fences the old response',{timeout:240_000},()=>withT40ReminderRiskFixture(async f=>{
  const baseline=await f.http.get('/api/workbench/reminders');assert.equal(baseline.status,200);
  assert.deepEqual(await f.runtime.runFollowUpDueBatch({limit:20}),{scanned:1,emitted:1,skipped:0});
  const response=await atRealTicketTableWait(f,increment(baseline.value),()=>f.logout());assert.equal(response.status,401);
  assert.doesNotMatch(JSON.stringify(response.value),/canonical_item|reminder_id|source_key/u);
  assert.equal((await f.http.get('/api/workbench/items/ticket/'+f.ticketId)).status,401);
},{realSession:true}));
test('T40 a retained Bot item and realtime event physically expire during a real reminder table wait',{timeout:240_000},()=>withT40ReminderRiskFixture(async f=>{
  const baseline=await f.http.get('/api/workbench/reminders');assert.equal(baseline.status,200);
  const source=await f.appendLaterPrimary(),path=increment(baseline.value),before=await f.http.get(path);assert.equal(before.status,200);
  assert.ok(Array.isArray(before.value.items)&&before.value.items.length>0);
  const id=source.sourceRef.slice('channel:'.length);
  const deadline=(await f.pool.query<{epoch:string}>(`SELECT (platform.physical_epoch_ms()+2000)::text AS epoch`)).rows[0]?.epoch;assert.ok(deadline);
  await f.pool.query(`UPDATE conversation.item SET retention_until=platform.local_from_epoch_ms($2::bigint),retention_until_epoch_ms=$2::bigint WHERE source_type='CHANNEL_MESSAGE' AND source_id=$1`,[id,deadline]);
  await f.pool.query(`UPDATE conversation.realtime_event SET expires_at=platform.local_from_epoch_ms($2::bigint),expires_epoch_ms=$2::bigint
    WHERE source_type='CONVERSATION_ITEM' AND source_id IN (SELECT id::text FROM conversation.item WHERE source_type='CHANNEL_MESSAGE' AND source_id=$1)`,[id,deadline]);
  const response=await atRealTicketTableWait(f,path,async()=>{
    while(BigInt(text((await f.pool.query<{epoch:string}>(`SELECT platform.physical_epoch_ms()::text AS epoch`)).rows[0]?.epoch))<=BigInt(deadline))await delay(20);
  });assert.equal(response.status,200);assert.deepEqual(response.value.items,[],'transaction start time cannot retain physically expired material or its event');
}));
