import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeG2SendBudget, openG2SendBudget } from '../src/p2-g2-send-budget.mjs';
import { withP2012Database, applyThrough031, assertNoP2012Residual } from './helpers/p2-012-postgres-harness.mjs';
import { migrateP2012 } from '../scripts/p2-012-migrate.mjs';
import { createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { configurationFixture } from './helpers/p2-g2-configuration-fixture.mjs';
import { g2CandidateInventory, G2_ROOT } from '../src/p2-g2-candidate.mjs';
import { createG2ResourceSampler } from '../src/p2-g2-resource-sampler.mjs';
import { g2DatabaseIdentity, g2Hash } from '../src/p2-g2-validation-config.mjs';
import { createG2ProcessCluster } from '../src/p2-g2-service-loop-assembly.mjs';
import { readG2ProviderReceipts } from '../src/p2-g2-provider-receipts.mjs';
import { writeG2StartupEvidence, verifyG2LiveSource } from '../src/p2-g2-live-evidence.mjs';
import { readG2Evidence } from '../src/p2-g2-evidence.mjs';
import { createG2ControlRecorder } from '../src/p2-g2-control-evidence.mjs';
import { launchSystemBrowser,closeBrowserTestResources } from './helpers/p2-006-browser-harness.mjs';

const until = async check => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await new Promise(r => setTimeout(r, 100)); }
  throw Error('P2_G2_SYNTHETIC_WAIT_TIMEOUT');
};
test('P2-G2 uses three real processes, isolated PostgreSQL, actual HTTP/browser, minimal environment and a synthetic SDK', { timeout: 120000 }, async t => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  try { await withP2012Database({ databaseUrl, purpose: 'g2process', max: 1, run: async ({ pool, databaseUrl: isolated }) => {
    await applyThrough031({ pool, databaseUrl: isolated }); await migrateP2012({ databaseUrl: isolated });
    const access = createPilotAccessService({ pool }), principals = [];
    for (const [index, role] of ['ADMIN', 'DISPATCHER', 'HANDLER'].entries()) principals.push(await access.upsertPrincipal({
      wecomUserId: 'synthetic-g2-process-agent-' + index, displayName: '合成G2坐席' + index, roles: [role], resolverTeamIds: ['PILOT_IT'] }));
    const reservation = createServer(); await new Promise(r => reservation.listen(0, '127.0.0.1', r));
    const port = reservation.address().port; await new Promise(r => reservation.close(r));
    const { manifest, env } = configurationFixture();
    const webhookUrl='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=synthetic-process-unused';
    manifest.scope.group_webhook_routes=[{group_hash:g2Hash('synthetic-g2-group'),endpoint_hash:g2Hash(webhookUrl)}];
    env.P2_G2_GROUP_WEBHOOK_ROUTES=JSON.stringify([{group_id:'synthetic-g2-group',url:webhookUrl}]);
    env.PILOT_DATABASE_URL = isolated;
    manifest.listen_port = port; manifest.reporter_origin = 'http://127.0.0.1:' + port;
    manifest.scope.database_identity_hash = g2DatabaseIdentity(isolated).fingerprint;
    manifest.scope.principal_ids = principals.map(p => p.id);
    manifest.scope.approved_inputs.push('眼科多个诊室都打不开工作站。');
    manifest.scope.approved_inputs.push('另外一个故障：测试诊室断网。');
    manifest.approval.valid_from_epoch_ms = String(Date.now() - 1000);
    manifest.approval.expires_epoch_ms = String(Date.now() + 3600000);
    manifest.candidate_fingerprint = g2CandidateInventory().fingerprint;
    const budgetDirectory = mkdtempSync(path.join(tmpdir(), 'g2-process-budget-'));
    t.after(() => rmSync(budgetDirectory, { recursive: true, force: true }));
    const budgetFile = path.join(budgetDirectory, 'budget.jsonl');
    initializeG2SendBudget({ file: budgetFile, manifest });
    const people = ['reporter-a', 'reporter-b', 'reporter-c'];
    const cluster = createG2ProcessCluster({ manifest, budgetFile, env: { ...env, OPENAI_API_KEY: 'must-not-inherit',
      P2_012_REAL_WECOM_SEND_APPROVED: 'true', NODE_OPTIONS: '--expose-gc' } });
    for (const name of ['controlledRequest', 'controlledStopRole', 'controlledRestartRole', 'disconnectGateway'])
      assert.equal(Object.hasOwn(cluster, name), false, 'Gate facade must not expose fault controls without the approved scenario');
    assert.throws(() => cluster.stopRoleForFault('GATEWAY', 'G2-F02'), { code: 'P2_G2_FAULT_NOT_APPROVED' });
    let browser,sampler,controls,primaryError=null;
    const frame = (text, person, chatType = 'group') => ({ cmd: 'aibot_msg_callback', headers: { req_id: randomUUID() }, body: {
      msgid: randomUUID(), aibotid: env.WECOM_BOT_ID, chattype: chatType,
      ...(chatType === 'group' ? { chatid: 'synthetic-g2-group' } : {}), from: { userid: person },
      msgtype: 'text', text: { content: '【p2-g2测试】' + text },
    } });
    try {
      const started = await cluster.start(); assert.equal(started.process_count, 3);
      const competing = createG2ProcessCluster({ manifest, budgetFile, env });
      await assert.rejects(competing.start(), { code: 'P2_G2_COMPETING_CONTROLLER' });
      assert.equal(competing.status().process_count, 0);
      const metrics = await cluster.metrics();
      assert.equal(metrics.app_pool_max, 4); assert.equal(metrics.worker_pool_max, 2); assert.equal(metrics.gateway_pool_max, 1);
      assert.equal(metrics.rule_worker_ready, 1);
      const environment = await cluster.syntheticEnvironment();
      assert.equal(environment.model_environment_keys, 0); assert.equal(environment.old_approval_keys, 0); assert.equal(environment.expose_gc, false);
      assert.equal(environment.model_network_unreachable,true);assert.equal(environment.blocked_model_http_probes,6);
      const resourceDirectory=mkdtempSync(path.join(G2_ROOT,'tmp','p2-g2-resource-preview-'));
      t.after(()=>{const relative=path.relative(path.join(G2_ROOT,'tmp'),path.resolve(resourceDirectory));
        assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));rmSync(resourceDirectory,{recursive:true,force:true});});
      const startup=writeG2StartupEvidence({manifest,directory:resourceDirectory,ready:started,environment,
        host:{host_cpu_count:8,host_memory_bytes:16*1024**3,postgres_rss_bytes:null,proxy_rss_bytes:null}});
      assert.equal(startup.start.result,'PASS');assert.equal(startup.environment.result,'INCOMPLETE','development host cannot establish formal 2C4G');
      controls=createG2ControlRecorder({file:path.join(resourceDirectory,'control-sources.jsonl'),manifest});
      for(const record of readG2Evidence(path.join(resourceDirectory,'startup-evidence.jsonl')))
        for(const source of record.source_refs)assert.equal(verifyG2LiveSource(source,record,manifest),true);
      sampler=createG2ResourceSampler({cluster,manifest,directory:resourceDirectory});
      const preview=await sampler.sample();
      assert.equal(preview.record.evidence_type,'SYNTHETIC_PROCESS_BROWSER');assert.equal(preview.complete,false);
      assert.equal(preview.record.details.natural_gc,true);assert.equal(preview.record.details.interrupted,false);
      assert.equal(verifyG2LiveSource(preview.record.source_refs[0],preview.record,manifest),true);
      assert.equal(verifyG2LiveSource(preview.record.source_refs[0],{...preview.record,result:'PASS'},manifest),false);
      assert.ok(preview.unavailable_metrics.includes('user_visible_latency_p95_ms'));
      await cluster.submitSyntheticFrame(frame('@测试助手', people[0]));
      await until(async () => (await pool.query("SELECT count(*)::integer AS n FROM intake.deterministic_decision WHERE result_code='NEEDS_DESCRIPTION'")).rows[0].n === 1);
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM communication.delivery WHERE target_type='PERSON'")).rows[0].n, 0);
      await cluster.submitSyntheticFrame(frame('处方提交不了', people[2], 'single'));
      await until(async () => (await pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n === 1);
      const origin = started.origin, cookie = started.cookies[0];
      browser = await launchSystemBrowser({ url: origin + '/workbench/lifecycle', width: 1366, height: 768, cookies: [cookie] });
      await browser.waitFor("document.body.textContent.includes('工单')");
      const organic = (await pool.query(`SELECT j.entry_mode,l.leg_type FROM intake.contact_journey j JOIN intake.channel_leg l ON l.journey_id=j.id
        JOIN intake.service_intake i ON i.id=l.source_intake_id WHERE i.reporter_wecom_userid=$1`, [people[2]])).rows;
      assert.deepEqual(organic, [{ entry_mode: 'DIRECT_ORGANIC', leg_type: 'DIRECT_ORGANIC' }]);
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM intake.service_intake WHERE reporter_wecom_userid=$1 AND source_chat_type='group'", [people[2]])).rows[0].n, 0);
      await until(async () => (await pool.query("SELECT count(*)::integer AS n FROM communication.delivery WHERE status='SENT'")).rows[0].n >= 1);
      const sdk = await cluster.syntheticProviderCounts(); assert.ok(sdk.calls >= 1); assert.equal(sdk.model_provider_calls, 0);
      const wssReceipts=readG2ProviderReceipts({file:path.join(budgetDirectory,'provider-receipts.jsonl'),manifest});
      assert.ok(wssReceipts.length>=1);
      for(const {record} of wssReceipts){
        assert.equal(record.provider_errcode,0);assert.equal(record.outcome,'ACKED');
        const actual=(await pool.query('SELECT id::text,attempt_count FROM communication.delivery WHERE outbox_id=$1::uuid',[record.outbox_id])).rows;
        assert.ok(actual.some(row=>g2Hash(row.id)===record.delivery_ref_hash&&row.attempt_count===record.attempt_no));
      }
      assert.ok(openG2SendBudget({ file: budgetFile, manifest }).counts().total >= sdk.calls);
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM communication.message m JOIN communication.outbox o ON o.message_id=m.id JOIN communication.delivery d ON d.outbox_id=o.id WHERE d.target_type='GROUP' AND m.content->>'text' NOT LIKE '【p2-g2测试】%'")).rows[0].n, 0);
      await cluster.stopRoleForFault('WORKER', 'G2-F02');
      const faultSample=await sampler.sample({phase:'FAULT',faultId:'G2-F02'});
      assert.equal(faultSample.record.details.metrics.process_count,2);
      assert.equal(faultSample.record.details.metrics.worker_rss_bytes,null);
      assert.equal(faultSample.record.details.interrupted,false);assert.equal(faultSample.record.details.natural_gc,true);
      const waiting = frame('处方提交不了', people[1], 'single');
      assert.equal((await cluster.submitSyntheticFrame(waiting)).p1_committed, true);
      await new Promise(r => setTimeout(r, 600));
      assert.equal((await pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n, 1);
      assert.equal((await fetch(origin + '/health/ready')).status, 503);
      await cluster.restartRoleForFault('WORKER', 'G2-F02');
      await until(async () => (await pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n === 2);
      const disconnectedAt=String(Date.now());await cluster.disconnectGatewayForFault('G2-F01');
      await until(async()=>cluster.status().gateway_authenticated===false);
      const off=controls.append({scenario_id:'G2-F01',role:'GATEWAY',action:'disconnect',started_physical_epoch_ms:disconnectedAt,state:cluster.status()});
      const beforeReconnectCalls=(await cluster.syntheticProviderCounts()).calls;
      assert.equal((await fetch(origin+'/health/ready')).status,503,'Gateway loss remains visible in service readiness');
      const disconnectedTicket=(await pool.query(`SELECT t.id FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.id=t.source_intake_id
        WHERE i.reporter_wecom_userid=$1`,[people[1]])).rows[0];
      await browser.evaluate(`location.hash=${JSON.stringify('queue=queued&selected='+disconnectedTicket.id)};location.reload()`,{awaitPromise:false});
      await browser.waitFor("Array.from(document.querySelectorAll('#lc-detail button')).some(b=>b.textContent==='接单')");
      await browser.evaluate("Array.from(document.querySelectorAll('#lc-detail button')).find(b=>b.textContent==='接单').click()");
      await browser.waitFor("document.querySelector('#lc-detail form button')?.textContent==='确认：接单'");
      await browser.evaluate("document.querySelector('#lc-detail form button').click()");
      await browser.waitFor("document.querySelector('.detail-header .badge')?.textContent==='已接单'");
      await browser.waitFor("document.querySelector('#lc-detail .delivery')?.textContent.includes('待处理')");
      await until(async()=>(await pool.query(`SELECT count(*)::integer AS n FROM communication.delivery_attempt a
        JOIN communication.ticket_notification_binding b ON b.delivery_id=a.delivery_id WHERE b.ticket_id=$1
        AND b.notification_type='TICKET_ACCEPTED' AND a.outcome='RETRY_SCHEDULED' AND a.error_code='GATEWAY_UNAVAILABLE'`,[disconnectedTicket.id])).rows[0].n>0);
      assert.equal((await cluster.syntheticProviderCounts()).calls,beforeReconnectCalls,'no SDK call while disconnected');
      assert.equal((await pool.query(`SELECT d.status FROM communication.ticket_notification_binding b JOIN communication.delivery d ON d.id=b.delivery_id
        WHERE b.ticket_id=$1 AND b.notification_type='TICKET_ACCEPTED'`,[disconnectedTicket.id])).rows[0].status,'PENDING');
      const reconnectAt=String(Date.now());await cluster.reconnectGatewayForFault('G2-F01');
      await until(async()=>cluster.status().gateway_authenticated===true&&(await fetch(origin+'/health/ready')).status===200);
      const on=controls.append({scenario_id:'G2-F01',role:'GATEWAY',action:'reconnect',started_physical_epoch_ms:reconnectAt,state:cluster.status()});
      await browser.waitFor("document.querySelector('#lc-detail .delivery')?.textContent.includes('已发送')");
      assert.equal((await cluster.syntheticProviderCounts()).calls,beforeReconnectCalls+1);
      const acceptedOnce=(await pool.query(`SELECT count(*)::integer AS n FROM communication.ticket_notification_binding
        WHERE ticket_id=$1 AND notification_type='TICKET_ACCEPTED'`,[disconnectedTicket.id])).rows[0].n;
      assert.equal(acceptedOnce,1);
      const reconciliation=await cluster.captureReconciliation(),acceptedDelivery=reconciliation.deliveries.find(d=>d.ticket_id===disconnectedTicket.id&&d.notification_type==='TICKET_ACCEPTED');
      assert.ok(acceptedDelivery);assert.equal(acceptedDelivery.destination_eligible_at_reconciliation,true);
      assert.ok(reconciliation.attempts.some(a=>a.delivery_ref_hash===acceptedDelivery.delivery_ref_hash&&a.outcome==='RETRY_SCHEDULED'
        &&['GATEWAY_UNAVAILABLE','GATEWAY_UNAVAILABLE_BEFORE_SEND'].includes(a.error_code)&&BigInt(a.started_epoch_ms)>=BigInt(disconnectedAt)&&BigInt(a.started_epoch_ms)<=BigInt(on.physical_epoch_ms)));
      assert.equal(off.gateway_authenticated,false);assert.equal(on.gateway_authenticated,true);
      await cluster.submitSyntheticFrame(waiting);
      assert.equal((await pool.query('SELECT count(*)::integer AS n FROM channel.message_inbox WHERE msg_id=$1', [waiting.body.msgid])).rows[0].n, 1);
      assert.equal((await pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n, 2);
      assert.equal((await cluster.syntheticProviderCounts()).calls,beforeReconnectCalls+1,'replayed inbound does not resend the accepted notification');
      t.diagnostic(JSON.stringify({scenario_id:'G2-F01',surface:'ACTUAL_GATEWAY_DISCONNECT_WORKER_RECOVERY_BROWSER_AND_POSTGRES_MOCK_SDK',
        persisted_ticket_action_committed_while_disconnected:true,ui_pending_then_sent:true,additional_sdk_calls:1,accepted_notification_bindings:acceptedOnce}));
      await cluster.submitSyntheticFrame(frame('眼科多个诊室都打不开工作站。', people[2]));
      const candidate = await until(async () => (await pool.query('SELECT id FROM incident.candidate_review LIMIT 1')).rows[0]);
      await until(async () => (await pool.query("SELECT count(*)::integer AS n FROM communication.delivery WHERE status IN ('PENDING','LEASED','SENDING')")).rows[0].n === 0);
      const deliveryCount = (await pool.query('SELECT count(*)::integer AS n FROM communication.delivery')).rows[0].n;
      await cluster.stopRoleForFault('WORKER', 'G2-F02');
      // SYNTHETIC_FAULT only: shorten this owned candidate's expiry. This does
      // not count as a normal recognition or as elapsed real observation time.
      await pool.query(`WITH clock AS (SELECT platform.physical_epoch_ms()-1000 AS expiry)
        UPDATE incident.candidate_review SET created_at=platform.local_now()-interval '2 days',
        expires_epoch_ms=clock.expiry,expires_at=platform.local_from_epoch_ms(clock.expiry)
        FROM clock WHERE id=$1`, [candidate.id]);
      await new Promise(r => setTimeout(r, 750));
      assert.equal((await pool.query('SELECT status FROM incident.candidate_review WHERE id=$1', [candidate.id])).rows[0].status,
        'CANDIDATE', 'App must not secretly replace the unavailable rule/maintenance Worker');
      await cluster.restartRoleForFault('WORKER', 'G2-F02');
      await until(async () => (await pool.query('SELECT status FROM incident.candidate_review WHERE id=$1', [candidate.id])).rows[0].status === 'EXPIRED');
      assert.equal((await pool.query('SELECT count(*)::integer AS n FROM communication.delivery')).rows[0].n, deliveryCount);
      await cluster.submitSyntheticFrame(frame('处方提交不了',people[0]));
      const groupTicket=await until(async()=>(await pool.query(`SELECT t.id FROM pilot_ticket.ticket t
        JOIN intake.service_intake i ON i.id=t.source_intake_id WHERE i.reporter_wecom_userid=$1 AND i.source_chat_type='group'`,[people[0]])).rows[0]);
      const headers={cookie:cookie.name+'='+cookie.value,origin};
      const bootstrap=await (await fetch(origin+'/api/lifecycle/bootstrap',{headers})).json();
      for(const action of ['accept','start','resolve','confirm']){
        const detail=await(await fetch(origin+'/api/tickets/'+groupTicket.id,{headers})).json();
        const command={client_command_id:randomUUID(),expected_version:detail.version,reason_code:'OPERATOR_REVIEWED',note:'合成处理记录'};
        const response=await fetch(origin+'/api/tickets/'+groupTicket.id+'/'+action,{method:'POST',headers:{...headers,
          'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'if-match':'"'+detail.version+'"','idempotency-key':command.client_command_id},body:JSON.stringify(command)});
        assert.equal(response.status,200,await response.text());
      }
      await until(async()=>(await pool.query(`SELECT d.status FROM communication.ticket_notification_binding b
        JOIN communication.delivery d ON d.id=b.delivery_id WHERE b.ticket_id=$1 AND b.notification_type='TICKET_CLOSED'`,[groupTicket.id])).rows[0]?.status==='SENT');
      const receiptText=readFileSync(path.join(budgetDirectory,'webhook-receipts.jsonl'),'utf8'),receipts=receiptText.trim().split('\n').map(JSON.parse);
      assert.equal(receipts.length,1);assert.equal(receipts[0].record.provider_errcode,0);assert.equal(receipts[0].record.outcome,'ACKED');
      assert.doesNotMatch(receiptText,/synthetic-process-unused|reporter-a|qyapi/u);
      t.diagnostic(JSON.stringify({group_closure_surface:'REAL_THREE_PROCESS_HTTP_OUTBOX_MOCK_WEBHOOK',provider_receipt:receipts[0],receipt_sha256:g2Hash(receiptText)}));
      const postActual=async(path,body)=>{
        const command={client_command_id:randomUUID(),...body},version=command.expected_candidate_version??command.expected_row_version;
        const response=await fetch(origin+path,{method:'POST',headers:{...headers,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,
          'if-match':'"'+version+'"','idempotency-key':command.client_command_id},body:JSON.stringify(command)});
        const result=await response.json();assert.ok([200,202].includes(response.status),JSON.stringify({status:response.status,error:result.error}));return result;
      };
      const humanSession=(await pool.query(`SELECT l.conversation_session_id AS id FROM intake.channel_leg l JOIN intake.service_intake i ON i.id=l.source_intake_id
        WHERE i.reporter_wecom_userid=$1 AND l.leg_type IN ('DIRECT_ORGANIC','DIRECT_GUIDED') ORDER BY l.created_at DESC,l.id LIMIT 1`,[people[2]])).rows[0];
      const conversationResponse=await fetch(origin+'/api/conversations/'+humanSession.id,{headers});
      let conversation=await conversationResponse.json();
      assert.equal(conversationResponse.status,200,JSON.stringify({error:conversation.error,leg_session_linked:Boolean(humanSession.id),keys:Object.keys(conversation)}));
      await postActual('/api/conversations/'+humanSession.id+'/takeover',{expected_row_version:conversation.session.row_version,
        target_principal_id:principals[0].id,reason_code:'WORKBENCH_TAKEOVER'});
      conversation=await(await fetch(origin+'/api/conversations/'+humanSession.id,{headers})).json();
      await postActual('/api/conversations/'+humanSession.id+'/messages',{expected_row_version:conversation.session.row_version,text:manifest.scope.approved_replies[0]});
      await until(async()=>(await pool.query(`SELECT count(*)::integer AS n FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id
        JOIN communication.message m ON m.id=o.message_id WHERE m.purpose='HUMAN_REPLY' AND m.sender_kind='AGENT' AND d.status='SENT'`)).rows[0].n===1);
      const newFaultFrames=people.map(person=>frame('另外一个故障：测试诊室断网。',person,'single'));
      for(const input of newFaultFrames)await cluster.submitSyntheticFrame(input);
      const normalDecisions=await until(async()=>{
        const rows=(await pool.query(`SELECT d.id::text FROM intake.deterministic_decision d JOIN intake.service_intake i ON i.id=d.service_intake_id
          JOIN channel.message_inbox m ON m.id=i.primary_message_id WHERE m.msg_id=ANY($1::text[]) AND d.engine_version='p2-007-adapter/1.0.0' ORDER BY d.id`,[newFaultFrames.map(input=>input.body.msgid)])).rows;
        return rows.length===3?rows.map(r=>r.id):null;
      });
      const normalCandidate=await until(async()=>(await pool.query(`SELECT c.id FROM incident.candidate_review c JOIN intake.deterministic_decision source ON source.id=c.source_decision_id
        WHERE c.status='CANDIDATE' AND source.safe_result->'incident_report_decision_ids' @> $1::jsonb
          AND jsonb_array_length(source.safe_result->'incident_report_decision_ids')=3 ORDER BY c.created_at DESC,c.id LIMIT 1`,[JSON.stringify(normalDecisions)])).rows[0]);
      const normalDetail=await(await fetch(origin+'/api/incident-candidates/'+normalCandidate.id,{headers})).json();
      assert.equal(normalDetail.report_sources.length,3);
      assert.deepEqual(normalDetail.report_sources.map(r=>r.source_decision_id).sort(),[...normalDecisions].sort());
      await postActual('/api/incident-candidates/'+normalCandidate.id+'/start-review',{expected_row_version:normalDetail.row_version,reason_code:'OPERATOR_REVIEWED'});
      await postActual('/api/incident-candidates/'+normalCandidate.id+'/confirm',{expected_candidate_version:'2',confirmed_scope:'LOCAL',owner_principal_id:principals[0].id,
        selected_report_refs:normalDetail.report_sources.map(r=>r.source_decision_id),reason_code:'OPERATOR_REVIEWED'});
      try{await until(async()=>(await pool.query(`SELECT count(*)::integer AS n FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id
        JOIN communication.message m ON m.id=o.message_id WHERE m.sender_system_code='HUMAN_CONFIRMED_INCIDENT' AND d.status='SENT' AND d.target_type='PERSON'`)).rows[0].n===3);}
      catch(error){t.diagnostic(JSON.stringify({incident_delivery_diagnostic:(await pool.query(`SELECT d.status,d.target_type,d.last_error_code,m.sender_system_code
        FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id JOIN communication.message m ON m.id=o.message_id
        WHERE m.sender_system_code='HUMAN_CONFIRMED_INCIDENT'`)).rows,
        subscription_states:(await pool.query('SELECT status,direct_channel_leg_id IS NOT NULL AS has_direct FROM incident.reporter_subscription')).rows}));throw error;}
      const complete=await cluster.captureReconciliation();assert.equal(complete.counts.out_of_scope_deliveries,0);assert.equal(complete.counts.internal_note_leaks,0);
      t.diagnostic(JSON.stringify({scenario_id:'G2-N01',surface:'ACTUAL_THREE_ROLE_GUARD_AND_PROVIDER_RECEIPT',
        fixed_guidance_sent:true,ticket_notification_sent:true,human_reply_sent:1,incident_direct_notices_sent:3,normal_incident_reporters:3}));
    } catch(error){primaryError=error;} finally { await closeBrowserTestResources([()=>sampler?.close(),()=>controls?.close(),()=>browser?.close(),async()=>assert.equal((await cluster.stop()).process_count,0)],primaryError); }
    const stale = createG2ProcessCluster({ manifest, budgetFile, env });
    await assert.rejects(stale.start(), { code: 'P2_G2_DEDICATED_EMPTY_DATABASE_REQUIRED' });
    assert.equal(stale.status().process_count, 0);
    assert.equal((await pool.query("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name IN ('p2_g1_app','p2_g1_worker','p2_g1_gateway')")).rows[0].n, 0);
    assert.equal((await pool.query("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name='p2_g2_controller'")).rows[0].n, 0);
  } }); } finally { await assertNoP2012Residual({ databaseUrl }); }
});
