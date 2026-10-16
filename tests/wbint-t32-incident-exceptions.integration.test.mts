import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT32Fixture,t32Record,t32Text} from './helpers/t32-notification-exception-fixture.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';
import {createCommunicationSenderPort} from '../src/p2-004-communication-sender-port.mjs';
import {createIncidentPublicProgressAdmission} from '../src/p2-012-public-progress-admission.mjs';

test('T32 Incident exception rows preserve lifecycle and public purpose boundaries before pagination',{timeout:240000},async()=>{
  await withT32Fixture(async f=>{
    const incidentId=await f.confirm('CAMPUS'),path='/api/incidents/'+incidentId,secret='T32_PRIVATE_INCIDENT_CANARY';
    assert.equal((await f.post(path+'/internal-notes',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'WORKBENCH_INTERNAL_DISPOSITION',audience:'INTERNAL',text:secret})).status,200);
    const summary='合成明确公开进展：正在定位服务故障。';
    const publication=await f.post(path+'/publish-update',{client_command_id:randomUUID(),expected_row_version:'2',reason_code:'WORKBENCH_PUBLIC_PROGRESS',summary,preview_confirmed:true});assert.equal(publication.status,200,JSON.stringify(publication.body));
    const facts=(await f.pool.query<{id:string;template:string}>(`SELECT d.id::text,b.template_code AS template FROM communication.incident_notification_binding b JOIN communication.outbox o ON o.message_id=b.communication_message_id JOIN communication.delivery d ON d.outbox_id=o.id WHERE b.incident_id=$1::uuid ORDER BY d.id`,[incidentId])).rows;
    assert.ok(facts.some(r=>r.template==='INCIDENT_PUBLIC_PROGRESS_DIRECT'));assert.ok(facts.some(r=>r.template!=='INCIDENT_PUBLIC_PROGRESS_DIRECT'));
    let calls=0;const worker=createCommunicationDeliveryWorker({pool:f.pool,enabled:true,attemptAdmission:createIncidentPublicProgressAdmission({enabled:true}),sender:createCommunicationSenderPort(()=>{calls++;return {outcome:calls%2?'REJECTED_NOT_APPLIED':'UNKNOWN',provider_message_id:null,error_code:'T32_PROVIDER_PRIVATE_CANARY',retryable:false};})});
    for(const fact of facts)assert.ok(await worker.deliver({deliveryId:fact.id}));
    assert.equal(calls,facts.length);
    const response=await f.get('/api/notification-exceptions?domain=INCIDENT');assert.equal(response.status,200);assert.ok(Array.isArray(response.body.items));
    assert.equal(response.body.items.length,facts.length,'real Incident bindings must enter the authorized exceptions page');
    const rows=response.body.items.map(t32Record),publicRows=rows.filter(r=>r.source_kind==='INCIDENT_PUBLIC_PROGRESS'),legacy=rows.filter(r=>r.source_kind==='INCIDENT_LIFECYCLE');assert.ok(publicRows.length&&legacy.length);
    assert.ok(legacy.some(r=>r.route_kind==='GROUP'));for(const row of publicRows){assert.equal(row.route_kind,'BOT_DIRECT');assert.equal(row.destination_type,'PERSON');assert.equal(row.safe_summary,summary);}
    for(const row of rows){assert.equal(row.parent_id,incidentId);assert.deepEqual(row.allowed_actions,[],'T32 does not add Incident retry/reconcile');assert.equal((await f.get('/api/notification-exceptions/incident/'+incidentId+'/'+t32Text(row.delivery_id))).status,200);}
    assert.equal((await f.get(path,1)).status,200,'linked Ticket team READ remains valid');assert.equal((await f.get(path+'/notifications',1)).status,403);
    assert.deepEqual((await f.get('/api/notification-exceptions?domain=INCIDENT&limit=1',1)).body,{items:[],has_more:false,next_cursor:null},'Ticket/Incident VIEW cannot reveal notification counts');
    assert.equal((await f.get('/api/notification-exceptions/incident/'+incidentId+'/'+t32Text(publicRows[0]?.delivery_id),1)).status,404);
    assert.equal((await f.get(path+'/public-progress',3)).status,403,'Dispatcher current CAMPUS publication scope is rejected');
    const dispatcher=await f.get('/api/notification-exceptions?domain=INCIDENT',3);assert.ok(Array.isArray(dispatcher.body.items));assert.equal(dispatcher.body.items.length,legacy.length);assert.ok(dispatcher.body.items.map(t32Record).every(r=>r.source_kind==='INCIDENT_LIFECYCLE'));
    assert.equal((await f.get('/api/notification-exceptions/incident/'+incidentId+'/'+t32Text(publicRows[0]?.delivery_id),3)).status,404);
    assert.equal(/T32_PRIVATE_INCIDENT_CANARY|T32_PROVIDER_PRIVATE_CANARY|reporter_identity|target_id|target_hash|recipient|provider_message/u.test(JSON.stringify(response.body)),false);
    assert.equal(calls,facts.length,'queue reads create no additional external side effect');
  });
});
