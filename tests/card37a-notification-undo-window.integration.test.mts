import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {t25WebOrigin} from './helpers/t25-web-origin-fixture.mjs';
import {createTicketRoundNotifications} from '../app/server/src/workbench-ticket-round-notifications.mjs';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t11Http,t11NewTicket} from './helpers/t11-completion-fixture.mjs';
import {assertEpochMsString,shanghaiLocalToEpochMs} from '../app/server/src/platform/time-contract.mjs';
import {localP2016} from '../app/server/src/p2-016-domain-contracts.mjs';
import {CLAIM_UNDONE_BEFORE_NOTIFICATION_REASON} from '../app/server/src/notification-undo-window.mjs';

import {createP2016TicketCommandFacade} from '../app/server/src/p2-016-ticket-command-facade.mjs';
import {createP2016TicketNotificationProjector} from '../app/server/src/p2-016-ticket-notification-projector.mjs';
import {createCommunicationDeliveryWorker} from '../app/server/src/p2-004-communication-delivery-worker.mjs';
import {createMvpNotificationAdmission} from '../app/server/src/mvp-group-replies.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createPilotTicketCore} from '../app/server/src/p1-005-pilot-ticket-core.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';

function deliveryProbe(pool:PostgresPool,epoch:number){
  const sent:string[]=[];
  const worker=createCommunicationDeliveryWorker({pool,enabled:true,nowEpochMs:()=>String(epoch),
    attemptAdmission:createMvpNotificationAdmission(),sender:{send:async request=>{
      sent.push(request.delivery_id);
      return {outcome:'ACKNOWLEDGED',provider_message_id:null,error_code:null,retryable:false};
    }}});
  return {worker,sent,at(ms:number){epoch=ms;}};
}

