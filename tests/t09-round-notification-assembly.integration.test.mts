import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {object,rows,text,version} from './helpers/t09-fixture.mjs';

// Real T09 + T24 composition: existing 041/048 migrations and published HTTP/consumer ports.
// No Sender, direct business writes, reconstructed history, or legacy-notification substitutes.
test('stopping and reaccepting a started Ticket preserves its original 041 FIRST notification and communication responsibility',{timeout:240000},async()=>{
  await withT24Fixture(async f=>{
    const path='/api/tickets/'+f.ticketId,adminCookie=f.cookies[0],handlerCookie=f.cookies[2],handler=f.principals[1];
    assert.ok(adminCookie&&handlerCookie&&handler);
    const get=async(route:string,cookie=adminCookie)=>{
      const response=await fetch(f.origin+route,{headers:{cookie}});
      assert.equal(response.status,200,route);return object(await response.json());
    };
    const adminBootstrap=await get('/api/lifecycle/bootstrap'),handlerBootstrap=await get('/api/lifecycle/bootstrap',handlerCookie);
    assert.equal(adminBootstrap.ticket_round_notifications_enabled,true);
    assert.equal(adminBootstrap.ticket_return_to_dispatch_enabled,true);
    const post=async(route:string,body:Record<string,unknown>,cookie=adminCookie,csrf=adminBootstrap.csrf_token)=>{
      const response=await fetch(f.origin+route,{method:'POST',headers:{cookie,origin:f.origin,'content-type':'application/json',
        'x-csrf-token':text(csrf),'idempotency-key':text(body.client_command_id),'if-match':'"'+String(body.expected_version??body.expected_row_version)+'"'},body:JSON.stringify(body)});
      const result=object(await response.json());assert.equal(response.status,200,JSON.stringify(result));return result;
    };
    const initial=await get(path);assert.equal(initial.status,'QUEUED');assert.equal(initial.assignee_id,null);
    const assigned=await post(path+'/assign',{client_command_id:randomUUID(),expected_version:version(initial.version),reason_code:'WORKBENCH_ASSIGN',
      target_principal_id:handler.id,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});
    await f.runtime.roundNotifications.runOnce();
    const promised=await get(path+'/deliveries'),notices=rows(promised.items);assert.equal(notices.length,1);
    const first=notices[0];assert.ok(first);
    assert.deepEqual({node:first.node,cycle:first.cycle_no,destination:first.destination_type,status:first.status,attempts:first.attempt_count},
      {node:'FIRST_RESPONSIBILITY',cycle:1,destination:'PERSON',status:'PENDING',attempts:0});
    const initialCounts=await f.pool.query<{messages:number;outboxes:number;deliveries:number;rounds:number}>(`SELECT
      (SELECT count(*)::integer FROM communication.message) AS messages,
      (SELECT count(*)::integer FROM communication.outbox) AS outboxes,
      (SELECT count(*)::integer FROM communication.delivery) AS deliveries,
      (SELECT count(*)::integer FROM communication.ticket_round_notification_binding) AS rounds`);
    assert.deepEqual(initialCounts.rows,[{messages:1,outboxes:1,deliveries:1,rounds:1}]);
    await f.runtime.coordinator.runOnce();
    const linked=rows((await get(path+'/responsibility')).conversations);assert.equal(linked.length,1);
    const session=linked[0];assert.ok(session);
    await post('/api/conversations/'+text(session.session_id)+'/takeover',{client_command_id:randomUUID(),
      expected_row_version:version(Number(text(session.session_row_version))),reason_code:'T09_041_REAL_COMMUNICATION'},handlerCookie,handlerBootstrap.csrf_token);
    const responsibility=(await get(path+'/responsibility')).conversations;
    const begin=await get(path,handlerCookie);
    await post(path+'/accept-for-later-with-conversations',{client_command_id:randomUUID(),expected_version:version(begin.version),reason_code:'WORKBENCH_SELF_HANDLING',
      resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]},handlerCookie,handlerBootstrap.csrf_token);
    for(const action of ['start','wait-vendor'] as const){
      const current=await get(path,handlerCookie);
      await post(path+'/'+action,{client_command_id:randomUUID(),expected_version:version(current.version),reason_code:'T09_041_'+action.replaceAll('-','_').toUpperCase()},handlerCookie,handlerBootstrap.csrf_token);
    }
    const started=await get(path),cycle=object(started.handling_cycle),beforeEvents=rows((await get(path+'/events?limit=200')).items);
    assert.equal(started.status,'WAITING_VENDOR');assert.equal(started.assignee_id,handler.id);
    assert.equal(cycle.first_responsibility_event_id,assigned.ticket_event_id);
    await f.runtime.roundNotifications.runOnce();assert.deepEqual(await get(path+'/deliveries'),promised);
    const command={client_command_id:randomUUID(),expected_version:version(started.version),reason_code:'WORKBENCH_RETURN_TO_DISPATCH',
      reason:'T09_041_INTERNAL_REASON：等待合成配件',unfinished_work:'T09_041_INTERNAL_UNFINISHED：打印设备尚未修好',
      communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]};
    const returned=await post(path+'/return-to-dispatch',command,handlerCookie,handlerBootstrap.csrf_token);
    const stopped=await get(path);assert.equal(stopped.status,'QUEUED');assert.equal(stopped.assignee_id,null);
    assert.equal(stopped.version,version(started.version)+1);assert.equal(stopped.resolver_team_id,started.resolver_team_id);
    assert.equal(stopped.intake_id,started.intake_id);assert.deepEqual(stopped.handling_cycle,cycle);
    assert.deepEqual((await get(path+'/responsibility')).conversations,responsibility);
    const stoppedEvents=rows((await get(path+'/events?limit=200')).items);
    assert.deepEqual(stoppedEvents.slice(0,-1),beforeEvents);assert.equal(stoppedEvents.at(-1)?.event_type,'ticket.returned_to_dispatch');
    await f.runtime.roundNotifications.runOnce();assert.deepEqual(await get(path+'/deliveries'),promised);
    const replay=await post(path+'/return-to-dispatch',command,handlerCookie,handlerBootstrap.csrf_token);
    assert.equal(replay.replayed,true);assert.equal(replay.ticket_event_id,returned.ticket_event_id);
    await post(path+'/accept-for-later-with-conversations',{client_command_id:randomUUID(),expected_version:version(stopped.version),reason_code:'WORKBENCH_SELF_HANDLING',
      resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]},handlerCookie,handlerBootstrap.csrf_token);
    const accepted=await get(path);assert.equal(accepted.status,'ACCEPTED');assert.equal(accepted.assignee_id,handler.id);
    assert.equal(accepted.version,version(stopped.version)+1);assert.deepEqual(accepted.handling_cycle,cycle);
    assert.deepEqual((await get(path+'/responsibility')).conversations,responsibility);
    await f.runtime.roundNotifications.runOnce();await f.runtime.roundNotifications.runOnce();
    const final=await get(path+'/deliveries');assert.deepEqual(final,promised,'041 preserves the original notification after return, replay, and same-round reacceptance');
    assert.equal(JSON.stringify(final).includes('T09_041_INTERNAL_'),false);
    const finalCounts=await f.pool.query<{messages:number;outboxes:number;deliveries:number;rounds:number}>(`SELECT
      (SELECT count(*)::integer FROM communication.message) AS messages,
      (SELECT count(*)::integer FROM communication.outbox) AS outboxes,
      (SELECT count(*)::integer FROM communication.delivery) AS deliveries,
      (SELECT count(*)::integer FROM communication.ticket_round_notification_binding) AS rounds`);
    assert.deepEqual(finalCounts.rows,initialCounts.rows,'no unbound legacy or retreat intent may hide outside the 041 public projection');
    assert.equal(rows((await get(path+'/events?limit=200')).items).filter(event=>event.event_type==='ticket.returned_to_dispatch').length,1);
  },{ticketReturnToDispatchEnabled:true,ticketAssignmentEnabled:true,ticketConversationSelfHandlingEnabled:true,manualRoundConsumption:true});
});
