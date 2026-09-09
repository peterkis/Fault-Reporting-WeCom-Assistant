import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';
import { createP2012NotificationPolicy } from '../src/p2-012-notification-policy.mjs';
import { createP2016WeComSender } from '../src/p2-016-wecom-sender.mjs';
import { textHashP2016 } from '../src/p2-016-domain-contracts.mjs';
import { createCommunicationDeliveryWorker,createCommunicationReconciliationPort } from '../src/p2-004-communication-delivery-worker.mjs';

for(const chatType of ['group','single'])test('original Ticket notification source '+chatType,async t=>{
  await withG2Runtime(async f=>{
    await f.inbound('打印机卡纸了',{chatType});await f.pump();
    const rows=(await f.pool.query(`SELECT b.destination_type,m.message_type,m.content,d.status
      FROM communication.ticket_notification_binding b JOIN communication.message m ON m.id=b.message_id
      JOIN communication.delivery d ON d.id=b.delivery_id ORDER BY b.destination_type`)).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].destination_type,chatType==='group'?'GROUP':'PERSON');
    assert.equal(rows[0].status,'PENDING');assert.equal(f.providerCalls.length,0);
    const ticket=(await f.pool.query('SELECT id FROM pilot_ticket.ticket')).rows[0];
    const event=(await f.pool.query("SELECT event_id FROM pilot_ticket.ticket_event WHERE event_type='ticket.created'")).rows[0];
    assert.equal((await f.runtime.notifications.project({transaction:f.pool,ticket,event})).replayed,true);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM communication.delivery')).rows[0].n,1);
    if(chatType==='group'){
      assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.reporter_access_grant')).rows[0].n,0);
      assert.doesNotMatch(rows[0].content.text,/@|已.*(?:私聊|送达)/u);
    }
    t.diagnostic(JSON.stringify({source_case_id:chatType==='group'?'P2-007-X037':'P2-007-X038',
      surface:'NORMAL_FRAME_REAL_TICKET_EVENT_OUTBOX',private_ack_adjudication:chatType==='group'?'SUPPRESSED_WITHOUT_DIRECT_LEG':'CREATED',
      replay_delivery_delta:0,provider_calls:0}));
  },{ticketNotificationAdditionalEvents:['ticket.created']});
});

test('original Incident notification sources use actual confirmation, version four event and replay',async t=>{
  await withG2Runtime(async f=>{
    for(const reporter of f.reporters){await f.inbound('测试诊室断网。',{reporter});await f.pump();}
    await f.runtime.incidentExtension.runOnce();
    const candidate=(await f.pool.query('SELECT id,row_version FROM incident.candidate_review')).rows[0];
    const command=version=>({client_command_id:randomUUID(),expected_row_version:String(version),reason_code:'OPERATOR_REVIEWED'});
    const root='/api/incident-candidates/'+candidate.id;
    assert.equal((await f.post(root+'/start-review',command(candidate.row_version))).status,200);
    const refs=(await f.pool.query(`SELECT d.safe_result FROM incident.candidate_review c
      JOIN intake.deterministic_decision d ON d.id=c.source_decision_id WHERE c.id=$1`,[candidate.id])).rows[0].safe_result.incident_report_decision_ids;
    assert.ok(refs.length>0);
    const confirm={client_command_id:randomUUID(),expected_candidate_version:'2',reason_code:'OPERATOR_REVIEWED',
      confirmed_scope:'LOCAL',owner_principal_id:f.admin.id,selected_report_refs:refs};
    const result=await f.post(root+'/confirm',confirm,'2');assert.equal(result.status,200,JSON.stringify(result.body));
    const id=result.body.result_ref_id;
    assert.equal(result.body.result_row_version,'1');
    const notices=async()=>(await f.pool.query('SELECT incident_event_id,audience_type,template_code,communication_message_id FROM communication.incident_notification_binding ORDER BY id')).rows;
    const first=await notices();assert.equal(first.length,1);assert.equal(first[0].audience_type,'GROUP');
    assert.equal(first[0].template_code,'INCIDENT_CONFIRMED_GROUP');
    assert.equal((await f.post(root+'/confirm',confirm,'2')).body.replayed,true);assert.deepEqual(await notices(),first);
    const api='/api/incidents/'+id;
    // Actual human actions advance the owning Incident version; no seeded event/version.
    for(const version of ['1','2'])assert.equal((await f.post(api+'/primary-ticket',{...command(version),primary_ticket_id:null})).status,200);
    const update=command('3');const changed=await f.post(api+'/start-investigating',update);assert.equal(changed.status,200);
    assert.equal(changed.body.result_row_version,'4');
    const before=await notices();
    assert.equal((await f.post(api+'/start-investigating',update)).body.replayed,true);
    const policy=createP2012NotificationPolicy({enabled:true,publicEnabled:true,privateEnabled:true});
    const incident=(await f.pool.query('SELECT * FROM incident.incident WHERE id=$1',[id])).rows[0];
    const event={id:changed.body.result_event_id};
    assert.equal((await policy.project({transaction:f.pool,incident,event})).created,0);
    assert.deepEqual(await notices(),before);assert.equal(f.providerCalls.length,0);
    t.diagnostic(JSON.stringify({source_case_ids:['P2-007-X039','P2-007-X040'],surface:'NORMAL_REPORTS_AUTHENTICATED_INCIDENT_COMMANDS_OUTBOX',
      confirmation_version:1,source_confirmation_version_3_adjudication:'NEW_INCIDENT_STARTS_AT_ONE',update_version:4,
      source_generic_updated_adjudication:'ACTUAL_INCIDENT_INVESTIGATING_EVENT',no_direct_subscription_private_suppression:true,replay_delivery_delta:0,provider_calls:0}));
  });
});

