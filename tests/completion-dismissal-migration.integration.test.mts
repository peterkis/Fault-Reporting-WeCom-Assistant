import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withP2016IsolatedDatabase,applyThrough030} from './helpers/p2-016-postgres-harness.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {migrateP2016} from '../app/server/scripts/p2-016-migrate.mjs';
import {migrateServiceClosure} from '../app/server/scripts/service-closure-migrate.mjs';
import {migrateCompletionDismissal,applyCompletionDismissalSql} from '../app/server/scripts/completion-dismissal-migrate.mjs';
import {createPilotTicketCore} from '../app/server/src/p1-005-pilot-ticket-core.mjs';

type Pool=import('../app/server/src/platform/postgres-pool.mjs').PostgresPool;
const VOCABULARY=`SELECT c.conname,pg_get_constraintdef(c.oid,true) AS definition FROM pg_constraint c
  WHERE (c.conrelid='pilot_ticket.ticket'::regclass AND c.conname='ticket_status_check')
     OR (c.conrelid='pilot_ticket.ticket_event'::regclass AND c.conname IN ('ticket_event_status_check','ticket_event_type_check'))
     OR (c.conrelid='intake.service_intake'::regclass AND c.conname='service_intake_status_check')
     OR (c.conrelid='intake.service_intake_event'::regclass AND c.conname='service_intake_event_type_check')
     OR (c.conrelid='communication.ticket_notification_binding'::regclass AND c.contype='c' AND pg_get_constraintdef(c.oid,true) LIKE '%TICKET_%')
  ORDER BY c.conrelid::regclass::text,c.conname`;
const definitions=async(pool:Pool)=>Object.fromEntries((await pool.query<{conname:string;definition:string}>(VOCABULARY)).rows.map(row=>[row.conname,row.definition]));
const LEGACY=/'(CLOSED|CANCELLED|IGNORED|DUPLICATE_LINKED|ticket\.closed|ticket\.cancelled|ticket\.duplicate_linked|ticket\.unlinked|intake\.closed|TICKET_CLOSED)'/u;
const failure=async(promise:Promise<unknown>)=>{try{await promise;}catch(error){return String((error as Error).message);}return null;};

