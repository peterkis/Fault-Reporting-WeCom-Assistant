import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createP2012IncidentCommandService } from '../src/p2-012-incident-command-service.mjs';
import { createP2012IncidentQuery } from '../src/p2-012-incident-query.mjs';
import { createP2012NotificationPolicy } from '../src/p2-012-notification-policy.mjs';
import { createP2012ReporterTimelineAdapter } from '../src/p2-012-reporter-timeline-adapter.mjs';
import { createP2016WeComSender } from '../src/p2-016-wecom-sender.mjs';
import { textHashP2016 } from '../src/p2-016-domain-contracts.mjs';
import { createCommunicationDeliveryWorker,createCommunicationReconciliationPort } from '../src/p2-004-communication-delivery-worker.mjs';
import { withP2012Database,applyThrough031,apply032Raw,fixtureP2012,assertNoP2012Residual } from './helpers/p2-012-postgres-harness.mjs';
const databaseUrl=process.env.PILOT_DATABASE_URL;
const make=(action,id,version='1',extra={})=>({action,client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED',
  ...(['START_REVIEW','REJECT_CANDIDATE','EXPIRE_CANDIDATE','CONFIRM_INCIDENT'].includes(action)?{candidate_review_id:id}:{incident_id:id}),
  ...(action==='CONFIRM_INCIDENT'?{expected_candidate_version:version}:{expected_row_version:version}),...extra});

test('P2-012 cross-channel same reporter, pending activation, pause, unlink and reporter-safe history',async()=>{
  await withP2012Database({databaseUrl,purpose:'p2012subs',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await apply032Raw(pool);
    const f=await fixtureP2012(pool,{reporters:2,sameReporter:true}),authContext={principal_id:f.admin.id};
    const query=createP2012IncidentQuery({pool,enabled:true}),notifications=createP2012NotificationPolicy({enabled:true,publicEnabled:true,privateEnabled:true});
    const service=createP2012IncidentCommandService({pool,enabled:true,notifications}),run=command=>service.perform({authContext,command});
    assert.equal(f.candidate.distinct_reporters,1);
    const c=await f.newCandidate();await run(make('START_REVIEW',c.id));
    const confirmed=await run(make('CONFIRM_INCIDENT',c.id,'2',{confirmed_scope:'BUILDING',owner_principal_id:f.admin.id,selected_report_refs:[f.reports[0].decisionId]}));
    assert.equal(confirmed.ok,true);const id=confirmed.result_ref_id;
    const sub=async()=>(await pool.query('SELECT * FROM incident.reporter_subscription WHERE incident_id=$1::uuid',[id])).rows[0];
    assert.equal((await sub()).status,'PENDING_DESTINATION');
    const current=async()=>(await query.detail({authContext,id})).row_version;
    assert.equal((await run(make('RESUME_SUBSCRIPTION',id,await current(),{subscription_id:(await sub()).id,expected_subscription_version:(await sub()).row_version}))).error.code,'P2_012_DIRECT_DESTINATION_REQUIRED');
    assert.equal((await run(make('RESUME_SUBSCRIPTION',id,await current(),{subscription_id:(await sub()).id,expected_subscription_version:(await sub()).row_version,direct_channel_leg_id:f.reports[1].legId}))).ok,true);
    assert.equal((await sub()).status,'ACTIVE');
    assert.equal((await run(make('LINK_REPORT',id,await current(),{source_decision_id:f.reports[1].decisionId}))).ok,true);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM incident.reporter_subscription')).rows[0].n,1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM incident.incident_report')).rows[0].n,2);
    assert.equal((await run(make('PAUSE_SUBSCRIPTION',id,await current(),{subscription_id:(await sub()).id,expected_subscription_version:(await sub()).row_version}))).ok,true);
    const messages=async()=>(await pool.query('SELECT count(*)::int AS n FROM communication.message')).rows[0].n;
    assert.equal(await messages(),1); // One group destination, no guessed direct destination at confirmation.
    assert.equal((await run(make('START_INVESTIGATING',id,await current()))).ok,true);assert.equal(await messages(),1);
    assert.equal((await run(make('RESUME_SUBSCRIPTION',id,await current(),{subscription_id:(await sub()).id,expected_subscription_version:(await sub()).row_version}))).ok,true);
    const timeline=createP2012ReporterTimelineAdapter({pool,enabled:true});
    const before=await timeline.milestones({ticketId:f.reports[0].ticketId});assert.equal(before.length,2);
    assert.equal(/synthetic-reporter|reporter_identity|reason_code|source_decision|subscription|owner_/u.test(JSON.stringify(before)),false);
    const oldRepresentative=(await sub()).representative_report_id;
    const r=(await query.children({authContext,id,part:'reports'})).items.find(r=>r.id===oldRepresentative);
    assert.equal((await run(make('UNLINK_REPORT',id,await current(),{incident_report_id:r.id,expected_report_version:r.row_version}))).ok,true);
    assert.notEqual((await sub()).representative_report_id,oldRepresentative);assert.equal((await sub()).status,'ACTIVE');
    assert.equal((await timeline.milestones({ticketId:r.ticket_id})).length,0);
    assert.equal((await run(make('LINK_REPORT',id,await current(),{source_decision_id:f.reports[0].decisionId}))).ok,true);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM incident.incident_report')).rows[0].n,2);
    assert.equal((await sub()).status,'ACTIVE');
    assert.equal((await timeline.milestones({ticketId:f.reports[0].ticketId})).length,2);
    assert.equal((await run(make('RESOLVE_INCIDENT',id,await current()))).ok,true);
    const notices=(await query.children({authContext,id,part:'notifications'})).items;
    assert.equal(notices.filter(n=>n.template_code==='INCIDENT_RESOLVED_DIRECT').length,1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM pilot_ticket.ticket WHERE status='QUEUED'")).rows[0].n,2);
  }});await assertNoP2012Residual({databaseUrl});
});

