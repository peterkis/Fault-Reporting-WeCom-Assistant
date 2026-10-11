import assert from 'node:assert/strict';
import {withWeb01Fixture} from './web01-workbench-fixture.mjs';
import type {T11Fixture} from './t11-completion-fixture.mjs';
import type {ManualReporterDirectoryOptions} from '../../contracts/workbench_reporter_candidates_contracts.js';
import {createP2016Runtime} from '../../src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../../src/p2-006-workbench-http.mjs';
import {migrateTicketStaffCompletion} from '../../scripts/ticket-staff-completion-migrate.mjs';
import {migrateTicketRoundNotifications} from '../../scripts/ticket-round-notifications-migrate.mjs';
import {entryConfig,entryKey} from './p2-g2-yixiaoxiu-fixture.mjs';

/** Real migration/admission/Core/HTTP; only scheduled consumption is omitted in this explicit Port fixture. */
export async function withT25ManualFixture(run:(context:T11Fixture)=>Promise<void>,directory:ManualReporterDirectoryOptions){
 await withWeb01Fixture(async(f:T11Fixture)=>{
  await f.runtime.stop();
  await migrateTicketStaffCompletion({databaseUrl:f.databaseUrl,mode:'apply'});
  await migrateTicketRoundNotifications({databaseUrl:f.databaseUrl,mode:'apply'});
  const runtime=createP2016Runtime({pool:f.pool,publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),principalIds:[f.principals[0]?.id??'',f.outsider.id,f.principals[1]?.id??''],
   flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true,REPORTER_TIMELINE_ENABLED:true,WECOM_TEMPLATE_CARD_ENABLED:true},externalSendEnabled:false,
   ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketRoundNotificationsEnabled:true,workbenchManualReportsEnabled:true,workbenchReporterCandidatesEnabled:true,manualReporterDirectory:directory,
   reporterOrigin:'https://reporter.example.test',reporterHmacSecret:entryKey,reporterPolicy:'MEMBER_REQUIRED',reporterMemberEntry:entryConfig,
   wecomWebOAuth:{enabled:true,corpId:entryConfig.corpId,agentId:entryConfig.agentId,resolveCode:async()=>{throw Error('NO_REAL_OAUTH');}}});
  try{
   await listenConversationWorkbenchServer(runtime.server,{port:Number(new URL(f.origin).port)});
   const cookies=runtime.authenticate.browserCookies?.();assert.ok(cookies);
   await run({...f,runtime,cookies:cookies.map(c=>c.name+'='+c.value),browserCookies:cookies});
  }finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
 },{ticketSelfHandlingEnabled:true,workbenchManualReportsEnabled:true,workbenchReporterCandidatesEnabled:true,manualReporterDirectory:directory,manualProjection:true});
}
