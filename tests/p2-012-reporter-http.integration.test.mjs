import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { appendTicketEvent } from '../src/p1-006-ticket-state-actions.mjs';
import { createP2012Runtime } from '../src/p2-012-workbench-assembly.mjs';
import { transaction } from '../src/p2-012-domain-contracts.mjs';
import { migrateP2012 } from '../scripts/p2-012-migrate.mjs';
import { assertP2016Schema } from './helpers/p2-016-schema-assert.mjs';
import { withP2012Database,applyThrough031,fixtureP2012,assertNoP2012Residual } from './helpers/p2-012-postgres-harness.mjs';

test('P2-012 Reporter HTTP preserves bound grants, refresh ETag, safe milestones and unlink visibility',async()=>{
  const databaseUrl=process.env.PILOT_DATABASE_URL;
  await withP2012Database({databaseUrl,purpose:'p2012report',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});const f=await fixtureP2012(pool,{reporters:2});
    const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const listenPort=probe.address().port;await new Promise(r=>probe.close(r));const origin='http://127.0.0.1:'+listenPort;
    const runtime=createP2012Runtime({pool,principalId:f.admin.id,publicOrigin:origin,listenPort,reporterHmacSecret:'synthetic-only-report-session-hmac-at-least32',allowLocalHttp:true,
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true,REPORTER_TIMELINE_ENABLED:true,WECOM_TEMPLATE_CARD_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true}});
    try{
      await runtime.start();const ticket=(await pool.query('SELECT * FROM pilot_ticket.ticket WHERE id=$1::uuid',[f.reports[1].ticketId])).rows[0];
      const notice=await transaction(pool,async tx=>{const event=await appendTicketEvent({transaction:tx,ticket,eventType:'ticket.created',actor:{type:'SYSTEM',id:null},traceId:'synthetic-p2012-reporter'});return runtime.notifications.project({transaction:tx,ticket,event});});
      const grant=await runtime.reporterAccess.deliveryGrant({deliveryId:notice.delivery_id});
      const exchanged=await fetch(origin+'/api/reporter/access/exchange',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.token})});assert.equal(exchanged.status,200);
      const cookie=exchanged.headers.get('set-cookie').split(';')[0],ref=(await exchanged.json()).public_ref,path='/api/reporter/tickets/'+ref;
      const get=(p=path,headers={})=>fetch(origin+p,{headers:{cookie,...headers}});
      assert.equal((await fetch(origin+path)).status,401);assert.equal((await get('/api/reporter/tickets/'+'A'.repeat(32))).status,401);
      assert.equal((await get(path+'?ticket_id='+ticket.id)).status,401);assert.equal((await get('/api/incidents')).status,401);
      const initial=await get(),etag=initial.headers.get('etag');assert.deepEqual((await initial.json()).incident_milestones,[]);assert.equal((await get(path,{'if-none-match':etag})).status,304);
      const candidate=await f.newCandidate(),authContext={principal_id:f.admin.id},service=runtime.incidentExtension.commands;
      await service.perform({authContext,command:{action:'START_REVIEW',candidate_review_id:candidate.id,expected_row_version:'1',client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED'}});
      const confirmed=await service.perform({authContext,command:{action:'CONFIRM_INCIDENT',candidate_review_id:candidate.id,expected_candidate_version:'2',client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED',confirmed_scope:'LOCAL',owner_principal_id:f.admin.id,selected_report_refs:[f.reports[1].decisionId]}});assert.equal(confirmed.ok,true);
      const changed=await get(path,{'if-none-match':etag});assert.equal(changed.status,200);const body=await changed.json();await assertP2016Schema('p2_016_reporter_ticket_view',body);assert.equal(body.incident_milestones.length,1);
      for(const forbidden of [ticket.id,candidate.id,'reporter_identity_hash','subscription_id','owner_principal_id','reason_code','source_decision_id','synthetic-reporter'])assert.equal(JSON.stringify(body).includes(forbidden),false);
      const report=(await runtime.incidentExtension.query.children({authContext,id:confirmed.result_ref_id,part:'reports'})).items[0];
      const unlinked=await service.perform({authContext,command:{action:'UNLINK_REPORT',incident_id:confirmed.result_ref_id,expected_row_version:'1',incident_report_id:report.id,expected_report_version:report.row_version,client_command_id:randomUUID(),reason_code:'INCORRECT_ASSOCIATION'}});assert.equal(unlinked.ok,true);
      const removed=await get(path,{'if-none-match':changed.headers.get('etag')});assert.equal(removed.status,200);assert.deepEqual((await removed.json()).incident_milestones,[]);
      assert.equal((await pool.query('SELECT status FROM pilot_ticket.ticket WHERE id=$1::uuid',[ticket.id])).rows[0].status,'QUEUED');
    }finally{await runtime.stop();}assert.equal(runtime.server.listening,false);
  }});await assertNoP2012Residual({databaseUrl});
});
