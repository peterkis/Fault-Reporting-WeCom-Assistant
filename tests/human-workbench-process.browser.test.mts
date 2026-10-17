import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer,request as httpRequest} from 'node:http';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {withP2016IsolatedDatabase,assertNoP2016Residual} from './helpers/p2-016-postgres-harness.mjs';
import {migrateCurrentBaselineWithYxx} from '../scripts/migrate-current-baseline.mjs';
import {migrateWorkbenchAuth} from '../scripts/p2-016-workbench-auth-migrate.mjs';
import {migrateTicketSelfHandling} from '../scripts/ticket-self-handling-migrate.mjs';
import {migrateTicketStaffCompletion} from '../scripts/ticket-staff-completion-migrate.mjs';
import {migrateTicketRoundNotifications} from '../scripts/ticket-round-notifications-migrate.mjs';
import {migrateWorkbenchManualReports} from '../scripts/workbench-manual-reports-migrate.mjs';
import {migrateTicketReopenRounds} from '../scripts/ticket-reopen-rounds-migrate.mjs';
import {migrateBotReporterFeedback} from '../scripts/bot-reporter-feedback-migrate.mjs';
import {migrateWorkbenchPersonalRead} from '../scripts/workbench-personal-read-migrate.mjs';
import {migrateWorkbenchSupplementFollowUp} from '../scripts/workbench-supplement-follow-up-migrate.mjs';
import {migrateWorkbenchFollow} from '../scripts/workbench-follow-migrate.mjs';
import {migrateWorkbenchSourceGroups} from '../scripts/workbench-source-groups-migrate.mjs';
import {migrateConversationDeliveryCommands} from '../scripts/conversation-delivery-commands-migrate.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {createPilotTicketCore} from '../src/p1-005-pilot-ticket-core.mjs';
import {main as workbenchMain} from '../scripts/human-workbench.mjs';
import {workbenchTestSettings} from './helpers/human-workbench-test-settings.mjs';
import {addInboxSession,attachInboxJourney,INBOX_IDENTITY_KEY} from './helpers/conversation-inbox-fixture.mjs';
import {createYxxBrowserFixture} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
import type {IncomingHttpHeaders} from 'node:http';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {assertLocalDateTime} from '../src/platform/time-contract.mjs';
import {transactionP2016} from '../src/p2-016-domain-contracts.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
function object(v:unknown):Record<string,unknown>{assert.ok(v&&typeof v==='object'&&!Array.isArray(v));return v as Record<string,unknown>;}
interface Response {status:number;body:Record<string,unknown>;headers:IncomingHttpHeaders;raw:string}
function client(base:string,origin:string){
 const cookies=new Map<string,string>();let csrf='';
 const request=async(path:string,body?:Record<string,unknown>):Promise<Response>=>{
  const version=body?.expected_version??body?.expected_row_version??body?.expected_ticket_version;
  const result=await new Promise<Response>((resolve,reject)=>{
   const req=httpRequest(base+path,{method:body?'POST':'GET',headers:{host:new URL(origin).host,connection:'close',cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...(body?{origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':String(body.client_command_id),...(version!==undefined?{'if-match':'"'+String(version)+'"'}:{})}:{})}},res=>{
    const chunks:Buffer[]=[];res.on('data',(v:Buffer)=>chunks.push(v));res.on('end',()=>{const raw=Buffer.concat(chunks).toString();resolve({status:res.statusCode??0,headers:res.headers,raw,body:res.headers['content-type']?.includes('application/json')&&raw?object(JSON.parse(raw)): {}});});res.on('error',reject);
   });req.on('error',reject);req.setTimeout(10000,()=>req.destroy(Error('WORKBENCH_TEST_HTTP_TIMEOUT')));req.end(body?JSON.stringify(body):undefined);
  });
  for(const c of result.headers['set-cookie']??[]){const p=c.split(';')[0]??'',i=p.indexOf('=');cookies.set(p.slice(0,i),p.slice(i+1));}
  if(typeof result.body.csrf_token==='string')csrf=result.body.csrf_token;
  return result;
 };
 return {cookies,get:(p:string)=>request(p),post:(p:string,b:Record<string,unknown>)=>request(p,b)};
}
async function until(check:()=>Promise<boolean>){for(let i=0;i<160;i++){if(await check())return;await delay(50);}throw Error('WORKBENCH_TEST_CONVERGENCE_TIMEOUT');}

test('compiled parent and three compiled roles wire real OAuth sessions, bootstrap, React inbox/SSE, reporter feedback and three Sender adapters',{timeout:240000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'human-workbench-process-'));let proof:unknown,workerTraceFile:string|undefined;
 try{await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'humanwire',max:1,run:async({pool,databaseUrl}:{pool:PostgresPool;databaseUrl:string})=>{
  await migrateCurrentBaselineWithYxx({databaseUrl});
  const workerTracePath=join(tmpdir(),new URL(databaseUrl).pathname.slice(1)+'-worker-boundaries.jsonl');workerTraceFile=workerTracePath;
  for(const migrate of [migrateWorkbenchAuth,migrateTicketSelfHandling,migrateTicketStaffCompletion,migrateTicketRoundNotifications,migrateWorkbenchManualReports,migrateTicketReopenRounds,migrateBotReporterFeedback,migrateWorkbenchPersonalRead,migrateWorkbenchFollow,migrateWorkbenchSupplementFollowUp,migrateWorkbenchSourceGroups,migrateConversationDeliveryCommands])await migrate({databaseUrl,mode:'apply'});
  const access=createPilotAccessService({pool});await access.upsertPrincipal({wecomUserId:'runtime-staff',displayName:'运行接线合成坐席',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
  const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const address=probe.address();assert.ok(address&&typeof address==='object');const port=address.port;await new Promise<void>(r=>probe.close(()=>r()));
  const f=workbenchTestSettings(directory,port);f.env.PILOT_DATABASE_URL=databaseUrl;f.env.PILOT_LOG_IDENTITY_HASH_KEY=INBOX_IDENTITY_KEY;f.settings.transportEnabled=true;
  let controller:Awaited<ReturnType<typeof workbenchMain>>;
  const tls=await createYxxBrowserFixture({pool,createApp:({origin}:{origin:string})=>{f.settings.publicOrigin=origin;f.settings.reporterOrigin=origin;f.save();return createServer();},startApp:async()=>{
   controller=await workbenchMain(['--start'],{env:f.env,roleScriptUrl:new URL('./helpers/human-workbench-boundaries-role.mjs',import.meta.url)});assert.ok(controller);
   assert.equal(controller.process_count,3);assert.equal(controller.cookies,undefined);return controller.origin;
  },stopApp:async()=>{if(controller)assert.equal((await controller.stop()).process_count,0);}});
  assert.ok(tls);
  let browser:NonNullable<Awaited<ReturnType<typeof tls.launch>>>|undefined;
  try{
   const base='http://127.0.0.1:'+port,staff=client(base,tls.origin),member=client(base,tls.origin);
   for(const [http,path,code] of [[staff,'/workbench','staff'],[member,'/wecom/yixiaoxiu','member']] as const){const login=await http.get(path+'/login');assert.equal(login.status,302,login.raw);assert.ok(login.headers.location);const state=new URL(login.headers.location).searchParams.get('state');const callback=await http.get(path+'/callback?code='+code+'&state='+state);assert.equal(callback.status,303,callback.raw);}
   const boot=await staff.get('/api/lifecycle/bootstrap');assert.equal(boot.status,200,boot.raw);
   for(const key of ['ticket_self_handling_enabled','ticket_assignment_enabled','ticket_waiting_actions_enabled','ticket_staff_completion_enabled','ticket_reopen_rounds_enabled','ticket_round_notifications_enabled','manual_reports_enabled','manual_review_enabled','conversation_workspace_enabled','conversation_inbox_enabled','personal_read_enabled','realtime_sse_enabled','source_group_directory_enabled','internal_notes_enabled','draft_recovery_enabled','notification_exceptions_enabled'])assert.equal(boot.body[key],true,key);
   assert.equal(boot.body.ai_enabled,false);assert.equal(boot.body.incident_candidate_workspace_enabled,false);assert.equal(boot.body.reporter_candidates_enabled,false);
   assert.equal((await member.get('/api/yixiaoxiu/bootstrap')).status,200);
   const session=await addInboxSession(pool,{reporter:'synthetic-A',bot:'bot-test',group:null,text:'运行接线合成私聊'});await attachInboxJourney(pool,session,{name:'运行接线报修人'});
   // Seed only the external input fixture atomically, then use the original Core command.
   const groupTicketId=await transactionP2016(pool,async transaction=>{
    const group=await seedPersistedIntake({pool:transaction,text:'运行接线合成打印机无法打印',chatType:'group',requestType:'INCIDENT',status:'RECEIVED',tag:'runtime-group'});
    await transaction.query("UPDATE intake.service_intake SET source_bot_id='bot-test',source_chat_id='runtime-group',reporter_wecom_userid='synthetic-A' WHERE id=$1::uuid",[group.intakeId]);
    await transaction.query("UPDATE channel.message_inbox SET bot_id='bot-test',chat_id='runtime-group',sender_user_id='synthetic-A' WHERE id=$1::bigint",[group.messageId]);
    const created=await createPilotTicketCore({pool}).createForIntakeInTransaction({transaction,intakeId:group.intakeId,occurredAt:assertLocalDateTime(group.receivedAt),traceId:'runtime-group'});assert.ok(created.ticket);return created.ticket.id;
   });
   const inbox=await staff.get('/api/workbench/conversation-inbox');assert.equal(inbox.status,200,inbox.raw);assert.ok(Array.isArray(inbox.body.items));assert.ok(inbox.body.items.length>0);
   const detail=await staff.get('/api/workbench/conversations/'+session.id+'?view=chat');assert.equal(detail.status,200,detail.raw);assert.ok(detail.body.contact_ref);
   browser=await tls.launch();assert.ok(browser);await browser.command('Network.setCookies',{cookies:[...staff.cookies].map(([name,value])=>({name,value,url:tls.origin,secure:true}))});
   await browser.command('Page.navigate',{url:tls.origin+'/workbench/app/conversations/'+session.id});
   await browser.waitFor("Boolean(document.querySelector('[data-conversation-timeline]'))&&Boolean(document.querySelector('[data-action=open-conversations]'))");
   await browser.waitFor("document.querySelector('[data-realtime-status]')?.getAttribute('data-realtime-status')==='live'");
   assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-action=open-notification-exceptions]'))"),true);
   const sessionState=object(detail.body.session);
   const taken=await staff.post('/api/workbench/conversations/'+session.id+'/takeover',{client_command_id:randomUUID(),expected_row_version:sessionState.row_version});assert.equal(taken.status,200,taken.raw);
   const current=await staff.get('/api/workbench/conversations/'+session.id+'?view=chat');
   const note=await staff.post('/api/workbench/conversations/'+session.id+'/internal-notes',{client_command_id:randomUUID(),expected_row_version:object(current.body.session).row_version,text:'接线内部备注不得外发'});assert.equal(note.status,201,note.raw);
   await browser.waitFor("document.querySelector('[data-conversation-timeline]')?.textContent.includes('接线内部备注不得外发')");
   const replyState=await staff.get('/api/workbench/conversations/'+session.id+'?view=chat');
   const reply=await staff.post('/api/workbench/conversations/'+session.id+'/messages',{client_command_id:randomUUID(),expected_row_version:object(replyState.body.session).row_version,text:'运行接线合成文字回复'});assert.equal(reply.status,202,reply.raw);
   const complete=async(id:string)=>{
    let current=(await staff.get('/api/tickets/'+id)).body;
    const related=await staff.get('/api/tickets/'+id+'/related-conversations');assert.equal(related.status,200,related.raw);assert.ok(Array.isArray(related.body.items));
    const sessions=related.body.items.map(object).filter(s=>s.take_allowed===true).map(s=>({session_id:s.session_id,expected_row_version:Number(s.session_row_version)}));
    const hasConversations=related.body.items.length>0;
    const started=await staff.post('/api/tickets/'+id+(hasConversations?'/take-and-start-with-conversations':'/take-and-start'),{client_command_id:randomUUID(),expected_version:current.version,reason_code:'RUNTIME_WIRING',resolver_team_id:current.resolver_team_id,...(hasConversations?{communication_choice:sessions.length?'TAKE_SELECTED':'RETAIN_CURRENT',sessions}:{})});assert.equal(started.status,200,started.raw);
    current=(await staff.get('/api/tickets/'+id)).body;const cycle=object(current.handling_cycle);
    const done=await staff.post('/api/tickets/'+id+'/complete',{client_command_id:randomUUID(),expected_version:current.version,reason_code:'STAFF_COMPLETED',handling_cycle_id:cycle.id,internal_process:'内部接线验证',external_summary:'合成设备处理完成，请核对。',external_summary_confirmed:true});assert.equal(done.status,200,done.raw);
   };
   await complete(groupTicketId);
   const report=await member.post('/api/yixiaoxiu/requests',{schema_version:1,client_command_id:randomUUID(),description:'合成门诊网页打印机打印不了。',location:{text:'T43合成网页位置',unknown:false},service_code:null,impact_scope:'SINGLE_WORKSTATION',reported_department_text:null,extension:null});assert.equal(report.status,202,report.raw);
   const receipt=object(report.body.receipt??report.body);const ref=String(receipt.request_ref);let webId='';
   await until(async()=>{const q=await pool.query<{id:string}>('SELECT t.id::text FROM intake.web_request_binding b JOIN pilot_ticket.ticket t ON t.source_intake_id=b.intake_id WHERE b.request_ref=$1',[ref]);webId=q.rows[0]?.id??'';return !!webId;});await complete(webId);
   const webDetail=await member.get('/api/yixiaoxiu/requests/'+ref);assert.equal(webDetail.status,200,webDetail.raw);const feedback=object(webDetail.body.feedback_context);assert.equal(feedback.can_feedback,true);
   const command={schema_version:1,client_command_id:randomUUID(),feedback:'STILL_UNRESOLVED',completed_round_ref:feedback.completed_round_ref,expected_ticket_version:feedback.ticket_version};
   const result=await member.post('/api/yixiaoxiu/requests/'+ref+'/feedback',command);assert.equal(result.status,200,result.raw);assert.equal(object(result.body.ticket).status,'REOPENED');
   assert.equal((await member.get('/api/yixiaoxiu/requests/'+ref+'/feedback/commands/'+command.client_command_id)).body.state,'COMMITTED');
   let botRef='';await until(async()=>{botRef=(await pool.query<{public_ref:string}>('SELECT public_ref FROM pilot_ticket.reporter_public_ref WHERE ticket_id=$1::uuid AND status=\'ACTIVE\'',[groupTicketId])).rows[0]?.public_ref??'';return !!botRef;});
   assert.equal((await member.get('/api/reporter/feedback/bootstrap')).status,200);
   const botDetail=await member.get('/api/reporter/tickets/'+botRef);assert.equal(botDetail.status,200,botDetail.raw);const botFeedback=object(botDetail.body.feedback_context);assert.equal(botFeedback.can_feedback,true);
   const botCommand={schema_version:1,client_command_id:randomUUID(),feedback:'STILL_UNRESOLVED',completed_round_ref:botFeedback.completed_round_ref,expected_ticket_version:botFeedback.ticket_version};
   const botResult=await member.post('/api/reporter/tickets/'+botRef+'/feedback',botCommand);assert.equal(botResult.status,200,botResult.raw);assert.equal(object(botResult.body.ticket).status,'REOPENED');
   await until(async()=>{const lines=(await readFile(join(directory,'boundaries.jsonl'),'utf8')).trim().split('\n').map(v=>object(JSON.parse(v)));return ['app-send','group-send','bot-send'].every(kind=>lines.some(v=>v.event===kind));});
   const lines=((await readFile(join(directory,'boundaries.jsonl'),'utf8'))+'\n'+await readFile(workerTracePath,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(v=>object(JSON.parse(v)));
   const environment=lines.filter(v=>v.event==='environment');assert.equal(environment.length,3);assert.ok(environment.every(v=>v.has_identity_key&&v.has_reporter_secret&&!v.has_unrelated_secret));
   assert.equal(environment.find(v=>v.role==='WORKER')?.has_app_secret,false);assert.equal(environment.find(v=>v.role==='APP')?.has_bot_secret,false);
   assert.ok(lines.filter(v=>['app-send','group-send','bot-send'].includes(String(v.event))).every(v=>v.role==='GATEWAY'));
   assert.equal(JSON.stringify(lines.filter(v=>v.event==='app-send'||v.event==='group-send'||v.event==='bot-send')).includes('接线内部备注'),false);
   proof={bootstrap:true,real_oauth_sessions:true,compiled_roles:3,react_inbox:true,sse_live:true,web_reporter_feedback:true,bot_reporter_feedback:true,sender_routes:['WECOM_APP','WECOM_MESSAGE_PUSH','WECOM_AIBOT'],credentials_isolated:true};
  }finally{await browser?.close();await tls.close();}
  assert.equal((await pool.query<{n:number}>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name IN ('p2_g1_app','p2_g1_worker','p2_g1_gateway')")).rows[0]?.n,0);
 }});await assertNoP2016Residual({databaseUrl:process.env.PILOT_DATABASE_URL});console.log('HUMAN_WORKBENCH_WIRING '+JSON.stringify(proof));}
 finally{
  const trace=await readFile(join(directory,'boundaries.jsonl'),'utf8').catch(()=>'');
  const workerTrace=workerTraceFile?await readFile(workerTraceFile,'utf8').catch(()=>''):'';
  console.log('HUMAN_WORKBENCH_BOUNDARY_TRACE '+JSON.stringify((trace+'\n'+workerTrace).trim().split('\n').filter(Boolean).map(v=>{const r=object(JSON.parse(v));return {role:r.role,event:r.event,...(r.code?{code:r.code}:{})};})));
  if(workerTraceFile)await rm(workerTraceFile,{force:true});
  await rm(directory,{recursive:true,force:true});
 }
});