test('Card 37A A4 closure notification delays delivery by window and restore cancels without sending closure or restore notice',{timeout:120000},async()=>{
  const windowMs=20_000;
  await withT24Fixture(async f=>{
    const http=await t11Http(f,0,{closeConnections:true});
    const detail=await http.detail(f.ticketId);
    const beforeMs=BigInt(Date.now());
    const dismissed=await http.post(f.ticketId,'dismiss',{
      client_command_id:randomUUID(),
      expected_version:detail.version,
      reason_code:'REPORTER_WITHDREW',
      notify_reporter:true,
    });
    assert.equal(dismissed.status,200,await dismissed.text());

    const closureRow=(await f.pool.query<{id:string;notification_message_id:string|null}>(
      'SELECT id::text,notification_message_id::text FROM pilot_ticket.closure_record WHERE ticket_id=$1::uuid ORDER BY before_version DESC LIMIT 1',
      [f.ticketId],
    )).rows[0];
    assert.ok(closureRow?.notification_message_id,'notifying closure creates a closure message');

    const delivery=(await f.pool.query<{id:string;status:string;side_effect_state:string;next_attempt_epoch_ms:string}>(
      `SELECT d.id::text,d.status,d.side_effect_state,d.next_attempt_epoch_ms::text
         FROM communication.outbox o
         JOIN communication.delivery d ON d.outbox_id=o.id
        WHERE o.message_id=$1::uuid`,
      [closureRow.notification_message_id],
    )).rows[0];
    assert.ok(delivery);
    assert.equal(delivery.status,'PENDING');
    assert.equal(delivery.side_effect_state,'NOT_ATTEMPTED');
    assert.ok(
      BigInt(assertEpochMsString(delivery.next_attempt_epoch_ms))>=beforeMs+BigInt(windowMs)-1_000n,
      'closure delivery next_attempt_epoch_ms must be delayed by closureNotificationUndoWindowMs',
    );

    const probe=deliveryProbe(f.pool,Number(delivery.next_attempt_epoch_ms)-1);
    assert.equal((await probe.worker.runOnce()).processed,0,'no sendable delivery inside the closure window');
    const afterDismiss=await http.detail(f.ticketId);
    const restored=await http.post(f.ticketId,'restore',{
      client_command_id:randomUUID(),
      expected_version:afterDismiss.version,
      reason_code:'RESTORE_CLOSED',
    });
    assert.equal(restored.status,200,await restored.text());

    const cancelled=(await f.pool.query<{status:string;side_effect_state:string;last_error_code:string|null}>(
      'SELECT status,side_effect_state,last_error_code FROM communication.delivery WHERE id=$1::uuid',
      [delivery.id],
    )).rows[0];
    assert.equal(cancelled?.status,'CANCELLED');
    assert.equal(cancelled?.side_effect_state,'NOT_ATTEMPTED');
    assert.equal(cancelled?.last_error_code,'CLOSURE_RESTORED_BEFORE_NOTIFICATION');

    const afterRestoreRecord=(await f.pool.query<{restoration_notification_message_id:string|null}>(
      'SELECT restoration_notification_message_id::text FROM pilot_ticket.closure_record WHERE id=$1::uuid',
      [closureRow.id],
    )).rows[0];
    assert.equal(afterRestoreRecord?.restoration_notification_message_id,null,'restore inside undo window sends no restoration notice');

    probe.at(Number(delivery.next_attempt_epoch_ms)+1);
    assert.equal((await probe.worker.runOnce()).processed,0,'a restored closure sends neither message');
    assert.deepEqual(probe.sent,[]);

    const nonNotifyTicketId=await t11NewTicket(f);
    const nonNotifyDetail=await http.detail(nonNotifyTicketId);
    const nonNotifyRes=await http.post(nonNotifyTicketId,'dismiss',{
      client_command_id:randomUUID(),
      expected_version:nonNotifyDetail.version,
      reason_code:'FALSE_REPORT_OR_TEST',
      notify_reporter:false,
    });
    assert.equal(nonNotifyRes.status,200);
    const nonNotifyRecord=(await f.pool.query<{notification_message_id:string|null}>(
      'SELECT notification_message_id::text FROM pilot_ticket.closure_record WHERE ticket_id=$1::uuid',
      [nonNotifyTicketId],
    )).rows[0];
    assert.equal(nonNotifyRecord?.notification_message_id,null);

    // This same Bot source already produced a real reporter delivery above.
    // Closing it again with a silent reason isolates the matrix decision from source eligibility.
    const eligible=await http.detail(f.ticketId);
    const silent=await http.post(f.ticketId,'dismiss',{client_command_id:randomUUID(),expected_version:eligible.version,
      reason_code:'FALSE_REPORT_OR_TEST',notify_reporter:false,note:'合成演练结束（合成）'});
    assert.equal(silent.status,200,await silent.text());
    const latest=(await f.pool.query<{notification_message_id:string|null;notification_processed_at:string|null}>(`SELECT notification_message_id,notification_processed_at
      FROM pilot_ticket.closure_record WHERE ticket_id=$1 ORDER BY before_version DESC LIMIT 1`,[f.ticketId])).rows[0];
    assert.ok(latest?.notification_processed_at);assert.equal(latest.notification_message_id,null);
    assert.equal((await probe.worker.runOnce()).processed,0);assert.deepEqual(probe.sent,[]);
  },{
    mvpNotificationsEnabled:true,
    manualRoundConsumption:true,
    closureNotificationUndoWindowMs:windowMs,
    claimNotificationUndoWindowMs:0,
  });
});

