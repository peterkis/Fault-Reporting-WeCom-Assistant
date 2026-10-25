import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import type {IncomingHttpHeaders} from 'node:http';
import {withP2016IsolatedDatabase,assertNoP2016Residual} from './p2-016-postgres-harness.mjs';
import type {PostgresPool} from '../../app/server/src/platform/postgres-pool.mjs';
import {migrateCurrentBaselineWithYxx} from '../../app/server/scripts/migrate-current-baseline.mjs';
import {migrateTicketSelfHandling} from '../../app/server/scripts/ticket-self-handling-migrate.mjs';
import {migrateTicketStaffCompletion} from '../../app/server/scripts/ticket-staff-completion-migrate.mjs';
import {migrateTicketRoundNotifications} from '../../app/server/scripts/ticket-round-notifications-migrate.mjs';
import {migrateWorkbenchManualReports} from '../../app/server/scripts/workbench-manual-reports-migrate.mjs';
import {migrateWorkbenchVerifiedManualReports} from '../../app/server/scripts/workbench-verified-manual-reports-migrate.mjs';
import {migrateTicketUnassign} from '../../app/server/scripts/ticket-unassign-migrate.mjs';
import {migrateTicketReturnToDispatch} from '../../app/server/scripts/ticket-return-to-dispatch-migrate.mjs';
import {migrateTicketReopenRounds} from '../../app/server/scripts/ticket-reopen-rounds-migrate.mjs';
import {migrateBotReporterFeedback} from '../../app/server/scripts/bot-reporter-feedback-migrate.mjs';
import {migrateIncidentInternalNotes} from '../../app/server/scripts/incident-internal-notes-migrate.mjs';
import {migrateIncidentPublicProgress} from '../../app/server/scripts/incident-public-progress-migrate.mjs';
import {migrateIncidentOwnerTransfer} from '../../app/server/scripts/incident-owner-transfer-migrate.mjs';
import {migrateIncidentDeliveryControl} from '../../app/server/scripts/incident-delivery-control-migrate.mjs';
import {migrateConversationDeliveryCommands} from '../../app/server/scripts/conversation-delivery-commands-migrate.mjs';
import {migrateWorkbenchPersonalRead} from '../../app/server/scripts/workbench-personal-read-migrate.mjs';
import {migrateWorkbenchFollow} from '../../app/server/scripts/workbench-follow-migrate.mjs';
import {migrateWorkbenchSupplementFollowUp} from '../../app/server/scripts/workbench-supplement-follow-up-migrate.mjs';
import {migrateWorkbenchFollowUpSchedules} from '../../app/server/scripts/workbench-follow-up-schedules-migrate.mjs';
import {migrateWorkbenchFollowUpDueSignals} from '../../app/server/scripts/workbench-follow-up-due-migrate.mjs';
import {migrateWorkbenchSourceGroups} from '../../app/server/scripts/workbench-source-groups-migrate.mjs';
import {createPilotAccessService} from '../../app/server/src/p1-009-pilot-access-workbench.mjs';
import {createYxxProfile} from '../../app/server/src/p2-g2-yixiaoxiu-profile.mjs';
import type {P2016EnabledRuntime} from '../../app/server/src/p2-016-runtime.mjs';
import {createP2016OrchestrationWorker} from '../../app/server/src/p2-016-orchestration-adapters.mjs';
import {listenConversationWorkbenchServer} from '../../app/server/src/p2-006-workbench-http.mjs';
import {createYxxBrowserFixture} from './p2-g2-yixiaoxiu-browser.mjs';
import {entryConfig,entryKey} from './p2-g2-yixiaoxiu-fixture.mjs';
import {createT18Directory} from './t18-verified-fixture.mjs';
import {closeBrowserTestResources} from './p2-006-browser-harness.mjs';
import {createCommunicationDeliveryWorker} from '../../app/server/src/p2-004-communication-delivery-worker.mjs';
import {createCommunicationSenderPort} from '../../app/server/src/p2-004-communication-sender-port.mjs';
import type {ValidatedSenderRequest} from '../../app/server/src/p2-004-communication-sender-port.mjs';
import type {IncidentDeliveryControlPermissionPort} from '../../contracts/workbench_incident_delivery_control_contracts.js';
import {createIncidentPublicProgressAdmission} from '../../app/server/src/p2-012-public-progress-admission.mjs';
import {createChannelMessageInbox} from '../../app/server/src/p1-003-channel-message-inbox.mjs';
import {createP2016DirectIntakeProcessor} from '../../app/server/src/p2-016-direct-intake.mjs';
import {createP2G1HumanOnlyAssembly} from '../../app/server/src/p2-g1-human-only-assembly.mjs';
import {createIncidentCorrelationWorker} from '../../app/server/src/p2-015-incident-correlation.mjs';
import {createP2012CandidateReviewStore} from '../../app/server/src/p2-012-candidate-source-adapter.mjs';
import {createYxxDelegatedIdentityMapping} from '../../app/server/src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import type {TicketAppNotificationOptions} from '../../contracts/workbench_app_notification_contracts.js';
import {assertEpochMsString,formatEpochMsToShanghaiLocal} from '../../app/server/src/platform/time-contract.mjs';
import {p2016TicketSourceIntake} from '../../app/server/src/p2-016-guided-journey.mjs';

