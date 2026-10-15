import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT43Fixture,text,version,object,rows} from './helpers/t43-full-service-fixture.mjs';
import {get,startCommand} from './helpers/t43-service-actions.mjs';

test('T43 real member supplement fences a captured human command while directory and AI absence cannot prevent normal manual intake',{timeout:240000},()=>withT43Fixture(async f=>{
 const admin=f.staff[0];assert.ok(admin);const report=await f.webReport('合成打印机打印不了。');assert.ok(report.requestRef&&report.ticketId);
 const captured=await startCommand(f,report);assert.match(captured.path,/\/manual-reviews\//u);
 const detail=await get(f.member,'/api/yixiaoxiu/requests/'+report.requestRef);await f.member.get('/api/yixiaoxiu/bootstrap');
 const supplement=await f.member.post('/api/yixiaoxiu/requests/'+report.requestRef+'/supplements',{schema_version:1,client_command_id:randomUUID(),expected_input_revision:text(detail.input_revision),text:'T43真实新增材料：不同楼层也出现相同无法打印，需要重新确认。'});assert.equal(supplement.status,202,supplement.raw);
 await f.pump();const before=await get(admin,'/api/tickets/'+report.ticketId),events=await get(admin,'/api/tickets/'+report.ticketId+'/events?limit=200');
 const response=await admin.post(captured.path,captured.body);assert.equal(response.status,409,response.raw);assert.deepEqual(await get(admin,'/api/tickets/'+report.ticketId),before);assert.deepEqual(await get(admin,'/api/tickets/'+report.ticketId+'/events?limit=200'),events);assert.equal(before.assignee_id,null);
 const directory=await admin.get('/api/workbench/reporter-candidates?q='+encodeURIComponent('合成')+'&limit=2');assert.equal(directory.status,503,directory.raw);assert.equal(f.directoryCalls(),1);
 const manual=await f.manualReport('目录离线时合成电话打印机仍然打印不了。');assert.ok(manual.ticketId??manual.reviewId);assert.equal(f.directoryCalls(),1);assert.equal((await get(admin,'/api/lifecycle/bootstrap')).ai_enabled,false);assert.equal(f.senderCalls.length,0);
 console.log('T43_MATERIAL_DIRECTORY_AI '+JSON.stringify({new_material_http:supplement.status,stale_command_http:response.status,same_ticket:report.ticketId,ticket_version:version(before.version),directory_http:directory.status,directory_calls:f.directoryCalls(),manual_intake:manual.intakeId,ai_enabled:false,model_provider_calls:0}));
}));

test('T43 an actual unprojected normal Inbox receipt remains durable and only the original coordinator publishes its precise source item after the baseline',{timeout:240000},()=>withT43Fixture(async f=>{
 const admin=f.staff[0];assert.ok(admin);const baseline=await get(admin,'/api/workbench/reminders'),report=await f.deferredInbound();
 const count=async()=>f.pool.query<{event_id:string}>(`SELECT e.event_id::text FROM intake.service_intake i
  JOIN conversation.session s ON s.service_intake_id=i.id
  JOIN conversation.item ci ON ci.session_id=s.id AND ci.source_type='CHANNEL_MESSAGE' AND ci.source_id=i.primary_message_id::text AND ci.item_type='USER_MESSAGE'
  JOIN conversation.realtime_event e ON e.source_id=ci.id::text AND e.aggregate_id=ci.id::text
  WHERE i.id=$1::uuid AND e.publisher_name='CONVERSATION_TIMELINE_PROJECTOR' AND e.source_type='CONVERSATION_ITEM'
   AND e.event_type='conversation.item.created' AND e.aggregate_type='CONVERSATION_ITEM' AND e.authorization_scope_type='SESSION' AND e.authorization_scope_id=s.id`,[report.intakeId]);
 assert.equal((await count()).rowCount,0);const backlog=await f.runtime.coordinator.backlog();if(backlog.disabled)throw Error('T43_COORDINATOR_DISABLED');assert.ok(backlog.channel_messages>0);
 await f.pump();const published=await count();assert.equal(published.rowCount,1);const event=published.rows[0];assert.ok(event);assert.ok(BigInt(event.event_id)>BigInt(text(baseline.as_of_event_id)));
 const current=await f.intake(report.intakeId),kind=current.ticketId?'ticket':'review',id=current.ticketId??current.reviewId;assert.ok(id);const item=await get(admin,'/api/workbench/items/'+kind+'/'+id);assert.equal(object(item.item).id,id);assert.equal((await f.runtime.coordinator.backlog()).total,0);
 const notifications=await f.pool.query<{count:number}>('SELECT count(*)::int AS count FROM conversation.realtime_event WHERE event_id=$1::bigint',[event.event_id]);assert.equal(notifications.rows[0]?.count,1);assert.equal(rows(baseline.items).length,0);
 console.log('T43_ACTUAL_PROJECTION '+JSON.stringify({intake:report.intakeId,committed_before_projection:true,before_events:0,baseline:text(baseline.as_of_event_id),source_event_id:event.event_id,canonical:{kind,id},backlog_after:0,source_event:'conversation.item.created'}));
}));
