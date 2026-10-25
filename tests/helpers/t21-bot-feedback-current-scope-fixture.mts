// FORWARD_SOURCE_DRAFT / NOT_REGISTERED / NOT_COMPILED / NOT_RUN.
// Future tests/helpers/t21-bot-feedback-current-scope-fixture.mts; one owned PG.
// The original source-bound Bot/User/publicRef is a valid arrangement. Missing
// historical App pin is not a denial or a fixture prerequisite. Production T21
// HTTP/writer/050 remain NOT_IMPLEMENTED. Distinct approved App realms below
// are synthetic identity adapters, not live App authorization or history proof.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT11Fixture,t11Http} from './t11-completion-fixture.mjs';
import type {T11Fixture} from './t11-completion-fixture.mjs';
import {seedPersistedIntake} from './p2-015-postgres-harness.mjs';
import {createPilotTicketCore} from '../../app/server/src/p1-005-pilot-ticket-core.mjs';
import {createP2016Runtime} from '../../app/server/src/p2-016-runtime.mjs';
import {createP2016ReporterAccess} from '../../app/server/src/p2-016-reporter-access.mjs';
import {createP2016TicketNotificationProjector} from '../../app/server/src/p2-016-ticket-notification-projector.mjs';
import {textHashP2016,transactionP2016} from '../../app/server/src/p2-016-domain-contracts.mjs';
import {createContactJourneyStore,reporterIdentityHash} from '../../app/server/src/p2-015-contact-journey.mjs';
import {shanghaiLocalToEpochMs} from '../../app/server/src/platform/time-contract.mjs';
import {createYxxProfile} from '../../app/server/src/p2-g2-yixiaoxiu-profile.mjs';
import type {SelfServiceProfileOptions} from '../../app/server/src/p2-g2-yixiaoxiu-profile.mjs';
import {createWeComWebOAuth} from '../../app/server/src/p2-g2-wecom-web-oauth.mjs';
import {createYxxDelegatedIdentityMapping} from '../../app/server/src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {origin,secret,config,oauthOptions,browser,post} from './yxx-ss-009-http-fixture.mjs';
import type {BotReporterFeedbackInput} from '../../contracts/bot_reporter_feedback_contracts.js';

