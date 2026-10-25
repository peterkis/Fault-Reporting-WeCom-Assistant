import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import type {Pool} from 'pg';
import {testRoots} from './helpers/migration-roots.mjs';
import {withSS009Database} from './helpers/yxx-ss-009-resources.mjs';
import {readCurrentYxxScope} from '../app/server/src/yxx-current-readiness-scope.mjs';
import {currentRuntimeFingerprint} from '../app/server/src/yxx-current-evidence.mjs';
import {g2EvidenceTime} from '../app/server/src/p2-g2-evidence-time.mjs';
import {assertCurrentMigrationCatalog} from '../app/server/src/yxx-current-migration-catalog.mjs';
import {migrateCurrentBaselineWithYxx} from '../app/server/scripts/migrate-current-baseline.mjs';
import {migrateWorkbenchAuth} from '../app/server/scripts/p2-016-workbench-auth-migrate.mjs';
import {migrateThirdPartyStaffDirectory,validateThirdPartyStaffDirectoryCatalog} from '../app/server/scripts/p2-007-migrate.mjs';
import {yxxCatalogInventory,validateYxxCatalog} from '../app/server/scripts/yxx-self-service-migrate.mjs';
import {migrateWorkbenchSourceGroups} from '../app/server/scripts/workbench-source-groups-migrate.mjs';
import {migrateTicketSelfHandling} from '../app/server/scripts/ticket-self-handling-migrate.mjs';
import {migrateTicketStaffCompletion} from '../app/server/scripts/ticket-staff-completion-migrate.mjs';
import {migrateTicketRoundNotifications} from '../app/server/scripts/ticket-round-notifications-migrate.mjs';
import {migrateWorkbenchManualReports} from '../app/server/scripts/workbench-manual-reports-migrate.mjs';
import {migrateTicketReopenRounds} from '../app/server/scripts/ticket-reopen-rounds-migrate.mjs';
import {migrateWorkbenchVerifiedManualReports} from '../app/server/scripts/workbench-verified-manual-reports-migrate.mjs';
import {migrateWorkbenchPersonalRead} from '../app/server/scripts/workbench-personal-read-migrate.mjs';
import {migrateWorkbenchFollow} from '../app/server/scripts/workbench-follow-migrate.mjs';
import {migrateTicketUnassign} from '../app/server/scripts/ticket-unassign-migrate.mjs';
import {migrateTicketReturnToDispatch} from '../app/server/scripts/ticket-return-to-dispatch-migrate.mjs';
import {migrateWorkbenchFollowUpSchedules} from '../app/server/scripts/workbench-follow-up-schedules-migrate.mjs';
import {migrateBotReporterFeedback} from '../app/server/scripts/bot-reporter-feedback-migrate.mjs';
import {migrateWorkbenchFollowUpDueSignals} from '../app/server/scripts/workbench-follow-up-due-migrate.mjs';
import {migrateIncidentInternalNotes} from '../app/server/scripts/incident-internal-notes-migrate.mjs';
import {migrateIncidentPublicProgress} from '../app/server/scripts/incident-public-progress-migrate.mjs';
import {migrateIncidentOwnerTransfer} from '../app/server/scripts/incident-owner-transfer-migrate.mjs';
import {migrateIncidentDeliveryControl} from '../app/server/scripts/incident-delivery-control-migrate.mjs';
import {migrateConversationDeliveryCommands} from '../app/server/scripts/conversation-delivery-commands-migrate.mjs';
import {migrateWorkbenchSupplementFollowUp} from '../app/server/scripts/workbench-supplement-follow-up-migrate.mjs';
import {migrateMvpNotifications} from '../app/server/scripts/mvp-notifications-migrate.mjs';
import {migrateYxxH5} from '../app/server/scripts/yxx-h5-migrate.mjs';

