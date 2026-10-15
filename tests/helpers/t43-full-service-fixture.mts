import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import type {IncomingHttpHeaders} from 'node:http';
import {withP2016IsolatedDatabase,assertNoP2016Residual} from './p2-016-postgres-harness.mjs';
import type {PostgresPool} from '../../src/platform/postgres-pool.mjs';
import {migrateCurrentBaselineWithYxx} from '../../scripts/migrate-current-baseline.mjs';
import {migrateTicketSelfHandling} from '../../scripts/ticket-self-handling-migrate.mjs';
import {migrateTicketStaffCompletion} from '../../scripts/ticket-staff-completion-migrate.mjs';
import {migrateTicketRoundNotifications} from '../../scripts/ticket-round-notifications-migrate.mjs';
import {migrateWorkbenchManualReports} from '../../scripts/workbench-manual-reports-migrate.mjs';
import {migrateWorkbenchVerifiedManualReports} from '../../scripts/workbench-verified-manual-reports-migrate.mjs';
import {migrateTicketUnassign} from '../../scripts/ticket-unassign-migrate.mjs';
import {migrateTicketReturnToDispatch} from '../../scripts/ticket-return-to-dispatch-migrate.mjs';
import {migrateTicketReopenRounds} from '../../scripts/ticket-reopen-rounds-migrate.mjs';
import {migrateBotReporterFeedback} from '../../scripts/bot-reporter-feedback-migrate.mjs';
import {migrateIncidentInternalNotes} from '../../scripts/incident-internal-notes-migrate.mjs';
import {migrateIncidentPublicProgress} from '../../scripts/incident-public-progress-migrate.mjs';
import {migrateIncidentOwnerTransfer} from '../../scripts/incident-owner-transfer-migrate.mjs';
import {migrateIncidentDeliveryControl} from '../../scripts/incident-delivery-control-migrate.mjs';
import {migrateConversationDeliveryCommands} from '../../scripts/conversation-delivery-commands-migrate.mjs';
import {migrateWorkbenchPersonalRead} from '../../scripts/workbench-personal-read-migrate.mjs';
import {migrateWorkbenchFollow} from '../../scripts/workbench-follow-migrate.mjs';
import {migrateWorkbenchSupplementFollowUp} from '../../scripts/workbench-supplement-follow-up-migrate.mjs';
import {migrateWorkbenchFollowUpSchedules} from '../../scripts/workbench-follow-up-schedules-migrate.mjs';
import {migrateWorkbenchFollowUpDueSignals} from '../../scripts/workbench-follow-up-due-migrate.mjs';
import {migrateWorkbenchSourceGroups} from '../../scripts/workbench-source-groups-migrate.mjs';
import {createPilotAccessService} from '../../src/p1-009-pilot-access-workbench.mjs';
import {createYxxProfile} from '../../src/p2-g2-yixiaoxiu-profile.mjs';
import type {P2016EnabledRuntime} from '../../src/p2-016-runtime.mjs';
import {createP2016OrchestrationWorker} from '../../src/p2-016-orchestration-adapters.mjs';
import {listenConversationWorkbenchServer} from '../../src/p2-006-workbench-http.mjs';
import {createYxxBrowserFixture} from './p2-g2-yixiaoxiu-browser.mjs';
import {entryConfig,entryKey} from './p2-g2-yixiaoxiu-fixture.mjs';
import {createT18Directory} from './t18-verified-fixture.mjs';
import {closeBrowserTestResources} from './p2-006-browser-harness.mjs';

