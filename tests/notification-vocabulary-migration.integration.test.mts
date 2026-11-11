import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withP2016IsolatedDatabase,applyThrough030} from './helpers/p2-016-postgres-harness.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {migrateP2016} from '../app/server/scripts/p2-016-migrate.mjs';
import {migrateServiceClosure} from '../app/server/scripts/service-closure-migrate.mjs';
import {migrateCompletionDismissal} from '../app/server/scripts/completion-dismissal-migrate.mjs';
import {migrateNotificationVocabulary,applyNotificationVocabularySql} from '../app/server/scripts/notification-vocabulary-migrate.mjs';
import {createPilotTicketCore,applyPilotTicketCoreMigration} from '../app/server/src/p1-005-pilot-ticket-core.mjs';
import {applyChannelMessageInboxMigration} from '../app/server/src/p1-003-channel-message-inbox.mjs';
import {applyServiceIntakeMigration} from '../app/server/src/p1-004-service-intake.mjs';
import {applyTicketStateActionMigration} from '../app/server/src/p1-006-ticket-state-actions.mjs';
import {applyPilotAccessMigration} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {applyTicketClosureMigration} from '../app/server/src/p1-010-ticket-auto-completion.mjs';
import {applyNotificationOutboxMigration} from '../app/server/src/p1-007-notification-outbox.mjs';
import {ensureCompletionDismissal,releaseCompletionDismissal} from './helpers/completion-dismissal.mjs';

type Pool=import('../app/server/src/platform/postgres-pool.mjs').PostgresPool;
// Card 32D-L / ADR-0058 supplement: 073 notification vocabulary and automatic-completion deadline columns.
const CONSTRAINTS=`SELECT c.conname,pg_get_constraintdef(c.oid,true) AS definition FROM pg_constraint c
  WHERE (c.conrelid=to_regclass('pilot_ticket.ticket_event') AND c.conname='ticket_event_type_check')
     OR (c.conrelid=to_regclass('communication.ticket_notification_binding') AND c.contype='c' AND pg_get_constraintdef(c.oid,true) LIKE '%TICKET_REOPENED%')
  ORDER BY c.conname`;
const DEADLINE=`SELECT
  (SELECT array_agg(column_name::text ORDER BY column_name) FROM information_schema.columns WHERE table_schema='pilot_ticket' AND table_name='ticket' AND column_name LIKE 'auto\\_c%') AS columns,
  (SELECT array_agg(indexname::text ORDER BY indexname) FROM pg_indexes WHERE schemaname='pilot_ticket' AND tablename='ticket' AND indexname LIKE '%auto\\_c%') AS indexes,
  (SELECT array_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=to_regclass('pilot_ticket.ticket') AND NOT t.tgisinternal AND pg_get_triggerdef(t.oid) LIKE '%auto\\_c%') AS triggers`;
const definitions=async(pool:Pool)=>Object.fromEntries((await pool.query<{conname:string;definition:string}>(CONSTRAINTS)).rows.map(row=>[row.conname,row.definition]));
const deadline=async(pool:Pool)=>(await pool.query<{columns:string[]|null;indexes:string[]|null;triggers:string[]|null}>(DEADLINE)).rows[0];
const LEGACY=/'(ticket\.auto_close_reminder|TICKET_CANCELLED|TICKET_AUTO_CLOSE_REMINDER)'/u;
const closureEndColumns=async(pool:Pool)=>(await pool.query<{name:string}>("SELECT column_name::text AS name FROM information_schema.columns WHERE table_schema='pilot_ticket' AND table_name='closure_record' AND column_name IN ('closed_at','closed_by','ended_at','ended_by') ORDER BY column_name")).rows.map(row=>row.name);
const failure=async(promise:Promise<unknown>)=>{try{await promise;}catch(error){return String((error as Error).message);}return null;};
const NEW_COLUMNS=['auto_complete_at','auto_complete_epoch_ms','auto_complete_reminder_at','auto_complete_reminder_epoch_ms'];
const OLD_COLUMNS=['auto_close_at','auto_close_epoch_ms','auto_close_reminder_at','auto_close_reminder_epoch_ms'];