test('072 completion / dismissal: legacy data blocks it, rewrites the vocabulary, re-runs harmlessly, and rolls back only without new-value data',{timeout:240000},()=>withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'c32cd072',run:async(context:{pool:Pool;databaseUrl:string})=>{
 const {pool,databaseUrl}=context;
 await applyThrough030(context);const p2016={databaseUrl,mode:'apply'};await migrateP2016(p2016);await migrateServiceClosure({databaseUrl,mode:'apply'});
 const before=await definitions(pool);
 assert.equal(Object.keys(before).length,6,JSON.stringify(Object.keys(before)));
 assert.ok(Object.values(before).every(definition=>LEGACY.test(definition)),'every targeted constraint starts in the old vocabulary');
 assert.deepEqual(await migrateCompletionDismissal({databaseUrl,mode:'check'}),{status:'PENDING',migration_id:'072_ticket_completion_dismissal'});

 // A database that already holds an old value fails before any change; nothing is mapped or deleted.
 const intake=await seedPersistedIntake({pool,text:'072 迁移前置检查（合成）',requestType:'INCIDENT',status:'RECEIVED'});
 const created=await createPilotTicketCore({pool:pool as never}).createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'c32cd-072'});
 assert.ok(created.ticket);const ticketId=created.ticket.id;
 await pool.query("UPDATE pilot_ticket.ticket SET status='CLOSED' WHERE id=$1::uuid",[ticketId]);
 assert.match(String(await failure(migrateCompletionDismissal({databaseUrl,mode:'apply'}))),/COMPLETION_DISMISSAL_LEGACY_DATA_PRESENT: ticket\.status/u);
 assert.equal((await pool.query<{status:string}>('SELECT status FROM pilot_ticket.ticket WHERE id=$1::uuid',[ticketId])).rows[0]?.status,'CLOSED','legacy data is not rewritten');
 assert.deepEqual(await definitions(pool),before,'a failed precheck changes no constraint');
 await pool.query("UPDATE pilot_ticket.ticket SET status='NEW' WHERE id=$1::uuid",[ticketId]);

 // Forward: the new vocabulary only.
 assert.deepEqual(await migrateCompletionDismissal({databaseUrl,mode:'apply'}),{status:'APPLIED',migration_id:'072_ticket_completion_dismissal'});
 const after=await definitions(pool);
 assert.deepEqual(Object.keys(after),Object.keys(before));
 for(const [name,definition] of Object.entries(after))assert.equal(LEGACY.test(definition),false,name+': '+definition);
 assert.match(String(after.ticket_status_check),/'COMPLETED'.*'DISMISSED'/u);assert.match(String(after.service_intake_status_check),/'DISMISSED'/u);
 assert.match(String(after.ticket_event_type_check),/'ticket\.completed'.*'ticket\.dismissed'/u);assert.match(String(after.service_intake_event_type_check),/'intake\.dismissed'/u);
 assert.match(String(await failure(pool.query("UPDATE pilot_ticket.ticket SET status='CLOSED' WHERE id=$1::uuid",[ticketId]))),/ticket_status_check/u);
 assert.match(String(await failure(pool.query("UPDATE pilot_ticket.ticket SET status='CANCELLED' WHERE id=$1::uuid",[ticketId]))),/ticket_status_check/u);
 assert.match(String(await failure(pool.query("UPDATE pilot_ticket.ticket SET status='DUPLICATE_LINKED' WHERE id=$1::uuid",[ticketId]))),/ticket_status_check/u);
 await pool.query("UPDATE pilot_ticket.ticket SET status='DISMISSED' WHERE id=$1::uuid",[ticketId]);
 await pool.query("UPDATE pilot_ticket.ticket SET status='COMPLETED' WHERE id=$1::uuid",[ticketId]);
 assert.deepEqual(await migrateCompletionDismissal({databaseUrl,mode:'apply'}),{status:'NOOP_ALREADY_APPLIED',migration_id:'072_ticket_completion_dismissal'});

 // The body is re-runnable for fixtures that apply older migrations afterwards; the recorded originals are kept.
 const baseline=(await pool.query<{object_name:string;definition:string}>('SELECT object_name,definition FROM pilot_ticket.completion_dismissal_baseline ORDER BY object_name')).rows;
 await applyCompletionDismissalSql(pool as never);
 assert.deepEqual((await pool.query('SELECT object_name,definition FROM pilot_ticket.completion_dismissal_baseline ORDER BY object_name')).rows,baseline);
 assert.deepEqual(await definitions(pool),after);

 // Rollback refuses while new-value data exists, then restores the exact original definitions.
 assert.match(String(await failure(migrateCompletionDismissal({databaseUrl,mode:'rollback'}))),/COMPLETION_DISMISSAL_ROLLBACK_REQUIRES_EMPTY_FIXTURE/u);
 await pool.query("UPDATE pilot_ticket.ticket SET status='NEW' WHERE id=$1::uuid",[ticketId]);
 assert.deepEqual(await migrateCompletionDismissal({databaseUrl,mode:'rollback'}),{status:'ROLLED_BACK',migration_id:'072_ticket_completion_dismissal'});
 assert.deepEqual(await definitions(pool),before);
 assert.equal((await pool.query("SELECT to_regclass('pilot_ticket.completion_dismissal_baseline') IS NULL AS gone")).rows[0]?.gone,true);
 assert.deepEqual(await migrateCompletionDismissal({databaseUrl,mode:'apply'}),{status:'APPLIED',migration_id:'072_ticket_completion_dismissal'});
 assert.deepEqual(await definitions(pool),after);
}}));