test('Card 37A A4 claim FIRST_HANDLING delivery delays from claim event time and cancels on return-to-dispatch',{timeout:120000},async()=>{
  const claimWindowMs=25_000;
  await withT24Fixture(async f=>{
    const http=await t11Http(f,0,{closeConnections:true});
    await http.start(f.ticketId);
    const claimEvent=(await f.pool.query<{event_id:string;created_at:string}>(
      `SELECT event_id::text,created_at::text
         FROM pilot_ticket.ticket_event
        WHERE ticket_id=$1::uuid AND event_type='ticket.started'
        ORDER BY event_ordinal DESC LIMIT 1`,
      [f.ticketId],
    )).rows[0];
    assert.ok(claimEvent,'take-and-start records ticket.started');
    const claimEventEpochMs=BigInt(shanghaiLocalToEpochMs(localP2016(claimEvent.created_at)));

    assert.ok(f.runtime.roundNotifications);
    const sweep=await f.runtime.roundNotifications.runOnce();
    assert.equal(sweep.created,1);

    const delivery=(await f.pool.query<{id:string;status:string;side_effect_state:string;next_attempt_epoch_ms:string}>(
      `SELECT d.id::text,d.status,d.side_effect_state,d.next_attempt_epoch_ms::text
         FROM communication.ticket_round_notification_binding r
         JOIN communication.ticket_notification_binding b ON b.id=r.notification_binding_id
         JOIN communication.delivery d ON d.id=b.delivery_id
        WHERE r.ticket_id=$1::uuid AND r.node='FIRST_HANDLING' AND r.destination_type='PERSON'`,
      [f.ticketId],
    )).rows[0];
    assert.ok(delivery);
    assert.equal(delivery.status,'PENDING');
    assert.equal(BigInt(assertEpochMsString(delivery.next_attempt_epoch_ms)),claimEventEpochMs+BigInt(claimWindowMs));

    const probe=deliveryProbe(f.pool,Number(delivery.next_attempt_epoch_ms)-1);
    assert.equal(await probe.worker.deliver({deliveryId:delivery.id}),null);
    const current=await http.detail(f.ticketId);
    const returned=await http.post(f.ticketId,'return-to-dispatch',{
      client_command_id:randomUUID(),
      expected_version:current.version,
      reason_code:'WORKBENCH_RETURN_TO_DISPATCH',
      reason:'撤销领取',
      unfinished_work:'刚领取即撤销，尚未开始处理',
      communication_choice:'RETAIN_CURRENT',
      communication_target_principal_id:null,
      sessions:[],
    });
    assert.equal(returned.status,200,await returned.text());

    const cancelled=(await f.pool.query<{status:string;side_effect_state:string;last_error_code:string|null}>(
      'SELECT status,side_effect_state,last_error_code FROM communication.delivery WHERE id=$1::uuid',
      [delivery.id],
    )).rows[0];
    assert.equal(cancelled?.status,'CANCELLED');
    assert.equal(cancelled?.side_effect_state,'NOT_ATTEMPTED');
    assert.equal(cancelled?.last_error_code,CLAIM_UNDONE_BEFORE_NOTIFICATION_REASON);
    probe.at(Number(delivery.next_attempt_epoch_ms));
    assert.equal(await probe.worker.deliver({deliveryId:delivery.id}),null);
    assert.deepEqual(probe.sent,[]);
  },{
    mvpNotificationsEnabled:true,
    ticketReturnToDispatchEnabled:true,
    manualRoundConsumption:true,
    claimNotificationUndoWindowMs:claimWindowMs,
  });
});

test('Card 37A A4 return-to-dispatch before worker sweep suppresses creating FIRST_HANDLING notice',{timeout:120000},async()=>{
  await withT24Fixture(async f=>{
    const http=await t11Http(f,0,{closeConnections:true});
    const started=await http.start(f.ticketId);
    const returned=await http.post(f.ticketId,'return-to-dispatch',{
      client_command_id:randomUUID(),
      expected_version:started.version,
      reason_code:'WORKBENCH_RETURN_TO_DISPATCH',
      reason:'撤销领取',
      unfinished_work:'刚领取即撤销，尚未开始处理',
      communication_choice:'RETAIN_CURRENT',
      communication_target_principal_id:null,
      sessions:[],
    });
    assert.equal(returned.status,200,await returned.text());

    assert.ok(f.runtime.roundNotifications);
    const sweep=await f.runtime.roundNotifications.runOnce();
    assert.equal(sweep.created,0);

    const bindings=(await f.pool.query(
      "SELECT 1 FROM communication.ticket_round_notification_binding WHERE ticket_id=$1::uuid AND node='FIRST_HANDLING'",
      [f.ticketId],
    )).rowCount;
    assert.equal(bindings,0);
    const probe=deliveryProbe(f.pool,Date.now()+60_000);
    assert.equal((await probe.worker.runOnce()).processed,0);
    assert.deepEqual(probe.sent,[]);
  },{
    mvpNotificationsEnabled:true,
    ticketReturnToDispatchEnabled:true,
    manualRoundConsumption:true,
    claimNotificationUndoWindowMs:10_000,
  });
});