test('073 notification vocabulary: legacy data blocks it, rewrites types and deadline columns, re-runs harmlessly, and rolls back only without new-value data',{timeout:240000},()=>withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'c32dl073',run:async(context:{pool:Pool;databaseUrl:string})=>{
 const {pool,databaseUrl}=context;
 await applyThrough030(context);const p2016={databaseUrl,mode:'apply'};await migrateP2016(p2016);await migrateServiceClosure({databaseUrl,mode:'apply'});await migrateCompletionDismissal({databaseUrl,mode:'apply'});
 const before=await definitions(pool),beforeDeadline=await deadline(pool);
 assert.equal(Object.keys(before).length,2,JSON.stringify(Object.keys(before)));
 assert.ok(Object.values(before).every(definition=>LEGACY.test(definition)),'every targeted constraint starts in the old vocabulary');
 assert.deepEqual(beforeDeadline?.columns,OLD_COLUMNS);assert.deepEqual(beforeDeadline?.indexes,['pilot_ticket_auto_close_epoch_idx','ticket_auto_close_idx']);
 assert.equal(beforeDeadline?.triggers?.length,2);
 assert.deepEqual(await closureEndColumns(pool),['closed_at','closed_by']);
 assert.deepEqual(await migrateNotificationVocabulary({databaseUrl,mode:'check'}),{status:'PENDING',migration_id:'073_notification_vocabulary'});

 const intake=await seedPersistedIntake({pool,text:'073 迁移前置检查（合成）',requestType:'INCIDENT',status:'RECEIVED'});
 const created=await createPilotTicketCore({pool:pool as never}).createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'c32dl-073'});
 assert.ok(created.ticket);const ticketId=created.ticket.id;
 const eventId=String((await pool.query<{id:string}>(`INSERT INTO pilot_ticket.ticket_event(ticket_id,event_type,old_status,new_status,aggregate_version,event_ordinal,operator_type,operator_id,trace_id)
  VALUES($1::uuid,'ticket.information_added','NEW','NEW',1,1,'SYSTEM',NULL,'c32dl-073') RETURNING event_id::text AS id`,[ticketId])).rows[0]?.id);
 const originalType=String((await pool.query<{event_type:string}>('SELECT event_type FROM pilot_ticket.ticket_event WHERE event_id=$1::uuid',[eventId])).rows[0]?.event_type);
 const deadlineEpoch='4102444800000';
 await pool.query('UPDATE pilot_ticket.ticket SET auto_close_epoch_ms=$2::bigint WHERE id=$1::uuid',[ticketId,deadlineEpoch]);
 const deadlineLocal=String((await pool.query<{at:string}>('SELECT auto_close_at::text AS at FROM pilot_ticket.ticket WHERE id=$1::uuid',[ticketId])).rows[0]?.at);
 assert.notEqual(deadlineLocal,'null','the ARCH-005 trigger fills the local deadline');

 // A database holding an old value fails before any change; nothing is mapped or deleted.
 await pool.query("UPDATE pilot_ticket.ticket_event SET event_type='ticket.auto_close_reminder' WHERE event_id=$1::uuid",[eventId]);
 assert.match(String(await failure(migrateNotificationVocabulary({databaseUrl,mode:'apply'}))),/NOTIFICATION_VOCABULARY_LEGACY_DATA_PRESENT: ticket_event/u);
 assert.equal((await pool.query<{event_type:string}>('SELECT event_type FROM pilot_ticket.ticket_event WHERE event_id=$1::uuid',[eventId])).rows[0]?.event_type,'ticket.auto_close_reminder','legacy data is not rewritten');
 assert.deepEqual(await definitions(pool),before,'a failed precheck changes no constraint');assert.deepEqual(await deadline(pool),beforeDeadline,'nor any deadline column');
 await pool.query('UPDATE pilot_ticket.ticket_event SET event_type=$2 WHERE event_id=$1::uuid',[eventId,originalType]);

 // Forward: the new vocabulary only; deadline values, indexes and the local/epoch sync survive the rename.
 assert.deepEqual(await migrateNotificationVocabulary({databaseUrl,mode:'apply'}),{status:'APPLIED',migration_id:'073_notification_vocabulary'});
 const after=await definitions(pool),afterDeadline=await deadline(pool);
 assert.deepEqual(Object.keys(after),Object.keys(before));
 for(const [name,definition] of Object.entries(after))assert.equal(LEGACY.test(definition),false,name+': '+definition);
 assert.match(String(after.ticket_event_type_check),/'ticket\.auto_complete_reminder'/u);
 const binding=Object.values(after).find(definition=>definition.includes('TICKET_REOPENED'));
 assert.match(String(binding),/'TICKET_REOPENED'::text, 'TICKET_RESTORED'::text/u);assert.match(String(binding),/'TICKET_DISMISSED'/u);
 assert.deepEqual(afterDeadline?.columns,NEW_COLUMNS);
 assert.deepEqual(await closureEndColumns(pool),['ended_at','ended_by'],'the closure record end fields are renamed');assert.deepEqual(afterDeadline?.indexes,['pilot_ticket_auto_complete_epoch_idx','ticket_auto_complete_idx']);
 assert.equal(afterDeadline?.triggers?.length,2);
 for(const trigger of afterDeadline?.triggers??[])assert.doesNotMatch(trigger,/auto_close/u,trigger);
 const kept=(await pool.query<{at:string;epoch:string}>('SELECT auto_complete_at::text AS at,auto_complete_epoch_ms::text AS epoch FROM pilot_ticket.ticket WHERE id=$1::uuid',[ticketId])).rows[0];
 assert.deepEqual(kept,{at:deadlineLocal,epoch:deadlineEpoch},'the rename keeps the stored deadline');
 await pool.query('UPDATE pilot_ticket.ticket SET auto_complete_reminder_epoch_ms=$2::bigint WHERE id=$1::uuid',[ticketId,'4102441200000']);
 const synced=(await pool.query<{ok:boolean}>('SELECT auto_complete_reminder_at=platform.local_from_epoch_ms(auto_complete_reminder_epoch_ms) AS ok FROM pilot_ticket.ticket WHERE id=$1::uuid',[ticketId])).rows[0];
 assert.equal(synced?.ok,true,'the recreated ARCH-005 trigger keeps the renamed pair in sync');
 assert.match(String(await failure(pool.query("UPDATE pilot_ticket.ticket_event SET event_type='ticket.auto_close_reminder' WHERE event_id=$1::uuid",[eventId]))),/ticket_event_type_check/u);
 assert.deepEqual(await migrateNotificationVocabulary({databaseUrl,mode:'apply'}),{status:'NOOP_ALREADY_APPLIED',migration_id:'073_notification_vocabulary'});

 // The body is re-runnable for fixtures that apply older migrations afterwards; the recorded originals are kept.
 const baseline=(await pool.query('SELECT object_kind,object_name,relation,definition FROM pilot_ticket.notification_vocabulary_baseline ORDER BY object_kind,object_name')).rows;
 assert.deepEqual(baseline.map(row=>(row as {object_kind:string}).object_kind),['column','column','column','column','column','column','constraint','constraint','index','index','trigger','trigger']);
 await applyNotificationVocabularySql(pool as never);
 assert.deepEqual((await pool.query('SELECT object_kind,object_name,relation,definition FROM pilot_ticket.notification_vocabulary_baseline ORDER BY object_kind,object_name')).rows,baseline);
 assert.deepEqual(await definitions(pool),after);assert.deepEqual(await deadline(pool),afterDeadline);
 // A re-run historical 007 adds an empty old column again: the body drops it; a filled one fails instead of choosing a value.
 await pool.query('ALTER TABLE pilot_ticket.ticket ADD COLUMN auto_close_at TIMESTAMP');
 await applyNotificationVocabularySql(pool as never);assert.deepEqual(await deadline(pool),afterDeadline);
 await pool.query('ALTER TABLE pilot_ticket.ticket ADD COLUMN auto_close_at TIMESTAMP');
 await pool.query("UPDATE pilot_ticket.ticket SET auto_close_at='2099-12-31 00:00:00' WHERE id=$1::uuid",[ticketId]);
 assert.match(String(await failure(applyNotificationVocabularySql(pool as never))),/NOTIFICATION_VOCABULARY_DEADLINE_COLUMN_CONFLICT:auto_close_at/u);
 await pool.query('ALTER TABLE pilot_ticket.ticket DROP COLUMN auto_close_at');

 // Rollback refuses while new-value data exists, then restores the exact original objects with the data in place.
 await pool.query("UPDATE pilot_ticket.ticket_event SET event_type='ticket.auto_complete_reminder' WHERE event_id=$1::uuid",[eventId]);
 assert.match(String(await failure(migrateNotificationVocabulary({databaseUrl,mode:'rollback'}))),/NOTIFICATION_VOCABULARY_ROLLBACK_REQUIRES_EMPTY_FIXTURE/u);
 await pool.query('UPDATE pilot_ticket.ticket_event SET event_type=$2 WHERE event_id=$1::uuid',[eventId,originalType]);
 assert.deepEqual(await migrateNotificationVocabulary({databaseUrl,mode:'rollback'}),{status:'ROLLED_BACK',migration_id:'073_notification_vocabulary'});
 assert.deepEqual(await definitions(pool),before);assert.deepEqual(await deadline(pool),beforeDeadline);assert.deepEqual(await closureEndColumns(pool),['closed_at','closed_by']);
 assert.equal((await pool.query<{epoch:string}>('SELECT auto_close_epoch_ms::text AS epoch FROM pilot_ticket.ticket WHERE id=$1::uuid',[ticketId])).rows[0]?.epoch,deadlineEpoch);
 assert.equal((await pool.query("SELECT to_regclass('pilot_ticket.notification_vocabulary_baseline') IS NULL AS gone")).rows[0]?.gone,true);
 assert.deepEqual(await migrateNotificationVocabulary({databaseUrl,mode:'apply'}),{status:'APPLIED',migration_id:'073_notification_vocabulary'});
 assert.deepEqual(await definitions(pool),after);assert.deepEqual(await deadline(pool),afterDeadline);
}}));

