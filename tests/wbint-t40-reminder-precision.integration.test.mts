import test from 'node:test';
import assert from 'node:assert/strict';
import {withT40ReminderRiskFixture,object,text,type T40ReminderRiskFixture} from './helpers/t40-reminder-risk-fixture.mjs';
import type {PostgresPoolClient,PostgresQuery} from '../app/server/src/platform/postgres-pool.mjs';

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
  const events=await f.pool.query<{event_id:string}>(`SELECT e.event_id::text FROM pilot_ticket.ticket t
    JOIN intake.service_intake i ON i.id=t.source_intake_id JOIN conversation.session s ON s.service_intake_id=i.id
    JOIN conversation.item ci ON ci.session_id=s.id AND ci.source_type='CHANNEL_MESSAGE' AND ci.source_id=i.primary_message_id::text AND ci.item_type='USER_MESSAGE'
    JOIN conversation.realtime_event e ON e.source_id=ci.id::text AND e.aggregate_id=ci.id::text
    WHERE t.id=$1::uuid AND e.publisher_name='CONVERSATION_TIMELINE_PROJECTOR' AND e.source_type='CONVERSATION_ITEM'
      AND e.event_type='conversation.item.created' AND e.aggregate_type='CONVERSATION_ITEM'
      AND e.authorization_scope_type='SESSION' AND e.authorization_scope_id=s.id AND e.event_id>$2::bigint`,[id,text(b.as_of_event_id)]);
  assert.ok(events.rows.length>0,'the original coordinator must actually publish this Intake original primary item after the baseline watermark');
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

test('T40 finite new-report publication cannot advance the live cursor before its original Core Ticket exists',async()=>withT40ReminderRiskFixture(async f=>{
  await f.setTeams(['PILOT_IT']);const b=await baseline(f),originals=new Map<PostgresPoolClient,PostgresQuery>();
  let release=()=>{},held=false,pending:Promise<string>|undefined;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const observe=(client:PostgresPoolClient)=>{
    if(originals.has(client))return;const query=client.query;originals.set(client,query);
    client.query=new Proxy(query,{apply(target,receiver,args:unknown[]){
      if(!held&&typeof args[0]==='string'&&/INSERT\s+INTO\s+pilot_ticket\.ticket\s*\(/iu.test(args[0])){
        held=true;return gate.then(()=>Reflect.apply(target,receiver,args));
      }
      return Reflect.apply(target,receiver,args);
    }});
  };
  f.pool.on('acquire',observe);
  try{
    pending=f.createTeamReport();void pending.catch(()=>{});
    const until=performance.now()+10000;while(!held&&performance.now()<until)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(held,true,'the actual original Core INSERT must be held before execution');
    const during=await f.http.get('/api/workbench/reminders?'+new URLSearchParams({after_event_id:text(b.as_of_event_id),baseline_token:text(b.baseline_token)}));
    assert.equal(during.status,200);assert.deepEqual(during.value.items,[]);
    assert.equal(during.value.as_of_event_id,b.as_of_event_id,'the fixture must not publish a new material before its authorized canonical card exists');
    release();const id=await pending;
    const observed=await increment(f,{...b,as_of_event_id:during.value.as_of_event_id});
    assert.ok(observed.some(value=>object(value.canonical_item).id===id),'the original first event remains in the same live window after Core commit');
  }finally{release();await pending?.catch(()=>{});f.pool.removeListener('acquire',observe);for(const [client,query]of originals)client.query=query;}
}));