test('37A A5.8 notifying closure is deliverable at its deadline and a later restore notifies', {timeout:120000},()=>withT24Fixture(async f=>{
  const http=await t11Http(f,0,{closeConnections:true});
  const before=await http.detail(f.ticketId);
  const res=await http.post(f.ticketId,'dismiss',{client_command_id:randomUUID(),expected_version:before.version,
    reason_code:'REPORTER_WITHDREW',notify_reporter:true,note:'报修人撤回（合成）'});
  assert.equal(res.status,200,await res.text());
  const row=(await f.pool.query<{id:string;due:string;event_time:string}>(`SELECT d.id::text,d.next_attempt_epoch_ms::text AS due,e.created_at::text AS event_time
    FROM pilot_ticket.closure_record c JOIN pilot_ticket.ticket_event e ON e.event_id=c.closure_ticket_event_id
    JOIN communication.outbox o ON o.message_id=c.notification_message_id
    JOIN communication.delivery d ON d.outbox_id=o.id WHERE c.ticket_id=$1`,[f.ticketId])).rows[0];
  assert.ok(row);
  const deadline=Number(row.due);
  const eventMs=Number(shanghaiLocalToEpochMs(localP2016(row.event_time)));
  assert.ok(deadline>=eventMs+10000,'the default window protects the full ten seconds');
  const probe=deliveryProbe(f.pool,deadline-1);
  assert.equal((await probe.worker.runOnce()).processed,0);
  probe.at(deadline);
  assert.equal((await probe.worker.runOnce()).processed,1);
  assert.deepEqual(probe.sent,[row.id]);
  const closed=await http.detail(f.ticketId);
  const restored=await http.post(f.ticketId,'restore',{client_command_id:randomUUID(),expected_version:closed.version,reason_code:'RESTORE_CLOSED'});
  assert.equal(restored.status,200,await restored.text());
  const restore=(await f.pool.query<{id:string;due:string}>(`SELECT d.id::text,d.next_attempt_epoch_ms::text AS due FROM pilot_ticket.closure_record c
    JOIN communication.outbox o ON o.message_id=c.restoration_notification_message_id JOIN communication.delivery d ON d.outbox_id=o.id WHERE c.ticket_id=$1`,[f.ticketId])).rows[0];
  assert.ok(restore);assert.notEqual(restore.id,row.id);
  assert.equal((await probe.worker.runOnce()).processed,1);assert.deepEqual(probe.sent,[row.id,restore.id]);

},{mvpNotificationsEnabled:true,manualRoundConsumption:true}));

