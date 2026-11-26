import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {createP2016TicketQuery} from '../app/server/src/p2-016-ticket-query.mjs';
import {createWorkbenchReminders} from '../app/server/src/workbench-reminders.mjs';
import {migrateWorkbenchFollowUpSchedules} from '../app/server/scripts/workbench-follow-up-schedules-migrate.mjs';
import {migrateWorkbenchFollowUpDueSignals} from '../app/server/scripts/workbench-follow-up-due-migrate.mjs';
import type {WorkbenchReminderPage} from '../contracts/workbench_reminder_contracts.js';
import {createWorkbenchReminders as createLegacyReminders} from './fixtures/card42a-legacy/workbench-reminders.mjs';
import {spyPool} from './helpers/card42a-sql-observer.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';

interface Fixture {pool:PostgresPool;databaseUrl:string;origin:string;cookies:string[];outsider:{id:string}}

async function submitReport({origin,cookies}:Fixture){
  const cookie=cookies[0];assert.ok(cookie);
  const bootstrap=await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie}});
  assert.equal(bootstrap.status,200);
  const auth:unknown=await bootstrap.json();
  assert.ok(auth&&typeof auth==='object'&&'csrf_token' in auth&&typeof auth.csrf_token==='string');
  const command={schema_version:1,client_command_id:randomUUID(),source:'PHONE',description:'新报修：打印机打印不了（合成）',
    location:{text:null,unknown:true},reporter:{verification:'UNVERIFIED',name:'合成报修人',contact:'合成内线',department:null}};
  const response=await fetch(origin+'/api/workbench/reports',{method:'POST',headers:{cookie,origin,'content-type':'application/json',
    'x-csrf-token':auth.csrf_token,'idempotency-key':command.client_command_id},body:JSON.stringify(command)});
  assert.equal(response.status,202,await response.clone().text());
  const result:unknown=await response.json();
  assert.ok(result&&typeof result==='object'&&'ticket' in result&&result.ticket&&typeof result.ticket==='object'&&'id' in result.ticket&&typeof result.ticket.id==='string');
  return result.ticket.id;
}

test('42A team B granted between the final principal check and reminder facts resets the team A baseline',async()=>{
  await withWeb01Fixture(async(f:Fixture)=>{
    assert.match(new URL(f.databaseUrl).pathname,/^\/ticket_card42a_web01_/u);
    await migrateWorkbenchFollowUpSchedules({databaseUrl:f.databaseUrl,mode:'apply'});
    await migrateWorkbenchFollowUpDueSignals({databaseUrl:f.databaseUrl,mode:'apply'});
    const handler=f.outsider.id;
    await f.pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES ('R16_A','A 组（合成）')");
    await f.pool.query("INSERT INTO pilot_ticket.pilot_team_member(principal_id,team_id) VALUES ($1,'R16_A'),($1,'PILOT_IT')",[handler]);
    const revokeB=async()=>assert.equal((await f.pool.query("DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1 AND team_id='PILOT_IT'",[handler])).rowCount,1);
    let armed=false,factsReads=0,principalRechecked=false;
    const observed=spyPool(f.pool,sql=>{
      if(!armed)return;
      if(factsReads===1&&sql.includes('FROM pilot_ticket.pilot_principal AS p'))principalRechecked=true;
      if(!sql.includes("'AUTHORIZED_TEAM_NEW_REPORT'::text AS reason")||++factsReads!==2)return;
      assert.ok(principalRechecked,'the second facts statement must follow the current principal lookup');
      // The reminder transaction holds its own client. Wait for this independent
      // autocommit before forwarding the untouched facts SQL to PostgreSQL.
      return f.pool.query("INSERT INTO pilot_ticket.pilot_team_member(principal_id,team_id) VALUES ($1,'PILOT_IT')",[handler])
        .then(result=>{assert.equal(result.rowCount,1);});
    });
    const options={pool:observed.pool,query:createP2016TicketQuery({pool:observed.pool,enabled:true}),enabled:true};
    const current=createWorkbenchReminders(options),legacy=createLegacyReminders(options);
    const authContext={principal_id:handler,expires_epoch_ms:String(Date.now()+3_600_000)};
    const read=(reader:typeof current,baseline?:WorkbenchReminderPage)=>reader.page({authContext,parameters:
      baseline?new URLSearchParams({after_event_id:baseline.as_of_event_id,baseline_token:baseline.baseline_token}):new URLSearchParams()});
    const readDuringGrant=async(reader:typeof current,baseline:WorkbenchReminderPage)=>{
      armed=true;factsReads=0;principalRechecked=false;
      try{const page=await read(reader,baseline);assert.equal(factsReads,2);return page;}finally{armed=false;}
    };
    const broad=await read(current),legacyBroad=await read(legacy);
    await revokeB();
    const narrow=await read(current),legacyNarrow=await read(legacy);
    const ticket=await submitReport(f);
    const stored=await f.pool.query('SELECT id FROM pilot_ticket.ticket WHERE id=$1 AND resolver_team_id=$2 AND assignee_id IS NULL',[ticket,'PILOT_IT']);
    assert.equal(stored.rowCount,1,'only team B grants this handler READ of the reported Ticket');

    const reset=await readDuringGrant(current,narrow);
    assert.deepEqual(reset.items,[]);assert.equal(reset.next_cursor,null);assert.equal(reset.reset_required,true);
    assert.notEqual(reset.baseline_token,narrow.baseline_token);
    const resumed=await read(current,reset);assert.equal(resumed.reset_required,false);assert.deepEqual(resumed.items,[]);assert.equal(resumed.next_cursor,null);

    // Both broad tokens predate this report. No source rows or watermarks are mocked.
    const control=await read(current,broad),legacyControl=await read(legacy,legacyBroad);
    assert.equal(control.reset_required,false);assert.equal(legacyControl.reset_required,false);
    assert.ok(control.items.some(item=>item.reason==='AUTHORIZED_TEAM_NEW_REPORT'&&item.canonical_item.kind==='ticket'&&item.canonical_item.id===ticket));
    assert.deepEqual(legacyControl.items,control.items);
    await revokeB();
    const legacyRace=await readDuringGrant(legacy,legacyNarrow);
    assert.deepEqual(legacyRace.items,[]);assert.equal(legacyRace.next_cursor,null);
  },{namespace:'ticket_card42a',manualProjection:true,workbenchManualReportsEnabled:true,workbenchRealtimeEnabled:true});
});
