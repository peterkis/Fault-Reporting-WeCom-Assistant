import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withP2016IsolatedDatabase,applyThrough030} from './helpers/p2-016-postgres-harness.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {migrateP2016} from '../app/server/scripts/p2-016-migrate.mjs';
import {migrateServiceClosure} from '../app/server/scripts/service-closure-migrate.mjs';
import {migrateCompletionDismissal} from '../app/server/scripts/completion-dismissal-migrate.mjs';
import {migrateNotificationVocabulary} from '../app/server/scripts/notification-vocabulary-migrate.mjs';
import {migrateSystemClosureRestore} from '../app/server/scripts/system-closure-restore-migrate.mjs';
import {createServiceIntakeDecisionPort} from '../app/server/src/p2-015-service-intake-decision-port.mjs';
import {transactionP2016} from '../app/server/src/p2-016-domain-contracts.mjs';

type Pool=import('../app/server/src/platform/postgres-pool.mjs').PostgresPool;
// ADR-0056 supplement: 074 lets the system restore its own out-of-scope Intake closure (restored_by empty, restore_source SYSTEM).
const RESTORE_CHECK="SELECT pg_get_constraintdef(oid,true) AS definition FROM pg_constraint WHERE conrelid='pilot_ticket.closure_record'::regclass AND conname='closure_restore_actor'";
const restoreCheck=async(pool:Pool)=>(await pool.query<{definition:string}>(RESTORE_CHECK)).rows[0]?.definition;
const restoreColumn=async(pool:Pool)=>(await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema='pilot_ticket' AND table_name='closure_record' AND column_name='restore_source'")).rowCount===1;
const failure=async(promise:Promise<unknown>)=>{try{await promise;}catch(error){return String((error as Error).message);}return null;};
const ID='074_system_closure_restore';

async function closeOutOfScope(pool:Pool,actor:string|null):Promise<string>{
 const seed=await seedPersistedIntake({pool,text:'天气怎么样',requestType:'UNKNOWN',status:'RECEIVED'});
 await transactionP2016(pool,transaction=>createServiceIntakeDecisionPort(actor?{closureActor:actor}:{}).apply({transaction,input:{result_code:'OUT_OF_SCOPE',intake_id:seed.intakeId,
  occurred_at:seed.receivedAt,trace_id:'test:074',decision_id:randomUUID(),reason_code:'OUT_OF_SCOPE',catalog_version:'T074',rule_set_version:'T074'}}));
 const record=(await pool.query<{id:string;source:string}>('SELECT id::text,source FROM pilot_ticket.closure_record WHERE intake_id=$1::uuid',[seed.intakeId])).rows[0];
 assert.equal(record?.source,actor?'MANUAL':'SYSTEM');
 return record.id;
}
const restore=(pool:Pool,id:string,actor:string|null)=>pool.query(`UPDATE pilot_ticket.closure_record SET restored_at=ended_at,restored_by=$2::uuid,restoration_event_id=$3::uuid WHERE id=$1::uuid`,[id,actor,randomUUID()]);
const unrestore=(pool:Pool,id:string)=>pool.query('UPDATE pilot_ticket.closure_record SET restored_at=NULL,restored_by=NULL,restoration_event_id=NULL WHERE id=$1::uuid',[id]);

test('074 system closure restore: only a system out-of-scope Intake closure restores without a staff actor; rollback refuses while one exists',{timeout:240000},()=>withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'restore074',run:async(context:{pool:Pool;databaseUrl:string})=>{
 const {pool,databaseUrl}=context;
 await applyThrough030(context);const p2016={databaseUrl,mode:'apply'};await migrateP2016(p2016);await migrateServiceClosure({databaseUrl,mode:'apply'});
 await migrateCompletionDismissal({databaseUrl,mode:'apply'});await migrateNotificationVocabulary({databaseUrl,mode:'apply'});
 const original=await restoreCheck(pool);assert.ok(original?.includes('restored_by IS NOT NULL'));
 const system=await closeOutOfScope(pool,null),manual=await closeOutOfScope(pool,randomUUID()),staff=randomUUID();
 // Before 074 every restoration needs a staff actor; existing manual restorations stay valid across the migration.
 assert.match(String(await failure(restore(pool,system,null))),/closure_restore_actor/u);
 await restore(pool,manual,staff);
 assert.deepEqual(await migrateSystemClosureRestore({databaseUrl,mode:'check'}),{status:'PENDING',migration_id:ID});
 assert.deepEqual(await migrateSystemClosureRestore({databaseUrl,mode:'apply'}),{status:'APPLIED',migration_id:ID});
 assert.deepEqual(await migrateSystemClosureRestore({databaseUrl,mode:'apply'}),{status:'NOOP_ALREADY_APPLIED',migration_id:ID});
 assert.equal(await restoreColumn(pool),true);
 const sources=async()=>Object.fromEntries((await pool.query<{id:string;restore_source:string|null}>('SELECT id::text,restore_source FROM pilot_ticket.closure_record')).rows.map(row=>[row.id,row.restore_source]));
 assert.deepEqual(await sources(),{[system]:null,[manual]:'MANUAL'},'existing restorations read MANUAL without any backfill');
 // A manual closure never restores without a staff actor, even under 074.
 await unrestore(pool,manual);
 assert.match(String(await failure(restore(pool,manual,null))),/closure_restore_actor/u);
 await restore(pool,system,null);
 assert.deepEqual(await sources(),{[system]:'SYSTEM',[manual]:null});
 assert.match(String(await failure(pool.query("UPDATE pilot_ticket.closure_record SET restore_source='MANUAL' WHERE id=$1::uuid",[system]))),/restore_source/u);
 // Rollback never rewrites a system restoration.
 assert.match(String(await failure(migrateSystemClosureRestore({databaseUrl,mode:'rollback'}))),/SYSTEM_CLOSURE_RESTORE_ROLLBACK_REQUIRES_EMPTY_FIXTURE/u);
 assert.equal(await restoreColumn(pool),true);
 await unrestore(pool,system);await restore(pool,manual,staff);
 assert.deepEqual(await migrateSystemClosureRestore({databaseUrl,mode:'rollback'}),{status:'ROLLED_BACK',migration_id:ID});
 assert.equal(await restoreColumn(pool),false);assert.equal(await restoreCheck(pool),original);
 assert.deepEqual(await migrateSystemClosureRestore({databaseUrl,mode:'rollback'}),{status:'NOT_APPLIED',migration_id:ID});
 assert.match(String(await failure(restore(pool,system,null))),/closure_restore_actor/u);
 assert.deepEqual(await migrateSystemClosureRestore({databaseUrl,mode:'apply'}),{status:'APPLIED',migration_id:ID});
 await restore(pool,system,null);assert.deepEqual(await sources(),{[system]:'SYSTEM',[manual]:'MANUAL'});
}}));
