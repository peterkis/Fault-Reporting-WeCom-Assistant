import {withT12Fixture} from './t12-completion-fixture.mjs';
import type {T11Fixture} from './t11-completion-fixture.mjs';
import {createP2016Runtime} from '../../src/p2-016-runtime.mjs';

/** Additional public HTTP profiles; the original first fixture remains byte frozen. */
export async function withT12Profile(run:(context:T11Fixture)=>Promise<void>,{
 recoveryEnabled=true,takeoverCompletionEnabled=true,notesEnabled=true,
}:{recoveryEnabled?:boolean;takeoverCompletionEnabled?:boolean;notesEnabled?:boolean}={}){
 await withT12Fixture(async f=>{
  await f.runtime.stop();
  const runtime=createP2016Runtime({pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.origin,
   listenPort:Number(new URL(f.origin).port),principalIds:[f.principals[0]?.id??'',f.outsider.id,f.principals[1]?.id??''],
   externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketConversationSelfHandlingEnabled:true,
   ticketTakeoverEnabled:true,ticketStaffCompletionEnabled:true,ticketTakeoverCompletionEnabled:takeoverCompletionEnabled,
   workbenchInternalNotesEnabled:notesEnabled,workbenchDraftRecoveryEnabled:recoveryEnabled});
  try{const started=await runtime.start();if(!started.cookies)throw Error('T12_PROFILE_AUTH_REQUIRED');
   await run({...f,runtime,cookies:started.cookies.map(c=>c.name+'='+c.value),browserCookies:started.cookies});
  }finally{await runtime.stop();if(runtime.server.listening)throw Error('T12_PROFILE_HTTP_RESIDUAL');}
 });
}
