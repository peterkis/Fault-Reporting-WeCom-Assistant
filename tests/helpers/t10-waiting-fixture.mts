import {withWeb01Fixture} from './web01-workbench-fixture.mjs';
import {createP2016Runtime} from '../../app/server/src/p2-016-runtime.mjs';
import type {T11Fixture} from './t11-completion-fixture.mjs';

/** Reuses the owned WEB01 synthetic database and current HTTP host. */
export async function withT10Fixture(run:(context:T11Fixture)=>Promise<void>,{waitingEnabled=true,recoveryEnabled=true,installCycleSchema=true}:{waitingEnabled?:boolean;recoveryEnabled?:boolean;installCycleSchema?:boolean}={}){
  await withWeb01Fixture(async(context:T11Fixture)=>{
    await context.runtime.stop();
    const options={pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true as const},publicOrigin:context.origin,listenPort:Number(new URL(context.origin).port),principalIds:[context.principals[0]?.id??'',context.outsider.id,context.principals[1]?.id??''],externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketWaitingActionsEnabled:waitingEnabled,workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:recoveryEnabled};
    const runtime=createP2016Runtime(options);
    try{const started=await runtime.start();if(!started.cookies)throw Error('T10_AUTH_REQUIRED');await run({...context,runtime,cookies:started.cookies.map(cookie=>cookie.name+'='+cookie.value),browserCookies:started.cookies});}
    finally{await runtime.stop();if(runtime.server.listening)throw Error('T10_HTTP_RESIDUAL');}
  },{ticketSelfHandlingEnabled:true,installTicketSelfHandlingSchema:installCycleSchema});
}