export function t21Object(value:unknown):Record<string,unknown>{assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
export const t21Config={...config,reporterUserIds:['user-test','other-user-test']};
const appOAuthId=(selected:typeof t21Config,member:'a'|'b')=>selected.agentId===t21Config.agentId?'open-'+member:'open-'+member+'-'+selected.agentId;
export function t21OAuthOptions(selected=t21Config){return {...oauthOptions,corpId:selected.corpId,agentId:selected.agentId,
 resolveCode:async(code:string)=>({userid:appOAuthId(selected,code==='a'||code.startsWith('a:')?'a':'b')})};}
// Provider authorization codes are single-use; repeated same-member logins need
// distinct synthetic codes rather than weakening the real OAuth replay fence.
export async function t21Login(client:ReturnType<typeof browser>,member:'a'|'b'='a'){
 const begin=await client.request('/wecom/yixiaoxiu/login');assert.equal(begin.status,302);
 const location=begin.headers.location;assert.equal(typeof location,'string');
 const state=new URL(String(location)).searchParams.get('state');assert.ok(state);
 const code=member+':'+randomUUID();
 assert.equal((await client.request('/wecom/yixiaoxiu/callback?state='+encodeURIComponent(state)+'&code='+encodeURIComponent(code))).status,303);
}
export async function t21Mapping(selected=t21Config){return createYxxDelegatedIdentityMapping({config:selected,
 accessTokenProvider:async()=> 'synthetic-t21-token-'+selected.agentId,fetchImpl:async()=>new Response(JSON.stringify({errcode:0,open_userid_list:[
 {userid:'user-test',open_userid:appOAuthId(selected,'a')},{userid:'other-user-test',open_userid:appOAuthId(selected,'b')}]}))});}
export async function t21OpenMember(context:T11Fixture,{write=true,botId=t21Config.botId,agentId=t21Config.agentId,webFeedback=false}:{write?:boolean;botId?:string;agentId?:string;webFeedback?:boolean}={}){
 const selected={...t21Config,botId,agentId,proofRef:agentId===t21Config.agentId?t21Config.proofRef:'tests/t21-synthetic-mapping-'+agentId};
 const options:SelfServiceProfileOptions & {botReporterFeedbackEnabled:boolean}={profile:'MEMBER_SELF_SERVICE',pool:context.pool,publicOrigin:origin,
  reporterMemberEntry:selected,identityMapping:await t21Mapping(selected),reporterHmacSecret:secret,oauth:createWeComWebOAuth(t21OAuthOptions(selected)),
  yxxSelfService:{reporterFeedbackEnabled:webFeedback,featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:write,YIXIAOXIU_MY_REPORTS_ENABLED:true},pollMilliseconds:100},botReporterFeedbackEnabled:true};
 const app=createYxxProfile(options);await app.start();await app.selfService.pump?.stop();return app;
}
export type T21DraftFixture=Parameters<Parameters<typeof withT21DraftFixture>[0]>[0];
// No nested owned databases or parallel App; the original T11 fixture owns PG.
export async function withT21DraftFixture(run:(fixture:{context:T11Fixture;ticketId:string;publicRef:string;path:string;
 completed:Awaited<ReturnType<Awaited<ReturnType<typeof t11Http>>['detail']>>;
 access:ReturnType<typeof createP2016ReporterAccess>;legacySession:string;associatedJourneyId:string|null;
 replaceMember(options?:Parameters<typeof t21OpenMember>[1]):Promise<ReturnType<typeof t21OpenMember> extends Promise<infer A>?A:never>;
 closeMember():Promise<void>;
 verifyStaff<T>(read:(staff:Awaited<ReturnType<typeof t11Http>>)=>Promise<T>):Promise<T>;
})=>Promise<void>,{associatedJourney=false}:{associatedJourney?:boolean}={}){
 await withT11Fixture(async context=>{
  const intake=await seedPersistedIntake({pool:context.pool,text:'合成门诊打印故障。',chatType:'single',requestType:'INCIDENT',status:'RECEIVED'});
  const created=await createPilotTicketCore({pool:context.pool}).createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'t21-draft-bot'});
  assert.ok(created.ticket);const ticketId=created.ticket.id,staff=await t11Http(context,0,{closeConnections:true}),active=await staff.start(ticketId);
  assert.equal((await staff.post(ticketId,'complete',staff.command(active))).status,200);
  const completed=await staff.detail(ticketId);assert.equal(completed.status,'CLOSED');assert.ok(completed.handling_cycle?.staff_completion_event_id);
  const journey=associatedJourney?await transactionP2016(context.pool,transaction=>createContactJourneyStore().ensureJourney({transaction,input:{
   entry_mode:'DIRECT_ORGANIC',origin_intake_id:intake.intakeId,linked_ticket_id:ticketId,
   reporter_identity_hash:reporterIdentityHash({provider:'WECOM_AIBOT',bot_id:'bot-test',reporter_external_id:'user-test',hmac_key:secret}),
   profile_resolution_status:'NOT_REQUIRED',evaluation_due_at:intake.receivedAt,evaluation_due_epoch_ms:shanghaiLocalToEpochMs(intake.receivedAt),
   reported_at:intake.receivedAt,last_activity_at:intake.receivedAt,privacy_class:'INTERNAL',
   retention_until:intake.retentionUntil,retention_until_epoch_ms:shanghaiLocalToEpochMs(intake.retentionUntil),
  }})):null;
  const access=createP2016ReporterAccess({pool:context.pool,enabled:true,hmacSecret:secret});
  const original=await transactionP2016(context.pool,transaction=>access.ensurePublicRefInTransaction({transaction,ticketId,
   reporterBindingHash:textHashP2016(JSON.stringify(['WECOM_AIBOT','bot-test','user-test'])),journeyId:journey?.id??null}));
  // Existing Notification/Outbox/Delivery/Grant Ports, genuine CLOSED event.
  // No fake Grant rows, fake event or Sender/SDK. This is only a legacy grant
  // prerequisite; it is NOT proof of T24 routing or delivery to the user.
  const notifications=createP2016TicketNotificationProjector({enabled:true,cardEnabled:true,reporterAccess:access});
  const notification=await transactionP2016(context.pool,transaction=>notifications.project({transaction,ticket:{id:ticketId},
   event:{event_id:completed.handling_cycle?.staff_completion_event_id??''}}));
  const deliveryId='delivery_id' in notification?notification.delivery_id:null,messageId='message_id' in notification?notification.message_id:null;
  assert.ok(typeof deliveryId==='string'&&typeof messageId==='string');
  // The original projector may already own this event with a text Delivery.
  // Reuse that real target/message and the original target-checking Grant Port,
  // never replace the Message/Delivery or claim a card was actually delivered.
  await transactionP2016(context.pool,transaction=>access.issueInTransaction({transaction,ticketId,deliveryId,messageId,
   reporterBindingHash:textHashP2016(JSON.stringify(['WECOM_AIBOT','bot-test','user-test']))}));
  const grant=await access.deliveryGrant({deliveryId}),legacy=await access.exchange(grant.token);
  assert.equal(legacy.public_ref,original.public_ref);
  await context.runtime.stop();assert.equal(context.runtime.server.listening,false);
  let current:Awaited<ReturnType<typeof t21OpenMember>>|null=null;
  const closeMember=async()=>{if(current){await current.stop();assert.equal(current.server.listening,false);current=null;}};
  const replaceMember=async(options?:Parameters<typeof t21OpenMember>[1])=>{await closeMember();current=await t21OpenMember(context,options);return current;};
  const verifyStaff=async<T,>(read:(http:Awaited<ReturnType<typeof t11Http>>)=>Promise<T>):Promise<T>=>{
   await closeMember();const runtime=createP2016Runtime({pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:context.origin,
    listenPort:Number(new URL(context.origin).port),principalIds:[context.principals[0]?.id??''],externalSendEnabled:false,
    ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketReopenRoundsEnabled:true});
   if('disabled' in runtime)throw Error('T21_DRAFT_STAFF_DISABLED');
   try{const started=await runtime.start();assert.ok(started.cookies);return await read(await t11Http({...context,runtime,cookies:started.cookies.map(c=>c.name+'='+c.value)},0,{closeConnections:true}));}
   finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
  };
  try{await run({context,ticketId,publicRef:original.public_ref,path:'/api/reporter/tickets/'+original.public_ref,
   completed,access,legacySession:legacy.sessionToken,associatedJourneyId:journey?.id??null,replaceMember,closeMember,verifyStaff});}
  finally{await closeMember();}
 });
}
export async function t21FeedbackCommand(member:ReturnType<typeof browser>,path:string):Promise<{csrf:string;command:BotReporterFeedbackInput}>{
 const detail=await member.request(path);assert.equal(detail.status,200,detail.text);
 const context=t21Object(t21Object(detail.json()).feedback_context);
 assert.equal(context.can_feedback,true,'current approved App mapping plus original Bot/User/ref and a genuine completed round must be eligible when the explicit T21 write capability is enabled');
 const bootstrap=await member.request('/api/reporter/feedback/bootstrap');assert.equal(bootstrap.status,200,bootstrap.text);
 const csrf=String(t21Object(bootstrap.json()).csrf_token);assert.match(csrf,/^[a-f0-9]{64}$/u);
 return {csrf,command:{schema_version:1,client_command_id:randomUUID(),feedback:'STILL_UNRESOLVED',completed_round_ref:String(context.completed_round_ref),expected_ticket_version:Number(context.ticket_version)}};
}
export function t21Send(member:ReturnType<typeof browser>,path:string,command:BotReporterFeedbackInput,csrf:string){return member.request(path+'/feedback',{
 ...post(command,csrf),headers:{...post(command,csrf).headers,'if-match':'"'+command.expected_ticket_version+'"'}});}

// These browser contracts assert Chinese Reporter status copy. Set the real
// browser language explicitly instead of inheriting the runner's OS locale.
export async function t21ChineseBrowser(surface:{evaluate(expression:string):Promise<unknown>;command(method:string,params:Record<string,unknown>):Promise<unknown>}):Promise<void>{
 const userAgent=await surface.evaluate('navigator.userAgent');assert.equal(typeof userAgent,'string');
 await surface.command('Emulation.setUserAgentOverride',{userAgent,acceptLanguage:'zh-CN'});
 assert.equal(await surface.evaluate('navigator.language'),'zh-CN');
}
