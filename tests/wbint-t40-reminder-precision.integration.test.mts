import test from 'node:test';
import assert from 'node:assert/strict';
import {withT40ReminderRiskFixture,object,text,type T40ReminderRiskFixture} from './helpers/t40-reminder-risk-fixture.mjs';

async function align(f:T40ReminderRiskFixture):Promise<string>{
  // Real database wall clock; no source fact or browser clock is rewritten.
  await f.pool.query('SELECT pg_sleep((1000-platform.physical_epoch_ms()%1000+30)/1000.0)');
  const row=(await f.pool.query<{second:string}>("SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS second")).rows[0];assert.ok(row);return row.second;
}
async function baseline(f:T40ReminderRiskFixture){const r=await f.http.get('/api/workbench/reminders');assert.equal(r.status,200);assert.deepEqual(r.value.items,[]);return r.value;}
async function increment(f:T40ReminderRiskFixture,b:Record<string,unknown>){
  const r=await f.http.get('/api/workbench/reminders?'+new URLSearchParams({after_event_id:text(b.as_of_event_id),baseline_token:text(b.baseline_token)}));assert.equal(r.status,200);assert.equal(r.value.reset_required,false);assert.ok(Array.isArray(r.value.items));return r.value.items.map(object);
}
async function assertOriginalInitialEventPublished(f:T40ReminderRiskFixture,id:string,b:Record<string,unknown>){
  const events=await f.pool.query<{event_id:string}>(`SELECT e.event_id::text FROM conversation.realtime_event e JOIN conversation.session s ON s.id::text=e.aggregate_id
    JOIN pilot_ticket.ticket t ON t.source_intake_id=s.service_intake_id WHERE t.id=$1::uuid AND e.event_type='conversation.session.created'
      AND e.aggregate_type='CONVERSATION_SESSION' AND e.event_id>$2::bigint`,[id,text(b.as_of_event_id)]);
  assert.ok(events.rows.length>0,'the original coordinator must actually publish this Intake initial session after the baseline watermark');
}
test('T40 genuinely new team report in the same business second is a new authorized reminder',async()=>withT40ReminderRiskFixture(async f=>{
  await f.setTeams(['PILOT_IT']);const second=await align(f),b=await baseline(f),id=await f.createTeamReport();
  const when=(await f.pool.query<{second:string}>("SELECT to_char(i.created_at,'YYYY-MM-DD HH24:MI:SS') AS second FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.id=t.source_intake_id WHERE t.id=$1::uuid",[id])).rows[0];assert.equal(when?.second,second,'real source and baseline must exercise the same business second');
  await assertOriginalInitialEventPublished(f,id,b);
  assert.ok((await increment(f,b)).some(x=>x.reason==='AUTHORIZED_TEAM_NEW_REPORT'&&object(x.canonical_item).id===id));
}));
test('T40 real same-second old intake projected after baseline remains history',async()=>withT40ReminderRiskFixture(async f=>{
  await f.setTeams(['PILOT_IT']);const second=await align(f),id=await f.createTeamReport({project:false}),b=await baseline(f);
  await f.publishPendingReports();await assertOriginalInitialEventPublished(f,id,b);
  const when=(await f.pool.query<{second:string}>("SELECT to_char(i.created_at,'YYYY-MM-DD HH24:MI:SS') AS second FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.id=t.source_intake_id WHERE t.id=$1::uuid",[id])).rows[0];assert.equal(when?.second,second);
  assert.equal((await increment(f,b)).some(x=>object(x.canonical_item).id===id),false,'late projection cannot make an original pre-baseline fact new');
}));
test('T40 genuine same-second staff reopen is new only for a currently readable followed Ticket',async()=>withT40ReminderRiskFixture(async f=>{
  const reopen=await f.prepareClosedRelatedTicket(),second=await align(f),b=await baseline(f);await reopen();
  const when=(await f.pool.query<{second:string}>("SELECT to_char(created_at,'YYYY-MM-DD HH24:MI:SS') AS second FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_type='ticket.reopened'",[f.ticketId])).rows[0];assert.equal(when?.second,second);
  assert.ok((await increment(f,b)).some(x=>x.reason==='RELATED_REOPEN'&&object(x.canonical_item).id===f.ticketId));
}));
