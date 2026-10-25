import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT37Fixture,object,rows,text,type T37Fixture,type T37Http} from './helpers/t37-follow-up-fixture.mjs';
import {createP2016Runtime} from '../app/server/src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../app/server/src/p2-006-workbench-http.mjs';

function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function current(http:T37Http,path:string){const result=await http.get(path);assert.equal(result.status,200,JSON.stringify(result.value));return result.value;}
function scheduleCommand(ticket:Record<string,unknown>,scheduleVersion:string,action:'SET'|'CANCEL',dueAt:string|null){return {client_command_id:randomUUID(),expected_version:version(ticket.version),expected_schedule_version:scheduleVersion,reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action,due_at:dueAt};}
async function http(fixture:T37Fixture,index:number):Promise<T37Http>{
 const entry=fixture.runtime.authenticate.browserCookies?.()[index];assert.ok(entry);const cookie=entry.name+'='+entry.value;
 const get=async(path:string)=>{const response=await fetch(fixture.origin+path,{headers:{cookie}});return {status:response.status,value:object(await response.json())};};
 const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=text(bootstrap.value.csrf_token);
 const post=async(path:string,body:Readonly<Record<string,unknown>>)=>{const expected=body.expected_version??body.expected_row_version;const response=await fetch(fixture.origin+path,{method:'POST',headers:{cookie,origin:fixture.origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':text(body.client_command_id),'if-match':'"'+version(expected)+'"'},body:JSON.stringify(body)});return {status:response.status,value:object(await response.json())};};return {get,post};
}
async function stop(fixture:T37Fixture){await fixture.runtime.stop();assert.equal(fixture.runtime.server.listening,false);assert.equal((await fixture.runtime.observability.metrics()).sse_clients,0);}
async function recompose(fixture:T37Fixture,enabled:boolean):Promise<T37Fixture>{
 await stop(fixture);const port=Number(new URL(fixture.origin).port);
 const runtime=createP2016Runtime({pool:fixture.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:fixture.origin,listenPort:port,principalIds:[fixture.dispatcher,fixture.handler,fixture.otherHandler],gatewayEnabled:false,senderEnabled:false,externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketReopenRoundsEnabled:true,workbenchFollowUpSchedulesEnabled:enabled});
 await listenConversationWorkbenchServer(runtime.server,{port});return {...fixture,runtime};
}

test('real completion while shared-time maintenance is disabled ends the old schedule and a genuine reopened round requires a new arrangement',{timeout:240000},async()=>{
 await withT37Fixture(async initial=>{
  let fixture=initial;
  try{
   let handler=await http(fixture,1);const path='/api/tickets/'+await fixture.createTicket(),queued=await current(handler,path);
   const started=await handler.post(path+'/take-and-start',{client_command_id:randomUUID(),expected_version:version(queued.version),reason_code:'T37_REAL_START',resolver_team_id:text(queued.resolver_team_id)});assert.equal(started.status,200,JSON.stringify(started.value));
   const running=await current(handler,path),firstCycle=object(running.handling_cycle),schedule=await current(handler,path+'/follow-up-schedule');
   const command=scheduleCommand(running,text(schedule.schedule_version),'SET','2020-01-02 09:30:00');const set=await handler.post(path+'/follow-up-schedule',command);assert.equal(set.status,200);
   fixture=await recompose(fixture,false);handler=await http(fixture,1);
   assert.equal((await handler.get(path+'/follow-up-schedule')).status,503);const ackWhileOff=await handler.get(path+'/follow-up-schedule/commands/'+command.client_command_id);assert.equal(ackWhileOff.status,200);assert.equal(ackWhileOff.value.state,'COMMITTED');
   const currentRunning=await current(handler,path),cycle=object(currentRunning.handling_cycle);
   const completion=await handler.post(path+'/complete',{client_command_id:randomUUID(),expected_version:version(currentRunning.version),reason_code:'STAFF_COMPLETED',handling_cycle_id:text(cycle.id),internal_process:'T37 合成内部处理过程',external_summary:'合成设备已恢复，完成本轮处置。',external_summary_confirmed:true});assert.equal(completion.status,200,JSON.stringify(completion.value));
   const closed=await current(handler,path);assert.equal(closed.status,'CLOSED');assert.equal(object(closed.handling_cycle).id,firstCycle.id);const completionEvent=text(object(closed.handling_cycle).staff_completion_event_id);
   fixture=await recompose(fixture,true);handler=await http(fixture,1);
   const ended=await current(handler,path+'/follow-up-schedule');assert.equal(ended.active,null);assert.equal(ended.schedule_version,'1');assert.deepEqual(ended.allowed_actions,[]);
   assert.ok(rows(ended.history).some(row=>row.action==='ENDED'&&row.ticket_event_id===completionEvent&&row.end_reason==='CLOSED'&&row.due_at==='2020-01-02 09:30:00'));
   const reopened=await handler.post(path+'/reopen',{client_command_id:randomUUID(),expected_version:version(closed.version),reason_code:'STAFF_REOPEN',note:'合成故障仍需下一轮处理'});assert.equal(reopened.status,200,JSON.stringify(reopened.value));
   const fresh=await current(handler,path),newCycle=object(fresh.handling_cycle);assert.equal(fresh.status,'REOPENED');assert.equal(fresh.assignee_id,null);assert.equal(fresh.id,closed.id);assert.equal(fresh.ticket_no,closed.ticket_no);assert.notEqual(newCycle.id,firstCycle.id);assert.equal(Number(newCycle.cycle_no),Number(firstCycle.cycle_no)+1);assert.equal(newCycle.first_responsibility_event_id,null);
   const freshSchedule=await current(handler,path+'/follow-up-schedule');assert.equal(freshSchedule.active,null);assert.equal(freshSchedule.schedule_version,'1');
   const dispatcher=await http(fixture,0),newArrangement=scheduleCommand(fresh,text(freshSchedule.schedule_version),'SET','2030-01-02 09:30:00');assert.equal((await dispatcher.post(path+'/follow-up-schedule',newArrangement)).status,200);
   const next=await current(dispatcher,path+'/follow-up-schedule');assert.equal(next.schedule_version,'2');assert.equal(object(next.active).is_due,false);assert.deepEqual(object((await current(dispatcher,path)).handling_cycle),newCycle);
   const originalAck=await handler.get(path+'/follow-up-schedule/commands/'+command.client_command_id);assert.equal(originalAck.status,200);assert.deepEqual(originalAck.value.result,{...set.value,replayed:true});
  }finally{await stop(fixture);}
 },{workbenchFollowUpSchedulesEnabled:true,lifecycleEnabled:true});
});

test('real cancellation while shared-time maintenance is disabled retains the actual terminal event and cannot revive a cancelled ticket schedule',{timeout:240000},async()=>{
 await withT37Fixture(async initial=>{
  let fixture=initial;
  try{
   let dispatcher=await http(fixture,0);const path='/api/tickets/'+await fixture.createTicket(),queued=await current(dispatcher,path),empty=await current(dispatcher,path+'/follow-up-schedule');
   const command=scheduleCommand(queued,text(empty.schedule_version),'SET','2020-01-02 09:30:00');assert.equal((await dispatcher.post(path+'/follow-up-schedule',command)).status,200);
   fixture=await recompose(fixture,false);dispatcher=await http(fixture,0);const arranged=await current(dispatcher,path);
   const cancel=await dispatcher.post(path+'/cancel',{client_command_id:randomUUID(),expected_version:version(arranged.version),reason_code:'T37_REAL_CANCEL'});assert.equal(cancel.status,200,JSON.stringify(cancel.value));const terminal=await current(dispatcher,path);assert.equal(terminal.status,'CANCELLED');
   fixture=await recompose(fixture,true);dispatcher=await http(fixture,0);const ended=await current(dispatcher,path+'/follow-up-schedule');assert.equal(ended.active,null);assert.equal(ended.schedule_version,'1');assert.deepEqual(ended.allowed_actions,[]);
   assert.ok(rows(ended.history).some(row=>row.action==='ENDED'&&row.ticket_event_id===cancel.value.ticket_event_id&&row.end_reason==='CANCELLED'));
   const rejected=await dispatcher.post(path+'/reopen',{client_command_id:randomUUID(),expected_version:version(terminal.version),reason_code:'STAFF_REOPEN',note:'验证取消工单不能通过工作人员重开。'});assert.equal(rejected.status,409,'a valid reopen command cannot bypass the CANCELLED state');
   assert.equal((await current(dispatcher,path)).status,'CANCELLED');assert.equal((await current(dispatcher,path+'/follow-up-schedule')).active,null);
  }finally{await stop(fixture);}
 },{workbenchFollowUpSchedulesEnabled:true,lifecycleEnabled:true});
});