test('37A A5.8 only FIRST_HANDLING waits; STAFF_COMPLETED person and configured group send immediately', {timeout:120000},()=>withT24Fixture(async f=>{
  const http=await t11Http(f,0,{closeConnections:true});
  const intake=await seedPersistedIntake({pool:f.pool,text:'打印机故障（合成）',chatType:'group',tag:'card37a',requestType:'INCIDENT',status:'RECEIVED'});
  const {ticket}=await createPilotTicketCore({pool:f.pool}).createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'card37a'});
  assert.ok(ticket);
  const started=await http.start(ticket.id);
  const completed=await http.post(ticket.id,'complete',http.command(started));
  assert.equal(completed.status,200,await completed.text());
  await f.runtime.roundNotifications.runOnce();await f.runtime.roundNotifications.runOnce();
  const rows=(await f.pool.query<{node:string;destination_type:string;id:string;due:string;event_time:string}>(`SELECT r.node,r.destination_type,d.id::text,
    d.next_attempt_epoch_ms::text AS due,e.created_at::text AS event_time FROM communication.ticket_round_notification_binding r
    JOIN communication.ticket_notification_binding n ON n.id=r.notification_binding_id
    JOIN communication.delivery d ON d.id=n.delivery_id JOIN pilot_ticket.ticket_event e ON e.event_id=n.ticket_event_id
    WHERE r.ticket_id=$1 ORDER BY r.node,r.destination_type`,[ticket.id])).rows;
  assert.deepEqual(rows.map(r=>[r.node,r.destination_type]),[['FIRST_HANDLING','PERSON'],['STAFF_COMPLETED','GROUP'],['STAFF_COMPLETED','PERSON']]);
  const first=rows[0];assert.ok(first);
  const due=Number(shanghaiLocalToEpochMs(localP2016(first.event_time)))+10_000;
  assert.equal(Number(first.due),due);
  const probe=deliveryProbe(f.pool,Date.now());
  assert.equal((await probe.worker.runOnce()).processed,2);
  assert.deepEqual([...probe.sent].sort(),rows.slice(1).map(r=>r.id).sort());
  probe.at(due-1);assert.equal(await probe.worker.deliver({deliveryId:first.id}),null);
  probe.at(due);assert.equal((await probe.worker.runOnce()).processed,1);assert.equal(probe.sent.at(-1),first.id);
  assert.equal(await probe.worker.deliver({deliveryId:first.id}),null);
},{mvpNotificationsEnabled:true,manualRoundConsumption:true,groupNotificationTargets:[{botId:'bot-test',groupId:'group-card37a'}]}));

for(const projected of [true,false])test('37A A5.8 ordinary return after zero window preserves FIRST_HANDLING; preprojected='+projected,{timeout:120000},()=>withT24Fixture(async f=>{
  const http=await t11Http(f,0,{closeConnections:true});
  const started=await http.start(f.ticketId);
  if(projected)assert.equal((await f.runtime.roundNotifications.runOnce()).created,1);
  const ret=await http.post(f.ticketId,'return-to-dispatch',{client_command_id:randomUUID(),expected_version:started.version,
    reason_code:'WORKBENCH_RETURN_TO_DISPATCH',reason:'需要重新派工（合成）',unfinished_work:'等待更换设备（合成）',
    communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]});
  assert.equal(ret.status,200,await ret.text());
  if(!projected)assert.equal((await f.runtime.roundNotifications.runOnce()).created,1,'ordinary return after the window cannot suppress projection');
  const probe=deliveryProbe(f.pool,Date.now());
  assert.equal((await probe.worker.runOnce()).processed,1,'ordinary return after the window cannot cancel delivery');
  assert.equal(probe.sent.length,1);
},{mvpNotificationsEnabled:true,ticketReturnToDispatchEnabled:true,manualRoundConsumption:true,claimNotificationUndoWindowMs:0}));

test('37A A5.8 a delayed closure sweep counts ten seconds from the event', {timeout:120000},()=>withT24Fixture(async f=>{
  // Commit through the real command port without an inline projector. Its pending
  // record is the same one consumed by production catch-up after a delayed sweep.
  const facade=createP2016TicketCommandFacade({pool:f.pool,enabled:true});
  const http=await t11Http(f,0,{closeConnections:true});
  const before=await http.detail(f.ticketId);
  const actor=f.principals[0];assert.ok(actor);
  const result=await facade.perform({authContext:{principal_id:actor.id},command:{ticket_id:f.ticketId,action:'dismiss',
    client_command_id:randomUUID(),expected_version:before.version,reason_code:'REPORTER_WITHDREW',notify_reporter:true,note:'延迟扫描（合成）'}});
  assert.equal(result.ok,true);
  const closure=(await f.pool.query<{event_time:string;notification_processed_at:string|null}>(`SELECT e.created_at::text AS event_time,c.notification_processed_at
    FROM pilot_ticket.closure_record c JOIN pilot_ticket.ticket_event e ON e.event_id=c.closure_ticket_event_id WHERE c.ticket_id=$1`,[f.ticketId])).rows[0];
  assert.ok(closure);assert.equal(closure.notification_processed_at,null);
  const eventMs=Number(shanghaiLocalToEpochMs(localP2016(closure.event_time)));
  const sweepMs=eventMs+30_000;
  const projector=createP2016TicketNotificationProjector({enabled:true,mvpPolicy:true,now:()=>String(sweepMs)});
  assert.ok((await projector.projectPendingClosures({pool:f.pool})).scanned>=1);
  const row=(await f.pool.query<{id:string;due:string}>(`SELECT d.id::text,d.next_attempt_epoch_ms::text AS due FROM pilot_ticket.closure_record c
    JOIN communication.outbox o ON o.message_id=c.notification_message_id JOIN communication.delivery d ON d.outbox_id=o.id WHERE c.ticket_id=$1`,[f.ticketId])).rows[0];
  assert.ok(row);
  const probe=deliveryProbe(f.pool,sweepMs);
  const sent=await probe.worker.deliver({deliveryId:row.id});
  assert.deepEqual({delay:Number(row.due)-eventMs,sendable:sent!==null,sends:probe.sent.length},{delay:10000,sendable:true,sends:1});
},{mvpNotificationsEnabled:true,manualRoundConsumption:true}));

