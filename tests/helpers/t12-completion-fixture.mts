import {withWeb01Fixture} from './web01-workbench-fixture.mjs';
import type {T11Fixture} from './t11-completion-fixture.mjs';
import {createP2016Runtime} from '../../app/server/src/p2-016-runtime.mjs';
import {migrateTicketStaffCompletion} from '../../app/server/scripts/ticket-staff-completion-migrate.mjs';

/** Test-only SOURCE preparation: forward the planned false-default option; no production implementation. */
export async function withT12Fixture(run:(context:T11Fixture)=>Promise<void>){
  await withWeb01Fixture(async(f:T11Fixture)=>{
    await f.runtime.stop();
    await migrateTicketStaffCompletion({databaseUrl:f.databaseUrl,mode:'apply'});
    const options={pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true as const},publicOrigin:f.origin,
      listenPort:Number(new URL(f.origin).port),principalIds:[f.principals[0]?.id??'',f.outsider.id,f.principals[1]?.id??''],
      externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketConversationSelfHandlingEnabled:true,
      ticketTakeoverEnabled:true,ticketStaffCompletionEnabled:true,ticketTakeoverCompletionEnabled:true,
      workbenchInternalNotesEnabled:false,workbenchDraftRecoveryEnabled:false};
    // The extra planned option is currently ignored: the actual first business RED must await WHOLE.
    const runtime=createP2016Runtime(options);
    try{const started=await runtime.start();if(!started.cookies)throw Error('T12_AUTH_REQUIRED');
      await run({...f,runtime,cookies:started.cookies.map(c=>c.name+'='+c.value),browserCookies:started.cookies});
    }finally{await runtime.stop();if(runtime.server.listening)throw Error('T12_HTTP_RESIDUAL');}
  },{ticketSelfHandlingEnabled:true,ticketConversationSelfHandlingEnabled:true,ticketTakeoverEnabled:true,
    ticketSelfHandlingWebSource:false,chronologicalTicketEvents:true});
}
