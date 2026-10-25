// Registered original T08 contract/defaults tracer; initially NOT_RUN.
// Requires only the two minimal fixture additions in t08-tests-helper-seams.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {withT08Fixture,object,rows,text} from './helpers/t08-fixture.mjs';
import {UNASSIGN_MIGRATION_ID} from '../app/server/scripts/ticket-unassign-migrate.mjs';

const command=(version:number)=>({client_command_id:randomUUID(),expected_version:version,reason_code:'WORKBENCH_UNASSIGN',reason:'T08 隔离默认与迁移验证内部原因',communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]});

test('omitting the production unassign option leaves its consumer and raw recovery false without 046 or an unassign receipt',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),handler=await fixture.http(2),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
  const bootstrap=await admin.get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);
  assert.equal(bootstrap.value.ticket_unassign_enabled,false);assert.equal(bootstrap.value.ticket_unassign_draft_recovery_enabled,false);
  assert.equal(bootstrap.value.ticket_assignment_enabled,false);assert.equal(bootstrap.value.ticket_conversation_self_handling_enabled,false);
  assert.equal((await fixture.pool.query('SELECT 1 FROM platform.schema_migration WHERE migration_id=$1',[UNASSIGN_MIGRATION_ID])).rowCount,0);
  assert.equal((await handler.post(path+'/accept',{client_command_id:randomUUID(),expected_version:1,reason_code:'T08_DEFAULT_REAL_ACCEPT'})).status,200);
  const before=await admin.get(path);assert.equal(before.status,200);assert.equal(before.value.status,'ACCEPTED');assert.equal(before.value.assignee_id,fixture.handler);
  assert.ok(Array.isArray(before.value.allowed_actions));assert.equal(before.value.allowed_actions.includes('unassign'),false);
  const events=(await admin.get(path+'/events?limit=200')).value,delivery=(await admin.get(path+'/deliveries')).value,body=command(2);
  const refused=await admin.post(path+'/unassign',body);assert.equal(refused.status,503);assert.equal(object(refused.value.error).code,'P2_016_DISABLED');
  const ack=await admin.get(path+'/unassign/commands/'+body.client_command_id);assert.equal(ack.status,503);assert.equal(object(ack.value.error).code,'P2_016_DISABLED');
  assert.deepEqual((await admin.get(path)).value,before.value);assert.deepEqual((await admin.get(path+'/events?limit=200')).value,events);assert.deepEqual((await admin.get(path+'/deliveries')).value,delivery);
  // Explicit private no-receipt assertion; the real old accept above is the only ownership command.
  assert.equal((await fixture.pool.query("SELECT 1 FROM pilot_ticket.ticket_command_receipt WHERE ticket_id=$1::uuid AND command_type='WORKBENCH_TICKET_UNASSIGN'",[ticketId])).rowCount,0);
 },{migration:false,omitTicketUnassignOption:true});
});

test('an explicitly enabled consumer without 046 refuses before creating a receipt or changing private Ticket/event facts',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),handler=await fixture.http(2),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
  assert.equal((await admin.get('/api/lifecycle/bootstrap')).value.ticket_unassign_draft_recovery_enabled,false);
  assert.equal((await handler.post(path+'/accept',{client_command_id:randomUUID(),expected_version:1,reason_code:'T08_MISSING_046_REAL_ACCEPT'})).status,200);
  // GET detail is itself fail-closed when enabled without 046. Readback is explicitly private, not a substitute public DTO.
  const before=await fixture.pool.query('SELECT id::text,status,assignee_id::text,resolver_team_id,version FROM pilot_ticket.ticket WHERE id=$1::uuid',[ticketId]);
  assert.equal(before.rowCount,1);assert.equal(before.rows[0]?.status,'ACCEPTED');assert.equal(before.rows[0]?.assignee_id,fixture.handler);assert.equal(before.rows[0]?.version,2);
  const events=(await admin.get(path+'/events?limit=200')).value,delivery=(await admin.get(path+'/deliveries')).value;
  const body=command(2),refused=await admin.post(path+'/unassign',body);assert.equal(refused.status,503);assert.equal(object(refused.value.error).code,'P2_016_UNASSIGN_UNAVAILABLE');
  for(const response of [await admin.get(path),await admin.get(path+'/unassign/commands/'+body.client_command_id)]){
   assert.equal(response.status,503);assert.equal(object(response.value.error).code,'P2_016_UNASSIGN_UNAVAILABLE');
  }
  assert.equal((await fixture.pool.query('SELECT 1 FROM platform.schema_migration WHERE migration_id=$1',[UNASSIGN_MIGRATION_ID])).rowCount,0);
  assert.equal((await fixture.pool.query("SELECT 1 FROM pilot_ticket.ticket_command_receipt WHERE ticket_id=$1::uuid AND command_type='WORKBENCH_TICKET_UNASSIGN'",[ticketId])).rowCount,0);
  assert.deepEqual((await fixture.pool.query('SELECT id::text,status,assignee_id::text,resolver_team_id,version FROM pilot_ticket.ticket WHERE id=$1::uuid',[ticketId])).rows,before.rows);
  assert.deepEqual((await admin.get(path+'/events?limit=200')).value,events);assert.deepEqual((await admin.get(path+'/deliveries')).value,delivery);
 },{migration:false,ticketUnassignEnabled:true});
});

