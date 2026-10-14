import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withT35Fixture} from './helpers/t35-read-fixture.mjs';
import {ownedHttp} from './helpers/t36-supplement-fixture.mjs';
import {migrateWorkbenchSupplementFollowUp,supplementFollowUpSchemaReady} from '../scripts/workbench-supplement-follow-up-migrate.mjs';
test('T36 default OFF starts the original host without 062 and preserves original Ticket READ',{timeout:240000},()=>withT35Fixture(async f=>{
 const get=(path:string)=>ownedHttp(f.origin+path,{headers:{cookie:f.firstCookie}}),id=f.tickets[0]?.ticket.id;assert.ok(id);
 const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const body=await bootstrap.json() as {supplement_follow_up_enabled:boolean;supplement_follow_up_draft_recovery_enabled:boolean};assert.equal(body.supplement_follow_up_enabled,false);assert.equal(body.supplement_follow_up_draft_recovery_enabled,false);
 assert.equal((await get('/api/tickets/'+id)).status,200);assert.equal((await get('/api/tickets/'+id+'/supplement-follow-up')).status,404);assert.equal((await get('/api/tickets/'+id+'/supplement-follow-up/material?source_ref=channel:1&revision=1')).status,404);
 const tables=await f.pool.query<{present:boolean}>("SELECT to_regclass('pilot_ticket.workbench_supplement_disposition') IS NOT NULL AS present");assert.equal(tables.rows[0]?.present,false);
 const health=await get('/health/ready'),value:unknown=await health.json();console.log('T36_DEFAULT_OFF_HEALTH '+JSON.stringify({status:health.status,new_schema_guard_present:JSON.stringify(value).includes('workbench_supplement_follow_up_schema')}));assert.equal(JSON.stringify(value).includes('workbench_supplement_follow_up_schema'),false);
}));
test('T36 062 check rolls back, apply commits once, status/NOOP require exact catalog and original checksum',{timeout:240000},()=>withT35Fixture(async f=>{
 assert.equal((await migrateWorkbenchSupplementFollowUp({databaseUrl:f.databaseUrl,mode:'status'})).status,'PENDING');assert.equal((await migrateWorkbenchSupplementFollowUp({databaseUrl:f.databaseUrl,mode:'check'})).status,'CHECK_ROLLBACK_SUCCEEDED');assert.equal(await supplementFollowUpSchemaReady(f.pool),false);
 assert.equal((await migrateWorkbenchSupplementFollowUp({databaseUrl:f.databaseUrl,mode:'apply'})).status,'APPLIED');assert.equal((await migrateWorkbenchSupplementFollowUp({databaseUrl:f.databaseUrl,mode:'status'})).status,'NOOP_ALREADY_APPLIED');assert.equal((await migrateWorkbenchSupplementFollowUp({databaseUrl:f.databaseUrl,mode:'apply'})).status,'NOOP_ALREADY_APPLIED');
 await f.pool.query("UPDATE platform.schema_migration SET checksum_sha256=$1 WHERE migration_id='062_workbench_supplement_follow_up'",['0'.repeat(64)]);assert.equal(await supplementFollowUpSchemaReady(f.pool),false);
 for(const mode of ['check','status','apply'] as const)await assert.rejects(migrateWorkbenchSupplementFollowUp({databaseUrl:f.databaseUrl,mode}));
}));
test('T36 readiness rejects drift of the original receipt resource guard without weakening any old SQL',{timeout:240000},()=>withT35Fixture(async f=>{
 await migrateWorkbenchSupplementFollowUp({databaseUrl:f.databaseUrl,mode:'apply'});assert.equal(await supplementFollowUpSchemaReady(f.pool),true);
 await f.pool.query('ALTER TABLE pilot_ticket.ticket_command_receipt DROP CONSTRAINT p2016_command_resource');await f.pool.query('ALTER TABLE pilot_ticket.ticket_command_receipt ADD CONSTRAINT p2016_command_resource CHECK(true)');
 console.log('T36_SHARED_RECEIPT_SHAPE_READY '+await supplementFollowUpSchemaReady(f.pool));assert.equal(await supplementFollowUpSchemaReady(f.pool),false,'the original receipt resource boundary is a necessary dependency of the disposition evidence');
}));