test('P2-012 fixed notices reuse sender, restart persistence, explicit UNKNOWN reconciliation and no blind resend',async()=>{
  await withP2012Database({databaseUrl,purpose:'p2012sender',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await apply032Raw(pool);
    const f=await fixtureP2012(pool,{reporters:2}),authContext={principal_id:f.admin.id};
    const policy=createP2012NotificationPolicy({enabled:true,publicEnabled:true,privateEnabled:true,testLabel:true});
    const service=createP2012IncidentCommandService({pool,enabled:true,notifications:policy});
    const c=await f.newCandidate();await service.perform({authContext,command:make('START_REVIEW',c.id)});
    const command=make('CONFIRM_INCIDENT',c.id,'2',{confirmed_scope:'LOCAL',owner_principal_id:f.admin.id,selected_report_refs:f.reports.map(r=>r.decisionId)});
    const result=await service.perform({authContext,command});assert.equal(result.ok,true);
    let calls=0;const bodies=[];
    const sender=createP2016WeComSender({gateway:{getAuthenticatedClient:()=>({sendMessage:async(target,body)=>{calls++;bodies.push(body);return calls===1?{}:{errcode:0,headers:{req_id:'synthetic'}};}})},enabled:true,cardEnabled:false,
      allowedTargetHashes:['synthetic-incident-group','synthetic-reporter-1'].map(textHashP2016)});
    const ids=(await pool.query('SELECT id FROM communication.delivery ORDER BY id')).rows.map(r=>r.id);assert.equal(ids.length,2);
    let worker=createCommunicationDeliveryWorker({pool,sender,enabled:true});
    assert.equal((await worker.deliver({deliveryId:ids[0]})).status,'RECONCILIATION_REQUIRED');
    worker=createCommunicationDeliveryWorker({pool,sender,enabled:true});
    assert.equal(await worker.deliver({deliveryId:ids[0]}),null);assert.equal(calls,1);
    assert.equal((await worker.deliver({deliveryId:ids[1]})).status,'SENT');
    assert.ok(bodies.every(b=>b.msgtype==='markdown'&&b.markdown.content.startsWith('【P2-012测试】')));
    assert.equal(/synthetic-reporter|synthetic-incident-group|patient|source_decision|reason_code|owner_|DIRECT_DESTINATION/u.test(JSON.stringify(bodies)),false);
    const reconciliation=createCommunicationReconciliationPort({pool});
    const refused=await reconciliation.reconcileUnknownDelivery({deliveryId:ids[0],expectedStatus:'RECONCILIATION_REQUIRED',resolution:'CONFIRMED_SENT',reasonCode:'SYNTHETIC_CLIENT_CONFIRMED',authorized:false});
    assert.equal(refused.ok,false);
    await reconciliation.reconcileUnknownDelivery({deliveryId:ids[0],expectedStatus:'RECONCILIATION_REQUIRED',resolution:'CONFIRMED_SENT',reasonCode:'SYNTHETIC_CLIENT_CONFIRMED',authorized:true});
    assert.equal(await worker.deliver({deliveryId:ids[0]}),null);assert.equal(calls,2);
    const restarted=createP2012IncidentCommandService({pool,enabled:true,notifications:policy});
    assert.equal((await restarted.perform({authContext,command})).replayed,true);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM communication.delivery')).rows[0].n,2);
  }});await assertNoP2012Residual({databaseUrl});
});
