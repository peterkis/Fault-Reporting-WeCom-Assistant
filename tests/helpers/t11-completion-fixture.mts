import {withWeb01Fixture,seedWeb01NoConversationIntake} from './web01-workbench-fixture.mjs';
import {createP2016Runtime} from '../../app/server/src/p2-016-runtime.mjs';
import type {P2016EnabledRuntime} from '../../app/server/src/p2-016-runtime.mjs';
import type {PostgresPool} from '../../app/server/src/platform/postgres-pool.mjs';
import {randomUUID} from 'node:crypto';
import {migrateTicketStaffCompletion} from '../../app/server/scripts/ticket-staff-completion-migrate.mjs';
import {migrateTicketReopenRounds} from '../../app/server/scripts/ticket-reopen-rounds-migrate.mjs';
import {migrateBotReporterFeedback} from '../../app/server/scripts/bot-reporter-feedback-migrate.mjs';
import type {P2016TicketDetail} from '../../contracts/p2_016_contracts.js';
import {createPilotTicketCore} from '../../app/server/src/p1-005-pilot-ticket-core.mjs';
import {assertLocalDateTime} from '../../app/server/src/platform/time-contract.mjs';

export async function t11NewTicket(context:T11Fixture){
  const intake=await seedWeb01NoConversationIntake({pool:context.pool,text:'T11 mixed command synthetic fault'});
  const occurredAt=assertLocalDateTime(intake.receivedAt);
  const created=await createPilotTicketCore({pool:context.pool}).createForIntake({intakeId:intake.intakeId,occurredAt,traceId:'t11-mixed-source'});
  if(!created.ticket)throw Error('T11_MIXED_ADMISSION_FAILED');
  return created.ticket.id;
}

export interface T11Fixture {pool:PostgresPool;databaseUrl:string;tickets:{ticket:{id:string};intake:{intakeId:string;requestRef?:string}}[];principals:{id:string}[];outsider:{id:string};runtime:P2016EnabledRuntime;origin:string;cookies:string[];browserCookies:readonly {name:string;value:string;url:string|undefined;httpOnly:true;secure:boolean;sameSite:'Strict';expires:number}[]}
export async function withT11Fixture(run:(context:T11Fixture)=>Promise<void>,{completionEnabled=true,installCompletionSchema=true,notesEnabled=true,recoveryEnabled=true,conversationHandlingEnabled=false,boardActionsEnabled=false,reopenEnabled=false,waitingEnabled=false,assignmentEnabled=false}:{completionEnabled?:boolean;installCompletionSchema?:boolean;notesEnabled?:boolean;recoveryEnabled?:boolean;conversationHandlingEnabled?:boolean;boardActionsEnabled?:boolean;reopenEnabled?:boolean;waitingEnabled?:boolean;assignmentEnabled?:boolean}={}){
  await withWeb01Fixture(async(f:T11Fixture)=>{
    await f.runtime.stop();
    if(completionEnabled&&installCompletionSchema)await migrateTicketStaffCompletion({databaseUrl:f.databaseUrl,mode:'apply'});
    if(completionEnabled&&installCompletionSchema)await migrateTicketReopenRounds({databaseUrl:f.databaseUrl,mode:'apply'});
    if(completionEnabled&&installCompletionSchema)await migrateBotReporterFeedback({databaseUrl:f.databaseUrl,mode:'apply'});
    const options={pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true as const},publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),principalIds:[f.principals[0]?.id??'',f.outsider.id,f.principals[1]?.id??''],externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketConversationSelfHandlingEnabled:conversationHandlingEnabled,ticketStaffCompletionEnabled:completionEnabled,ticketReopenRoundsEnabled:reopenEnabled,ticketWaitingActionsEnabled:waitingEnabled,ticketAssignmentEnabled:assignmentEnabled,workbenchInternalNotesEnabled:notesEnabled,workbenchDraftRecoveryEnabled:recoveryEnabled,workbenchBoardActionsEnabled:boardActionsEnabled};
    const runtime=createP2016Runtime(options);
    try{const started=await runtime.start();if(!started.cookies)throw Error('T11_AUTH_REQUIRED');await run({...f,runtime,cookies:started.cookies.map(c=>c.name+'='+c.value),browserCookies:started.cookies});}
    finally{await runtime.stop();if(runtime.server.listening)throw Error('T11_HTTP_RESIDUAL');}
  },{ticketSelfHandlingEnabled:true});
}
export async function t11Http(context:T11Fixture,index=0,{closeConnections=false}:{closeConnections?:boolean}={}){
  const cookie=context.cookies[index];if(!cookie)throw Error('T11_AUTH_REQUIRED');
  const transport:Record<string,string>=closeConnections?{connection:'close'}:{};
  const get=async(path:string)=>fetch(context.origin+path,{headers:{cookie,...transport}});
  const bootstrap=await (await get('/api/lifecycle/bootstrap')).json() as {csrf_token:string};
  const post=async(id:string,action:string,body:{client_command_id:string;expected_version:unknown}&Record<string,unknown>,headers:Record<string,string>={})=>fetch(context.origin+'/api/tickets/'+id+'/'+action,{method:'POST',headers:{cookie,...transport,origin:context.origin,'content-type':'application/json','idempotency-key':body.client_command_id,'if-match':'"'+body.expected_version+'"','x-csrf-token':bootstrap.csrf_token,...headers},body:JSON.stringify(body)});
  const detail=async(id:string)=>(await (await get('/api/tickets/'+id)).json()) as P2016TicketDetail;
  const start=async(id:string)=>{
    const current=await detail(id),body={client_command_id:randomUUID(),expected_version:current.version,reason_code:'T11_START',resolver_team_id:current.resolver_team_id};
    const response=await post(id,'take-and-start',body);
    if(response.status!==200){
      const payload:unknown=await response.json().catch(()=>null);
      const error=payload&&typeof payload==='object'&&'error' in payload?payload.error:null;
      const code=error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'?error.code:null;
      const after=await detail(id);
      throw Error('T11_START_FAILED:'+response.status+':'+JSON.stringify({code,client_command_id:body.client_command_id,
        expected_version:body.expected_version,before_status:current.status,before_cycle:current.handling_cycle?.cycle_no??null,
        current_version:after.version,current_status:after.status,current_cycle:after.handling_cycle?.cycle_no??null}));
    }
    return detail(id);
  };
  const command=(current:P2016TicketDetail)=>{if(!current.handling_cycle)throw Error('T11_CYCLE_REQUIRED');return {client_command_id:randomUUID(),expected_version:current.version,reason_code:'STAFF_COMPLETED',handling_cycle_id:current.handling_cycle.id,internal_process:'INTERNAL_T11_CANARY：排查并重启合成设备。',external_summary:'打印服务已恢复，请重新尝试。',external_summary_confirmed:true as const};};
  return {get,post,detail,start,command};
}
