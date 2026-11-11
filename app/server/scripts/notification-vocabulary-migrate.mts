import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import type {PostgresTransaction} from '../src/platform/postgres-pool.mjs';
import {transactionP2016,failP2016} from '../src/p2-016-domain-contracts.mjs';

/** ADR-0058 supplement: TICKET_DISMISSED, TICKET_RESTORED, ticket.auto_complete_reminder / TICKET_AUTO_COMPLETE_REMINDER, auto_complete_* deadline columns. */
export const NOTIFICATION_VOCABULARY_MIGRATION_ID='073_notification_vocabulary';
const file=new URL('../../../database/migrations/073_notification_vocabulary.sql',import.meta.url);
async function source(){const sql=await readFile(file,'utf8'),body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];if(!body)failP2016();return {sql,body,checksum:createHash('sha256').update(sql).digest('hex')};}

/**
 * Applies the 073 body inside the caller's transaction without registering it. For isolated test databases built from a partial
 * migration chain; call it after every other migration of that chain (after 072).
 */
export async function applyNotificationVocabularySql(tx:Pick<PostgresTransaction,'query'>):Promise<void>{
 const {body}=await source();
 await tx.query(body);
}

export async function notificationVocabularySchemaReady(tx:PostgresTransaction):Promise<boolean>{
 const {checksum}=await source();
 const row=(await tx.query<{checksum_sha256:string;baseline:boolean}>(`SELECT checksum_sha256,to_regclass('pilot_ticket.notification_vocabulary_baseline') IS NOT NULL AS baseline
  FROM platform.schema_migration WHERE migration_id=$1`,[NOTIFICATION_VOCABULARY_MIGRATION_ID])).rows[0];
 return row?.checksum_sha256===checksum&&row.baseline;
}
/** Roles that write ticket notifications or reminders must fail before timers, intake or network startup when 073 is missing. */
export async function requireNotificationVocabularySchema({pool}:{pool:PostgresTransaction}):Promise<void>{
 let ready=false;
 try{ready=await notificationVocabularySchemaReady(pool);}catch{ /* Missing base schema or unavailable DB is not ready. */ }
 if(!ready)throw new Error('NOTIFICATION_VOCABULARY_SCHEMA_REQUIRED');
}

/** Rows that hold the 073 vocabulary; rollback refuses while any exist because it never maps data back. */
const NEW_VALUE_PROBES=[
 ['pilot_ticket.ticket_event',"SELECT 1 FROM pilot_ticket.ticket_event WHERE event_type='ticket.auto_complete_reminder' LIMIT 1"],
 ['communication.ticket_notification_binding',"SELECT 1 FROM communication.ticket_notification_binding WHERE notification_type IN ('TICKET_DISMISSED','TICKET_RESTORED') LIMIT 1"],
 ['notification.outbox',"SELECT 1 FROM notification.outbox WHERE event_type='ticket.auto_complete_reminder' OR template_code='TICKET_AUTO_COMPLETE_REMINDER' LIMIT 1"],
] as const;
export async function notificationVocabularyNewValuesPresent(tx:Pick<PostgresTransaction,'query'>):Promise<boolean>{
 for(const [relation,query] of NEW_VALUE_PROBES){
  if((await tx.query<{present:boolean}>('SELECT to_regclass($1) IS NOT NULL AS present',[relation])).rows[0]?.present!==true)continue;
  if((await tx.query(query)).rowCount)return true;
 }
 return false;
}
/**
 * Restores the recorded pre-073 objects and drops the baseline table: the new sync triggers are replaced by the recorded originals
 * around the reverse column renames, then indexes and constraint definitions. Never maps or deletes data.
 */
