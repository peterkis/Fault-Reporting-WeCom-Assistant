import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createP2G1InboundProjectionCoordinator,P2_G1_PROJECTION_STREAMS} from '../src/p2-g1-inbound-projection-coordinator.mjs';
import {createConversationControlService,createPilotConversationControlAuthorization} from '../src/p2-005-conversation-control.mjs';
import {appendRealtimeEvent} from '../src/p2-003-realtime-event-log.mjs';
test('WEB01 real HTTP: scope, duplicate review, natural-day completion range, keyset and protected static',async()=>{
  await withWeb01Fixture(async({origin,cookies,tickets,waiting,pool,principals})=>{
    const get=(path,index=0)=>fetch(origin+path,{headers:{cookie:cookies[index]}});
    assert.equal((await fetch(origin+'/api/workbench/board')).status,401);
    assert.equal((await fetch(origin+'/workbench/app/')).status,401);
    assert.equal((await fetch(origin+'/api/workbench/board',{headers:{cookie:'yxx_member_session=synthetic-reporter'}})).status,401);
    const read=async path=>{const response=await get(path);assert.equal(response.status,200,await response.clone().text());return response.json();};
    const bootstrap=await read('/api/lifecycle/bootstrap');assert.equal(bootstrap.principal_id,principals[0].id);
    const pending=await read('/api/workbench/board?column=pending');
    assert.equal(pending.items.length,7);assert.equal(pending.items.filter(i=>i.intake_id===tickets[0].intake.intakeId).length,1);
    assert.ok(pending.items.some(i=>i.kind==='intake'&&i.id===waiting.intakeId&&i.status==='WAITING_DESCRIPTION'));
    assert.equal(pending.items.find(i=>i.id===waiting.intakeId).priority,null);
    assert.equal((await get('/api/workbench/items/intake/'+waiting.intakeId,1)).status,404);
    assert.ok((await read('/api/workbench/items/intake/'+waiting.intakeId)).records.some(r=>r.audience==='REPORT'));
    assert.equal(pending.items.find(i=>i.id===tickets[0].ticket.id).kind,'ticket');assert.ok(pending.items.some(i=>i.kind==='review'));
    assert.ok(pending.items.filter(i=>i.kind==='ticket').every(i=>i.created_at<pending.range.from)); // Old nonterminal Tickets remain visible.
    const first=await read('/api/workbench/board?column=pending&limit=2');assert.ok(first.next_cursor);
    const second=await read('/api/workbench/board?column=pending&limit=2&cursor='+first.next_cursor);
    assert.equal(new Set([...first.items,...second.items].map(i=>i.kind+i.id)).size,4);
    assert.equal((await get('/api/workbench/board?column=active&cursor='+first.next_cursor)).status,400);
    assert.equal((await get('/api/workbench/board?column=pending&limit=101')).status,400);
    const closed=await read('/api/workbench/board?column=closed');assert.equal(closed.items.length,4);
    await pool.query('UPDATE pilot_ticket.ticket SET updated_at=platform.local_now() WHERE id=$1::uuid',[tickets[11].ticket.id]);
    const closingFirst=await read('/api/workbench/board?column=closed&limit=1');
    assert.equal(closingFirst.items[0].id,tickets[9].ticket.id);
    const closingNext=await read('/api/workbench/board?column=closed&limit=1&cursor='+closingFirst.next_cursor);
    assert.equal(closingNext.items[0].id,tickets[10].ticket.id);
    const resolved=closed.items.find(i=>i.status==='RESOLVED');assert.ok(resolved);assert.equal(resolved.completed_at,null);
    await pool.query("UPDATE pilot_ticket.ticket_event SET created_at=date_trunc('day',platform.local_now())-interval '2 days' WHERE ticket_id=$1::uuid AND event_type='ticket.closed'",[tickets[9].ticket.id]);
    assert.equal((await read('/api/workbench/board?column=closed')).items.length,3);
    assert.equal((await read('/api/workbench/board?column=closed&range=all')).items.length,4);
    const commandId=randomUUID();
    const cancelled=await fetch(origin+'/api/tickets/'+tickets[0].ticket.id+'/cancel',{method:'POST',headers:{cookie:cookies[0],origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':commandId,'if-match':'"2"'},body:JSON.stringify({client_command_id:commandId,expected_version:2,reason_code:'WEB01_SYNTHETIC_CANCEL'})});
    assert.equal(cancelled.status,200,await cancelled.clone().text());
    assert.ok((await read('/api/workbench/board?column=closed&range=all')).items.every(i=>i.status!=='CANCELLED'));
    const cancellationView=await read('/api/workbench/board?column=closed&range=cancelled');
    assert.equal(cancellationView.items.length,1);assert.equal(cancellationView.items[0].status,'CANCELLED');
    const separateReview=pending.items.find(i=>i.kind==='review');
    await pool.query('UPDATE intake.contact_journey SET linked_ticket_id=$1::uuid WHERE id=(SELECT journey_id FROM intake.manual_review_item WHERE id=$2::uuid)',[tickets[5].ticket.id,separateReview.id]);
    assert.ok((await read('/api/workbench/board?column=active')).items.find(i=>i.id===tickets[5].ticket.id).review_reason);
    assert.ok((await read('/api/workbench/board?column=pending')).items.every(i=>i.id!==separateReview.id));
    const outsider=await get('/api/workbench/board?column=pending',1);assert.equal(outsider.status,200);assert.equal((await outsider.json()).items.length,0);
    const path='/api/workbench/items/ticket/'+tickets[5].ticket.id;
    assert.equal((await get(path,1)).status,404);
    const detail=await read(path);assert.ok(detail.records.some(r=>r.text==='仅供内部的合成处理记录'&&r.audience==='INTERNAL'));assert.ok(detail.records.some(r=>r.audience==='REPORT'));assert.equal(detail.item.title,'住院部西区无线网络频繁断开');
    assert.ok(detail.records.some(r=>r.audience==='REPORT'&&r.text?.includes('尚待判断的合成材料')));
    const shell=await get('/workbench/app/items/ticket/'+tickets[5].ticket.id);assert.equal(shell.status,200);assert.match(shell.headers.get('content-security-policy'),/script-src 'self'; style-src 'self'/u);
    assert.equal((await get('/workbench/app?view=list')).status,200);
    assert.equal((await fetch(origin+'/workbench/app?view=list')).status,401);
    const html=await shell.text(),asset=html.match(/src="([^"]+\.js)"/u)?.[1];assert.ok(asset);assert.equal((await get(asset)).status,200);
    assert.equal((await get('/workbench/app/assets/unknown.js')).status,404);
    assert.equal((await get('/workbench/app/src/main.tsx')).status,404);
    const unknown=await get('/api/unknown-web01');assert.equal(unknown.status,404);assert.match(unknown.headers.get('content-type'),/application\/json/u);
    assert.equal((await get('/workbench')).status,200);assert.equal((await get('/workbench/lifecycle')).status,200);
    assert.equal((await get('/api/reporter/bootstrap')).status,503); // Existing member closed flag is unchanged.
    await pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[principals[0].id]);
    assert.equal((await get(path)).status,401);assert.equal((await get('/workbench/app/')).status,401);
  });
});

test('WEB01 current communication responsibility excludes a retained assignment after a real topic boundary',async()=>{
  await withWeb01Fixture(async({origin,cookies,tickets,pool,principals})=>{
    const read=async path=>{const response=await fetch(origin+path,{headers:{cookie:cookies[0]}});assert.equal(response.status,200);return response.json();};
    const coordinator=createP2G1InboundProjectionCoordinator({pool,enabled:true});
    const projectMessages=async()=>{
      const result=await coordinator.runOnce();
      // The visual fixture sets Ticket snapshot states; this regression drives
      // the normal channel-message stream that actually ends a service session.
      const stream=result.streams.find(value=>value.source_stream===P2_G1_PROJECTION_STREAMS.channelMessage);
      assert.ok(stream);assert.deepEqual(stream.failures,[]);
    };
    await projectMessages();
    const ticket=tickets[5],path='/api/workbench/items/ticket/'+ticket.ticket.id,historyPath='/api/tickets/'+ticket.ticket.id+'/responsibility';
    const session=(await read(historyPath)).conversations[0];assert.ok(session);assert.equal(session.combined_accept_allowed,true);
    const control=createConversationControlService({pool,enabled:true,authorize:createPilotConversationControlAuthorization({pool}),realtimeAppender:appendRealtimeEvent});
    const assigned=await control.takeoverSession({command_type:'TAKEOVER',session_id:session.session_id,client_command_id:randomUUID(),idempotency_scope:'WEB01_CONVERSATION_REGRESSION',expected_row_version:Number(session.session_row_version),actor_principal_id:principals[0].id,target_principal_id:principals[1].id,reason_code:'SYNTHETIC_REVIEW'});
    assert.equal(assigned.ok,true);
    const before=(await read(path)).responsibility;
    assert.deepEqual(before.conversation_assignees,[principals[1].display_name]);
    await pool.query("UPDATE conversation.session SET status='WAITING_USER' WHERE id=$1::uuid",[session.session_id]);
    assert.deepEqual((await read(path)).responsibility.conversation_assignees,[principals[1].display_name]);
    const source=(await pool.query('SELECT source_chat_id FROM intake.service_intake WHERE id=$1::uuid',[ticket.intake.intakeId])).rows[0];
    const next=await seedPersistedIntake({pool,text:'全新合成话题',status:'RECEIVED'});
    await pool.query('UPDATE channel.message_inbox SET chat_id=$1 WHERE id=$2::bigint',[source.source_chat_id,next.messageId]);
    await pool.query('UPDATE intake.service_intake SET source_chat_id=$1 WHERE id=$2::uuid',[source.source_chat_id,next.intakeId]);
    await projectMessages();
    const retained=(await read(historyPath)).conversations.find(value=>value.session_id===session.session_id);
    assert.equal(retained.combined_accept_allowed,false);
    assert.equal(retained.assignment_status,'ASSIGNED');
    assert.equal(retained.conversation_principal_name,principals[1].display_name);
    const after=(await read(path)).responsibility;
    assert.deepEqual(after.conversation_assignees,[]);
    assert.equal(after.ticket_assignee_name,before.ticket_assignee_name);
  });
});
