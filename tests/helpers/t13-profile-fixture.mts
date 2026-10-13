import assert from 'node:assert/strict';
import{withWeb01Fixture}from'./web01-workbench-fixture.mjs';
import{createP2016Runtime}from'../../src/p2-016-runtime.mjs';import type{P2016EnabledRuntime}from'../../src/p2-016-runtime.mjs';
import type{T07Fixture}from'./t07-public-fixture.mjs';
import{migrateTicketStaffCompletion}from'../../scripts/ticket-staff-completion-migrate.mjs';
import{migrateTicketReopenRounds}from'../../scripts/ticket-reopen-rounds-migrate.mjs';
import{migrateTicketUnassign}from'../../scripts/ticket-unassign-migrate.mjs';
import{migrateTicketReturnToDispatch}from'../../scripts/ticket-return-to-dispatch-migrate.mjs';
import{closeBrowserTestResources}from'./p2-006-browser-harness.mjs';
export interface T13Fixture extends Omit<T07Fixture,'runtime'>{outsider:{id:string};runtime:P2016EnabledRuntime;browserCookies:readonly{name:string;value:string;url:string|undefined}[]}
/** Additional owned profiles form real facts through existing public commands; the original first stays frozen. */
export async function withT13Profile(run:(f:T13Fixture)=>Promise<void>,{historyEnabled=true,writeEnabled=true,realtimeEnabled=false}:{historyEnabled?:boolean;writeEnabled?:boolean;realtimeEnabled?:boolean}={}){
 await withWeb01Fixture(async(f:T13Fixture)=>{
  await f.runtime.stop();await migrateTicketStaffCompletion({databaseUrl:f.databaseUrl,mode:'apply'});await migrateTicketReopenRounds({databaseUrl:f.databaseUrl,mode:'apply'});await migrateTicketUnassign({databaseUrl:f.databaseUrl,mode:'apply'});await migrateTicketReturnToDispatch({databaseUrl:f.databaseUrl,mode:'apply'});
  const runtime=createP2016Runtime({pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),principalIds:[f.principals[0]?.id??'',f.outsider.id,f.principals[1]?.id??''],externalSendEnabled:false,workbenchAssignmentHistoryEnabled:historyEnabled,workbenchRealtimeEnabled:realtimeEnabled,ticketSelfHandlingEnabled:writeEnabled,ticketConversationSelfHandlingEnabled:writeEnabled,ticketAssignmentEnabled:writeEnabled,ticketTakeoverEnabled:writeEnabled,ticketTakeoverCompletionEnabled:writeEnabled,ticketStaffCompletionEnabled:writeEnabled,ticketReopenRoundsEnabled:writeEnabled,ticketUnassignEnabled:writeEnabled,ticketReturnToDispatchEnabled:writeEnabled,ticketWaitingActionsEnabled:writeEnabled});
  let primary:unknown;try{const started=await runtime.start();assert.ok(started.cookies);await run({...f,runtime,cookies:started.cookies.map(cookie=>cookie.name+'='+cookie.value),browserCookies:started.cookies});}catch(error){primary=error;}
  await closeBrowserTestResources([async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);assert.equal((await runtime.observability.metrics()).sse_clients,0);}],primary);
 },{ticketSelfHandlingEnabled:true,ticketConversationSelfHandlingEnabled:true,ticketTakeoverEnabled:true,ticketAssignmentEnabled:true,ticketSelfHandlingWebSource:false,chronologicalTicketEvents:true});
}