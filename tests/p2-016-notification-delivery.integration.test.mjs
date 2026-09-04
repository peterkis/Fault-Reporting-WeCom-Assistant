import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPilotTicketCore } from '../src/p1-005-pilot-ticket-core.mjs';
import { appendTicketEvent,createTicketActionService } from '../src/p1-006-ticket-state-actions.mjs';
import { createP2016ReporterAccess } from '../src/p2-016-reporter-access.mjs';
import { createP2016ReporterTimeline } from '../src/p2-016-reporter-timeline.mjs';
import { createP2016TicketNotificationProjector } from '../src/p2-016-ticket-notification-projector.mjs';
import { createP2016WeComSender } from '../src/p2-016-wecom-sender.mjs';
import { createCommunicationDeliveryWorker,createCommunicationReconciliationPort } from '../src/p2-004-communication-delivery-worker.mjs';
import { transactionP2016,textHashP2016 } from '../src/p2-016-domain-contracts.mjs';
import { seedPersistedIntake } from './helpers/p2-015-postgres-harness.mjs';
import { withP2016IsolatedDatabase,applyThrough030,assertNoP2016Residual } from './helpers/p2-016-postgres-harness.mjs';
import { migrateP2016 } from '../scripts/p2-016-migrate.mjs';
import { assertP2016Schema } from './helpers/p2-016-schema-assert.mjs';
const databaseUrl=process.env.PILOT_DATABASE_URL;
test('P2-016 persisted card delivery, HMAC grants, one-use sessions and reporter-safe timeline',async()=>{
  assert.ok(databaseUrl,'database required');
  await withP2016IsolatedDatabase({databaseUrl,purpose:'p2016notify',run:async({pool,databaseUrl:isolated})=>{
    await applyThrough030({pool,databaseUrl:isolated});await migrateP2016({databaseUrl:isolated});
    const access=createP2016ReporterAccess({pool,enabled:true,hmacSecret:'synthetic-only-reporter-hmac-secret-at-least-32'});
    const projector=createP2016TicketNotificationProjector({enabled:true,cardEnabled:true,reporterAccess:access});
    const seed=await seedPersistedIntake({pool,text:'synthetic',requestType:'INCIDENT',status:'RECEIVED'});
    const ticket=(await createPilotTicketCore({pool}).createForIntake({intakeId:seed.intakeId,occurredAt:seed.receivedAt,traceId:'synthetic'})).ticket;
    let event;
    const notification=await transactionP2016(pool,async tx=>{
      event=await appendTicketEvent({transaction:tx,ticket,eventType:'ticket.created',actor:{type:'SYSTEM',id:null},traceId:'synthetic'});
      return projector.project({transaction:tx,ticket,event});
    });
    const before=(await pool.query('SELECT count(*)::integer AS n FROM communication.message')).rows[0].n;
    const replay=await transactionP2016(pool,tx=>projector.project({transaction:tx,ticket,event}));
    assert.equal(replay.replayed,true);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM communication.message')).rows[0].n,before);
    let calls=0,body=null;
    const gateway={getAuthenticatedClient:()=>({sendMessage:async(target,value)=>{calls++;assert.equal(target,'user-test');body=value;return {errcode:0,headers:{req_id:'synthetic-ack'}};}})};
    const sender=createP2016WeComSender({gateway,enabled:true,cardEnabled:true,allowedTargetHashes:[textHashP2016('user-test')],
      reporterAccess:access,origin:'https://reporter.example.test',allowedHosts:['reporter.example.test']});
    const worker=createCommunicationDeliveryWorker({pool,sender,enabled:true});
    const sent=await worker.deliver({deliveryId:notification.delivery_id});assert.equal(sent.status,'SENT');assert.equal(calls,1);
    assert.equal(body.msgtype,'template_card');assert.equal(body.template_card.card_type,'text_notice');
    assert.equal(body.template_card.emphasis_content.title,ticket.ticket_no.slice(-4));
    assert.equal(JSON.stringify(body).includes(ticket.id),false);
    assert.equal(JSON.stringify(body).includes('user-test'),false);
    const link=new URL(body.template_card.card_action.url),token=new URLSearchParams(link.hash.slice(1)).get('grant');
    assert.equal(link.search,'');assert.equal(token.length,64);
    const facts=(await pool.query('SELECT (SELECT jsonb_agg(g) FROM pilot_ticket.reporter_access_grant g) AS grants,(SELECT jsonb_agg(m) FROM communication.message m) AS messages')).rows[0];
    assert.equal(JSON.stringify(facts).includes(token),false);
    const exchanged=await access.exchange(token);
    await assert.rejects(access.exchange(token),{code:'P2_016_GRANT_INVALID'});
    await assert.rejects(access.exchange('x'.repeat(64)),{code:'P2_016_GRANT_INVALID'});
    const timeline=createP2016ReporterTimeline({pool,access,enabled:true});
    const bootstrap=await timeline.bootstrap({sessionToken:exchanged.sessionToken});assert.equal(bootstrap.identity_mode,'BOUND_ACCESS_SESSION');
    const detail=await timeline.detail({sessionToken:exchanged.sessionToken,publicRef:exchanged.public_ref});
    await assertP2016Schema('p2_016_reporter_ticket_view',detail);await assertP2016Schema('p2_016_reporter_session',bootstrap);
    assert.equal(detail.ticket_no,ticket.ticket_no);assert.equal(JSON.stringify(detail).includes(ticket.id),false);
    await transactionP2016(pool,tx=>appendTicketEvent({transaction:tx,ticket,eventType:'ticket.note_added',actor:{type:'SYSTEM',id:null},
      internalNote:'patient-secret 10.1.1.1',externalNote:'unapproved external patient-secret',traceId:'synthetic-note'}));
    const page=await timeline.timeline({sessionToken:exchanged.sessionToken,publicRef:exchanged.public_ref});
    await assertP2016Schema('p2_016_reporter_timeline',page);
    assert.equal(page.items.length,1);assert.equal(JSON.stringify(page).includes('patient-secret'),false);
    await assert.rejects(timeline.detail({sessionToken:exchanged.sessionToken,publicRef:'x'.repeat(32)}),{code:'P2_016_REPORTER_UNAUTHENTICATED'});
    assert.equal(await worker.deliver({deliveryId:notification.delivery_id}),null);assert.equal(calls,1);
    await access.logout(exchanged.sessionToken);
    await assert.rejects(timeline.bootstrap({sessionToken:exchanged.sessionToken}),{code:'P2_016_REPORTER_UNAUTHENTICATED'});
    const accepted=await transactionP2016(pool,tx=>createTicketActionService().performInTransaction({ticketId:ticket.id,action:'accept',expectedVersion:ticket.version,
      actor:{type:'SYSTEM',id:null},traceId:'synthetic-unknown'},tx));
    const unknownEvent=accepted.event;
    const unknownNotification=await transactionP2016(pool,tx=>projector.project({transaction:tx,ticket,event:unknownEvent}));
    const unknownSender=createP2016WeComSender({gateway:{getAuthenticatedClient:()=>({sendMessage:async()=>{calls++;return {};}})},enabled:true,cardEnabled:true,
      allowedTargetHashes:[textHashP2016('user-test')],reporterAccess:access,origin:'https://reporter.example.test',allowedHosts:['reporter.example.test']});
    const unknownWorker=createCommunicationDeliveryWorker({pool,sender:unknownSender,enabled:true});
    assert.equal((await unknownWorker.deliver({deliveryId:unknownNotification.delivery_id})).status,'RECONCILIATION_REQUIRED');
    const count=calls;assert.equal(await unknownWorker.deliver({deliveryId:unknownNotification.delivery_id}),null);assert.equal(calls,count);
    const reconciliation=createCommunicationReconciliationPort({pool});
    await reconciliation.reconcileUnknownDelivery({deliveryId:unknownNotification.delivery_id,expectedStatus:'RECONCILIATION_REQUIRED',resolution:'CONFIRMED_SENT',reasonCode:'SYNTHETIC_CLIENT_CONFIRMED',authorized:true});
    assert.equal(await unknownWorker.deliver({deliveryId:unknownNotification.delivery_id}),null);assert.equal(calls,count);
  }});
  await assertNoP2016Residual({databaseUrl});
});
