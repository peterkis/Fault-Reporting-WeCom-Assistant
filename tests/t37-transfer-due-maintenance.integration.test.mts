import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT37Fixture,object,rows,text,type T37Http} from './helpers/t37-follow-up-fixture.mjs';

function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function current(http:T37Http,path:string){const result=await http.get(path);assert.equal(result.status,200,JSON.stringify(result.value));return result.value;}
async function snapshot(http:T37Http,path:string){return {ticket:await current(http,path),schedule:await current(http,path+'/follow-up-schedule'),events:await current(http,path+'/events?limit=200'),responsibility:await current(http,path+'/responsibility'),deliveries:await current(http,path+'/deliveries')};}
function command(ticket:Record<string,unknown>,schedule:Record<string,unknown>,action:'SET'|'CANCEL',due:string|null){return {client_command_id:randomUUID(),expected_version:version(ticket.version),expected_schedule_version:text(schedule.schedule_version),reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action,due_at:due};}

test('real responsibility transfer and unassign retain shared time while current authority must explicitly cancel or reschedule sustained due work',{timeout:240000},async()=>{
 await withT37Fixture(async fixture=>{
  const dispatcher=await fixture.http(0),original=await fixture.http(1),nextHandler=await fixture.http(2),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
  const queued=await current(dispatcher,path);
  assert.equal((await dispatcher.post(path+'/assign',{client_command_id:randomUUID(),expected_version:version(queued.version),reason_code:'WORKBENCH_ASSIGN',target_principal_id:fixture.handler,resolver_team_id:text(queued.resolver_team_id),communication_choice:'RETAIN_CURRENT',sessions:[]})).status,200);
  const before=await snapshot(dispatcher,path),first=command(before.ticket,before.schedule,'SET','2020-01-02 09:30:00');
  const set=await original.post(path+'/follow-up-schedule',first);assert.equal(set.status,200,JSON.stringify(set.value));
  const arranged=await snapshot(dispatcher,path),active=object(arranged.schedule.active),cycle=arranged.ticket.handling_cycle;
  assert.equal(active.is_due,true);assert.equal(active.due_epoch_ms,'1577928600000');
  assert.deepEqual(cycle,before.ticket.handling_cycle);assert.deepEqual(arranged.deliveries,before.deliveries);
  const transfer=await dispatcher.post(path+'/transfer-assignment',{client_command_id:randomUUID(),expected_version:version(arranged.ticket.version),reason_code:'WORKBENCH_TRANSFER',target_principal_id:fixture.otherHandler,resolver_team_id:text(arranged.ticket.resolver_team_id),communication_choice:'RETAIN_CURRENT',sessions:[]});
  assert.equal(transfer.status,200,JSON.stringify(transfer.value));
  const inherited=await snapshot(dispatcher,path);
  assert.equal(inherited.ticket.assignee_id,fixture.otherHandler);assert.equal(inherited.ticket.status,arranged.ticket.status);
  assert.deepEqual(inherited.ticket.handling_cycle,cycle);assert.deepEqual(inherited.schedule.active,active);
  assert.equal(inherited.schedule.schedule_version,arranged.schedule.schedule_version);assert.deepEqual(inherited.schedule.history,arranged.schedule.history);
  assert.deepEqual(inherited.deliveries,arranged.deliveries);
  const newView=await current(nextHandler,path+'/follow-up-schedule');assert.deepEqual(newView.allowed_actions,['SET','CANCEL']);
  assert.equal(object((await current(nextHandler,path+'/follow-up-schedule')).active).is_due,true,'reading a due arrangement cannot finish it');
  assert.deepEqual((await current(original,path+'/follow-up-schedule')).allowed_actions,[]);
  assert.equal((await original.post(path+'/follow-up-schedule',command(inherited.ticket,inherited.schedule,'CANCEL',null))).status,403);
  assert.deepEqual(await snapshot(dispatcher,path),inherited,'rejected former handler cannot mutate shared time or other facts');
  const cancel=await nextHandler.post(path+'/follow-up-schedule',command(inherited.ticket,inherited.schedule,'CANCEL',null));assert.equal(cancel.status,200,JSON.stringify(cancel.value));
  const cancelled=await snapshot(dispatcher,path);assert.equal(cancelled.schedule.active,null);assert.equal(cancelled.schedule.schedule_version,'2');
  assert.equal(rows(cancelled.schedule.history)[0]?.action,'CANCEL');assert.equal(rows(cancelled.schedule.history)[0]?.due_at,'2020-01-02 09:30:00');
  assert.equal((await nextHandler.post(path+'/follow-up-schedule',command(cancelled.ticket,cancelled.schedule,'SET','2030-01-02 09:30:00'))).status,200);
  const rescheduled=await snapshot(dispatcher,path);assert.equal(rescheduled.schedule.schedule_version,'3');assert.equal(object(rescheduled.schedule.active).is_due,false);
  assert.equal(object(rescheduled.schedule.active).due_at,'2030-01-02 09:30:00');assert.equal(rows(rescheduled.schedule.history).length,3);
  const unassign=await dispatcher.post(path+'/unassign',{client_command_id:randomUUID(),expected_version:version(rescheduled.ticket.version),reason_code:'WORKBENCH_UNASSIGN',reason:'合成调度重新安排，保留团队共享时间。',communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]});
  assert.equal(unassign.status,200,JSON.stringify(unassign.value));
  const team=await snapshot(dispatcher,path);assert.equal(team.ticket.assignee_id,null);assert.equal(team.ticket.resolver_team_id,rescheduled.ticket.resolver_team_id);
  assert.deepEqual(team.ticket.handling_cycle,cycle);assert.deepEqual(team.schedule.active,rescheduled.schedule.active);assert.deepEqual(team.schedule.history,rescheduled.schedule.history);
  assert.equal(team.schedule.schedule_version,'3');assert.deepEqual(team.deliveries,rescheduled.deliveries);
  assert.deepEqual((await current(nextHandler,path+'/follow-up-schedule')).allowed_actions,[],'unassigned former handler retains team READ, not maintenance');
  assert.deepEqual(team.schedule.allowed_actions,['SET','CANCEL'],'authorized dispatcher maintains unassigned team work');
  const ack=await original.get(path+'/follow-up-schedule/commands/'+first.client_command_id);assert.equal(ack.status,200);
  assert.deepEqual(ack.value,{client_command_id:first.client_command_id,ticket_id:ticketId,state:'COMMITTED',result:{...set.value,replayed:true}});
 },{workbenchFollowUpSchedulesEnabled:true,ticketAssignmentEnabled:true,ticketUnassignEnabled:true});
});