test('the owned 046 forward migration checks PENDING without writing, applies once and keeps its exact checksum and existing facts on NOOP',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
  const before=(await admin.get(path)).value,events=(await admin.get(path+'/events?limit=200')).value,delivery=(await admin.get(path+'/deliveries')).value;
  const sql=await readFile(new URL('../database/migrations/046_ticket_unassign.sql',import.meta.url));
  const checksum=createHash('sha256').update(sql).digest('hex');
  assert.deepEqual(await fixture.migrateUnassign('check'),{status:'PENDING',migration_id:UNASSIGN_MIGRATION_ID});
  assert.equal((await fixture.pool.query('SELECT 1 FROM platform.schema_migration WHERE migration_id=$1',[UNASSIGN_MIGRATION_ID])).rowCount,0);
  const pending=await fixture.pool.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='pilot_ticket.ticket_event'::regclass AND conname='ticket_event_type_check'");
  assert.equal(pending.rowCount,1);assert.equal(text(pending.rows[0]?.definition).includes('ticket.unassigned'),false);
  assert.deepEqual(await fixture.migrateUnassign('apply'),{status:'APPLIED',migration_id:UNASSIGN_MIGRATION_ID});
  const stamp=await fixture.pool.query('SELECT migration_id,checksum_sha256,applied_at::text,applied_epoch_ms::text FROM platform.schema_migration WHERE migration_id=$1',[UNASSIGN_MIGRATION_ID]);
  assert.equal(stamp.rowCount,1);assert.equal(stamp.rows[0]?.checksum_sha256,checksum);
  assert.deepEqual(await fixture.migrateUnassign('apply'),{status:'NOOP_ALREADY_APPLIED',migration_id:UNASSIGN_MIGRATION_ID});
  assert.deepEqual(await fixture.migrateUnassign('check'),{status:'NOOP_ALREADY_APPLIED',migration_id:UNASSIGN_MIGRATION_ID});
  assert.deepEqual((await fixture.pool.query('SELECT migration_id,checksum_sha256,applied_at::text,applied_epoch_ms::text FROM platform.schema_migration WHERE migration_id=$1',[UNASSIGN_MIGRATION_ID])).rows,stamp.rows);
  const installed=await fixture.pool.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='pilot_ticket.ticket_event'::regclass AND conname='ticket_event_type_check'");
  assert.equal(installed.rowCount,1);assert.equal(text(installed.rows[0]?.definition).includes('ticket.unassigned'),true);
  assert.deepEqual((await admin.get(path)).value,before);assert.deepEqual((await admin.get(path+'/events?limit=200')).value,events);assert.deepEqual((await admin.get(path+'/deliveries')).value,delivery);
  assert.equal((await admin.get('/api/lifecycle/bootstrap')).value.ticket_unassign_enabled,false,'applying SQL must not enable the runtime option');
 },{migration:false,ticketUnassignEnabled:false});
});