for(const scenario of ['undo before sweep','undo after sweep','no undo'])test('37A app FIRST_HANDLING uses the claim deadline: '+scenario,{timeout:120000},()=>withT24Fixture(async f=>{
  const windowMs=60_000;
  const source=await t25WebOrigin(f);
  const round=createTicketRoundNotifications({pool:f.pool,enabled:true,mvpPolicy:true,botId:'bot-test',
    reporterAccess:f.runtime.reporterAccess,appNotifications:source.appNotifications,claimNotificationUndoWindowMs:windowMs});
  const notice=()=>f.pool.query<{id:string;provider:string;status:string;due:string;created_at:string;last_error_code:string|null}>(`SELECT d.id,d.provider,d.status,d.next_attempt_epoch_ms::text AS due,e.created_at::text,d.last_error_code
    FROM communication.ticket_round_notification_binding r JOIN communication.ticket_notification_binding n ON n.id=r.notification_binding_id
    JOIN communication.delivery d ON d.id=n.delivery_id JOIN pilot_ticket.ticket_event e ON e.event_id=n.ticket_event_id
    WHERE r.ticket_id=$1 AND r.node='FIRST_HANDLING'`,[source.ticketId]);
  if(scenario!=='undo before sweep'){
    await round.runOnce();
    const rows=await notice();assert.equal(rows.rowCount,1);const row=rows.rows[0];assert.ok(row);
    assert.equal(row.provider,'WECOM_APP');
    assert.equal(Number(row.due),Number(shanghaiLocalToEpochMs(localP2016(row.created_at)))+windowMs);
    const probe=deliveryProbe(f.pool,Number(row.due)-1);
    assert.equal(await probe.worker.deliver({deliveryId:row.id}),null);
    if(scenario==='no undo'){
      probe.at(Number(row.due));await probe.worker.deliver({deliveryId:row.id});
      assert.deepEqual(probe.sent,[row.id]);assert.equal((await notice()).rows[0]?.status,'SENT');
      return;
    }
  }
  const response=await source.http.post(source.ticketId,'return-to-dispatch',{client_command_id:randomUUID(),
    expected_version:source.started.version,reason_code:'WORKBENCH_RETURN_TO_DISPATCH',reason:'撤销领取',
    unfinished_work:'刚领取即撤销，尚未开始处理',communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]});
  assert.equal(response.status,200,await response.text());
  await round.runOnce();
  const rows=await notice();
  if(scenario==='undo before sweep')assert.equal(rows.rowCount,0);
  else{assert.equal(rows.rows[0]?.status,'CANCELLED');assert.equal(rows.rows[0]?.last_error_code,CLAIM_UNDONE_BEFORE_NOTIFICATION_REASON);}
},{manualRoundConsumption:true,mvpNotificationsEnabled:true,ticketReturnToDispatchEnabled:true,claimNotificationUndoWindowMs:60_000}));
