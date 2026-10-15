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
export interface T40LocateFixture {
  readonly origin:string;
  readonly runtime:P2016EnabledRuntime;
  readonly ticketId:string;
  readonly handler:string;
  readonly browserCookie:Readonly<{name:string;value:string;url:string}>;
  readonly http:T37Http;
  readonly setupCommandIds:readonly string[];
  currentFacts():Promise<Record<string,unknown>>;
  revokeTargetRead():Promise<void>;
  readonly targetTitle:string;
}
/** Separate public locate setup. Original T40 first/helper remain immutable; no successful HTTP reply is mocked. */
export async function withT40LocateFixture(run:(fixture:T40LocateFixture)=>Promise<void>) {
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
    const migration={databaseUrl:String(databaseUrl),mode:'apply'};
    await migrateWorkbenchManualReports(migration);
    await migrateWorkbenchPersonalRead(migration);
    await migrateWorkbenchFollow(migration);
    const options={
      pool:base.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true as const},
      publicOrigin:base.origin,listenPort:Number(new URL(base.origin).port),
      principalIds:[base.dispatcher,base.handler,base.otherHandler],
      gatewayEnabled:false,senderEnabled:false,externalSendEnabled:false,
      workbenchManualReviewEnabled:true,workbenchConversationsEnabled:true,
      workbenchFollowEnabled:true,workbenchPersonalReadEnabled:true,
      workbenchFollowUpSchedulesEnabled:true,workbenchRealtimeEnabled:true,
      ticketAssignmentEnabled:true,workbenchRemindersEnabled:true,
    };
    const runtime=createP2016Runtime(options);
    try {
      assert.equal(runtime.orchestrationWorker,null);
      assert.equal(runtime.incidentExtension,null);
      assert.equal(runtime.selfService,null);
      await listenConversationWorkbenchServer(runtime.server,{port:options.listenPort});
      const cookies=runtime.authenticate.browserCookies?.();
      assert.ok(cookies?.[0]&&cookies[1]);
      const cookieAt=(index:number)=>{
        const entry=cookies[index];assert.ok(entry);
        return entry.name+'='+entry.value;
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
            cookie:cookieAt(index),origin:base.origin,'content-type':'application/json',
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
      // Keep the target genuinely beyond the first 50-row server page, without editing its fact timestamps.
      await new Promise<void>(resolve=>setTimeout(resolve,1100));
      for(let index=0;index<51;index++)await base.createTicket();
      const firstPage=await http.get('/api/workbench/board?column=pending&range=all&scope=team&limit=50');
      assert.equal(firstPage.status,200);assert.ok(Array.isArray(firstPage.value.items));
      assert.equal(firstPage.value.items.length,50);assert.equal(firstPage.value.items.map(object).some(item=>item.id===ticketId),false);
      assert.equal(typeof firstPage.value.next_cursor,'string');
      const targetRead=await http.get('/api/workbench/items/ticket/'+ticketId+'?limit=50');assert.equal(targetRead.status,200);
      const targetTitle=text(object(targetRead.value.item).title);
      const revokeTargetRead=async()=>{
        const before=await dispatcher.get(path);assert.equal(before.status,200);
        const transfer=await dispatcher.post(path+'/transfer-assignment',{
          client_command_id:randomUUID(),expected_version:version(before.value.version),reason_code:'WORKBENCH_TRANSFER',
          target_principal_id:base.otherHandler,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[],
        });
        assert.equal(transfer.status,200,JSON.stringify(transfer.value));await base.setHandlerTeams([]);
        const denied=await http.get('/api/workbench/items/ticket/'+ticketId+'?limit=50');assert.equal(denied.status,404);
      };
      const projection=await runtime.realtimeProjector.runOnce({limit:100});
      assert.equal(projection.disabled,false,'original realtime source preparation must reach its own seam');
      const firstCookie=cookies[1];assert.equal(typeof firstCookie.url,'string');
      if(typeof firstCookie.url!=='string')throw Error('T40_REAL_HANDLER_COOKIE_REQUIRED');
      const currentFacts=async()=>{
        const facts:Record<string,unknown>={};
        for(const endpoint of [path,path+'/events?limit=200',path+'/responsibility',path+'/follow-up-schedule',
          '/api/workbench/items/ticket/'+ticketId+'/follow',
          '/api/workbench/items/ticket/'+ticketId+'/read-position']) {
          const response=await http.get(endpoint);assert.equal(response.status,200,endpoint);
          facts[endpoint]=response.value;
        }
        return facts;
      };
      await run({origin:base.origin,runtime,ticketId,handler:base.handler,
        browserCookie:{name:firstCookie.name,value:firstCookie.value,url:firstCookie.url},http,
        setupCommandIds:[assignmentId,scheduleId],currentFacts,revokeTargetRead,targetTitle});
    } finally {
      await runtime.stop();
      assert.equal(runtime.server.listening,false);
      assert.equal((await runtime.observability.metrics()).sse_clients,0);
    }
  },{workbenchFollowUpSchedulesEnabled:true,ticketAssignmentEnabled:true,lifecycleEnabled:true});
}