test('046 rejects private unassign facts that expose an external note or omit the exact release metadata and internal reason',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),handler=await fixture.http(2),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
  assert.equal((await handler.post(path+'/accept',{client_command_id:randomUUID(),expected_version:1,reason_code:'T08_SQL_GUARD_REAL_ACCEPT'})).status,200);
  const body=command(2),withdrawn=await admin.post(path+'/unassign',body);assert.equal(withdrawn.status,200,JSON.stringify(withdrawn.value));
  const eventId=text(withdrawn.value.ticket_event_id),before=(await admin.get(path)).value,history=(await admin.get(path+'/events?limit=200')).value,delivery=(await admin.get(path+'/deliveries')).value;
  // Sole SQL write below is an intentionally invalid private INSERT in an always-rolled-back tx.
  // It never changes ownership, creates a valid business event or establishes a test precondition.
  const metadata={old_assignee_id:fixture.handler,new_assignee_id:null,old_team_id:'PILOT_IT',new_team_id:'PILOT_IT'};
  const faults:[string,unknown,string|null,string|null,string|null,string,string|null][]=[
   ['external-note',metadata,body.reason,'不能外发','ACCEPTED','PILOT_USER',fixture.admin],
   ['missing-internal-reason',metadata,null,null,'ACCEPTED','PILOT_USER',fixture.admin],
   ['blank-internal-reason',metadata,'   ',null,'ACCEPTED','PILOT_USER',fixture.admin],
   ['non-null-new-owner',{...metadata,new_assignee_id:fixture.otherHandler},body.reason,null,'ACCEPTED','PILOT_USER',fixture.admin],
   ['changed-team',{...metadata,new_team_id:'OTHER_SYNTHETIC_TEAM'},body.reason,null,'ACCEPTED','PILOT_USER',fixture.admin],
   ['missing-new-owner',{old_assignee_id:fixture.handler,old_team_id:'PILOT_IT',new_team_id:'PILOT_IT'},body.reason,null,'ACCEPTED','PILOT_USER',fixture.admin],
   ['extra-metadata',{...metadata,external_visible:true},body.reason,null,'ACCEPTED','PILOT_USER',fixture.admin],
   ['started-state',metadata,body.reason,null,'IN_PROGRESS','PILOT_USER',fixture.admin],
   ['missing-old-state',metadata,body.reason,null,null,'PILOT_USER',fixture.admin],
   ['non-human-actor',metadata,body.reason,null,'ACCEPTED','SYSTEM',fixture.admin],
  ];
  const tx=await fixture.pool.connect();
  try{for(const [name,assignment,note,external,oldStatus,operatorType,operatorId] of faults){
   await tx.query('BEGIN');
   try{
    await assert.rejects(tx.query(`INSERT INTO pilot_ticket.ticket_event(event_id,ticket_id,event_type,old_status,new_status,aggregate_version,event_ordinal,
     operator_type,operator_id,internal_note,external_note,reason_code,attachment_ids,trace_id,created_at,assignment_metadata)
     SELECT $1::uuid,ticket_id,event_type,$2::text,new_status,aggregate_version+1,event_ordinal+1,
      $3::text,$4::text,$5::text,$6::text,reason_code,attachment_ids,$7::text,created_at,$8::jsonb
     FROM pilot_ticket.ticket_event WHERE event_id=$9::uuid AND ticket_id=$10::uuid`,
     [randomUUID(),oldStatus,operatorType,operatorId,note,external,'t08-private-constraint-'+name,JSON.stringify(assignment),eventId,ticketId]),
     {code:'23514',constraint:'p2016_assignment_metadata_check'},name);
   }finally{await tx.query('ROLLBACK');}
  }}finally{tx.release();}
  const fact=await fixture.pool.query('SELECT internal_note,external_note,assignment_metadata FROM pilot_ticket.ticket_event WHERE event_id=$1::uuid AND ticket_id=$2::uuid',[eventId,ticketId]);
  assert.equal(fact.rowCount,1);assert.equal(fact.rows[0]?.internal_note,body.reason);assert.equal(fact.rows[0]?.external_note,null);assert.deepEqual(fact.rows[0]?.assignment_metadata,metadata);
  assert.equal(rows(history.items).filter(row=>row.event_type==='ticket.unassigned').length,1);
  assert.deepEqual((await admin.get(path)).value,before);assert.deepEqual((await admin.get(path+'/events?limit=200')).value,history);assert.deepEqual((await admin.get(path+'/deliveries')).value,delivery);
 });
});
