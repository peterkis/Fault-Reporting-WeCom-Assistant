import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';

test('detail report time comes from the original chat or initial H5 submission, not Ticket creation or later activity',async()=>{
  await withT24Fixture(async f=>{
    const http=await t11Http(f),web=f.tickets[0];assert.ok(web);
    const read=async(id:string)=>{const response=await http.get('/api/workbench/items/ticket/'+id);assert.equal(response.status,200);return await response.json() as {reported_at:string|null;item:{created_at:string;updated_at:string};records:unknown[]};};
    const botTime=(await f.pool.query<{at:string}>("SELECT to_char(m.received_at,'YYYY-MM-DD HH24:MI:SS') AS at FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.id=t.source_intake_id JOIN channel.message_inbox m ON m.id=i.primary_message_id WHERE t.id=$1::uuid",[f.ticketId])).rows[0]?.at;assert.ok(botTime);
    const webTime=(await f.pool.query<{at:string}>("SELECT to_char(s.received_at,'YYYY-MM-DD HH24:MI:SS') AS at FROM pilot_ticket.ticket t JOIN intake.web_submission s ON s.intake_id=t.source_intake_id AND s.kind='SUBMIT' WHERE t.id=$1::uuid ORDER BY s.input_revision LIMIT 1",[web.ticket.id])).rows[0]?.at;assert.ok(webTime);
    await f.pool.query("UPDATE pilot_ticket.ticket SET created_at=platform.local_now()+interval '1 hour',updated_at=platform.local_now()+interval '1 hour' WHERE id=ANY($1::uuid[])",[[f.ticketId,web.ticket.id]]);
    const bot=await read(f.ticketId),initial=await read(web.ticket.id);
    assert.equal(bot.reported_at,botTime);assert.equal(initial.reported_at,webTime);assert.ok(botTime<bot.item.created_at);assert.ok(webTime<initial.item.created_at);
    await f.pool.query("UPDATE pilot_ticket.ticket SET updated_at=created_at+interval '10 minutes' WHERE id=$1::uuid",[web.ticket.id]);
    assert.equal((await read(web.ticket.id)).reported_at,webTime);
    const small=await http.get('/api/workbench/items/ticket/'+web.ticket.id+'?limit=1');assert.equal(small.status,200);assert.equal((await small.json() as {reported_at:string|null}).reported_at,webTime);
    await f.pool.query("WITH clock AS MATERIALIZED (SELECT platform.physical_epoch_ms() AS epoch) UPDATE channel.message_inbox SET received_at=platform.local_from_epoch_ms(clock.epoch-60000),received_epoch_ms=clock.epoch-60000,retention_until=platform.local_from_epoch_ms(clock.epoch-1000),retention_until_epoch_ms=clock.epoch-1000 FROM clock WHERE id=(SELECT i.primary_message_id FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.id=t.source_intake_id WHERE t.id=$1::uuid)",[f.ticketId]);
    assert.equal((await read(f.ticketId)).reported_at,null,'expired original content does not get a fabricated Ticket-time fallback');
    await f.pool.query('UPDATE intake.web_request_binding SET revoked_at=platform.local_now() WHERE intake_id=$1::uuid',[web.intake.intakeId]);
    assert.equal((await read(web.ticket.id)).reported_at,null);
  });
});

test('detail and delivery reads recheck current READ after their final database wait',async()=>{
  await withT24Fixture(async f=>{
    const principal=f.principals[0];assert.ok(principal);const http=await t11Http(f),original=f.pool.query;
    let target:'time'|'delivery'|null='time',hits=0;
    f.pool.query=new Proxy(original,{apply(fn,thisArg,args:unknown[]){
      const value:unknown=Reflect.apply(fn,thisArg,args),sql=typeof args[0]==='string'?args[0]:'';
      if(target==='time'&&sql.includes("CASE WHEN i.source_provider='STAFF_MANUAL_REPORT'")||target==='delivery'&&sql.includes('FROM communication.ticket_notification_binding b')){
        target=null;hits++;return Promise.resolve(value).then(async rows=>{await f.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[principal.id]);return rows;});
      }
      return value;
    }});
    try{
      const detail=await http.get('/api/workbench/items/ticket/'+f.ticketId);assert.ok([401,403,404].includes(detail.status));await detail.arrayBuffer();assert.equal(hits,1);
      await f.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=true WHERE id=$1::uuid',[principal.id]);target='delivery';
      const deliveries=await http.get('/api/tickets/'+f.ticketId+'/deliveries');assert.ok([401,403,404].includes(deliveries.status));await deliveries.arrayBuffer();assert.equal(hits,2);
    }finally{f.pool.query=original;}
  });
});
