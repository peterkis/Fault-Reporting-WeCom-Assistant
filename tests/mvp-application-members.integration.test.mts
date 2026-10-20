import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {randomUUID} from 'node:crypto';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {entryConfig,entryKey,listenYxx,stopYxx} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {createWeComWebOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import {createWeComOAuthServer} from '../src/p2-g2-wecom-oauth-server.mjs';
import {createYxxSelfServiceExtension} from '../src/yxx-self-service-runtime.mjs';
import {createYxxDelegatedIdentityMapping} from '../src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {validateYxxEntryConfig} from '../src/p2-g2-yixiaoxiu-contract.mjs';
import {createApplicationMemberVerifier} from '../src/wecom-application-member.mjs';
import {migrateBotReporterFeedback} from '../scripts/bot-reporter-feedback-migrate.mjs';
import {createWorkbenchNotificationOptions} from '../src/human-workbench-configuration.mjs';
import {createTicketRoundNotifications} from '../src/workbench-ticket-round-notifications.mjs';
import {createP2016OrchestrationWorker} from '../src/p2-016-orchestration-adapters.mjs';
import {createP2016WeComSender} from '../src/p2-016-wecom-sender.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';
import {composeConversationRuleAdmission} from '../src/conversation-rule-admission.mjs';
import {createMvpNotificationAdmission} from '../src/mvp-group-replies.mjs';

function object(v:unknown):Record<string,unknown>{assert.ok(v&&typeof v==='object'&&!Array.isArray(v));return v as Record<string,unknown>;}
function nativeClient(base:string,origin:string){
 const cookies=new Map<string,string>();let csrf='';
 const send=async(path:string,body?:Record<string,unknown>)=>{
  const result=await new Promise<{status:number;headers:import('node:http').IncomingHttpHeaders;body:Record<string,unknown>;raw:string}>((resolve,reject)=>{
   const req=httpRequest(base+path,{method:body?'POST':'GET',headers:{host:new URL(origin).host,connection:'close',cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),
    ...(body?{origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':String(body.client_command_id),...(body.expected_ticket_version?{'if-match':'"'+body.expected_ticket_version+'"'}:{})}:{} )}},res=>{
    const chunks:Buffer[]=[];res.on('data',(c:Buffer)=>chunks.push(c));res.on('error',reject);res.on('end',()=>{const raw=Buffer.concat(chunks).toString();resolve({status:res.statusCode??0,headers:res.headers,body:res.headers['content-type']?.includes('application/json')?object(JSON.parse(raw)):{},raw});});
   });req.on('error',reject);req.setTimeout(10000,()=>req.destroy(Error('MVP_HTTP_DEADLINE')));req.end(body?JSON.stringify(body):undefined);
  });
  for(const c of result.headers['set-cookie']??[]){const part=c.split(';')[0]??'',i=part.indexOf('=');cookies.set(part.slice(0,i),part.slice(i+1));}
  if(typeof result.body.csrf_token==='string')csrf=result.body.csrf_token;return result;
 };
 return {get:(path:string)=>send(path),post:(path:string,body:Record<string,unknown>)=>send(path,body),async login(code:string){
  const begin=await send('/wecom/yixiaoxiu/login');assert.equal(begin.status,302);const location=begin.headers.location;assert.ok(location);const state=new URL(location).searchParams.get('state');assert.ok(state);
  const callback=await send('/wecom/yixiaoxiu/callback?code='+code+'&state='+state);assert.equal(callback.status,303,callback.raw);assert.equal((await send('/api/yixiaoxiu/bootstrap')).status,200);
 }};
}

test('MVP H5 admits unlisted visible members through real OAuth and HTTP; durable application notifications survive logout and process restart without a Bot identity',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  await migrateBotReporterFeedback({databaseUrl:context.databaseUrl,mode:'apply'});
  const config=validateYxxEntryConfig({...entryConfig,identityMode:'VERIFIED_APP_OPENID'});assert.ok(config.enabled);assert.equal(config.reporterUserIds,undefined);
  const visible=new Set(['open-new-a','open-new-b']),appBodies:Record<string,unknown>[]=[],paths:string[]=[],origin='https://entry.test';let memberUnavailable=false,stallMemberLookup=false,releaseMemberLookup:(()=>void)|undefined;
  const fetchImpl:typeof fetch=async(input,init)=>{
   const url=new URL(input instanceof Request?input.url:String(input));paths.push(url.pathname);assert.equal(url.origin,'https://qyapi.weixin.qq.com');
   if(url.pathname==='/cgi-bin/user/get'){if(memberUnavailable)return new Response('synthetic temporary outage',{status:503});const id=url.searchParams.get('userid'),response=()=>new Response(JSON.stringify(id&&visible.has(id)?{errcode:0,userid:id,name:'合成报修人',status:1,enable:1}:{errcode:60011}));if(stallMemberLookup)return new Promise<Response>(resolve=>{releaseMemberLookup=()=>resolve(response());});return response();}
   assert.equal(url.pathname,'/cgi-bin/message/send','new app identities must not be converted as plaintext Bot ids');
   const body=object(JSON.parse(String(init?.body)));appBodies.push(body);return new Response(JSON.stringify({errcode:0,msgid:'synthetic-app-'+appBodies.length}));
  };
  const token=async()=> 'MVP_SYNTHETIC_APP_TOKEN',verify=createApplicationMemberVerifier({accessTokenProvider:token,fetchImpl});
  const mapping=await createYxxDelegatedIdentityMapping({config,accessTokenProvider:token,fetchImpl});assert.equal(paths.length,0);
  const options={memberEntry:config,appChannelAccountId:'mvp-app',notificationBindingsFile:'D:/synthetic-missing-not-used.json'};
  const appNotifications=createWorkbenchNotificationOptions(options,entryKey),round=createTicketRoundNotifications({pool:context.pool,enabled:true,mvpPolicy:true,botId:'bot-test',reporterAccess:context.runtime.reporterAccess,appNotifications});
  const makeApp=()=>{
   const oauth=createWeComWebOAuth({enabled:true,corpId:config.corpId,agentId:config.agentId,publicOrigin:origin,resolveCode:async code=>({userid:code==='A'?'open-new-a':'open-new-b'})});assert.ok(oauth.enabled);
   const extension=createYxxSelfServiceExtension({pool:context.pool,oauth,publicOrigin:origin,reporterMemberEntry:config,identityMapping:mapping,reporterHmacSecret:entryKey,
    profile:'FULL_SERVICE_LOOP',featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true},applicationMemberVerifier:verify,reporterFeedbackEnabled:true});
   return {oauth,extension,server:createWeComOAuthServer({oauth,publicOrigin:origin,profile:'MEMBER_SELF_SERVICE',memberHandler:extension.handler})};
  };
  let app=makeApp(),base=await listenYxx(app.server);
  const orchestration=createP2016OrchestrationWorker({pool:context.pool,mvpPolicy:true,identityHmacKey:'mvp-h5-synthetic-identity',notifications:context.runtime.notifications,realtime:context.runtime.realtimeProjector,
   yxxSelfService:{featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true}}});
  try{
   const a=nativeClient(base,origin),b=nativeClient(base,origin);await a.login('A');await b.login('B');
   const input={schema_version:1,client_command_id:randomUUID(),description:'合成门诊打印机打印不了。',location:{text:'合成测试区',unknown:false},service_code:null,impact_scope:'SELF',reported_department_text:null,extension:null};
   const accepted=await a.post('/api/yixiaoxiu/requests',input);assert.equal(accepted.status,202,accepted.raw);const ref=String(object(accepted.body.receipt).request_ref);
   const replay=await a.post('/api/yixiaoxiu/requests',input);assert.equal(replay.body.replayed,true);
   const own=await a.get('/api/yixiaoxiu/requests/'+ref);assert.equal(own.status,200,own.raw);assert.equal((await b.get('/api/yixiaoxiu/requests/'+ref)).status,404);
   const forged=await a.post('/api/yixiaoxiu/requests',{...input,client_command_id:randomUUID(),notify_recipient_id:'open-new-b'});assert.equal(forged.status,400);
   const binding=(await context.pool.query<{intake_id:string;notify_recipient_id:string;notify_identity_namespace:string}>('SELECT intake_id::text,notify_recipient_id,notify_identity_namespace FROM intake.web_request_binding WHERE request_ref=$1',[ref])).rows[0];assert.ok(binding);
   assert.equal(binding.notify_recipient_id,'open-new-a');assert.equal(binding.notify_identity_namespace,'APP_OPEN_USERID');
   let processed:unknown;
   const pending=(await context.pool.query<{n:number}>('SELECT count(*)::integer AS n FROM intake.web_request_binding WHERE processed_revision<input_revision')).rows[0]?.n??0;
   assert.ok(pending>=1&&pending<=50);
   for(let batch=0;batch<=pending;batch++){
    processed=await orchestration.processDueBatch({feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true},now_epoch_ms:String(Date.now()+15000)});
    if((await context.pool.query('SELECT 1 FROM pilot_ticket.ticket WHERE source_intake_id=$1::uuid',[binding.intake_id])).rowCount)break;
   }
   const ticket=(await context.pool.query<{id:string}>('SELECT id::text FROM pilot_ticket.ticket WHERE source_intake_id=$1::uuid',[binding.intake_id])).rows[0];assert.ok(ticket,JSON.stringify(processed));
   await assert.rejects(context.pool.query("UPDATE intake.web_request_binding SET notify_recipient_id='open-new-b' WHERE intake_id=$1::uuid",[binding.intake_id]),/WEB_NOTIFICATION_RECIPIENT_IMMUTABLE/u);
   const http=await t11Http(context),started=await http.start(ticket.id);await round.runOnce();
   assert.equal((await http.post(ticket.id,'complete',http.command(started))).status,200);await round.runOnce();
   const notice=await context.pool.query<{id:string}>(`SELECT d.id::text FROM communication.ticket_notification_binding n JOIN communication.delivery d ON d.id=n.delivery_id WHERE n.ticket_id=$1::uuid ORDER BY n.created_at,n.id`,[ticket.id]);assert.equal(notice.rowCount,2);
   const publicView=await a.get('/api/yixiaoxiu/requests/'+ref);assert.equal(publicView.status,200);assert.equal(publicView.raw.includes('open-new-a'),false);assert.equal(publicView.raw.includes('notify_recipient'),false);
   app.oauth.close();await stopYxx(app.server);app.extension.close();app=makeApp();base=await listenYxx(app.server);
   // A fresh sender/options instance has no original OAuth session or in-memory member correspondence.
   const freshOptions=createWorkbenchNotificationOptions(options,entryKey);
   const sender=createP2016WeComSender({mvpPolicy:true,gateway:{getAuthenticatedClient:()=>{throw Error('H5_MUST_NOT_SEND_BOT');}},enabled:true,cardEnabled:true,
    reporterAccess:context.runtime.reporterAccess,origin,allowedHosts:['entry.test'],linkMode:'MEMBER_REQUIRED',
    appRoundNotifications:{pool:context.pool,notifications:freshOptions,agentId:Number(config.agentId),accessTokenProvider:token,applicationMemberVerifier:verify,fetchImpl}});
   const delivery=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender,attemptAdmission:composeConversationRuleAdmission(createMvpNotificationAdmission())});
   for(const [index,n] of notice.rows.entries()){
    memberUnavailable=index===0;stallMemberLookup=index===1;
    const unavailable=await delivery.deliver({deliveryId:n.id});assert.ok(unavailable&&'status'in unavailable);assert.equal(unavailable.status,'PENDING');assert.equal(unavailable.side_effect_state,'NOT_ATTEMPTED');assert.equal(appBodies.length,index,'a failed or timed-out member lookup cannot call message/send');
    memberUnavailable=false;stallMemberLookup=false;if(index===1)assert.ok(releaseMemberLookup);releaseMemberLookup?.();
    await context.pool.query('WITH stamp AS(SELECT platform.physical_epoch_ms() AS epoch) UPDATE communication.delivery SET next_attempt_epoch_ms=epoch,next_attempt_at=platform.local_from_epoch_ms(epoch) FROM stamp WHERE id=$1::uuid',[n.id]);
    const result=await delivery.deliver({deliveryId:n.id});assert.ok(result&&'status'in result);assert.equal(result.status,'SENT');assert.equal(await delivery.deliver({deliveryId:n.id}),null);
   }
   assert.equal(appBodies.length,2);for(const body of appBodies){assert.equal(body.touser,'open-new-a');assert.equal(object(body.template_card).source,undefined);assert.match(String(object(object(body.template_card).card_action).url),new RegExp('/reports/'+ref+'$','u'));}
   assert.equal(object(object(appBodies[0]).template_card).main_title&&object(object(object(appBodies[0]).template_card).main_title).title,'工程师正在处理你的工单');
   assert.equal(paths.includes('/cgi-bin/batch/userid_to_openuserid'),false);
   const after=nativeClient(base,origin);await after.login('A');assert.equal((await after.get('/api/yixiaoxiu/requests/'+ref)).status,200);
   memberUnavailable=true;assert.equal((await after.get('/api/yixiaoxiu/bootstrap')).status,503);memberUnavailable=false;assert.equal((await after.get('/api/yixiaoxiu/bootstrap')).status,200);
   const completed=await after.get('/api/yixiaoxiu/requests/'+ref),feedback=object(completed.body.feedback_context);
   assert.equal(feedback.can_feedback,true);
   const reopen={schema_version:1,client_command_id:randomUUID(),completed_round_ref:feedback.completed_round_ref,expected_ticket_version:feedback.ticket_version,feedback:'STILL_UNRESOLVED'};
   const response=await after.post('/api/yixiaoxiu/requests/'+ref+'/feedback',reopen);assert.equal(response.status,200,response.raw);
   assert.equal((await after.post('/api/yixiaoxiu/requests/'+ref+'/feedback',reopen)).status,200);
   const reopened=await http.detail(ticket.id);assert.equal(reopened.ticket_no,started.ticket_no);assert.equal(reopened.handling_cycle?.cycle_no,2);
   await http.start(ticket.id);await round.runOnce();
   const second=(await context.pool.query<{id:string}>(`SELECT b.delivery_id::text AS id FROM communication.ticket_round_notification_binding r JOIN communication.ticket_notification_binding b ON b.id=r.notification_binding_id JOIN pilot_ticket.ticket_handling_cycle c ON c.id=r.cycle_id WHERE r.ticket_id=$1::uuid AND c.cycle_no=2`,[ticket.id])).rows[0];assert.ok(second);
   visible.delete('open-new-a');
   const refused=await delivery.deliver({deliveryId:second.id});assert.ok(refused&&'status'in refused);assert.equal(refused.status,'DEAD_LETTER');assert.equal(appBodies.length,2,'revoked current members receive no SDK call');
   const denied=await after.get('/api/yixiaoxiu/requests/'+ref);assert.equal(denied.status,403,denied.raw);
   const count=(await context.pool.query<{n:number}>('SELECT count(*)::integer AS n FROM intake.web_request_binding')).rows[0]?.n;
   assert.equal((await after.post('/api/yixiaoxiu/requests',{...input,client_command_id:randomUUID()})).status,403);
   assert.equal((await context.pool.query<{n:number}>('SELECT count(*)::integer AS n FROM intake.web_request_binding')).rows[0]?.n,count);
  }finally{await orchestration.stop();app.oauth.close();await stopYxx(app.server);app.extension.close();}
 },{mvpNotificationsEnabled:true,ticketReopenRoundsEnabled:true,manualRoundConsumption:true});
});
