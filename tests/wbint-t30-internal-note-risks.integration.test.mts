import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {t30Http,record,text} from './helpers/t30-internal-note-fixture.mjs';
import {createP2012ReporterTimelineAdapter} from '../src/p2-012-reporter-timeline-adapter.mjs';
const input=(version:string,note='合成内部检查')=>({client_command_id:randomUUID(),expected_row_version:version,reason_code:'WORKBENCH_INTERNAL_DISPOSITION',audience:'INTERNAL',text:note});
test('T30 real HTTP enforces exact input, current purpose, stable private pages, concurrency and original-ledger recovery without outward effects',async()=>{
  await t30Http({purpose:'t30risk'},async({pool,f,confirm,get,post})=>{
    const incident=await confirm(),path='/api/incidents/'+incident,notes=path+'/internal-notes';
    const outward=await pool.query(`SELECT (SELECT count(*) FROM communication.incident_notification_binding)::text AS bindings,(SELECT count(*) FROM communication.outbox)::text AS outbox,(SELECT count(*) FROM communication.delivery)::text AS deliveries,(SELECT count(*) FROM conversation.realtime_event)::text AS sse`);
    const reporter=createP2012ReporterTimelineAdapter({pool,enabled:true}),ticketId=text(record(f.reports[0]).ticketId),milestones=await reporter.milestones({ticketId}),personal=(await get('/api/tickets/'+ticketId)).body,events=(await get(path+'/events')).body;
    for(const changes of [{text:''},{text:' \n\t'},{text:'x\u0001'},{text:'x'.repeat(2001)},{text:'x\ud800'},{audience:'GROUP'},{actor_principal_id:text(record(f.admin).id)},{expected_row_version:'9223372036854775808'},{expected_row_version:1}]){const response=await post(notes,{...input('1'),...changes});assert.ok([400,409].includes(response.status),JSON.stringify(response.body));assert.equal(JSON.stringify(response.body).includes('x'.repeat(20)),false);}
    assert.equal((await post(notes,input('1'),0,{'if-match':'W/"1"'})).status,409);assert.equal((await post(notes,input('1'),0,{'idempotency-key':randomUUID()})).status,400);
    assert.equal((await post(notes,input('1'),0,{'origin':'http://outside.invalid'})).status,403);assert.equal((await post(notes,input('1'),0,{'x-csrf-token':'invalid'})).status,403);
    assert.equal((await get(notes+'?limit=101')).status,400);assert.equal((await get(notes+'?limit=1&limit=2')).status,400);assert.equal((await get(notes+'?state=ACTIVE')).status,400);
    for(const actor of [2,3]){assert.ok([403,404].includes((await get(notes,actor)).status));assert.ok([403,404].includes((await post(notes,input('1'),actor)).status));}
    const command=input('1','私有并发正文：不能进入 Reporter、通知或 SSE'),same=await Promise.all([post(notes,command),post(notes,command),post(notes,command)]);assert.ok(same.every(r=>r.status===200));assert.equal(same.filter(r=>r.body.replayed===false).length,1);assert.ok(same.every(r=>r.body.result_event_id===same[0]?.body.result_event_id));
    assert.equal((await post(notes,{...command,text:'不同正文'})).status,409);
    const receipt=(await get(path+'/commands/'+command.client_command_id)).body;assert.equal(receipt.state,'COMMITTED');assert.equal(JSON.stringify(receipt).includes(command.text),false);
    const a=input('2','第二条'),b=input('2','竞争不应保存'),race=await Promise.all([post(notes,a),post(notes,b)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
    const first=(await get(notes+'?limit=1')).body;assert.ok(Array.isArray(first.items));assert.equal(first.items.length,1);assert.equal(record(first.items[0]).incident_row_version,'2');const cursor=text(first.next_cursor),second=(await get(notes+'?limit=1&cursor='+encodeURIComponent(cursor))).body;assert.ok(Array.isArray(second.items));assert.equal(second.items.length,1);assert.equal(second.next_cursor,null);assert.equal(record(second.items[0]).incident_row_version,'3');assert.equal((await get(notes+'?cursor='+encodeURIComponent(cursor),1)).status,400);
    assert.deepEqual((await get(path+'/events')).body,events);assert.deepEqual(await reporter.milestones({ticketId}),milestones);assert.deepEqual((await get('/api/tickets/'+ticketId)).body,personal);assert.equal((await get(notes,1)).status,200);assert.equal((await post(path+'/correct-scope',{client_command_id:randomUUID(),expected_row_version:'3',reason_code:'SCOPE_CORRECTION',confirmed_scope:'CAMPUS'})).status,200);
    assert.equal((await get(notes,1)).status,403);assert.equal((await post(notes,input('4'),1)).status,403);assert.equal((await get(notes+'?cursor='+encodeURIComponent(cursor))).status,400);
    await pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='ADMIN'",[text(record(f.admin).id)]);await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'DISPATCHER')",[text(record(f.admin).id)]);
    assert.equal((await get(path+'/commands/'+command.client_command_id)).status,403);assert.equal((await post(notes,command)).status,403);
    await pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='DISPATCHER'",[text(record(f.admin).id)]);await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'ADMIN')",[text(record(f.admin).id)]);
    assert.equal((await post(notes,command)).body.replayed,true);
    const after=await pool.query(`SELECT (SELECT count(*) FROM communication.incident_notification_binding)::text AS bindings,(SELECT count(*) FROM communication.outbox)::text AS outbox,(SELECT count(*) FROM communication.delivery)::text AS deliveries,(SELECT count(*) FROM conversation.realtime_event)::text AS sse`);
    // The explicit scope command legitimately produces its existing safe SSE;
    // no internal-note event or body is projected into that stream.
    assert.deepEqual({bindings:after.rows[0]?.bindings,outbox:after.rows[0]?.outbox,deliveries:after.rows[0]?.deliveries},{bindings:outward.rows[0]?.bindings,outbox:outward.rows[0]?.outbox,deliveries:outward.rows[0]?.deliveries});
    assert.equal((await pool.query('SELECT 1 FROM conversation.realtime_event WHERE payload::text LIKE $1',['%私有并发正文%'])).rowCount,0);assert.equal((await pool.query("SELECT 1 FROM incident.incident_event WHERE event_type='incident.internal_note_added' AND safe_payload<>'{}'::jsonb")).rowCount,0);
  });
});
test('T30 disabled host mounts no private purpose on the unchanged 032 schema',async()=>{
  await t30Http({purpose:'t30off',notes:false,ddl:false},async({confirm,get,post,pool})=>{const incident=await confirm(),path='/api/incidents/'+incident+'/internal-notes';assert.equal((await get(path)).status,404);assert.equal((await post(path,input('1'))).status,404);assert.equal((await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema='incident' AND table_name='incident_event' AND column_name='internal_note_text'")).rowCount,0);});
});
