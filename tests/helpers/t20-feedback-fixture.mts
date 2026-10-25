import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT11Fixture,t11Http} from './t11-completion-fixture.mjs';
import type {T11Fixture} from './t11-completion-fixture.mjs';
import type {P2016TicketDetail} from '../../contracts/p2_016_contracts.js';
import {createP2016Runtime} from '../../app/server/src/p2-016-runtime.mjs';
import {createYxxProfile} from '../../app/server/src/p2-g2-yixiaoxiu-profile.mjs';
import {createWeComWebOAuth} from '../../app/server/src/p2-g2-wecom-web-oauth.mjs';
import {origin,secret,config,oauthOptions,mapping,browser,login,input,post} from './yxx-ss-009-http-fixture.mjs';
import type {YxxFeedbackInput} from '../../contracts/yxx_self_service_feedback_contracts.js';

export function t20Object(value:unknown):Record<string,unknown>{assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
async function t20MemberOptions(context:T11Fixture){const featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:boolean;YIXIAOXIU_MY_REPORTS_ENABLED:boolean}={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};return {pool:context.pool,publicOrigin:origin,reporterMemberEntry:config,identityMapping:await mapping(),reporterHmacSecret:secret,featureFlags};}
function t20MemberApp(options:Awaited<ReturnType<typeof t20MemberOptions>>){return createYxxProfile({...options,profile:'MEMBER_SELF_SERVICE',oauth:createWeComWebOAuth(oauthOptions),yxxSelfService:{featureFlags:options.featureFlags,pollMilliseconds:100,reporterFeedbackEnabled:true}});}
export interface T20FeedbackFixture{
 context:T11Fixture;options:Awaited<ReturnType<typeof t20MemberOptions>>;app:ReturnType<typeof t20MemberApp>;member:ReturnType<typeof browser>;
 path:string;requestRef:string;ticketId:string;completed:P2016TicketDetail;csrf:string;command:YxxFeedbackInput;
 send(body?:YxxFeedbackInput,headers?:Record<string,string>):ReturnType<ReturnType<typeof browser>['request']>;
}
// Single App at every stage; synthetic identity adapters, actual admission/Core/T04/T11 and native HTTP.
export async function withT20FeedbackFixture(run:(fixture:T20FeedbackFixture)=>Promise<void>,{beforeCompletion}:{beforeCompletion?:(input:{member:ReturnType<typeof browser>;path:string;csrf:string})=>Promise<void>}={}){
 await withT11Fixture(async context=>{
  await context.runtime.stop();const options=await t20MemberOptions(context),admission=t20MemberApp(options);
  let requestRef:string,ticketId:string;
  try{
   await admission.start();await admission.selfService.pump?.stop();const member=browser(admission.server);await login(member);
   const bootstrap=t20Object((await member.request('/api/yixiaoxiu/bootstrap')).json());
   const accepted=await member.request('/api/yixiaoxiu/requests',post(input('处方提交不了'),bootstrap.csrf_token));assert.equal(accepted.status,202,accepted.text);
   requestRef=String(t20Object(t20Object(accepted.json()).receipt).request_ref);assert.match(requestRef,/^[A-Za-z0-9_-]{32}$/u);
   assert.ok(admission.selfService.orchestrator);await admission.selfService.orchestrator.processPending({batchSize:20});
   assert.equal((await member.request('/api/yixiaoxiu/requests/'+requestRef)).status,200);
   const located=await context.pool.query<{id:string}>('SELECT t.id::text FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id JOIN pilot_ticket.ticket t ON t.id=i.pilot_ticket_id WHERE b.request_ref=$1',[requestRef]);
   assert.equal(located.rowCount,1);assert.ok(located.rows[0]);ticketId=located.rows[0].id;
   if(beforeCompletion){await beforeCompletion({member,path:'/api/yixiaoxiu/requests/'+requestRef,csrf:String(bootstrap.csrf_token)});await admission.selfService.orchestrator.processPending({batchSize:20});}
  }finally{await admission.stop();assert.equal(admission.server.listening,false);}
  const staff=createP2016Runtime({pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:context.origin,
   listenPort:Number(new URL(context.origin).port),principalIds:[context.principals[0]?.id??''],externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true});
  if('disabled' in staff)throw Error('T20_FIXTURE_STAFF_DISABLED');let completed:P2016TicketDetail;
  try{const started=await staff.start();assert.ok(started.cookies);const http=await t11Http({...context,runtime:staff,cookies:started.cookies.map(c=>c.name+'='+c.value)});
   const active=await http.start(ticketId);assert.equal((await http.post(ticketId,'complete',http.command(active))).status,200);
   completed=await http.detail(ticketId);assert.equal(completed.status,'CLOSED');assert.ok(completed.handling_cycle?.staff_completion_event_id);
  }finally{await staff.stop();assert.equal(staff.server.listening,false);}
  const app=t20MemberApp({...options,identityMapping:await mapping()});
  try{
   await app.start();await app.selfService.pump?.stop();const member=browser(app.server);await login(member);
   const bootstrap=t20Object((await member.request('/api/yixiaoxiu/bootstrap')).json()),csrf=String(bootstrap.csrf_token),path='/api/yixiaoxiu/requests/'+requestRef;
   const detail=await member.request(path);assert.equal(detail.status,200,detail.text);const eligibility=t20Object(t20Object(detail.json()).feedback_context);assert.equal(eligibility.can_feedback,true);
   const command:YxxFeedbackInput={schema_version:1,client_command_id:randomUUID(),feedback:'STILL_UNRESOLVED',completed_round_ref:String(eligibility.completed_round_ref),expected_ticket_version:completed.version};
   const send=(body=command,headers:Record<string,string>={})=>member.request(path+'/feedback',{...post(body,csrf),headers:{...post(body,csrf).headers,'if-match':'"'+body.expected_ticket_version+'"',...headers}});
   await run({context,options,app,member,path,requestRef,ticketId,completed,csrf,command,send});
  }finally{await app.stop();assert.equal(app.server.listening,false);}
 });
}
