import {shanghaiLocalToEpochMs} from '../../src/platform/time-contract.mjs';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import type {PostgresPool} from '../../src/platform/postgres-pool.mjs';
import {createPilotAccessService} from '../../src/p1-009-pilot-access-workbench.mjs';
import {migrateWorkbenchAuth} from '../../scripts/p2-016-workbench-auth-migrate.mjs';
import {createWeComWorkbenchAuthentication} from '../../src/p2-016-workbench-wecom-auth.mjs';
import {createContactJourneyStore} from '../../src/p2-015-contact-journey.mjs';
import {migrateWorkbenchSupplementFollowUp} from '../../scripts/workbench-supplement-follow-up-migrate.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {P2016EnabledRuntime} from '../../src/p2-016-runtime.mjs';
import {createP2016Runtime} from '../../src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../../src/p2-006-workbench-http.mjs';
import {migrateWorkbenchManualReports} from '../../scripts/workbench-manual-reports-migrate.mjs';
import {migrateWorkbenchPersonalRead} from '../../scripts/workbench-personal-read-migrate.mjs';
import {migrateWorkbenchFollow} from '../../scripts/workbench-follow-migrate.mjs';
import {withT37Fixture,object,text,type T37Http} from './t37-follow-up-fixture.mjs';

export {object,text};
export function version(value:unknown):number {
  assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<=2147483647);
  return value;
}
export interface T40ReminderRiskFixture {
  readonly origin:string;
  readonly pool:PostgresPool;
  readonly runtime:P2016EnabledRuntime;
  readonly ticketId:string;
  readonly handler:string;
  readonly browserCookie:Readonly<{name:string;value:string;url:string}>;
  readonly http:T37Http;
  readonly setupCommandIds:readonly string[];
  currentFacts():Promise<Record<string,unknown>>;
  appendLaterPrimary():Promise<{sourceRef:string;revision:string}>;
  revokeReadWithoutScopeChange():Promise<void>;
  nextDue():Promise<void>;
  setTeams(teams:readonly string[]):Promise<void>;
  removeStaffRole():Promise<void>;
  createTeamReport():Promise<string>;
  logout():Promise<void>;
}
/** Separate six-risk fixture: original public Core/Assignment/Journey/ingress/HTTP ports; original T40 first/helper stay immutable. */
export async function withT40ReminderRiskFixture(run:(fixture:T40ReminderRiskFixture)=>Promise<void>,{realSession=false}:{realSession?:boolean}={}) {
  await withT37Fixture(async base=>{
    await base.runtime.stop();
    // Locate only the random database already owned by the original isolated wrapper.
    // Never print its URL or start/create a new cluster.
    const isolated=await base.pool.query<{database_name:string}>('SELECT current_database() AS database_name');
    const databaseName=isolated.rows[0]?.database_name;
    assert.ok(databaseName);
    const ownerUrl=process.env.PILOT_DATABASE_URL;
    assert.equal(typeof ownerUrl,'string');
    if(typeof ownerUrl!=='string')throw Error('T40_OWNED_DATABASE_REQUIRED');
    const databaseUrl=new URL(ownerUrl);databaseUrl.pathname='/'+databaseName;
    const migration={databaseUrl:String(databaseUrl),mode:'apply' as const};
    await migrateWorkbenchManualReports(migration);
    await migrateWorkbenchPersonalRead(migration);
    await migrateWorkbenchFollow(migration);
    await migrateWorkbenchSupplementFollowUp(migration);
    const authOrigin='https://127.0.0.1:'+new URL(base.origin).port;
    const identityHashKey='t40-isolated-auth-identity-hash-key',corpId='ww-t40-source-fixture',agentId='1000001';
    let official:ReturnType<typeof createWeComWorkbenchAuthentication>|undefined;
    const realCookies:{name:string;value:string;url:string}[]=[],realCsrf:string[]=[];
    if(realSession){
      await migrateWorkbenchAuth(migration);
      official=createWeComWorkbenchAuthentication({pool:base.pool,publicOrigin:authOrigin,corpId,agentId,identityHashKey,accessTokenProvider:async()=> 't40-isolated-token',fetchImpl:async(input,init)=>{
        const url=new URL(String(input));assert.equal(url.origin,'https://qyapi.weixin.qq.com');assert.equal(url.pathname,'/cgi-bin/batch/userid_to_openuserid');
        assert.equal(typeof init?.body,'string');const body=object(JSON.parse(String(init?.body)));assert.ok(Array.isArray(body.userid_list));
        return new Response(JSON.stringify({errcode:0,open_userid_list:body.userid_list.map(user=>({userid:text(user),open_userid:'open-'+text(user)}))}),{headers:{'content-type':'application/json'}});
      }});
      await official.initialize();
      for(const principal of [base.dispatcher,base.handler,base.otherHandler]){
        const row=(await base.pool.query<{wecom_user_id:string}>('SELECT wecom_user_id FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[principal])).rows[0];assert.ok(row);
        const token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url'),now=Date.now(),expires=now+3600000;
        const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
        const identity=createHmac('sha256',identityHashKey).update(JSON.stringify(['workbench-identity-v1',corpId,agentId,'open-'+row.wecom_user_id])).digest('hex');
        await base.pool.query(`INSERT INTO pilot_ticket.workbench_auth_session(session_token_hash,csrf_token_hash,principal_id,identity_hash,created_at,created_epoch_ms,last_seen_at,last_seen_epoch_ms,expires_epoch_ms,expires_at)
          VALUES($1,$2,$3::uuid,$4,platform.local_from_epoch_ms($5),$5,platform.local_from_epoch_ms($5),$5,$6,platform.local_from_epoch_ms($6))`,[hash(token),hash(csrf),principal,identity,now,expires]);
        realCookies.push({name:'__Host-wecom_workbench_session',value:token,url:base.origin});realCsrf.push(csrf);
      }
    }
    const options={
      pool:base.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true as const},
      publicOrigin:base.origin,listenPort:Number(new URL(base.origin).port),
      principalIds:[base.dispatcher,base.handler,base.otherHandler],
      gatewayEnabled:false,senderEnabled:false,externalSendEnabled:false,
      workbenchManualReviewEnabled:true,workbenchConversationsEnabled:true,
      workbenchFollowEnabled:true,workbenchPersonalReadEnabled:true,workbenchSupplementFollowUpEnabled:true,
      workbenchFollowUpSchedulesEnabled:true,workbenchRealtimeEnabled:true,
      ticketAssignmentEnabled:true,workbenchRemindersEnabled:true,...(official?{workbenchAuthentication:official}:{}),
    };
    const runtime=createP2016Runtime(options);
    try {
      assert.equal(runtime.orchestrationWorker,null);
      assert.equal(runtime.incidentExtension,null);
      assert.equal(runtime.selfService,null);
      await listenConversationWorkbenchServer(runtime.server,{port:options.listenPort});
      const cookies=official?realCookies:runtime.authenticate.browserCookies?.();
      assert.ok(cookies?.[0]&&cookies[1]);
      const cookieAt=(index:number)=>{
        const entry=cookies[index];assert.ok(entry);
        return entry.name+'='+entry.value+(official?'; __Host-wecom_workbench_csrf='+realCsrf[index]:'');
      };
      const httpAt=async(index:number):Promise<T37Http>=>{
        const get=async(path:string)=>{
          const response=await fetch(base.origin+path,{headers:{cookie:cookieAt(index)}});
          return {status:response.status,value:object(await response.json())};
        };
        const bootstrap=await get('/api/lifecycle/bootstrap');
        assert.equal(bootstrap.status,200,JSON.stringify(bootstrap.value));
        const csrf=text(bootstrap.value.csrf_token);
        const post=async(path:string,body:Readonly<Record<string,unknown>>)=>{
          const response=await fetch(base.origin+path,{method:'POST',headers:{
            cookie:cookieAt(index),origin:official?authOrigin:base.origin,'content-type':'application/json',
            'x-csrf-token':csrf,'idempotency-key':text(body.client_command_id),
            'if-match':'"'+String(body.expected_version)+'"',
          },body:JSON.stringify(body)});
          return {status:response.status,value:object(await response.json())};
        };
        return {get,post};
      };
      const dispatcher=await httpAt(0),http=await httpAt(1),ticketId=await base.createTicket();
      const path='/api/tickets/'+ticketId;
      const queued=await dispatcher.get(path);assert.equal(queued.status,200);
      const assignmentId=randomUUID();
      const assignment=await dispatcher.post(path+'/assign',{
        client_command_id:assignmentId,expected_version:version(queued.value.version),
        reason_code:'WORKBENCH_ASSIGN',target_principal_id:base.handler,
        resolver_team_id:text(queued.value.resolver_team_id),communication_choice:'RETAIN_CURRENT',sessions:[],
      });
      assert.equal(assignment.status,200,JSON.stringify(assignment.value));
      const assigned=await http.get(path);assert.equal(assigned.status,200);
      assert.equal(assigned.value.assignee_id,base.handler,'current handling relation is an actual HTTP fact');
      const schedule=await http.get(path+'/follow-up-schedule');assert.equal(schedule.status,200);
      const scheduleId=randomUUID();
      const arranged=await http.post(path+'/follow-up-schedule',{
        client_command_id:scheduleId,expected_version:version(assigned.value.version),
        expected_schedule_version:text(schedule.value.schedule_version),
        reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action:'SET',due_at:'2020-01-02 09:30:00',
      });
      assert.equal(arranged.status,200,JSON.stringify(arranged.value));
      const active=await http.get(path+'/follow-up-schedule');assert.equal(active.status,200);
      assert.equal(object(active.value.active).is_due,true);
      await base.setHandlerTeams([]); // Ticket assignee READ remains, and this principal scope stays fixed during later transfer.
      const stableScope=text((await http.get('/api/lifecycle/bootstrap')).value.authorization_revision);
      const revokeReadWithoutScopeChange=async()=>{
        const before=await dispatcher.get(path);assert.equal(before.status,200);
        const response=await dispatcher.post(path+'/transfer-assignment',{client_command_id:randomUUID(),expected_version:version(before.value.version),reason_code:'WORKBENCH_TRANSFER',target_principal_id:base.otherHandler,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});
        assert.equal(response.status,200,JSON.stringify(response.value));
        assert.equal(text((await http.get('/api/lifecycle/bootstrap')).value.authorization_revision),stableScope);
        assert.equal((await http.get('/api/workbench/items/ticket/'+ticketId+'?limit=50')).status,404);
      };
      const removeStaffRole=async()=>{
        const row=(await base.pool.query<{wecom_user_id:string}>('SELECT wecom_user_id FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[base.handler])).rows[0];assert.ok(row);
        await createPilotAccessService({pool:base.pool}).upsertPrincipal({wecomUserId:row.wecom_user_id,displayName:'T40 revoked staff',roles:['REPORTER'],resolverTeamIds:[]});
      };
      const createTeamReport=async()=>{const id=await base.createTicket();await runtime.realtimeProjector.runOnce({limit:100});return id;};
      const logout=async()=>{assert.ok(official);const response=await fetch(base.origin+'/workbench/logout',{method:'POST',headers:{cookie:cookieAt(1),origin:authOrigin,'x-csrf-token':text(realCsrf[1])}});assert.equal(response.status,200);assert.deepEqual(await response.json(),{logged_out:true});};
      const nextDue=async()=>{
        const ticket=await dispatcher.get(path),schedule=await dispatcher.get(path+'/follow-up-schedule');assert.equal(ticket.status,200);assert.equal(schedule.status,200);
        const set=await dispatcher.post(path+'/follow-up-schedule',{client_command_id:randomUUID(),expected_version:version(ticket.value.version),expected_schedule_version:text(schedule.value.schedule_version),reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action:'SET',due_at:'2020-01-02 09:30:00'});
        assert.equal(set.status,200,JSON.stringify(set.value));assert.deepEqual(await runtime.runFollowUpDueBatch({limit:20}),{scanned:1,emitted:1,skipped:0});
      };
      const appendLaterPrimary=async()=>{
        const source=(await base.pool.query<{intake_id:string;message_id:string;reported_at:string;retention:string;retention_epoch:string}>(`SELECT t.source_intake_id::text AS intake_id,i.primary_message_id::text AS message_id,to_char(i.created_at,'YYYY-MM-DD HH24:MI:SS') AS reported_at,to_char(i.retention_until,'YYYY-MM-DD HH24:MI:SS') AS retention,i.retention_until_epoch_ms::text AS retention_epoch FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.id=t.source_intake_id WHERE t.id=$1::uuid`,[ticketId])).rows[0];assert.ok(source);
        const hash=createHash('sha256').update('t40-owned-same-reporter').digest('hex'),journeys=createContactJourneyStore();
        const journey=await journeys.ensureJourney({transaction:base.pool,input:{entry_mode:'GROUP_MENTION_TO_DIRECT_GUIDED',origin_intake_id:source.intake_id,linked_ticket_id:ticketId,reporter_identity_hash:hash,profile_resolution_status:'NOT_REQUIRED',evaluation_due_at:source.reported_at,evaluation_due_epoch_ms:shanghaiLocalToEpochMs(source.reported_at),reported_at:source.reported_at,privacy_class:'INTERNAL',retention_until:source.retention,retention_until_epoch_ms:source.retention_epoch}});
        await journeys.ensureLeg({transaction:base.pool,input:{journey_id:journey.id,source_intake_id:source.intake_id,leg_type:'GROUP_ORIGIN',origin_channel_message_id:source.message_id,provider_context_hash:hash,channel_identity_hash:hash,reporter_identity_hash:hash,opened_at:source.reported_at}});
        const msgid='t40-later-'+randomUUID(),accepted=object(await runtime.assembly.handleFrame({cmd:'aibot_msg_callback',headers:{req_id:msgid},body:{msgid,aibotid:'bot-test',chattype:'single',from:{userid:'user-test'},msgtype:'text',text:{content:'补充：T40同一故障另一个接触段的新材料。'}}}));
        assert.equal(accepted.ok,true);const result=object(accepted.result),intakeId=text(object(result.intake).id),message=object(result.message),messageId=text(message.channel_message_id);assert.notEqual(intakeId,source.intake_id);
        for(let attempt=0;attempt<20;attempt++){await runtime.coordinator.runOnce();if(object(await runtime.coordinator.backlog()).channel_messages===0)break;}
        assert.equal(object(await runtime.coordinator.backlog()).channel_messages,0);
        const session=(await base.pool.query<{id:string;thread_id:string;opened_at:string}>(`SELECT id::text,thread_id::text,to_char(created_at,'YYYY-MM-DD HH24:MI:SS') AS opened_at FROM conversation.session WHERE service_intake_id=$1::uuid`,[intakeId])).rows[0];assert.ok(session);
        await journeys.ensureLeg({transaction:base.pool,input:{journey_id:journey.id,source_intake_id:intakeId,leg_type:'DIRECT_GUIDED',conversation_session_id:session.id,conversation_thread_id:session.thread_id,origin_channel_message_id:messageId,provider_context_hash:hash,channel_identity_hash:hash,reporter_identity_hash:hash,opened_at:session.opened_at}});
        const current=await http.get(path+'/supplement-follow-up?limit=100');assert.equal(current.status,200);assert.ok(Array.isArray(current.value.items));const found=current.value.items.map(object).find(item=>item.source_ref==='channel:'+messageId);assert.ok(found);assert.equal(found.revision,'1');
        return {sourceRef:'channel:'+messageId,revision:'1'};
      };
      const projection=await runtime.realtimeProjector.runOnce({limit:100});
      assert.equal(projection.disabled,false,'original realtime source preparation must reach its own seam');
      const firstCookie=cookies[1];assert.equal(typeof firstCookie.url,'string');
      if(typeof firstCookie.url!=='string')throw Error('T40_REAL_HANDLER_COOKIE_REQUIRED');
      const currentFacts=async()=>{
        const facts:Record<string,unknown>={};
        for(const endpoint of [path,path+'/events?limit=200',path+'/responsibility',path+'/follow-up-schedule',
          '/api/workbench/items/ticket/'+ticketId,
          '/api/workbench/items/ticket/'+ticketId+'/read-position']) {
          const response=await http.get(endpoint);assert.equal(response.status,200,endpoint);
          if(endpoint==='/api/workbench/items/ticket/'+ticketId){
            const attention=object(object(response.value.item).attention);assert.equal(typeof attention.following,'boolean');assert.match(text(attention.follow_version),/^[a-f0-9]{64}$/u);facts[endpoint]=attention;
          }else facts[endpoint]=response.value;
        }
        return facts;
      };
      await run({origin:base.origin,pool:base.pool,runtime,ticketId,handler:base.handler,
        browserCookie:{name:firstCookie.name,value:firstCookie.value,url:firstCookie.url},http,
        setupCommandIds:[assignmentId,scheduleId],currentFacts,appendLaterPrimary,revokeReadWithoutScopeChange,nextDue,setTeams:base.setHandlerTeams,removeStaffRole,createTeamReport,logout});
    } finally {
      await runtime.stop();await official?.close();
      assert.equal(runtime.server.listening,false);
      assert.equal((await runtime.observability.metrics()).sse_clients,0);
    }
  },{workbenchFollowUpSchedulesEnabled:true,ticketAssignmentEnabled:true,lifecycleEnabled:true});
}
