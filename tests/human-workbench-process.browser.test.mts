import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer,request as httpRequest} from 'node:http';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {withP2016IsolatedDatabase,assertNoP2016Residual} from './helpers/p2-016-postgres-harness.mjs';
import {migrateCurrentBaselineWithYxx} from '../app/server/scripts/migrate-current-baseline.mjs';
import {migrateWorkbenchAuth} from '../app/server/scripts/p2-016-workbench-auth-migrate.mjs';
import {migrateTicketSelfHandling} from '../app/server/scripts/ticket-self-handling-migrate.mjs';
import {migrateTicketStaffCompletion} from '../app/server/scripts/ticket-staff-completion-migrate.mjs';
import {migrateMvpNotifications} from '../app/server/scripts/mvp-notifications-migrate.mjs';
import {migrateTicketReporterProfiles} from '../app/server/scripts/ticket-reporter-profiles-migrate.mjs';
import {migrateTicketRoundNotifications} from '../app/server/scripts/ticket-round-notifications-migrate.mjs';
import {migrateWorkbenchManualReports} from '../app/server/scripts/workbench-manual-reports-migrate.mjs';
import {migrateTicketReopenRounds} from '../app/server/scripts/ticket-reopen-rounds-migrate.mjs';
import {migrateBotReporterFeedback} from '../app/server/scripts/bot-reporter-feedback-migrate.mjs';
import {migrateWorkbenchPersonalRead} from '../app/server/scripts/workbench-personal-read-migrate.mjs';
import {migrateWorkbenchSupplementFollowUp} from '../app/server/scripts/workbench-supplement-follow-up-migrate.mjs';
import {migrateWorkbenchFollow} from '../app/server/scripts/workbench-follow-migrate.mjs';
import {migrateWorkbenchSourceGroups} from '../app/server/scripts/workbench-source-groups-migrate.mjs';
import {migrateConversationDeliveryCommands} from '../app/server/scripts/conversation-delivery-commands-migrate.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {main as workbenchMain} from '../app/server/scripts/human-workbench.mjs';
import {workbenchTestSettings,hashTarget} from './helpers/human-workbench-test-settings.mjs';
import {yxxIdentityConfigHash} from '../app/server/src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {addInboxSession,attachInboxJourney,INBOX_IDENTITY_KEY} from './helpers/conversation-inbox-fixture.mjs';
import {createYxxBrowserFixture} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
import type {IncomingHttpHeaders} from 'node:http';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {transactionP2016} from '../app/server/src/p2-016-domain-contracts.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
function object(v:unknown):Record<string,unknown>{assert.ok(v&&typeof v==='object'&&!Array.isArray(v));return v as Record<string,unknown>;}
interface Response {status:number;body:Record<string,unknown>;headers:IncomingHttpHeaders;raw:string}
function client(base:string,origin:string){
 const cookies=new Map<string,string>();let csrf='';
 const request=async(path:string,body?:Record<string,unknown>,loseResponse=false):Promise<Response>=>{
  const version=body?.expected_version??body?.expected_row_version??body?.expected_ticket_version??body?.expected_input_revision;
  const result=await new Promise<Response>((resolve,reject)=>{
   const req=httpRequest(base+path,{method:body?'POST':'GET',headers:{host:new URL(origin).host,connection:'close',cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...(body?{origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':String(body.client_command_id),...(version!==undefined?{'if-match':'"'+String(version)+'"'}:{})}:{})}},res=>{
    res.on('error',reject);
    // Drop the actual HTTP transport only after the server's committed response headers.
    // The caller has no result body and must check the original UUID before another write.
    if(loseResponse&&res.statusCode===200){res.destroy(Error('HUMAN_WORKBENCH_TEST_RESPONSE_LOST'));return;}
    const chunks:Buffer[]=[];res.on('data',(v:Buffer)=>chunks.push(v));res.on('end',()=>{const raw=Buffer.concat(chunks).toString();resolve({status:res.statusCode??0,headers:res.headers,raw,body:res.headers['content-type']?.includes('application/json')&&raw?object(JSON.parse(raw)): {}});});
   });req.on('error',reject);req.setTimeout(10000,()=>req.destroy(Error('WORKBENCH_TEST_HTTP_TIMEOUT')));req.end(body?JSON.stringify(body):undefined);
  });
  for(const c of result.headers['set-cookie']??[]){const p=c.split(';')[0]??'',i=p.indexOf('=');cookies.set(p.slice(0,i),p.slice(i+1));}
  if(typeof result.body.csrf_token==='string')csrf=result.body.csrf_token;
  return result;
 };
 return {cookies,get:(p:string)=>request(p),post:(p:string,b:Record<string,unknown>)=>request(p,b),postLosingResponse:(p:string,b:Record<string,unknown>)=>request(p,b,true)};
}
async function until(check:()=>Promise<boolean>){for(let i=0;i<160;i++){if(await check())return;await delay(50);}throw Error('WORKBENCH_TEST_CONVERGENCE_TIMEOUT');}
async function migrateWorkbenchDatabase(databaseUrl:string){
 await migrateCurrentBaselineWithYxx({databaseUrl});
 for(const migrate of [migrateWorkbenchAuth,migrateTicketSelfHandling,migrateTicketStaffCompletion,migrateTicketRoundNotifications,migrateWorkbenchManualReports,migrateTicketReopenRounds,migrateBotReporterFeedback,migrateWorkbenchPersonalRead,migrateWorkbenchFollow,migrateWorkbenchSupplementFollowUp,migrateWorkbenchSourceGroups,migrateConversationDeliveryCommands,migrateMvpNotifications])await migrate({databaseUrl,mode:'apply'});
 await migrateTicketReporterProfiles({databaseUrl,expectedDatabase:new URL(databaseUrl).pathname.slice(1),mode:'apply'});
}
async function unusedPort(){const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const address=probe.address();assert.ok(address&&typeof address==='object');await new Promise<void>(r=>probe.close(()=>r()));return address.port;}

test('compiled receive-only Bot admits a new visible sender and group, deduplicates, denies outsiders and never sends',{timeout:120000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'human-workbench-inbound-'));let workerTraceFile:string|undefined;
 const outerFailures:unknown[]=[];
 try{
  await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'humaninbound',max:1,run:async({pool,databaseUrl}:{pool:PostgresPool;databaseUrl:string})=>{
   await migrateWorkbenchDatabase(databaseUrl);
   await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'runtime-staff',displayName:'运行接线合成坐席',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
   const f=workbenchTestSettings(directory,await unusedPort());f.env.PILOT_DATABASE_URL=databaseUrl;f.env.WORKBENCH_INBOUND_IO_APPROVAL_REF='tests/isolated-inbound';
   f.settings.botInboundEnabled=true;f.settings.workbenchReporterProfilesEnabled=true;f.settings.bot.personTargetHashes=[];f.settings.bot.groupTargetHashes=[];f.settings.groupRoutes=[];
   f.settings.memberEntry={...f.settings.memberEntry,identityMode:'UNVERIFIED',memberIdsConfirmed:false,proofRef:null,proofKind:null};delete f.settings.memberEntry.reporterUserIds;
   f.save();await rm(f.settings.notificationBindingsFile);assert.equal(f.settings.transportEnabled,false);assert.equal(f.settings.memberEntry.reporterUserIds,undefined);
   workerTraceFile=join(tmpdir(),new URL(databaseUrl).pathname.slice(1)+'-worker-boundaries.jsonl');
   const controller=await workbenchMain(['--start'],{env:f.env,roleScriptUrl:new URL('./helpers/human-workbench-boundaries-role.mjs',import.meta.url)});assert.ok(controller);
   const failures:unknown[]=[];
   try{
    assert.equal(controller.process_count,3);
    const trace=async()=> (await readFile(join(directory,'boundaries.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(v=>object(JSON.parse(v)));
    const gateway=(await trace()).find(v=>v.event==='gateway-input-boundary');assert.ok(gateway);assert.equal(typeof gateway.port,'number');
    const post=async(frame:unknown)=>{const response=await fetch('http://127.0.0.1:'+String(gateway.port)+'/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(frame),signal:AbortSignal.timeout(5000)});assert.equal(response.status,202);await response.arrayBuffer();};
    const frame=(id:string,type:'single'|'group',sender='new-visible-member',bot='bot-test')=>({cmd:'aibot_msg_callback',headers:{req_id:'inbound-'+id},body:{aibotid:bot,msgid:'inbound-'+id,chattype:type,...(type==='group'?{chatid:'new-group-without-webhook-route'}:{}),from:{userid:sender},msgtype:'text',text:{content:(type==='group'?'@医小修 合成门诊群':'合成门诊单聊')+'打印机打印不了。'}}});
    await post(frame('single','single'));await post(frame('single','single'));
    await post(frame('group','group','new-visible-group-member'));await post(frame('outside','single','not-visible-member'));await post(frame('wrong-bot','single','new-visible-member','another-bot'));
    await until(async()=> (await trace()).filter(v=>v.event==='member-read').length===4);
    await until(async()=> (await pool.query<{n:number}>('SELECT count(*)::int AS n FROM pilot_ticket.ticket')).rows[0]?.n===2);
    await until(async()=> (await pool.query<{n:number}>("SELECT count(*)::int AS n FROM intake.ticket_reporter_profile WHERE state='RESOLVED'")).rows[0]?.n===2);
    const profiles=(await pool.query<{reporter_name:string;reporter_department:string;profile_source:string}>("SELECT reporter_name,reporter_department,profile_source FROM intake.ticket_reporter_profile ORDER BY reporter_name")).rows;
    assert.deepEqual(profiles.map(row=>row.reporter_name),['自动采集私聊报修人','自动采集群报修人']);
    assert.equal(profiles.every(row=>row.reporter_department==='自动采集合成科室'&&row.profile_source==='REPORT_SNAPSHOT'),true);
    assert.equal(object(object(controller.readiness).checks).ticket_reporter_profiles_schema,true);
    const inputs=await pool.query<{chat_type:string;sender_user_id:string;chat_id:string|null}>('SELECT chat_type,sender_user_id,chat_id FROM channel.message_inbox ORDER BY id');
    assert.equal(inputs.rowCount,2);assert.deepEqual(inputs.rows.map(v=>v.sender_user_id).sort(),['new-visible-group-member','new-visible-member']);
    assert.deepEqual(inputs.rows.map(v=>v.chat_type).sort(),['group','single']);assert.equal(inputs.rows.find(v=>v.chat_type==='group')?.chat_id,'new-group-without-webhook-route');
    assert.equal((await pool.query<{n:number}>('SELECT count(*)::int AS n FROM intake.service_intake')).rows[0]?.n,2);
    assert.equal((await pool.query<{n:number}>('SELECT count(*)::int AS n FROM pilot_ticket.pilot_principal')).rows[0]?.n,1,'reporting does not create staff access');
    for(const table of ['communication.delivery_attempt','notification.delivery_attempt'])assert.equal((await pool.query<{n:number}>('SELECT count(*)::int AS n FROM '+table)).rows[0]?.n,0);
    assert.equal((await trace()).filter(v=>['app-send','group-send','bot-send'].includes(String(v.event))).length,0);
    const h5=await fetch('http://127.0.0.1:'+f.settings.listenPort+'/api/yixiaoxiu/bootstrap',{headers:{host:new URL(f.settings.publicOrigin).host},signal:AbortSignal.timeout(5000)});assert.notEqual(h5.status,200);await h5.arrayBuffer();
    console.log('HUMAN_WORKBENCH_RECEIVE_ONLY_PROOF '+JSON.stringify({compiled_roles:3,configured_h5_members:0,h5_mapping_loaded:false,new_sender_in_roster:false,new_group_in_routes:false,admitted_messages:2,tickets:2,automatic_reporter_profiles:2,duplicates_collapsed:true,outsider_denied:true,wrong_bot_denied:true,staff_count:1,provider_send_attempts:0}));
   }catch(error){
    failures.push(error);
    try{
     const counts=(await pool.query("SELECT json_build_object('messages',(select count(*) from channel.message_inbox),'intakes',(select count(*) from intake.service_intake),'tickets',(select count(*) from pilot_ticket.ticket),'decisions',(select count(*) from intake.deterministic_decision)) AS counts")).rows[0]?.counts;
     console.log('HUMAN_WORKBENCH_RECEIVE_ONLY_DIAGNOSTIC '+JSON.stringify({counts}));
    }catch(diagnosticError){failures.push(diagnosticError);}
   }finally{try{assert.equal((await controller.stop()).process_count,0);}catch(cleanupError){failures.push(cleanupError);}}
   if(failures.length)throw failures.length===1?failures[0]:new AggregateError(failures,'HUMAN_WORKBENCH_RECEIVE_ONLY_FAILURE');
   assert.equal((await pool.query<{n:number}>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name IN ('p2_g1_app','p2_g1_worker','p2_g1_gateway')")).rows[0]?.n,0);
  }});
  await assertNoP2016Residual({databaseUrl:process.env.PILOT_DATABASE_URL});
 }catch(error){outerFailures.push(error);}
 finally{
  for(const cleanup of [async()=>{if(workerTraceFile)await rm(workerTraceFile,{force:true});},async()=>rm(directory,{recursive:true,force:true})]){
   try{await cleanup();}catch(cleanupError){outerFailures.push(cleanupError);}
  }
 }
 if(outerFailures.length)throw outerFailures.length===1?outerFailures[0]:new AggregateError(outerFailures,'HUMAN_WORKBENCH_RECEIVE_ONLY_OUTER_FAILURE');
});

test('compiled parent rejects missing personal-read schema or migration before reporting ready and stops all roles',{timeout:120000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'human-workbench-schema-'));let workerTraceFile:string|undefined;
 try{
  await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'humanmissing',max:1,run:async({pool,databaseUrl}:{pool:PostgresPool;databaseUrl:string})=>{
   await migrateWorkbenchDatabase(databaseUrl);
   await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'runtime-staff',displayName:'运行接线合成坐席',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
   // Keep later feature schemas intact while removing the isolated database's 047 dependency.
   await pool.query('DROP TABLE pilot_ticket.personal_material_read_position');
   assert.equal((await pool.query("SELECT to_regclass('pilot_ticket.personal_material_read_position') AS name")).rows[0]?.name,null);
   workerTraceFile=join(tmpdir(),new URL(databaseUrl).pathname.slice(1)+'-worker-boundaries.jsonl');
   for(const removeMarker of [false,true]){
    if(removeMarker)await pool.query("DELETE FROM platform.schema_migration WHERE migration_id='047_workbench_personal_read'");
    const f=workbenchTestSettings(directory,await unusedPort());f.env.PILOT_DATABASE_URL=databaseUrl;
    await assert.rejects(workbenchMain(['--start'],{env:f.env,roleScriptUrl:new URL('./helpers/human-workbench-boundaries-role.mjs',import.meta.url)}),/HUMAN_WORKBENCH_SCHEMA_REQUIRED:workbench_personal_read_schema(?:,|$)/u);
   }
   const trace=(await readFile(join(directory,'boundaries.jsonl'),'utf8')).trim().split('\n').map(v=>object(JSON.parse(v)));
   assert.equal(trace.filter(v=>v.role==='APP'&&v.event==='failed'&&String(v.code).startsWith('HUMAN_WORKBENCH_SCHEMA_REQUIRED:workbench_personal_read_schema')).length,2);
   assert.equal((await pool.query<{n:number}>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name IN ('p2_g1_app','p2_g1_worker','p2_g1_gateway')")).rows[0]?.n,0);
  }});
  await assertNoP2016Residual({databaseUrl:process.env.PILOT_DATABASE_URL});
 }finally{if(workerTraceFile)await rm(workerTraceFile,{force:true});await rm(directory,{recursive:true,force:true});}
});

test('compiled parent and three compiled roles wire real OAuth sessions, bootstrap, React inbox/SSE, reporter feedback and three Sender adapters',{timeout:240000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'human-workbench-process-'));let proof:unknown,workerTraceFile:string|undefined;
 try{await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'humanwire',max:1,run:async({pool,databaseUrl}:{pool:PostgresPool;databaseUrl:string})=>{
  await migrateWorkbenchDatabase(databaseUrl);
  const workerTracePath=join(tmpdir(),new URL(databaseUrl).pathname.slice(1)+'-worker-boundaries.jsonl');workerTraceFile=workerTracePath;
  const access=createPilotAccessService({pool});await access.upsertPrincipal({wecomUserId:'runtime-staff',displayName:'运行接线合成坐席',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
  const port=await unusedPort();
  const f=workbenchTestSettings(directory,port);f.env.PILOT_DATABASE_URL=databaseUrl;f.env.PILOT_LOG_IDENTITY_HASH_KEY=INBOX_IDENTITY_KEY;f.settings.transportEnabled=true;f.settings.workbenchRemindersEnabled=true;f.settings.workbenchFollowEnabled=true;
  // Complete this legacy read fixture before the real Worker can claim its Intake.
  const session=await addInboxSession(pool,{reporter:'synthetic-A',bot:'bot-test',group:null,text:'运行接线合成私聊'});await attachInboxJourney(pool,session,{name:'运行接线报修人'});
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
   assert.equal(object(object(controller?.readiness).checks).workbench_personal_read_schema,true);
   assert.equal(object(object(controller?.readiness).checks).workbench_follow_schema,true);
   assert.equal(boot.body.workbench_follow_enabled,true);assert.equal(boot.body.workbench_follow_draft_recovery_enabled,false);
   for(const key of ['ticket_self_handling_enabled','ticket_assignment_enabled','ticket_waiting_actions_enabled','ticket_staff_completion_enabled','ticket_reopen_rounds_enabled','ticket_round_notifications_enabled','manual_reports_enabled','manual_review_enabled','conversation_workspace_enabled','conversation_inbox_enabled','personal_read_enabled','realtime_sse_enabled','source_group_directory_enabled','internal_notes_enabled','notification_exceptions_enabled'])assert.equal(boot.body[key],true,key);
   for(const key of ['draft_recovery_enabled','manual_review_draft_recovery_enabled','ticket_conversation_draft_recovery_enabled','staff_completion_draft_recovery_enabled','conversation_draft_recovery_enabled','manual_report_draft_recovery_enabled','supplement_follow_up_draft_recovery_enabled'])assert.equal(boot.body[key],false,key);
   assert.equal(boot.body.ai_enabled,false);assert.equal(boot.body.incident_candidate_workspace_enabled,false);assert.equal(boot.body.reporter_candidates_enabled,false);
   assert.equal((await member.get('/api/yixiaoxiu/bootstrap')).status,200);
   // Seed only the external input atomically; the real Worker creates the Core Ticket and group receipt.
   const groupIntakeId=await transactionP2016(pool,async transaction=>{
    const group=await seedPersistedIntake({pool:transaction,text:'处方提交不了',chatType:'group',tag:'runtime-group'});
    await transaction.query("UPDATE intake.service_intake SET source_bot_id='bot-test',source_chat_id='runtime-group',reporter_wecom_userid='synthetic-A' WHERE id=$1::uuid",[group.intakeId]);
    await transaction.query("UPDATE channel.message_inbox SET bot_id='bot-test',chat_id='runtime-group',sender_user_id='synthetic-A' WHERE id=$1::bigint",[group.messageId]);
    return group.intakeId;
   });
   let groupTicketId='',groupReceipt='';
   await until(async()=>{const row=(await pool.query<{id:string;text:string}>(`SELECT t.id::text,m.content->>'text' AS text FROM pilot_ticket.ticket t
    JOIN intake.deterministic_decision dec ON dec.service_intake_id=t.source_intake_id
    JOIN communication.message m ON m.content->'group_reply'->>'decision_id'=dec.id::text AND m.sender_system_code='MVP_GROUP_REPLY'
    WHERE t.source_intake_id=$1::uuid AND m.content->'group_reply'->>'kind'='RECEIVED'`,[groupIntakeId])).rows[0];groupTicketId=row?.id??'';groupReceipt=row?.text??'';return !!groupReceipt;});
   assert.equal(groupReceipt,'收到啦～小修记下了，工程师马上联系您，稍等哦 🛠️');
   assert.equal((await pool.query("SELECT 1 FROM communication.ticket_notification_binding WHERE ticket_id=$1::uuid AND notification_type='TICKET_CREATED' AND destination_type='GROUP'",[groupTicketId])).rowCount,0);
   await until(async()=>{const trace=await readFile(join(directory,'boundaries.jsonl'),'utf8');return trace.split('\n').filter(Boolean).map(v=>object(JSON.parse(v))).some(v=>v.event==='bot-send'&&v.target==='runtime-group'&&JSON.stringify(v.body).includes(groupReceipt));});
   const inbox=await staff.get('/api/workbench/conversation-inbox');assert.equal(inbox.status,200,inbox.raw);assert.ok(Array.isArray(inbox.body.items));assert.ok(inbox.body.items.length>0);
   const detail=await staff.get('/api/workbench/conversations/'+session.id+'?view=chat');assert.equal(detail.status,200,detail.raw);assert.ok(detail.body.contact_ref);
   browser=await tls.launch();assert.ok(browser);await browser.command('Network.setCookies',{cookies:[...staff.cookies].map(([name,value])=>({name,value,url:tls.origin,secure:true}))});
   const relatedItems=async()=>{const result=await staff.get('/api/workbench/board?column=pending&scope=related');assert.equal(result.status,200,result.raw);assert.ok(Array.isArray(result.body.items));return result.body.items.map(object);};
   assert.equal((await relatedItems()).some(item=>item.id===groupTicketId),false,'team visibility alone is not a personal relationship');
   const beforeFollow=await staff.get('/api/tickets/'+groupTicketId);assert.equal(beforeFollow.status,200);
   await browser.command('Page.navigate',{url:tls.origin+'/workbench/app/items/ticket/'+groupTicketId+'?detail=page'});
   await browser.waitFor("document.querySelector('[data-action=toggle-item-follow]')?.getAttribute('aria-pressed')==='false'");
   await browser.evaluate("document.querySelector('[data-action=toggle-item-follow]').click()");
   await browser.waitFor("document.querySelector('[data-action=toggle-item-follow]')?.getAttribute('aria-pressed')==='true'");
   assert.equal((await relatedItems()).filter(item=>item.id===groupTicketId).length,1);
   await browser.evaluate("document.querySelector('button[aria-label=关闭详情]').click()");await browser.waitFor("Boolean(document.querySelector('[data-action=related-scope]'))");
   await browser.evaluate("document.querySelector('[data-action=related-scope]').click()");
   await browser.waitFor(`new URLSearchParams(location.search).get('scope')==='related'&&document.querySelectorAll('.ticket-card[data-item-id="${groupTicketId}"]').length===1`);
   await browser.evaluate(`document.querySelector('.ticket-card[data-item-id="${groupTicketId}"] .card-open').click()`);
   await browser.waitFor("document.querySelector('[data-action=toggle-item-follow]')?.getAttribute('aria-pressed')==='true'");
   await browser.evaluate("document.querySelector('[data-action=toggle-item-follow]').click()");
   await browser.waitFor("document.querySelector('[data-action=toggle-item-follow]')?.getAttribute('aria-pressed')==='false'");
   assert.equal((await relatedItems()).some(item=>item.id===groupTicketId),false);
   const afterFollow=await staff.get('/api/tickets/'+groupTicketId);assert.equal(afterFollow.status,200);
   for(const key of ['assignee_id','status','version'])assert.equal(afterFollow.body[key],beforeFollow.body[key]);
   console.log('HUMAN_RELATED_SCOPE '+JSON.stringify({compiled_parent_and_app:true,follow_adds_once:true,unfollow_removes:true,ownership_unchanged:true,draft_recovery:false}));
   await browser.command('Page.navigate',{url:tls.origin+'/workbench/app/conversations/'+session.id});
   await browser.waitFor("Boolean(document.querySelector('[data-conversation-timeline]'))&&Boolean(document.querySelector('[data-action=open-conversations]'))");
   try{await browser.waitFor("document.querySelector('[data-realtime-status]')?.getAttribute('data-realtime-status')==='live'");}catch(error){console.log('HUMAN_REALTIME_DIAGNOSTIC '+JSON.stringify(await browser.evaluate("({status:document.querySelector('[data-realtime-status]')?.getAttribute('data-realtime-status'),visibility:document.visibilityState,online:navigator.onLine,requests:performance.getEntriesByType('resource').filter(r=>r.name.includes('/api/')).map(r=>({path:new URL(r.name).pathname,status:r.responseStatus}))})")));throw error;}
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
   proof={bootstrap:true,personal_read_schema:true,worker_fixed_group_receipt:true,real_oauth_sessions:true,compiled_roles:3,react_inbox:true,sse_live:true,web_reporter_feedback:true,bot_reporter_feedback:true,sender_routes:['WECOM_APP','WECOM_MESSAGE_PUSH','WECOM_AIBOT'],credentials_isolated:true};
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

test('compiled entry completes normal Gateway intake, human handling, original reporter feedback and lost-response recovery across four sources',{timeout:180000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'human-workbench-loop-'));let workerTraceFile:string|undefined,phase='PREPARE';
 const list=(value:unknown)=>{assert.ok(Array.isArray(value));return value.map(object);};
 const string=(value:unknown)=>{assert.equal(typeof value,'string');return value as string;};
 const evidence:Record<string,unknown>={production_ready:false,external_calls:false,scenarios:[]};
 const mark=(value:string)=>{phase=value;console.log('HUMAN_WORKBENCH_LOOP_PHASE '+value);};
 try{
  await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'humanloop',max:1,run:async({pool,databaseUrl}:{pool:PostgresPool;databaseUrl:string})=>{
   await migrateWorkbenchDatabase(databaseUrl);
   evidence.migrations=(await pool.query<{migration_id:string}>('SELECT migration_id FROM platform.schema_migration ORDER BY migration_id')).rows.map(row=>row.migration_id);
   workerTraceFile=join(tmpdir(),new URL(databaseUrl).pathname.slice(1)+'-worker-boundaries.jsonl');
   const access=createPilotAccessService({pool});
   const principal=await access.upsertPrincipal({wecomUserId:'runtime-staff',displayName:'闭环合成坐席',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
   const second=await access.upsertPrincipal({wecomUserId:'runtime-handler',displayName:'闭环合成处理人',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
   const port=await unusedPort(),f=workbenchTestSettings(directory,port);
   f.env.PILOT_DATABASE_URL=databaseUrl;f.env.PILOT_LOG_IDENTITY_HASH_KEY=INBOX_IDENTITY_KEY;f.settings.transportEnabled=true;f.settings.workbenchRemindersEnabled=true;
   f.settings.memberEntry={...f.settings.memberEntry,reporterUserIds:['synthetic-A','synthetic-B']};
   f.settings.bot.personTargetHashes.push(hashTarget('synthetic-B'));
   f.bindings.mappingConfigHash=yxxIdentityConfigHash(f.settings.memberEntry);
   f.bindings.members.push({memberUserId:'synthetic-B',bindingProofRef:f.settings.memberEntry.proofRef,accountStatus:'ACTIVE',bindingState:'VERIFIED',messageReachability:'REACHABLE'});
   f.bindings.mentions.push({botId:'bot-test',groupId:'runtime-group',reporterUserId:'synthetic-B',mentionUserId:'qualified-mention-B',namespaceProofRef:'tests/synthetic-webhook-namespace'});
   let controller:Awaited<ReturnType<typeof workbenchMain>>;
   const tls=await createYxxBrowserFixture({pool,createApp:({origin}:{origin:string})=>{f.settings.publicOrigin=origin;f.settings.reporterOrigin=origin;f.save();return createServer();},startApp:async()=>{
    controller=await workbenchMain(['--start'],{env:f.env,roleScriptUrl:new URL('./helpers/human-workbench-boundaries-role.mjs',import.meta.url)});assert.ok(controller);assert.equal(controller.process_count,3);assert.equal(controller.cookies,undefined);return controller.origin;
   },stopApp:async()=>{if(controller)assert.equal((await controller.stop()).process_count,0);}});assert.ok(tls);
   let browser:NonNullable<Awaited<ReturnType<typeof tls.launch>>>|undefined,gatewayPort=0;
   try{
    const base='http://127.0.0.1:'+port,staff=client(base,tls.origin),handler=client(base,tls.origin),member=client(base,tls.origin),other=client(base,tls.origin);
    const read=async(http:ReturnType<typeof client>,path:string)=>{const result=await http.get(path);assert.equal(result.status,200,path+' '+result.raw);return result.body;};
    const post=async(http:ReturnType<typeof client>,path:string,body:Record<string,unknown>,status=200)=>{const result=await http.post(path,body);assert.equal(result.status,status,path+' '+result.raw);return result.body;};
    for(const [http,path,code] of [[staff,'/workbench','staff'],[handler,'/workbench','handler'],[member,'/wecom/yixiaoxiu','member'],[other,'/wecom/yixiaoxiu','member-b']] as const){
     const login=await http.get(path+'/login');assert.equal(login.status,302);assert.ok(login.headers.location);
     const callback=await http.get(path+'/callback?code='+code+'&state='+new URL(login.headers.location).searchParams.get('state'));assert.equal(callback.status,303,callback.raw);
     await read(http,path==='/workbench'?'/api/lifecycle/bootstrap':'/api/yixiaoxiu/bootstrap');
    }
    const bootstrap=await read(staff,'/api/lifecycle/bootstrap');
    for(const flag of ['conversation_workspace_enabled','conversation_inbox_enabled','ticket_waiting_actions_enabled','ticket_staff_completion_enabled','ticket_reopen_rounds_enabled','personal_read_enabled','realtime_sse_enabled','manual_reports_enabled','workbench_reminders_enabled'])assert.equal(bootstrap[flag],true,flag);
    assert.equal(bootstrap.ai_enabled,false);assert.equal(bootstrap.incident_candidate_workspace_enabled,false);
    const trace=async()=>list((await readFile(join(directory,'boundaries.jsonl'),'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line) as unknown));
    await until(async()=>{const event=(await trace()).find(row=>row.event==='gateway-input-boundary');gatewayPort=Number(event?.port??0);return gatewayPort>0;});
    const sendFrame=async(frame:Record<string,unknown>)=>{const response=await fetch('http://127.0.0.1:'+gatewayPort+'/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(frame)});assert.equal(response.status,202,await response.text());};
    const frame=(chatType:'group'|'single',text:string,reporter:string,msgid=randomUUID())=>({cmd:'aibot_msg_callback',headers:{req_id:'loop-'+msgid},body:{msgid,aibotid:'bot-test',chattype:chatType,...(chatType==='group'?{chatid:'runtime-group'}:{}),from:{userid:reporter},msgtype:'text',text:{content:text}}});
    type IntakeFact={message_id:string;intake_id:string;session_id:string;reporter:string;chat_type:string};
    const material=async(msgid:string):Promise<IntakeFact>=>{
     let found:IntakeFact|undefined;await until(async()=>{found=(await pool.query<IntakeFact>(`SELECT m.id::text AS message_id,r.intake_id::text,s.id::text AS session_id,m.sender_user_id AS reporter,m.chat_type
       FROM channel.message_inbox m JOIN intake.service_intake_message r ON r.channel_message_id=m.id JOIN conversation.session s ON s.service_intake_id=r.intake_id WHERE m.bot_id='bot-test' AND m.msg_id=$1`,[msgid])).rows[0];return !!found;});assert.ok(found);return found;
    };
    const accept=async(chatType:'group'|'single',text:string,reporter:string)=>{const inbound=frame(chatType,text,reporter);await sendFrame(inbound);return {...await material(inbound.body.msgid),frame:inbound};};
    const processed=async(messageId:string)=>until(async()=>(await pool.query<{processed:boolean}>(`SELECT EXISTS (
     SELECT 1 FROM intake.service_intake_message r JOIN intake.deterministic_decision d ON d.service_intake_id=r.intake_id
     AND d.source_window_start_sequence<=r.sequence_no AND d.source_window_end_sequence>=r.sequence_no
     WHERE r.channel_message_id=$1::bigint) AS processed`,[messageId])).rows[0]?.processed===true);
    const ticketFor=async(intakeId:string)=>{let id='';await until(async()=>{id=(await pool.query<{id:string}>(`SELECT t.id::text FROM pilot_ticket.ticket t WHERE t.source_intake_id=$1::uuid OR t.id=(SELECT j.linked_ticket_id FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id WHERE l.source_intake_id=$1::uuid LIMIT 1)`,[intakeId])).rows[0]?.id??'';return !!id;});return id;};
    mark('A_GATEWAY_GROUP_AND_PRIVATE');
    const group=await accept('group','@合成测试助手 合成门诊群打印机打印不了。','synthetic-B'),direct=await accept('single','合成门诊单聊打印机打印不了。','synthetic-A');
    assert.equal(group.reporter,'synthetic-B');assert.equal(group.chat_type,'group');assert.equal(direct.reporter,'synthetic-A');assert.equal(direct.chat_type,'single');assert.notEqual(group.intake_id,direct.intake_id);
    const groupId=await ticketFor(group.intake_id),directId=await ticketFor(direct.intake_id);assert.notEqual(groupId,directId);
    await sendFrame(group.frame);await sendFrame(direct.frame);
    for(const source of [group,direct]){
     assert.equal((await pool.query<{n:number}>('SELECT count(*)::int AS n FROM channel.message_inbox WHERE bot_id=$1 AND msg_id=$2',['bot-test',source.frame.body.msgid])).rows[0]?.n,1);
     assert.equal((await pool.query<{n:number}>('SELECT count(*)::int AS n FROM pilot_ticket.ticket WHERE source_intake_id=$1::uuid',[source.intake_id])).rows[0]?.n,1);
     assert.equal((await read(staff,'/api/workbench/conversations/'+source.session_id+'?view=chat')).contact_ref!==undefined,true);
    }
    assert.ok(list((await read(staff,'/api/workbench/conversation-inbox')).items).length>=2);
    browser=await tls.launch();assert.ok(browser);await browser.command('Network.setCookies',{cookies:[...staff.cookies].map(([name,value])=>({name,value,url:tls.origin,secure:true}))});
    await browser.command('Page.navigate',{url:tls.origin+'/workbench/app/conversations/'+direct.session_id});
    await browser.waitFor("Boolean(document.querySelector('[data-conversation-timeline]'))&&document.querySelector('[data-realtime-status]')?.getAttribute('data-realtime-status')==='live'");
    assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-action=open-conversations]'))&&Boolean(document.querySelector('[data-action=open-notification-exceptions]'))"),true);
    const conversation='/api/workbench/conversations/'+direct.session_id,privateCanary='LOOP_INTERNAL_ONLY_'+randomUUID();
    await post(staff,conversation+'/takeover',{client_command_id:randomUUID(),expected_row_version:object((await read(staff,conversation+'?view=chat')).session).row_version});
    const internal=await post(staff,conversation+'/internal-notes',{client_command_id:randomUUID(),expected_row_version:object((await read(staff,conversation+'?view=chat')).session).row_version,text:privateCanary},201);assert.equal(internal.outbox_id,null);
    const replyText='合成坐席已接待，正在核对打印故障。';
    const reply=await post(staff,conversation+'/messages',{client_command_id:randomUUID(),expected_row_version:object((await read(staff,conversation+'?view=chat')).session).row_version,text:replyText},202);
    await browser.waitFor('document.querySelector("[data-conversation-timeline]")?.textContent.includes('+JSON.stringify(privateCanary)+')');
    await until(async()=>(await trace()).some(row=>row.event==='bot-send'&&row.target==='synthetic-A'&&JSON.stringify(row.body).includes(replyText)));
    await until(async()=>{const deliveries=list((await read(staff,conversation+'/deliveries?view=chat&message_ids='+string(reply.message_id))).items);return deliveries.length>0&&deliveries.every(row=>row.status==='SENT');});
    evidence.A={normal_gateway_frames:true,duplicate_inbox_rows:1,duplicate_ticket_rows:1,group_ticket:groupId,private_ticket:directId,production_react:true,sse:true};

    mark('B_REAL_WORKER_RULE_ADMISSION');
    const unclear=await accept('single','系统不行','user-test');
    const ruleDeliveries=async(sequence:number)=>(await pool.query<{status:string;side_effect_state:string;last_error_code:string|null;attempt_count:number}>(`SELECT d.status,d.side_effect_state,d.last_error_code,d.attempt_count
     FROM intake.deterministic_decision dec JOIN intake.safe_action_suggestion a ON a.decision_id=dec.id AND a.action_type='REQUEST_ONE_DESCRIPTION'
     JOIN communication.message m ON m.client_command_id=a.id AND m.sender_system_code='RULE_FIRST_ORCHESTRATOR'
     JOIN communication.outbox o ON o.message_id=m.id JOIN communication.delivery d ON d.outbox_id=o.id
     WHERE dec.service_intake_id=$1::uuid AND dec.source_window_end_sequence=$2`,[unclear.intake_id,sequence])).rows;
    await until(async()=>(await ruleDeliveries(1)).some(row=>row.status==='SENT'));
    const unclearPath='/api/workbench/conversations/'+unclear.session_id;
    await post(staff,unclearPath+'/takeover',{client_command_id:randomUUID(),expected_row_version:object((await read(staff,unclearPath+'?view=chat')).session).row_version});
    const beforePausedSends=(await trace()).filter(row=>row.event==='bot-send'&&row.target==='user-test').length;
    const pausedJourney=async()=>(await pool.query<{status:string;row_version:string;linked_ticket_id:string|null;origin_session_id:string|null;current_session_id:string|null}>('SELECT status,row_version::text,linked_ticket_id::text,origin_session_id::text,current_session_id::text FROM intake.contact_journey WHERE origin_intake_id=$1::uuid',[unclear.intake_id])).rows[0];
    await until(async()=>{const value=await pausedJourney();return value?.origin_session_id===unclear.session_id&&value.current_session_id===unclear.session_id;});
    const beforePausedJourney=await pausedJourney();assert.ok(beforePausedJourney);
    const unclearAgain=await accept('single','系统不行','user-test');assert.equal(unclearAgain.intake_id,unclear.intake_id);
    await processed(unclearAgain.message_id);
    const pausedRules=(await pool.query<{state:string;error_code:string|null}>(`SELECT a.state,a.error_code FROM intake.deterministic_decision d JOIN intake.safe_action_suggestion a ON a.decision_id=d.id
      WHERE d.service_intake_id=$1::uuid AND d.source_window_end_sequence=2`,[unclear.intake_id])).rows;
    assert.ok(pausedRules.length>0);assert.ok(pausedRules.every(row=>row.state==='CANCELLED'&&row.error_code==='RULE_ACTIONS_PAUSED_AFTER_TAKEOVER'));
    assert.equal((await ruleDeliveries(2)).length,0,'paused actions must not create outbound messages or delivery attempts');
    assert.deepEqual(await pausedJourney(),beforePausedJourney);
    assert.equal((await trace()).filter(row=>row.event==='bot-send'&&row.target==='user-test').length,beforePausedSends);

    mark('E_WEB_AND_UNVERIFIED_MANUAL');
    const webInput={schema_version:1,client_command_id:randomUUID(),description:'合成门诊网页打印机打印不了。',location:{text:'闭环合成位置',unknown:false},service_code:null,impact_scope:'SINGLE_WORKSTATION',reported_department_text:null,extension:null};
    const web=await post(member,'/api/yixiaoxiu/requests',webInput,202),webRef=string(object(web.receipt).request_ref);
    const webReplay=await post(member,'/api/yixiaoxiu/requests',webInput);assert.equal(webReplay.replayed,true);assert.equal(object(webReplay.receipt).request_ref,webRef);
    let webId='';await until(async()=>{webId=(await pool.query<{id:string}>('SELECT t.id::text FROM intake.web_request_binding b JOIN pilot_ticket.ticket t ON t.source_intake_id=b.intake_id WHERE b.request_ref=$1',[webRef])).rows[0]?.id??'';return !!webId;});
    assert.equal((await other.get('/api/yixiaoxiu/requests/'+webRef)).status,404);
    assert.ok(JSON.stringify(await read(member,'/api/yixiaoxiu/my-reports')).includes(webRef));assert.equal(JSON.stringify(await read(other,'/api/yixiaoxiu/my-reports')).includes(webRef),false);
    const manual=await post(staff,'/api/workbench/reports',{schema_version:1,client_command_id:randomUUID(),source:'PHONE',description:'合成门诊电话打印机打印不了。',location:{text:null,unknown:true},reporter:{verification:'UNVERIFIED',name:'闭环合成电话联系人',contact:'合成内线9943',department:null}},202);
    assert.equal(manual.external_notification,false);assert.equal(manual.manual_contact_required,true);const manualId=string(object(manual.ticket).id);
    const detail=(http:ReturnType<typeof client>,id:string)=>read(http,'/api/tickets/'+id);
    const start=async(http:ReturnType<typeof client>,id:string)=>{
     const current=await detail(http,id),related=list((await read(http,'/api/tickets/'+id+'/related-conversations')).items),sessions=related.filter(row=>row.take_allowed===true).map(row=>({session_id:row.session_id,expected_row_version:Number(row.session_row_version)}));
     await post(http,'/api/tickets/'+id+(related.length?'/take-and-start-with-conversations':'/take-and-start'),{client_command_id:randomUUID(),expected_version:current.version,reason_code:'LOOP_EXPLICIT_START',resolver_team_id:current.resolver_team_id,...(related.length?{communication_choice:sessions.length?'TAKE_SELECTED':'RETAIN_CURRENT',sessions}:{})});
     const next=await detail(http,id);assert.equal(next.status,'IN_PROGRESS');return next;
    };
    const sources=[{kind:'private',id:directId,owner:member},{kind:'group',id:groupId,owner:other},{kind:'web',id:webId,owner:member},{kind:'manual',id:manualId,owner:member}];
    const journeys:Record<string,unknown>[]=[];
    for(const source of sources){
     mark('B_HANDLING_'+source.kind);
     let current=await start(staff,source.id);const path='/api/tickets/'+source.id,number=current.ticket_no,cycle=object(current.handling_cycle);
     const communication=list((await read(staff,path+'/responsibility')).conversations);
     await post(staff,path+'/transfer-assignment',{client_command_id:randomUUID(),expected_version:current.version,reason_code:'WORKBENCH_ASSIGN',target_principal_id:second.id,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});
     current=await detail(handler,source.id);assert.equal(current.assignee_id,second.id);assert.deepEqual(list((await read(staff,path+'/responsibility')).conversations),communication);
     await post(handler,path+'/request-information',{client_command_id:randomUUID(),expected_version:current.version,reason_code:'WORKBENCH_REQUEST_INFORMATION',note:'合成内部补充请求 '+privateCanary,external_visible:false});
     const waiting=await detail(handler,source.id);assert.equal(waiting.status,'WAITING_REQUESTER');
     if(source.kind==='web'){
      await read(member,'/api/yixiaoxiu/bootstrap');
      const request=await read(member,'/api/yixiaoxiu/requests/'+webRef),supplementText='合成网页补充：重新连接后打印仍然失败。';
      await post(member,'/api/yixiaoxiu/requests/'+webRef+'/supplements',{schema_version:1,client_command_id:randomUUID(),expected_input_revision:request.input_revision,text:supplementText},202);
      await until(async()=>(await detail(handler,source.id)).status==='IN_PROGRESS');current=await detail(handler,source.id);assert.equal(current.assignee_id,second.id);assert.deepEqual(current.handling_cycle,waiting.handling_cycle);
      const resumes=(await pool.query<{event_id:string}>("SELECT event_id::text FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_type='ticket.resumed' AND reason_code='WEB_SUPPLEMENT_RECEIVED'",[source.id])).rows;assert.equal(resumes.length,1);
      const materialPath='/api/workbench/items/ticket/'+source.id,materials=list((await read(staff,materialPath)).records),supplement=materials.find(row=>row.text===supplementText);assert.ok(supplement);const coordinate=object(supplement.read_material);
      const beforeRead=await read(handler,materialPath+'/read-position'),followBefore=await read(staff,path+'/supplement-follow-up');assert.equal(followBefore.has_pending_supplements,true);
      const readCommand={client_command_id:randomUUID(),source_ref:coordinate.source_ref,revision:coordinate.revision};
      const acknowledged=await post(staff,materialPath+'/read-position',readCommand);assert.ok(acknowledged.source_key);
      assert.deepEqual(await read(handler,materialPath+'/read-position'),beforeRead,'personal reading never advances another handler');assert.deepEqual(await read(staff,path+'/supplement-follow-up'),followBefore,'reading does not resolve team follow-up');
      await post(staff,path+'/supplement-follow-up',{client_command_id:randomUUID(),action:'RECORD_DISPOSITION',source_ref:coordinate.source_ref,revision:coordinate.revision,disposition_note:'已核实补充，继续原处理轮次。',mark_followed_up:true});
      assert.equal((await read(staff,path+'/supplement-follow-up')).has_pending_supplements,false);
     }else{
      if(source.kind==='group'){
       let ref='';await until(async()=>{ref=(await pool.query<{public_ref:string}>('SELECT public_ref FROM pilot_ticket.reporter_public_ref WHERE ticket_id=$1::uuid AND status=\'ACTIVE\'',[source.id])).rows[0]?.public_ref??'';return !!ref;});
       const addition=await accept('single','续接工单 '+ref+'：已重新连接，仍需检查。','synthetic-B');await processed(addition.message_id);assert.equal(await ticketFor(addition.intake_id),source.id);
      }else if(source.kind==='private'){
       const addition=await accept('single','补充：错误提示为403，请继续核对。','synthetic-A');await processed(addition.message_id);assert.equal(addition.intake_id,direct.intake_id);
      }
      current=await detail(handler,source.id);assert.equal(current.status,'WAITING_REQUESTER','Bot/manual waiting remains explicit until staff resumes');
      await post(handler,path+'/resume',{client_command_id:randomUUID(),expected_version:current.version,reason_code:'WORKBENCH_RESUME',note:'工作人员核对补充后明确继续。',external_visible:false});current=await detail(handler,source.id);assert.equal(current.status,'IN_PROGRESS');
     }
     mark('C_COMPLETION_'+source.kind);
     await post(handler,path+'/complete',{client_command_id:randomUUID(),expected_version:current.version,reason_code:'STAFF_COMPLETED',handling_cycle_id:object(current.handling_cycle).id,internal_process:privateCanary,external_summary:'合成打印设备已恢复，请本人重新核对。',external_summary_confirmed:true});
     const closed=await detail(handler,source.id);assert.equal(closed.status,'CLOSED');assert.equal(object(closed.handling_cycle).id,cycle.id);
     if(source.kind==='manual'){
      assert.deepEqual(list((await read(staff,path+'/deliveries')).items),[]);assert.equal((await pool.query<{n:number}>('SELECT count(*)::int AS n FROM communication.ticket_notification_binding WHERE ticket_id=$1::uuid',[source.id])).rows[0]?.n,0);
     }else{
      for(const node of ['FIRST_HANDLING','STAFF_COMPLETED'])await until(async()=>{const notices=list((await read(staff,path+'/deliveries')).items).filter(row=>row.node===node&&row.cycle_no===1);return notices.length===(source.kind==='group'&&node==='STAFF_COMPLETED'?2:1)&&notices.every(row=>row.status==='SENT');});
      if(source.kind==='private'){
       const ordinary=await accept('single','补充：错误提示为403。','synthetic-A');await processed(ordinary.message_id);assert.equal(ordinary.intake_id,direct.intake_id);
       const newIssue=await accept('single','另外门诊系统也登录不了','synthetic-A');await processed(newIssue.message_id);assert.notEqual(newIssue.intake_id,direct.intake_id);assert.notEqual(newIssue.session_id,direct.session_id);assert.notEqual(await ticketFor(newIssue.intake_id),source.id);
       const still=await detail(handler,source.id);assert.equal(still.status,'CLOSED');assert.equal(still.version,closed.version);assert.deepEqual(still.handling_cycle,closed.handling_cycle);
      }
      mark('D_REPORTER_FEEDBACK_'+source.kind);
      let publicPath='/api/yixiaoxiu/requests/'+webRef;
      if(source.kind==='web')await read(member,'/api/yixiaoxiu/bootstrap');
      if(source.kind!=='web'){
       const ref=(await pool.query<{public_ref:string}>('SELECT public_ref FROM pilot_ticket.reporter_public_ref WHERE ticket_id=$1::uuid AND status=\'ACTIVE\'',[source.id])).rows[0]?.public_ref;assert.ok(ref);publicPath='/api/reporter/tickets/'+ref;
       await read(source.owner,'/api/reporter/feedback/bootstrap');assert.equal((await (source.kind==='group'?member:other).get(publicPath)).status,404);
      }
      const reporterDetail=await read(source.owner,publicPath);assert.equal(JSON.stringify(reporterDetail).includes(privateCanary),false);const feedback=object(reporterDetail.feedback_context);assert.equal(feedback.can_feedback,true);
      const feedbackCommand={schema_version:1,client_command_id:randomUUID(),feedback:'STILL_UNRESOLVED',completed_round_ref:feedback.completed_round_ref,expected_ticket_version:feedback.ticket_version};
      await post(source.owner,publicPath+'/feedback',feedbackCommand);assert.equal((await read(source.owner,publicPath+'/feedback/commands/'+feedbackCommand.client_command_id)).state,'COMMITTED');
      const reopened=await detail(staff,source.id);assert.equal(reopened.ticket_no,number);assert.equal(reopened.status,'REOPENED');assert.equal(reopened.assignee_id,null);assert.equal(object(reopened.handling_cycle).cycle_no,Number(cycle.cycle_no)+1);assert.equal(object(reopened.handling_cycle).first_responsibility_event_id,null);
      const accepted=await start(handler,source.id);assert.equal(accepted.assignee_id,second.id);assert.equal(object(accepted.handling_cycle).id,object(reopened.handling_cycle).id);
     }
     journeys.push({source:source.kind,ticket_id:source.id,ticket_no:number,old_cycle:cycle.id,reporter_feedback:source.kind!=='manual',unverified_manual:source.kind==='manual'});
    }
    mark('F_LOST_COMMITTED_RESPONSE');
    const recoveryPath='/api/tickets/'+directId,current=await detail(staff,directId),eventsBefore=list((await read(staff,recoveryPath+'/events?limit=200')).items).filter(row=>row.event_type==='ticket.assignment_transferred').length;
    const command={client_command_id:randomUUID(),expected_version:current.version,reason_code:'WORKBENCH_ASSIGN',target_principal_id:principal.id,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]};
    await assert.rejects(staff.postLosingResponse(recoveryPath+'/transfer-assignment',command),/HUMAN_WORKBENCH_TEST_RESPONSE_LOST/u);
    const receipt=await read(staff,recoveryPath+'/assignment/commands/'+command.client_command_id);assert.equal(receipt.state,'COMMITTED');
    const committed=await detail(staff,directId);assert.equal(committed.assignee_id,principal.id);
    const replay=await post(staff,recoveryPath+'/transfer-assignment',command);assert.equal(replay.ticket_event_id,receipt.ticket_event_id);assert.deepEqual(await detail(staff,directId),committed);
    assert.equal(list((await read(staff,recoveryPath+'/events?limit=200')).items).filter(row=>row.event_type==='ticket.assignment_transferred').length,eventsBefore+1);
    const sends=(await trace()).filter(row=>['app-send','group-send','bot-send'].includes(string(row.event)));
    assert.ok(['app-send','group-send','bot-send'].every(kind=>sends.some(row=>row.event===kind)));assert.ok(sends.every(row=>row.role==='GATEWAY'));assert.equal(JSON.stringify(sends).includes(privateCanary),false);
    for(const send of sends.filter(row=>row.event==='group-send')){assert.equal(send.target,'runtime-group');assert.deepEqual(object(object(send.payload).text).mentioned_list,['qualified-mention-B']);}
    assert.ok(sends.filter(row=>row.event==='app-send').every(row=>object(row.payload).touser==='open-synthetic-A'));
    assert.ok(sends.filter(row=>row.event==='bot-send').every(row=>['synthetic-A','synthetic-B','user-test','runtime-group'].includes(string(row.target))));
    const workerTrace=object(JSON.parse((await readFile(workerTraceFile,'utf8')).trim().split('\n')[0]??''));
    evidence.resources={ports:{app:port,https:Number(new URL(tls.origin).port),sdk:gatewayPort},roles:[...(await trace()).filter(row=>row.event==='environment'),workerTrace].map(row=>({role:row.role,pid:row.pid}))};
    for(const source of [group,direct]){
     assert.equal((await pool.query<{n:number}>('SELECT count(*)::int AS n FROM channel.message_inbox WHERE bot_id=$1 AND msg_id=$2',['bot-test',source.frame.body.msgid])).rows[0]?.n,1);
     assert.equal((await pool.query<{n:number}>('SELECT count(*)::int AS n FROM pilot_ticket.ticket WHERE source_intake_id=$1::uuid',[source.intake_id])).rows[0]?.n,1);
    }
    evidence.B={explicit_communication_retained:true,web_system_resume:true,bot_explicit_resume:true,personal_read_independent:true,team_follow_up_explicit:true,paused_rules:pausedRules.length,paused_rule_deliveries:0,paused_rule_sender_calls:0};
    evidence.C={closed_by_current_handler:true,channels:['WECOM_AIBOT','WECOM_MESSAGE_PUSH','WECOM_APP'],observed_delivery_state:'SENT',user_read_evidence:'NOT_ASSERTED',internal_material_not_sent:true};
    evidence.D={original_reporter_http_feedback:true,same_ticket_new_round:true,assignee_cleared:true,explicit_reaccept:true,ordinary_supplement_does_not_reopen:true};
    evidence.E={own_web_read:true,other_reporter_404:true,unverified_manual_no_notification:true};
    evidence.F={actual_http_response_lost:true,original_uuid_receipt:'COMMITTED',explicit_identical_replay:true,assignment_events_added:1};evidence.journeys=journeys;
   }catch(error){console.log('HUMAN_WORKBENCH_LOOP_FAILED '+JSON.stringify({phase,message:error instanceof Error?error.message:String(error)}));throw error;}
   finally{await browser?.close();await tls.close();if(gatewayPort)await assert.rejects(fetch('http://127.0.0.1:'+gatewayPort+'/message',{signal:AbortSignal.timeout(1000)}));}
   assert.equal((await pool.query<{n:number}>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name IN ('p2_g1_app','p2_g1_worker','p2_g1_gateway')")).rows[0]?.n,0);
  }});
  await assertNoP2016Residual({databaseUrl:process.env.PILOT_DATABASE_URL});console.log('HUMAN_WORKBENCH_CLOSURE_PROOF '+JSON.stringify({...evidence,compiled_parent_and_roles:true,process_count_started:3,process_count_stopped:0,owned_database_removed:true,scenarios:['A','B','C','D','E','F'].map(name=>({name,result:'PASS'}))}));
 }finally{if(workerTraceFile)await rm(workerTraceFile,{force:true});await rm(directory,{recursive:true,force:true});}
});
