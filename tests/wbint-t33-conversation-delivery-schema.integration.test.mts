import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {withP2016IsolatedDatabase,applyThrough030} from './helpers/p2-016-postgres-harness.mjs';
import {migrateP2016,p2016CatalogInventory,p2016CatalogHash} from '../app/server/scripts/p2-016-migrate.mjs';
import {migrateP2012} from '../app/server/scripts/p2-012-migrate.mjs';
import {migrateYxxSelfService} from '../app/server/scripts/yxx-self-service-migrate.mjs';
import {migrateWorkbenchManualReports} from '../app/server/scripts/workbench-manual-reports-migrate.mjs';
import {migrateWorkbenchPersonalRead} from '../app/server/scripts/workbench-personal-read-migrate.mjs';
import {migrateTicketSelfHandling} from '../app/server/scripts/ticket-self-handling-migrate.mjs';
import {migrateTicketStaffCompletion} from '../app/server/scripts/ticket-staff-completion-migrate.mjs';
import {migrateTicketReopenRounds} from '../app/server/scripts/ticket-reopen-rounds-migrate.mjs';
import {migrateBotReporterFeedback} from '../app/server/scripts/bot-reporter-feedback-migrate.mjs';
import {migrateWorkbenchFollow,followSchemaReady} from '../app/server/scripts/workbench-follow-migrate.mjs';
import {migrateConversationDeliveryCommands} from '../app/server/scripts/conversation-delivery-commands-migrate.mjs';
import {conversationDeliveryReceiptSchemaReady,conversationDeliveryReceiptSchemaShape} from '../app/server/src/p2-006-delivery-command-schema.mjs';

test('T33 explicit 061 check rolls back and exact 031/032 consumers retain complete catalog guards',{timeout:120000},async()=>{
 assert.ok(process.env.PILOT_DATABASE_URL);
 await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'t33schema61',max:2,run:async({pool,databaseUrl}:{pool:PostgresPool;databaseUrl:string})=>{
  const options={databaseUrl,mode:'apply'};
  await applyThrough030({pool,databaseUrl});await migrateP2016(options);const before=p2016CatalogHash(await p2016CatalogInventory(pool));
  assert.equal(before,'5521c4fc34481ef22e46cab4e0f3e1fdea232c995cef2f823008d0ea9142fb20');
  assert.equal((await migrateConversationDeliveryCommands({databaseUrl,mode:'status'})).status,'PENDING');assert.equal((await migrateConversationDeliveryCommands({databaseUrl,mode:'check'})).status,'CHECK_ROLLBACK_SUCCEEDED');
  assert.equal(p2016CatalogHash(await p2016CatalogInventory(pool)),before);assert.equal((await pool.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='061_workbench_conversation_delivery_commands'")).rows.length,0);
  assert.equal((await migrateConversationDeliveryCommands({databaseUrl,mode:'apply'})).status,'APPLIED');assert.equal(await conversationDeliveryReceiptSchemaShape(pool),'BASE');
  const repeat031=await migrateP2016(options);assert.ok(repeat031);assert.equal(repeat031.status,'NOOP_ALREADY_APPLIED');
  const new032=await migrateP2012(options);assert.ok(new032);assert.equal(new032.status,'APPLIED');const repeat032=await migrateP2012(options);assert.ok(repeat032);assert.equal(repeat032.status,'NOOP_ALREADY_APPLIED');
  const tx=await pool.connect();try{await tx.query('BEGIN');await tx.query('ALTER TABLE pilot_ticket.ticket_command_receipt DROP CONSTRAINT p2016_command_resource');assert.equal(await conversationDeliveryReceiptSchemaReady(tx),false);await tx.query('ROLLBACK');}finally{await tx.query('ROLLBACK').catch(()=>{});tx.release();}
  assert.equal(await conversationDeliveryReceiptSchemaReady(pool),true);
 }});
});

test('T33 explicit 061 preserves current 047/050 full receipts and the T34 follow schema',{timeout:120000},async()=>{
 assert.ok(process.env.PILOT_DATABASE_URL);
 await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'t33forward61',max:2,run:async({pool,databaseUrl}:{pool:PostgresPool;databaseUrl:string})=>{
  const options={databaseUrl,mode:'apply'};
  await applyThrough030({pool,databaseUrl});await migrateP2016(options);await migrateP2012({databaseUrl});await migrateYxxSelfService(options);await migrateTicketSelfHandling({databaseUrl,mode:'apply'});await migrateTicketStaffCompletion({databaseUrl,mode:'apply'});await migrateWorkbenchManualReports({databaseUrl,mode:'apply'});await migrateWorkbenchPersonalRead({databaseUrl,mode:'apply'});await migrateTicketReopenRounds({databaseUrl,mode:'apply'});await migrateBotReporterFeedback({databaseUrl,mode:'apply'});await migrateWorkbenchFollow({databaseUrl,mode:'apply'});
  assert.equal(await followSchemaReady(pool),true);assert.equal((await migrateConversationDeliveryCommands({databaseUrl,mode:'check'})).status,'CHECK_ROLLBACK_SUCCEEDED');assert.equal(await followSchemaReady(pool),true);
  assert.equal((await migrateConversationDeliveryCommands({databaseUrl,mode:'apply'})).status,'APPLIED');assert.equal(await conversationDeliveryReceiptSchemaShape(pool),'BOT');assert.equal(await followSchemaReady(pool),true);assert.equal((await migrateWorkbenchFollow({databaseUrl,mode:'apply'})).status,'NOOP_ALREADY_APPLIED');assert.equal((await migrateConversationDeliveryCommands({databaseUrl,mode:'apply'})).status,'NOOP_ALREADY_APPLIED');
 }});
});