test('original UNKNOWN source requires reconciliation after a real Outbox attempt',async t=>{
  await withG2Runtime(async f=>{
    await f.inbound('系统不行',{chatType:'single'});await f.pump();
    const delivery=(await f.pool.query('SELECT id FROM communication.delivery')).rows[0];assert.ok(delivery);
    let calls=0;
    const sender=createP2016WeComSender({enabled:true,cardEnabled:false,allowedTargetHashes:f.reporters.map(textHashP2016),
      gateway:{getAuthenticatedClient:()=>({sendMessage:async()=>{calls++;return {};}})}});
    let worker=createCommunicationDeliveryWorker({pool:f.pool,sender,enabled:true});
    assert.equal((await worker.deliver({deliveryId:delivery.id})).status,'RECONCILIATION_REQUIRED');
    worker=createCommunicationDeliveryWorker({pool:f.pool,sender,enabled:true});
    assert.equal(await worker.deliver({deliveryId:delivery.id}),null);assert.equal(calls,1);
    const row=(await f.pool.query('SELECT status,side_effect_state,attempt_count FROM communication.delivery WHERE id=$1',[delivery.id])).rows[0];
    assert.deepEqual(row,{status:'RECONCILIATION_REQUIRED',side_effect_state:'UNKNOWN',attempt_count:1});
    const reconcile=createCommunicationReconciliationPort({pool:f.pool});
    const input={deliveryId:delivery.id,expectedStatus:'RECONCILIATION_REQUIRED',resolution:'CONFIRMED_SENT',reasonCode:'SYNTHETIC_CLIENT_CONFIRMED'};
    assert.equal((await reconcile.reconcileUnknownDelivery({...input,authorized:false})).ok,false);
    assert.equal((await reconcile.reconcileUnknownDelivery({...input,authorized:true})).status,'SENT');
    assert.equal(await worker.deliver({deliveryId:delivery.id}),null);assert.equal(calls,1);
    assert.deepEqual((await f.pool.query('SELECT outcome FROM communication.delivery_attempt WHERE delivery_id=$1 ORDER BY attempt_no',[delivery.id])).rows.map(r=>r.outcome),['RECONCILIATION_REQUIRED','SENT']);
    t.diagnostic(JSON.stringify({source_case_ids:['P2-007-X042','D12-041'],surface:'NORMAL_FRAME_REAL_OUTBOX_MOCK_PROVIDER_UNKNOWN',
      synthetic_provider_attempts:1,automatic_retry_count:0,explicit_reconciliation:true,live_provider_calls:0}));
  });
});

test('D12-063 four actual Direct-qualified subscriptions produce version-idempotent Incident notices',async t=>{
  await withG2Runtime(async f=>{
    const decisions=[];
    for(const reporter of f.reporters){await f.inbound('测试诊室断网。',{reporter});const batch=await f.pump();decisions.push(batch.results[0].decision_id);}
    const receipts=(await f.pool.query(`SELECT i.reporter_wecom_userid AS reporter,m.content->>'text' AS text
      FROM communication.ticket_notification_binding b JOIN communication.message m ON m.id=b.message_id
      JOIN pilot_ticket.ticket t ON t.id=b.ticket_id JOIN intake.service_intake i ON i.id=t.source_intake_id
      WHERE b.destination_type='GROUP'`)).rows;
    assert.equal(receipts.length,4);
    for(const r of receipts){const ref=r.text.match(/续接工单 ([A-Za-z0-9_-]{32})：/u)?.[1];assert.ok(ref);
      await f.inbound('续接工单 '+ref+'：补充，还是断网。',{chatType:'single',reporter:r.reporter});await f.pump();}
    await f.runtime.incidentExtension.runOnce();const c=(await f.get('/api/incident-candidates')).items[0];assert.ok(c);
    const root='/api/incident-candidates/'+c.id;
    assert.equal((await f.post(root+'/start-review',{client_command_id:randomUUID(),expected_row_version:c.row_version,reason_code:'OPERATOR_REVIEWED'})).status,200);
    const current=await f.get(root),command={client_command_id:randomUUID(),expected_candidate_version:current.row_version,
      reason_code:'OPERATOR_REVIEWED',confirmed_scope:'LOCAL',owner_principal_id:f.admin.id,selected_report_refs:decisions};
    const confirmed=await f.post(root+'/confirm',command,current.row_version);assert.equal(confirmed.status,200);
    const id=confirmed.body.result_ref_id;
    const subscriptions=(await f.pool.query('SELECT status FROM incident.reporter_subscription WHERE incident_id=$1',[id])).rows;
    assert.equal(subscriptions.length,4);assert.ok(subscriptions.every(s=>s.status==='ACTIVE'));
    const counts=async()=>(await f.pool.query('SELECT audience_type,count(*)::int AS n FROM communication.incident_notification_binding WHERE incident_id=$1 GROUP BY audience_type ORDER BY audience_type',[id])).rows;
    assert.deepEqual(await counts(),[{audience_type:'GROUP',n:1},{audience_type:'REPORTER_DIRECT',n:4}]);
    assert.equal((await f.post(root+'/confirm',command,current.row_version)).body.replayed,true);
    assert.deepEqual(await counts(),[{audience_type:'GROUP',n:1},{audience_type:'REPORTER_DIRECT',n:4}]);
    assert.equal(f.providerCalls.length,0);
    t.diagnostic(JSON.stringify({source_case_id:'D12-063',surface:'NORMAL_GROUP_AND_DIRECT_REPORTS_HUMAN_CONFIRMATION',
      source_version_2_adjudication:'CONFIRMATION_EVENT_VERSION_ONE',group_notices:1,private_notices:4,replay_notice_delta:0,provider_calls:0}));
  },{reporterCount:4});
});