// Partial fixture chains (intake only, or the P1 chain without 031's communication tables) must still accept the 073 body.
test('073 body applies and releases on partial chains whose later tables do not exist yet',{timeout:240000},()=>withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'c32dl073p',run:async(context:{pool:Pool;databaseUrl:string})=>{
 const {pool}=context;
 const exists=async(relation:string)=>(await pool.query<{present:boolean}>('SELECT to_regclass($1) IS NOT NULL AS present',[relation])).rows[0]?.present===true;
 await applyChannelMessageInboxMigration({pool});await applyServiceIntakeMigration({pool});
 assert.equal(await exists('pilot_ticket.ticket'),false);
 await ensureCompletionDismissal(pool as never);
 assert.equal(await exists('pilot_ticket.notification_vocabulary_baseline'),true);
 await releaseCompletionDismissal(pool as never);assert.equal(await exists('pilot_ticket.notification_vocabulary_baseline'),false);
 await applyPilotTicketCoreMigration({pool});await applyTicketStateActionMigration({pool});await applyNotificationOutboxMigration({pool});await applyPilotAccessMigration({pool});await applyTicketClosureMigration({pool});
 assert.equal(await exists('communication.ticket_notification_binding'),false,'the P1 chain has no 031 notification binding');
 const p1Before=await definitions(pool),p1DeadlineBefore=await deadline(pool);
 await ensureCompletionDismissal(pool as never);
 const p1=await definitions(pool);
 assert.match(String(p1.ticket_event_type_check),/'ticket\.auto_complete_reminder'/u);
 for(const [name,definition] of Object.entries(p1))assert.equal(LEGACY.test(definition),false,name+': '+definition);
 assert.deepEqual((await deadline(pool))?.columns?.filter(name=>name.startsWith('auto_complete')).length,(p1DeadlineBefore?.columns?.length??0),'every P1 deadline column is renamed');
 await releaseCompletionDismissal(pool as never);
 assert.deepEqual(await definitions(pool),p1Before,'release restores the original P1 vocabulary');assert.deepEqual(await deadline(pool),p1DeadlineBefore,'and the P1 deadline columns');
}}));
