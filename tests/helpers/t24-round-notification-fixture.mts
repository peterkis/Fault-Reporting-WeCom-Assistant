import assert from 'node:assert/strict';
import {withWeb01Fixture} from './web01-workbench-fixture.mjs';
import {seedPersistedIntake} from './p2-015-postgres-harness.mjs';
import {createP2016Runtime} from '../../src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../../src/p2-006-workbench-http.mjs';
import {createPilotTicketCore} from '../../src/p1-005-pilot-ticket-core.mjs';
import {migrateTicketStaffCompletion} from '../../scripts/ticket-staff-completion-migrate.mjs';
import type {T11Fixture} from './t11-completion-fixture.mjs';
import {entryConfig,entryKey} from './p2-g2-yixiaoxiu-fixture.mjs';
import {migrateTicketRoundNotifications} from '../../scripts/ticket-round-notifications-migrate.mjs';
import {migrateTicketUnassign} from '../../scripts/ticket-unassign-migrate.mjs';

export async function withT24Fixture(run:(context:T11Fixture & {ticketId:string})=>Promise<void>,{ticketAssignmentEnabled=false,ticketUnassignEnabled=false,ticketConversationSelfHandlingEnabled=false,manualRoundConsumption=false}:{ticketAssignmentEnabled?:boolean;ticketUnassignEnabled?:boolean;ticketConversationSelfHandlingEnabled?:boolean;manualRoundConsumption?:boolean}={}){
  await withWeb01Fixture(async(f:T11Fixture)=>{
    await f.runtime.stop();await migrateTicketStaffCompletion({databaseUrl:f.databaseUrl,mode:'apply'});await migrateTicketRoundNotifications({databaseUrl:f.databaseUrl,mode:'apply'});
    if(ticketUnassignEnabled)await migrateTicketUnassign({databaseUrl:f.databaseUrl,mode:'apply'});
    const intake=await seedPersistedIntake({pool:f.pool,text:'合成Bot单聊报修',chatType:'single',requestType:'INCIDENT',status:'RECEIVED'});
    const created=await createPilotTicketCore({pool:f.pool}).createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'t24-fixture'});
    assert.ok(created.ticket);
    const options={pool:f.pool,publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),principalIds:[f.principals[0]?.id??'',f.outsider.id,f.principals[1]?.id??''],
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true as const,REPORTER_TIMELINE_ENABLED:true,WECOM_TEMPLATE_CARD_ENABLED:true},
      externalSendEnabled:false,ticketAssignmentEnabled,ticketUnassignEnabled,ticketConversationSelfHandlingEnabled,ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,
      reporterOrigin:'https://reporter.example.test',reporterHmacSecret:entryKey,reporterPolicy:'MEMBER_REQUIRED' as const,reporterMemberEntry:entryConfig,
      wecomWebOAuth:{enabled:true,corpId:entryConfig.corpId,agentId:entryConfig.agentId,resolveCode:async()=>{throw Error('NO_REAL_OAUTH');}},
      ticketRoundNotificationsEnabled:true};
    const runtime=createP2016Runtime(options);
    try{
      // Existing T08 host pattern: real HTTP, with automatic worker scheduling omitted only in explicit-consumption tests.
      // Every pre-existing caller keeps normal runtime.start(); no business state or production scheduler is faked.
      if(manualRoundConsumption)await listenConversationWorkbenchServer(runtime.server,{port:Number(new URL(f.origin).port)});
      const started=manualRoundConsumption?{cookies:runtime.authenticate.browserCookies?.()}:await runtime.start();
      assert.ok(started.cookies);await run({...f,runtime,ticketId:created.ticket.id,cookies:started.cookies.map(c=>c.name+'='+c.value),browserCookies:started.cookies});
    }
    finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
  },{ticketSelfHandlingEnabled:true});
}