export function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
export function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
export function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
export function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
export interface HttpResponse {status:number;body:Record<string,unknown>;headers:IncomingHttpHeaders;raw:string}
export interface HttpClient {cookies:Map<string,string>;request:(path:string,body?:Readonly<Record<string,unknown>>)=>Promise<HttpResponse>;get:(path:string)=>Promise<HttpResponse>;post:(path:string,body:Readonly<Record<string,unknown>>)=>Promise<HttpResponse>}
function httpClient(base:string,origin:string,initial:{name:string;value:string}[]=[]):HttpClient{
 const cookies=new Map(initial.map(c=>[c.name,c.value]));let csrf='';
 const request=async(path:string,body?:Readonly<Record<string,unknown>>):Promise<HttpResponse>=>{
  const expected=body?.expected_candidate_version??body?.expected_row_version??body?.expected_version;
  const response=await new Promise<HttpResponse>((resolve,reject)=>{
   const req=httpRequest(base+path,{method:body?'POST':'GET',headers:{host:new URL(origin).host,cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),connection:'close',...(body?{origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':text(body.client_command_id),...(expected!==undefined?{'if-match':'"'+String(expected)+'"'}:{})}:{})}},incoming=>{
    const chunks:Buffer[]=[];incoming.on('data',(chunk:Buffer)=>chunks.push(chunk));incoming.on('error',reject);incoming.on('end',()=>{const raw=Buffer.concat(chunks).toString();resolve({status:incoming.statusCode??0,headers:incoming.headers,raw,body:raw&&incoming.headers['content-type']?.includes('application/json')?object(JSON.parse(raw)): {}});});
   });req.on('error',reject);req.setTimeout(10000,()=>req.destroy(Error('T43_HTTP_TIMEOUT')));req.end(body?JSON.stringify(body):undefined);
  });
  for(const cookie of response.headers['set-cookie']??[]){const [pair]=cookie.split(';');assert.ok(pair);const index=pair.indexOf('=');cookies.set(pair.slice(0,index),pair.slice(index+1));}
  if(typeof response.body.csrf_token==='string')csrf=response.body.csrf_token;
  return response;
 };
 return {cookies,request,get:path=>request(path),post:(path,body)=>request(path,body)};
}
export interface Intake {intakeId:string;ticketId:string|null;reviewId:string|null;source:string}
export interface T43Fixture {
 pool:PostgresPool;databaseUrl:string;runtime:P2016EnabledRuntime;origin:string;backendOrigin:string;certificateSpki:string;
 staff:HttpClient[];member:HttpClient;principals:string[];browserCookies:{name:string;value:string;url:string}[];
 directoryCalls:()=>number;inbound:(chatType:'group'|'single',description:string,reporter?:string)=>Promise<Intake>;
 pump:()=>Promise<void>;project:()=>Promise<void>;intake:(id:string)=>Promise<Intake>;
 webReport:(description:string)=>Promise<Intake>;manualReport:(description:string)=>Promise<Intake>;
}

/** One original FULL_SERVICE_LOOP business App and supplied pool. Only external identity/directory are synthetic. */
export async function withT43Fixture(run:(f:T43Fixture)=>Promise<void>):Promise<void>{
 let outer:unknown;
 try{await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'t43full',max:4,run:async({pool,databaseUrl}:{pool:PostgresPool;databaseUrl:string})=>{
  await migrateCurrentBaselineWithYxx({databaseUrl});
  for(const migrate of [migrateTicketSelfHandling,migrateTicketStaffCompletion,migrateTicketRoundNotifications,migrateWorkbenchManualReports,migrateWorkbenchVerifiedManualReports,migrateTicketUnassign,migrateTicketReturnToDispatch,migrateTicketReopenRounds,migrateBotReporterFeedback,migrateIncidentInternalNotes,migrateIncidentPublicProgress,migrateIncidentOwnerTransfer,migrateIncidentDeliveryControl,migrateConversationDeliveryCommands,migrateWorkbenchPersonalRead,migrateWorkbenchFollow,migrateWorkbenchSupplementFollowUp,migrateWorkbenchFollowUpSchedules,migrateWorkbenchFollowUpDueSignals,migrateWorkbenchSourceGroups])await migrate({databaseUrl,mode:'apply'});
  const access=createPilotAccessService({pool}),principals:string[]=[];
  for(let index=0;index<4;index++){
   const p=await access.upsertPrincipal({wecomUserId:'t43-staff-'+index,displayName:'T43合成人员'+index,roles:index===0?['ADMIN']:['HANDLER'],resolverTeamIds:index===3?[]:['PILOT_IT']});principals.push(p.id);
  }
  const directory=createT18Directory();directory.setPrincipal(text(principals[0]));let directoryCalls=0;
  const offlineDirectory={...directory.directory,port:{async searchAuthorizedCandidates(){directoryCalls++;throw Error('T43_EXTERNAL_DIRECTORY_OFFLINE');},async verifyAuthorizedCandidate(){directoryCalls++;throw Error('T43_EXTERNAL_DIRECTORY_OFFLINE');}}};
  let runtime:P2016EnabledRuntime|undefined,worker:ReturnType<typeof createP2016OrchestrationWorker>|undefined,tls:Awaited<ReturnType<typeof createYxxBrowserFixture>>|undefined,backendOrigin='';
  let failure:unknown;
  try{
   tls=await createYxxBrowserFixture({pool,createApp:({origin}:{origin:string})=>{
    const created=createYxxProfile({profile:'FULL_SERVICE_LOOP',reporterPolicy:'MEMBER_REQUIRED',pool,publicOrigin:origin,reporterOrigin:origin,listenPort:0,principalIds:principals,
     reporterMemberEntry:entryConfig,reporterHmacSecret:entryKey,wecomWebOAuth:{enabled:true,corpId:entryConfig.corpId,agentId:entryConfig.agentId,resolveCode:async code=>({userid:code==='synthetic-B-code'?'synthetic-B':'synthetic-A'})},
     flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true,REPORTER_TIMELINE_ENABLED:true,WECOM_TEMPLATE_CARD_ENABLED:true},
     yxxSelfService:{featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true},reporterFeedbackEnabled:true,reporterFeedbackDraftRecoveryEnabled:true},
     gatewayEnabled:false,senderEnabled:false,externalSendEnabled:false,incidentFlags:{INCIDENT_CORRELATION_ENABLED:true,INCIDENT_PUBLIC_NOTICE_ENABLED:true,INCIDENT_PRIVATE_NOTICE_ENABLED:true},incidentBackgroundMaintenance:false,incidentCandidateWorkspaceEnabled:true,incidentInternalNotesEnabled:true,incidentPublicProgressEnabled:true,incidentOwnerTransferEnabled:true,incidentDeliveryControlEnabled:true,
     workbenchManualReportsEnabled:true,workbenchReporterCandidatesEnabled:true,manualReporterDirectory:offlineDirectory,workbenchManualReviewEnabled:true,workbenchReviewResolveAndStartEnabled:true,workbenchConversationsEnabled:true,workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true,
     ticketSelfHandlingEnabled:true,ticketConversationSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketTakeoverEnabled:true,ticketTakeoverCompletionEnabled:true,ticketAssignmentEnabled:true,ticketWaitingActionsEnabled:true,ticketUnassignEnabled:true,ticketReturnToDispatchEnabled:true,ticketReopenRoundsEnabled:true,botReporterFeedbackEnabled:true,botReporterFeedbackDraftRecoveryEnabled:true,ticketRoundNotificationsEnabled:true,
     workbenchFollowEnabled:true,workbenchPersonalReadEnabled:true,workbenchFollowUpSchedulesEnabled:true,workbenchRealtimeEnabled:true,workbenchActivityEnabled:true,workbenchRemindersEnabled:true,workbenchSearchEnabled:true,workbenchBoardActionsEnabled:true,workbenchAssignmentHistoryEnabled:true,notificationExceptionsEnabled:true,sourceGroupDirectoryEnabled:true});
    if('disabled' in created)throw Error('T43_ENABLED_FULL_SERVICE_RUNTIME_REQUIRED');runtime=created;
    return created.server;
   },startApp:async()=>{assert.ok(runtime);const address=await listenConversationWorkbenchServer(runtime.server,{port:0});backendOrigin='http://127.0.0.1:'+address.port;return backendOrigin;},stopApp:async()=>{await runtime?.stop();}});
   assert.ok(runtime&&tls);const active=runtime,origin=tls.origin;
   assert.equal(active.orchestrationWorker,null);assert.ok(active.selfService);assert.ok(active.incidentExtension);
   worker=createP2016OrchestrationWorker({pool,identityHmacKey:'t43-synthetic-identity-key',notifications:active.notifications,realtime:active.realtimeProjector,yxxSelfService:{featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true}}});
   const operational=worker;
   const cookies=active.authenticate.browserCookies?.();assert.ok(cookies&&cookies.length===4);
   const staff=await Promise.all(cookies.map(async cookie=>{const http=httpClient(backendOrigin,origin,[cookie]);const bootstrap=await http.get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200,bootstrap.raw);assert.equal(bootstrap.body.ai_enabled,false);return http;}));
   const member=httpClient(backendOrigin,origin),begin=await member.get('/wecom/yixiaoxiu/login');assert.equal(begin.status,302);
   const callback=await member.get('/wecom/yixiaoxiu/callback?code=synthetic-A-code&state='+new URL(text(begin.headers.location)).searchParams.get('state'));assert.equal(callback.status,303,callback.raw);
   const bootstrap=await member.get('/api/yixiaoxiu/bootstrap');assert.equal(bootstrap.status,200,bootstrap.raw);
   const intake=async(id:string):Promise<Intake>=>{const item=(await pool.query<{id:string;pilot_ticket_id:string|null;source_channel:string}>('SELECT id::text,pilot_ticket_id::text,source_channel FROM intake.service_intake WHERE id=$1::uuid',[id])).rows[0];assert.ok(item);const review=(await pool.query<{id:string}>("SELECT id::text FROM intake.manual_review_item WHERE service_intake_id=$1::uuid AND status='PENDING' ORDER BY id LIMIT 1",[id])).rows[0];return {intakeId:id,ticketId:item.pilot_ticket_id,reviewId:review?.id??null,source:item.source_channel};};
   const project=async()=>{for(let i=0;i<20;i++){const step=await active.coordinator.runOnce();assert.ok(step.streams.every(s=>s.failures.length===0));await active.realtimeProjector.runOnce({limit:100});if((await active.coordinator.backlog()).total===0)return;}assert.fail('T43_ACTUAL_PROJECTOR_BACKLOG_NOT_DRAINED');};
   const pump=async()=>{for(let i=0;i<3;i++){const result=await operational.processDueBatch({feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true},batch_size:20,now_epoch_ms:String(Date.now()+15000)});assert.equal(result.model_provider_calls,0);assert.equal(result.disabled,false);}await project();};
   const inbound=async(chatType:'group'|'single',description:string,reporter='synthetic-A')=>{const id=randomUUID(),accepted=object(await active.assembly.handleFrame({cmd:'aibot_msg_callback',headers:{req_id:'t43-'+id},body:{msgid:id,aibotid:'bot-test',chattype:chatType,...(chatType==='group'?{chatid:'t43-synthetic-origin-group'}:{}),from:{userid:reporter},msgtype:'text',text:{content:description}}}));assert.equal(accepted.ok,true);const id2=text(object(object(accepted.result).intake).id);await pump();return intake(id2);};
   const webReport=async(description:string)=>{const response=await member.post('/api/yixiaoxiu/requests',{schema_version:1,client_command_id:randomUUID(),description,location:{text:'T43合成网页位置',unknown:false},service_code:null,impact_scope:'SINGLE_WORKSTATION',reported_department_text:null,extension:null});assert.equal(response.status,202,response.raw);const ref=text(object(response.body.receipt).request_ref);await pump();const row=(await pool.query<{intake_id:string}>('SELECT intake_id::text FROM intake.web_request_binding WHERE request_ref=$1',[ref])).rows[0];assert.ok(row);return intake(row.intake_id);};
   const manualReport=async(description:string)=>{const admin=staff[0];assert.ok(admin);const response=await admin.post('/api/workbench/reports',{schema_version:1,client_command_id:randomUUID(),source:'PHONE',description,location:{text:'T43合成电话位置',unknown:false},reporter:{verification:'UNVERIFIED',name:'T43合成电话报修人',contact:'合成内线9943',department:null}});assert.equal(response.status,202,response.raw);assert.equal(response.body.external_notification,false);await project();return intake(text(response.body.intake_id));};
   await run({pool,databaseUrl,runtime:active,origin,backendOrigin,certificateSpki:tls.certificateSpki,staff,member,principals,browserCookies:cookies.map(c=>({name:c.name,value:c.value,url:origin+'/'})),directoryCalls:()=>directoryCalls,inbound,pump,project,intake,webReport,manualReport});
  }catch(error){failure=error;}
  await closeBrowserTestResources([()=>worker?.stop(),()=>tls?.close(),()=>runtime?.stop(),()=>{if(runtime)assert.equal(runtime.server.listening,false);if(tls)assert.deepEqual(tls.ownedResourceState(),{listeners:0,sockets:0,tlsDirectories:0});}],failure);
 }});}catch(error){outer=error;}
 await closeBrowserTestResources([()=>assertNoP2016Residual({databaseUrl:process.env.PILOT_DATABASE_URL})],outer);
}