export async function restoreNotificationVocabularyBaseline(tx:Pick<PostgresTransaction,'query'>):Promise<void>{
 const baseline=(await tx.query<{object_kind:string;object_name:string;relation:string;definition:string}>('SELECT object_kind,object_name,relation,definition FROM pilot_ticket.notification_vocabulary_baseline ORDER BY object_kind,object_name')).rows;
 const ident=(value:string)=>'"'+value.replaceAll('"','""')+'"',qualified=(relation:string)=>relation.split('.').map(ident).join('.');
 const of=(kind:string)=>baseline.filter(row=>row.object_kind===kind);
 for(const row of of('trigger'))await tx.query('DROP TRIGGER IF EXISTS '+ident(row.object_name)+' ON '+qualified(row.relation));
 for(const row of of('column'))await tx.query('ALTER TABLE '+qualified(row.relation)+' RENAME COLUMN '+ident(row.object_name)+' TO '+ident(row.definition));
 for(const row of of('trigger'))await tx.query(row.definition);
 for(const row of of('index'))await tx.query('ALTER INDEX '+ident(row.relation.split('.')[0]??'')+'.'+ident(row.object_name)+' RENAME TO '+ident(row.definition));
 for(const row of of('constraint')){
  await tx.query('ALTER TABLE '+qualified(row.relation)+' DROP CONSTRAINT '+ident(row.object_name));
  await tx.query('ALTER TABLE '+qualified(row.relation)+' ADD CONSTRAINT '+ident(row.object_name)+' '+row.definition);
 }
 await tx.query('DROP TABLE pilot_ticket.notification_vocabulary_baseline');
}

export async function migrateNotificationVocabulary({databaseUrl,mode='check'}:{databaseUrl:string;mode?:'check'|'apply'|'rollback'}){
 if(!databaseUrl||!['check','apply','rollback'].includes(mode))failP2016();
 const {body,checksum}=await source(),pool=createPostgresPool({connectionString:databaseUrl,max:1,application_name:'notification_vocabulary_migrator'});
 try{return await transactionP2016(pool,async tx=>{
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('NOTIFICATION_VOCABULARY_MIGRATION'))");
  const existing=(await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[NOTIFICATION_VOCABULARY_MIGRATION_ID])).rows[0];
  if(existing){
   if(existing.checksum_sha256!==checksum||!await notificationVocabularySchemaReady(tx))throw Error('NOTIFICATION_VOCABULARY_SCHEMA_DRIFT');
   if(mode!=='rollback')return {status:'NOOP_ALREADY_APPLIED',migration_id:NOTIFICATION_VOCABULARY_MIGRATION_ID};
   // Rollback restores the pre-073 vocabulary; it never maps data, so the database must hold no new-value rows.
   if(await notificationVocabularyNewValuesPresent(tx))throw Error('NOTIFICATION_VOCABULARY_ROLLBACK_REQUIRES_EMPTY_FIXTURE');
   await restoreNotificationVocabularyBaseline(tx);
   await tx.query('DELETE FROM platform.schema_migration WHERE migration_id=$1',[NOTIFICATION_VOCABULARY_MIGRATION_ID]);
   return {status:'ROLLED_BACK',migration_id:NOTIFICATION_VOCABULARY_MIGRATION_ID};
  }
  if(mode==='rollback')return {status:'NOT_APPLIED',migration_id:NOTIFICATION_VOCABULARY_MIGRATION_ID};
  if(mode==='check')return {status:'PENDING',migration_id:NOTIFICATION_VOCABULARY_MIGRATION_ID};
  await tx.query(body);
  await tx.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch) INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
   SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[NOTIFICATION_VOCABULARY_MIGRATION_ID,checksum]);
  return {status:'APPLIED',migration_id:NOTIFICATION_VOCABULARY_MIGRATION_ID};
 });}finally{await pool.end();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length>1||args.some(arg=>!['--check','--apply','--rollback'].includes(arg)))throw Error('NOTIFICATION_VOCABULARY_ARGUMENT_INVALID');
 const databaseUrl=process.env.PILOT_DATABASE_URL;if(!databaseUrl)throw Error('NOTIFICATION_VOCABULARY_DATABASE_URL_REQUIRED');
 try{console.log(JSON.stringify(await migrateNotificationVocabulary({databaseUrl,mode:args[0]==='--apply'?'apply':args[0]==='--rollback'?'rollback':'check'})));}
 catch(error){console.error(JSON.stringify({ok:false,error_code:'NOTIFICATION_VOCABULARY_MIGRATION_FAILED',detail:error instanceof Error?error.message.slice(0,200):null}));process.exitCode=1;}
}