test('current authorized 49 migrations coexist and replay after the preserved 22-file predecessor positive',async t=>{
  const {sourceRoot,runtimeRoot}=testRoots(),scope=readCurrentYxxScope(sourceRoot);
  const cleanupReceipts:Record<string,unknown>[]=[];
  const testContext={diagnostic(message:string){
    t.diagnostic(message);
    if(message.startsWith('SS009_RECEIPT '))cleanupReceipts.push(JSON.parse(message.slice('SS009_RECEIPT '.length)) as Record<string,unknown>);
  }};
  const digest=(bytes:Buffer|string):string=>createHash('sha256').update(bytes).digest('hex');
  const files=scope.migration_files.map(file=>({path:file,sha256_utf8_lf:digest(readFileSync(path.join(runtimeRoot,file),'utf8').replaceAll('\r\n','\n'))}));
  assert.equal(files.length,49);
  await withSS009Database({testContext,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'yxxcurrent',max:1,candidateRoot:runtimeRoot,candidateRepresentation:'STAGED_RUNTIME',
    run:async({pool,databaseUrl}:{pool:Pool;databaseUrl:string})=>{
      const version=Number((await pool.query<{version:string}>("SELECT current_setting('server_version_num') AS version")).rows[0]?.version);
      assert.ok(version>=180000&&version<190000);
      const options={databaseUrl,mode:'apply' as const};
      await assert.rejects(migrateCurrentBaselineWithYxx({...options,catalogProfile:'UNAPPROVED'}),{code:'ARCH_005_CATALOG_PROFILE_INVALID'});
      const baseline=await migrateCurrentBaselineWithYxx(options);assert.ok(baseline.yxx);
      assert.equal(baseline.status,'APPLIED');assert.equal(baseline.yxx.status,'APPLIED');
      const legacy=scope.migration_files.slice(0,14).map(file=>path.posix.basename(file).slice(0,3));
      assert.deepEqual(baseline.legacy_applied,legacy);
      const auth=await migrateWorkbenchAuth(options),directory=await migrateThirdPartyStaffDirectory(options);assert.ok(auth&&directory);
      assert.equal(auth.status,'APPLIED');assert.equal(directory.status,'APPLIED');
      const readMarkers=async()=> (await pool.query<{migration_id:string;checksum_sha256:string;time_pair:boolean}>(
        'SELECT migration_id,checksum_sha256,applied_at=platform.local_from_epoch_ms(applied_epoch_ms) AS time_pair FROM platform.schema_migration ORDER BY migration_id')).rows;
      const predecessor=JSON.parse(readFileSync(path.join(sourceRoot,'plans/yxx-current-readiness-scope.json'),'utf8')) as {files:{path:string;sha256_utf8_lf:string}[]};
      const predecessorSql=predecessor.files.filter(file=>file.path.startsWith('database/migrations/')).map(({path,sha256_utf8_lf})=>({path,sha256_utf8_lf}));
      assert.equal(predecessorSql.length,22);assert.deepEqual(files.slice(0,22),predecessorSql);
      const predecessorMarkers=await readMarkers();assert.deepEqual(predecessorMarkers.map(row=>row.migration_id),predecessorSql.slice(14).map(file=>path.posix.basename(file.path,'.sql')));
      validateYxxCatalog(await yxxCatalogInventory(pool));await validateThirdPartyStaffDirectoryCatalog(pool);
      assert.equal((await migrateCurrentBaselineWithYxx(options)).status,'NOOP_ALREADY_APPLIED');
      assert.equal((await migrateWorkbenchAuth(options))?.status,'NOOP_ALREADY_APPLIED');assert.equal((await migrateThirdPartyStaffDirectory(options))?.status,'NOOP_ALREADY_APPLIED');
      assert.deepEqual(await readMarkers(),predecessorMarkers);
      const currentOptions={...options,catalogProfile:'CURRENT_V2_49' as const};
      await assert.rejects(migrateCurrentBaselineWithYxx(currentOptions),{code:'CURRENT_MIGRATION_CATALOG_INVALID'},'a current replay profile cannot apply a partial combination');
      assert.deepEqual(await readMarkers(),predecessorMarkers);
      t.diagnostic('CURRENT_PREDECESSOR_CATALOG '+JSON.stringify({contract:'ADR-0027',status:'PASS',migration_files:predecessorSql,replay:'ALL_NOOP_MARKERS_UNCHANGED',historical_execution:false}));
      const forward:Array<[string,()=>Promise<{status:string}>]>=[
        ['037',()=>migrateWorkbenchSourceGroups(options)],['039',()=>migrateTicketSelfHandling(options)],
        ['040',()=>migrateTicketStaffCompletion(options)],['041/052',()=>migrateTicketRoundNotifications(options)],
        ['042',()=>migrateWorkbenchManualReports(options)],['043',()=>migrateTicketReopenRounds(options)],
        ['045/051',()=>migrateWorkbenchVerifiedManualReports(options)],['047',()=>migrateWorkbenchPersonalRead(options)],
        ['044',()=>migrateWorkbenchFollow(options)],['046',()=>migrateTicketUnassign(options)],
        ['048',()=>migrateTicketReturnToDispatch(options)],['049',()=>migrateWorkbenchFollowUpSchedules(options)],
        ['057',()=>migrateTicketReturnToDispatch(options)],['050',()=>migrateBotReporterFeedback(options)],
        ['053',()=>migrateWorkbenchFollowUpDueSignals(options)],['055',()=>migrateIncidentInternalNotes(options)],
        ['058',()=>migrateIncidentPublicProgress(options)],['054',()=>migrateIncidentOwnerTransfer(options)],
        ['060',()=>migrateIncidentDeliveryControl(options)],['061',()=>migrateConversationDeliveryCommands(options)],
        ['062',()=>migrateWorkbenchSupplementFollowUp(options)],['063',()=>migrateMvpNotifications(options)],
        ['064/065/066',()=>migrateYxxH5({...options,expectedDatabase:new URL(databaseUrl).pathname.slice(1),includePreviews:true})],
      ];
      const applyForward=async(expected:'APPLIED'|'NOOP_ALREADY_APPLIED')=>{
        for(const [migration,apply] of forward){t.diagnostic('CURRENT_SCOPE_STEP '+JSON.stringify({migration,expected}));assert.equal((await apply()).status,expected,migration);}
      };
      await applyForward('APPLIED');
      const markers=await readMarkers();
      assert.deepEqual(markers.map(row=>row.migration_id),scope.migration_files.slice(14).map(file=>path.posix.basename(file,'.sql')));
      for(const marker of markers){assert.equal(marker.checksum_sha256,digest(readFileSync(path.join(runtimeRoot,'database/migrations/'+marker.migration_id+'.sql'))));assert.equal(marker.time_pair,true,marker.migration_id);}
      const currentCatalog=await yxxCatalogInventory(pool);
      assert.throws(()=>validateYxxCatalog(currentCatalog),{code:'YXX_SELF_SERVICE_CATALOG_DRIFT'},'the original 034 contract must keep rejecting its successor');
      await assertCurrentMigrationCatalog(pool,'yxx',currentCatalog);await validateThirdPartyStaffDirectoryCatalog(pool);
      await assert.rejects(migrateCurrentBaselineWithYxx(options),{code:'P2_012_SCHEMA_DRIFT'},'the original default remains strict');
      for(const mutation of [
        'ALTER TABLE intake.web_request_binding ADD COLUMN unapproved_current_scope boolean',
        "DELETE FROM platform.schema_migration WHERE migration_id='066_yixiaoxiu_h5_media_previews'",
        "UPDATE platform.schema_migration SET checksum_sha256=repeat('0',64) WHERE migration_id='066_yixiaoxiu_h5_media_previews'",
      ]){
        const tx=await pool.connect();
        try{await tx.query('BEGIN');await tx.query(mutation);await assert.rejects(assertCurrentMigrationCatalog(tx,'yxx',await yxxCatalogInventory(tx)),{code:'CURRENT_MIGRATION_CATALOG_INVALID'});}
        finally{await tx.query('ROLLBACK');tx.release();}
      }
      assert.deepEqual(await readMarkers(),markers);
      const lastSql=path.join(runtimeRoot,'database/migrations/066_yixiaoxiu_h5_media_previews.sql'),lastBytes=readFileSync(lastSql);
      try{
        writeFileSync(lastSql,Buffer.concat([lastBytes,Buffer.from('\n-- synthetic unapproved runtime SQL\n')]));
        await assert.rejects(assertCurrentMigrationCatalog(pool,'yxx',currentCatalog),{code:'CURRENT_MIGRATION_CATALOG_INVALID'});
      }finally{writeFileSync(lastSql,lastBytes);assert.ok(readFileSync(lastSql).equals(lastBytes));}
      await assertCurrentMigrationCatalog(pool,'yxx',currentCatalog);
      const repeated=await migrateCurrentBaselineWithYxx(currentOptions);assert.ok(repeated.yxx);
      assert.equal(repeated.status,'NOOP_ALREADY_APPLIED');assert.equal(repeated.yxx.status,'NOOP_ALREADY_APPLIED');
      assert.deepEqual(repeated.legacy_applied,[]);
      const repeatedAuth=await migrateWorkbenchAuth(options),repeatedDirectory=await migrateThirdPartyStaffDirectory(options);assert.ok(repeatedAuth&&repeatedDirectory);
      assert.equal(repeatedAuth.status,'NOOP_ALREADY_APPLIED');assert.equal(repeatedDirectory.status,'NOOP_ALREADY_APPLIED');
      await applyForward('NOOP_ALREADY_APPLIED');
      assert.deepEqual(await readMarkers(),markers);
      const empty=await pool.query<{tickets:number;intakes:number}>('SELECT (SELECT count(*)::int FROM pilot_ticket.ticket) AS tickets,(SELECT count(*)::int FROM intake.service_intake) AS intakes');
      assert.deepEqual(empty.rows,[{tickets:0,intakes:0}]);
      t.diagnostic('CURRENT_SCOPE_CATALOG '+JSON.stringify({...g2EvidenceTime(),status:'PASS',
        candidate_fingerprint:currentRuntimeFingerprint(runtimeRoot),scope_sha256:scope.scope_sha256,
        database_scope:'OWNED_ISOLATED_DATABASE',postgres_version_num:version,migration_files:files,legacy_applied:legacy,markers,
        initial:{baseline:baseline.status,yxx:baseline.yxx.status,workbench_auth:auth.status,directory:directory.status},
        replay:'ALL_NOOP_MARKERS_UNCHANGED',catalog_verified:true,business_rows:empty.rows[0],live_authorized:false}));
    }});
  assert.equal(cleanupReceipts.length,1);
  assert.equal(cleanupReceipts[0]?.candidate_fingerprint,currentRuntimeFingerprint(runtimeRoot),
    'cleanup receipt must bind the actual executed runtime, independently of the canonical source root');
});