export function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
export function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
export function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
export function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
export interface HttpResponse {status:number;body:Record<string,unknown>;headers:IncomingHttpHeaders;raw:string}
export interface HttpClient {cookies:Map<string,string>;request:(path:string,body?:Readonly<Record<string,unknown>>)=>Promise<HttpResponse>;get:(path:string)=>Promise<HttpResponse>;post:(path:string,body:Readonly<Record<string,unknown>>)=>Promise<HttpResponse>}
function httpClient(base:string,origin:string,initial:{name:string;value:string}[]=[]):HttpClient{
 const cookies=new Map(initial.map(c=>[c.name,c.value]));let csrf='';
 const request=async(path:string,body?:Readonly<Record<string,unknown>>):Promise<HttpResponse>=>{
  const expected=body?.expected_candidate_version??body?.expected_row_version??body?.expected_version??body?.expected_ticket_version??body?.expected_input_revision;
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
export interface Intake {intakeId:string;ticketId:string|null;reviewId:string|null;source:string;requestRef:string|null}
type SenderOutcome='UNKNOWN'|'REJECTED_NOT_APPLIED'|'ACKNOWLEDGED';
export interface T43Fixture {
 pool:PostgresPool;databaseUrl:string;runtime:P2016EnabledRuntime;origin:string;backendOrigin:string;certificateSpki:string;
 staff:HttpClient[];member:HttpClient;members:HttpClient[];principals:string[];browserCookies:{name:string;value:string;url:string}[];
 directoryCalls:()=>number;inbound:(chatType:'group'|'single',description:string,reporter?:string)=>Promise<Intake>;
 pump:()=>Promise<void>;project:()=>Promise<void>;intake:(id:string)=>Promise<Intake>;
 webReport:(description:string)=>Promise<Intake>;manualReport:(description:string)=>Promise<Intake>;
 deferredInbound:()=>Promise<Intake>;correlate:()=>Promise<string>;
 grants:Set<string>;senderCalls:ValidatedSenderRequest[];setSenderOutcome:(outcome:SenderOutcome)=>void;deliver:(deliveryId:string)=>Promise<unknown>;
}

/** One original FULL_SERVICE_LOOP business App and supplied pool. Only external identity/directory are synthetic. */
export async function withT43Fixture(run:(f:T43Fixture)=>Promise<void>,{syntheticDelivery=false}:{syntheticDelivery?:boolean}={}):Promise<void>{
 let outer:unknown;
 try{await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'t43full',max:4,run:async({pool,databaseUrl}:{pool:PostgresPool;databaseUrl:string})=>{
  await migrateCurrentBaselineWithYxx({databaseUrl});
  for(const migrate of [migrateTicketSelfHandling,migrateTicketStaffCompletion,migrateTicketRoundNotifications,migrateWorkbenchManualReports,migrateWorkbenchVerifiedManualReports,migrateTicketUnassign,migrateTicketReopenRounds,migrateWorkbenchPersonalRead,migrateBotReporterFeedback,migrateWorkbenchFollow,migrateWorkbenchSupplementFollowUp,migrateWorkbenchFollowUpSchedules,migrateTicketReturnToDispatch,migrateWorkbenchFollowUpDueSignals,migrateWorkbenchSourceGroups,migrateIncidentInternalNotes,migrateIncidentPublicProgress,migrateIncidentOwnerTransfer,migrateIncidentDeliveryControl,migrateConversationDeliveryCommands])await migrate({databaseUrl,mode:'apply'});
  const access=createPilotAccessService({pool}),principals:string[]=[];
  for(let index=0;index<4;index++){
   const p=await access.upsertPrincipal({wecomUserId:'t43-staff-'+index,displayName:'T43合成人员'+index,roles:index===0?['ADMIN']:index===2?['DISPATCHER']:['HANDLER'],resolverTeamIds:index===3?[]:['PILOT_IT']});principals.push(p.id);
  }
  const directory=createT18Directory();directory.setPrincipal(text(principals[0]));let directoryCalls=0;
  const offlineDirectory={...directory.directory,port:{async searchAuthorizedCandidates(){directoryCalls++;throw Error('T43_EXTERNAL_DIRECTORY_OFFLINE');},async verifyAuthorizedCandidate(){directoryCalls++;throw Error('T43_EXTERNAL_DIRECTORY_OFFLINE');}}};
  const grants=new Set<string>(),permissions:IncidentDeliveryControlPermissionPort={hasPermission:async({principal_id,incident_id,permission})=>grants.has(principal_id+'|'+incident_id+'|'+permission)};
  const senderCalls:ValidatedSenderRequest[]=[];let outcome:SenderOutcome='UNKNOWN';
  const sender=createCommunicationSenderPort(async request=>{assert.equal(syntheticDelivery,true,'only the explicit isolated recording Sender may run');senderCalls.push(request);return {outcome,provider_message_id:null,error_code:outcome==='ACKNOWLEDGED'?null:'SYNTHETIC_T43_'+outcome,retryable:false};});
  const delivery=createCommunicationDeliveryWorker({pool,sender,enabled:syntheticDelivery,batchSize:1,attemptAdmission:createIncidentPublicProgressAdmission({enabled:true})});
  // FULL_SERVICE_LOOP requires the original delegated mapping contract, unlike the read-only entry fixture.
  const memberConfig={...entryConfig,identityMode:'VERIFIED_DELEGATED_MAPPING',reporterUserIds:['synthetic-A','synthetic-B']};
  const identityMapping=await createYxxDelegatedIdentityMapping({config:memberConfig,accessTokenProvider:async()=> 't43-synthetic-mapping-only',fetchImpl:async input=>{const url=new URL(String(input));assert.equal(url.origin,'https://qyapi.weixin.qq.com');assert.equal(url.pathname,'/cgi-bin/batch/userid_to_openuserid');return new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:'synthetic-A',open_userid:'t43-open-A'},{userid:'synthetic-B',open_userid:'t43-open-B'}]}));}});
  const appTargets=new Map(memberConfig.reporterUserIds.map(userid=>[createHmac('sha256',entryKey).update(JSON.stringify(['member',memberConfig.corpId,memberConfig.agentId,userid])).digest('hex'),userid]));
  const appNotifications:TicketAppNotificationOptions={enabled:syntheticDelivery,authority:{sourceCorpScope:memberConfig.corpId,sourceAppScope:memberConfig.agentId,channelAccountId:'T43_SYNTHETIC_APP_ACCOUNT',mappingConfigHash:identityMapping.configHash,mappingProofRef:memberConfig.proofRef,proofKind:'SYNTHETIC',validationProfile:'ISOLATED_TEST'},targetResolver:{localOnly:true,async resolveCurrentTarget(input){
   input.signal.throwIfAborted();const checked=assertEpochMsString(String(Date.now())),base={schema_version:1,source_kind:input.source_kind,scope:input.scope,checked_at:formatEpochMsToShanghaiLocal(checked),checked_at_epoch_ms:checked};
   const target=input.source_kind==='WEB_REQUEST'&&input.scope.sourceCorpScope===memberConfig.corpId&&input.scope.sourceAppScope===memberConfig.agentId&&input.scope.proofRef===memberConfig.proofRef?appTargets.get(input.scope.scopeHash):undefined;
   if(!target)return {...base,state:'NOT_ELIGIBLE',reason:'NO_MAPPING'};
   return {...base,state:'ELIGIBLE',target:{provider:'WECOM_APP',channel_account_id:'T43_SYNTHETIC_APP_ACCOUNT',target_type:'PERSON',target_id:target},verification:{mapping_config_hash:identityMapping.configHash,mapping_proof_ref:memberConfig.proofRef,binding_proof_ref:input.scope.proofRef,proof_kind:'SYNTHETIC',account_status:'ACTIVE',binding_state:'VERIFIED',message_reachability:'REACHABLE'}};
  }}};
  let runtime:P2016EnabledRuntime|undefined,worker:ReturnType<typeof createP2016OrchestrationWorker>|undefined,tls:Awaited<ReturnType<typeof createYxxBrowserFixture>>|undefined,backendOrigin='';
  let failure:unknown;
  try{
   tls=await createYxxBrowserFixture({pool,createApp:({origin}:{origin:string})=>{
    const created=createYxxProfile({profile:'FULL_SERVICE_LOOP',reporterPolicy:'MEMBER_REQUIRED',pool,publicOrigin:origin,reporterOrigin:origin,listenPort:0,principalIds:principals,
     reporterMemberEntry:memberConfig,identityMapping,appNotifications,reporterHmacSecret:entryKey,wecomWebOAuth:{enabled:true,corpId:entryConfig.corpId,agentId:entryConfig.agentId,resolveCode:async code=>({userid:code==='synthetic-B-code'?'t43-open-B':'t43-open-A'})},
     flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true,REPORTER_TIMELINE_ENABLED:true,WECOM_TEMPLATE_CARD_ENABLED:true},
     yxxSelfService:{featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true},reporterFeedbackEnabled:true,reporterFeedbackDraftRecoveryEnabled:true},
     gatewayEnabled:false,senderEnabled:false,externalSendEnabled:syntheticDelivery,incidentFlags:{INCIDENT_CORRELATION_ENABLED:true,INCIDENT_PUBLIC_NOTICE_ENABLED:true,INCIDENT_PRIVATE_NOTICE_ENABLED:true},incidentTestLabel:true,incidentBackgroundMaintenance:false,incidentCandidateWorkspaceEnabled:true,incidentInternalNotesEnabled:true,incidentPublicProgressEnabled:true,incidentOwnerTransferEnabled:true,incidentDeliveryControlEnabled:true,incidentDeliveryControlPermissions:permissions,
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
   const members:HttpClient[]=[];
   for(const code of ['synthetic-A-code','synthetic-B-code']){const client=httpClient(backendOrigin,origin),begin=await client.get('/wecom/yixiaoxiu/login');assert.equal(begin.status,302);const callback=await client.get('/wecom/yixiaoxiu/callback?code='+code+'&state='+new URL(text(begin.headers.location)).searchParams.get('state'));assert.equal(callback.status,303,callback.raw);assert.equal((await client.get('/api/yixiaoxiu/bootstrap')).status,200);members.push(client);}
   const member=members[0];assert.ok(member);
   const intake=async(id:string):Promise<Intake>=>{const original=await p2016TicketSourceIntake({transaction:pool,intakeId:id});const item=(await pool.query<{id:string;pilot_ticket_id:string|null;source_channel:string;request_ref:string|null}>('SELECT i.id::text,COALESCE(i.pilot_ticket_id,(SELECT t.id FROM pilot_ticket.ticket t WHERE t.source_intake_id=$2::uuid))::text AS pilot_ticket_id,i.source_channel,b.request_ref FROM intake.service_intake i LEFT JOIN intake.web_request_binding b ON b.intake_id=i.id WHERE i.id=$1::uuid',[id,original])).rows[0];assert.ok(item);const review=(await pool.query<{id:string}>("SELECT id::text FROM intake.manual_review_item WHERE service_intake_id=$1::uuid AND status='PENDING' ORDER BY id LIMIT 1",[id])).rows[0];return {intakeId:id,ticketId:item.pilot_ticket_id,reviewId:review?.id??null,source:item.source_channel,requestRef:item.request_ref};};
   const project=async()=>{for(let i=0;i<20;i++){const step=await active.coordinator.runOnce();assert.ok(step.streams.every(s=>s.failures.length===0),JSON.stringify(step));await active.realtimeProjector.runOnce({limit:100});if((await active.coordinator.backlog()).total===0)return;}assert.fail('T43_ACTUAL_PROJECTOR_BACKLOG_NOT_DRAINED');};
   const pump=async()=>{for(let i=0;i<3;i++){const result=await operational.processDueBatch({feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true},batch_size:20,now_epoch_ms:String(Date.now()+15000)});assert.equal(result.model_provider_calls,0);assert.equal(result.disabled,false);}await project();};
   const inbound=async(chatType:'group'|'single',description:string,reporter='synthetic-A')=>{const id=randomUUID(),accepted=object(await active.assembly.handleFrame({cmd:'aibot_msg_callback',headers:{req_id:'t43-'+id},body:{msgid:id,aibotid:'bot-test',chattype:chatType,...(chatType==='group'?{chatid:'t43-synthetic-origin-group'}:{}),from:{userid:reporter},msgtype:'text',text:{content:description}}}));assert.equal(accepted.ok,true);const id2=text(object(object(accepted.result).intake).id);await pump();return intake(id2);};
   const webReport=async(description:string)=>{const response=await member.post('/api/yixiaoxiu/requests',{schema_version:1,client_command_id:randomUUID(),description,location:{text:'T43合成网页位置',unknown:false},service_code:null,impact_scope:'SINGLE_WORKSTATION',reported_department_text:null,extension:null});assert.equal(response.status,202,response.raw);const ref=text(object(response.body.receipt).request_ref);await pump();const row=(await pool.query<{intake_id:string}>('SELECT intake_id::text FROM intake.web_request_binding WHERE request_ref=$1',[ref])).rows[0];assert.ok(row);return intake(row.intake_id);};
   const manualReport=async(description:string)=>{const admin=staff[0];assert.ok(admin);const response=await admin.post('/api/workbench/reports',{schema_version:1,client_command_id:randomUUID(),source:'PHONE',description,location:{text:'T43合成电话位置',unknown:false},reporter:{verification:'UNVERIFIED',name:'T43合成电话报修人',contact:'合成内线9943',department:null}});assert.equal(response.status,202,response.raw);assert.equal(response.body.external_notification,false);await project();return intake(text(response.body.intake_id));};
   const deferredInbox=createChannelMessageInbox({pool}),processor=createP2016DirectIntakeProcessor(),deferredAssembly=createP2G1HumanOnlyAssembly({projectAfterCommit:false,operationalIntake:{accept:input=>deferredInbox.accept(input,processor)}});
   const deferredInbound=async()=>{const msgid=randomUUID(),accepted=object(await deferredAssembly.handleFrame({cmd:'aibot_msg_callback',headers:{req_id:msgid},body:{msgid,aibotid:'bot-test',chattype:'single',from:{userid:'t43-delayed-'+randomUUID()},msgtype:'text',text:{content:'合成打印机打印不了。'}}}));assert.equal(accepted.ok,true);assert.equal(object(accepted.projection).deferred,true);const backlog=await active.coordinator.backlog();if(backlog.disabled)throw Error('T43_COORDINATOR_DISABLED');assert.ok(backlog.channel_messages>0);return intake(text(object(object(accepted.result).intake).id));};
   const correlate=async()=>{const correlated=await createIncidentCorrelationWorker({pool,enabled:true}).runOnce();assert.ok(correlated.correlated>0,'actual normal reports must produce a real correlation candidate');const importer=createP2012CandidateReviewStore({pool,enabled:true});const pending=await pool.query<{id:string}>("SELECT d.id::text FROM intake.deterministic_decision d WHERE d.result_code='INCIDENT_REVIEW_CANDIDATE' AND NOT EXISTS(SELECT 1 FROM incident.candidate_review c WHERE c.source_decision_id=d.id AND c.source_result_hash=d.result_hash) ORDER BY d.created_at,d.id LIMIT 20");for(const d of pending.rows)await importer.importDecision({decisionId:d.id});const candidates=await pool.query<{id:string}>('SELECT id::text FROM incident.candidate_review ORDER BY created_at,id');assert.equal(candidates.rowCount,1);const selected=candidates.rows[0];assert.ok(selected);return selected.id;};
   await run({pool,databaseUrl,runtime:active,origin,backendOrigin,certificateSpki:tls.certificateSpki,staff,member,members,principals,browserCookies:cookies.map(c=>({name:c.name,value:c.value,url:origin+'/'})),directoryCalls:()=>directoryCalls,inbound,pump,project,intake,webReport,manualReport,deferredInbound,correlate,grants,senderCalls,setSenderOutcome:value=>{outcome=value;},deliver:deliveryId=>delivery.deliver({deliveryId})});
  }catch(error){failure=error;}
  await closeBrowserTestResources([()=>worker?.stop(),()=>tls?.close(),()=>runtime?.stop(),()=>{if(runtime)assert.equal(runtime.server.listening,false);if(tls)assert.deepEqual(tls.ownedResourceState(),{listeners:0,sockets:0,tlsDirectories:0});}],failure);
 }});}catch(error){outer=error;}
 await closeBrowserTestResources([()=>assertNoP2016Residual({databaseUrl:process.env.PILOT_DATABASE_URL})],outer);
}
