import {closeBrowserTestResources} from './p2-006-browser-harness.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { withP2012Database, applyThrough031, assertNoP2012Residual } from './p2-012-postgres-harness.mjs';
import { migrateP2012 } from '../../scripts/p2-012-migrate.mjs';
import { migrateCurrentBaselineWithYxx } from '../../scripts/migrate-current-baseline.mjs';
import { createP2012Runtime } from '../../src/p2-012-workbench-assembly.mjs';
import { createP2016OrchestrationWorker } from '../../src/p2-016-orchestration-adapters.mjs';
import { createP2012PersonDestinationAuthorizer, createP2012DynamicWeComSender } from '../../src/p2-012-live-reporter-scope.mjs';
import { createCommunicationDeliveryWorker } from '../../src/p2-004-communication-delivery-worker.mjs';
import { createPilotAccessService } from '../../src/p1-009-pilot-access-workbench.mjs';
import { textHashP2016 } from '../../src/p2-016-domain-contracts.mjs';

export const G2_RULE_FLAGS = Object.freeze({ RULE_FIRST_ORCHESTRATION_ENABLED: true, MANUAL_REVIEW_QUEUE_ENABLED: true });
export async function withG2Runtime(run,{extraAgents=false,directoryPort,ticketNotificationAdditionalEvents=[],reporterCount=3,webSchema=false,incidentBackgroundMaintenance=true}={}) {
  assert.ok(Number.isInteger(reporterCount)&&reporterCount>=3&&reporterCount<=20);
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  assert.ok(databaseUrl, 'P2_G2_LOCAL_DATABASE_REQUIRED');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname));
  try {
    await withP2012Database({ databaseUrl, purpose: 'g2runtime', run: async ({ pool, databaseUrl: isolated }) => {
      if(webSchema)await migrateCurrentBaselineWithYxx({databaseUrl:isolated});
      else {await applyThrough031({ pool, databaseUrl: isolated }); await migrateP2012({ databaseUrl: isolated });}
      const admin = await createPilotAccessService({ pool }).upsertPrincipal({ wecomUserId: 'synthetic-g2-admin',
        displayName: '合成G2坐席', roles: ['ADMIN'], resolverTeamIds: ['PILOT_IT'] });
      const principals=[admin];
      if(extraAgents)for(let i=0;i<2;i++)principals.push(await createPilotAccessService({pool}).upsertPrincipal({
        wecomUserId:'synthetic-g2-agent-'+i,displayName:'合成G2处理人'+i,roles:[i===0?'HANDLER':'DISPATCHER'],resolverTeamIds:['PILOT_IT']}));
      const botId = 'synthetic-g2-bot', groupId = 'synthetic-g2-group';
      const reporters = Array.from({length:reporterCount},(_,n)=>'synthetic-g2-reporter-'+n);
      const personHashes = reporters.map(textHashP2016), groupHashes = [textHashP2016(groupId)];
      const personDestinationAuthorizer = createP2012PersonDestinationAuthorizer({ pool, botId, personHashes, groupHashes });
      const reservation = createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
      const listenPort = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
      const origin = 'http://127.0.0.1:' + listenPort;
      const runtime = createP2012Runtime({ pool, principalId: admin.id, principalIds:extraAgents?principals.map(p=>p.id):null, publicOrigin: origin, listenPort,
        ticketNotificationAdditionalEvents,incidentBackgroundMaintenance,
        flags: { TICKET_LIFECYCLE_WORKBENCH_ENABLED: true, REPORTER_TIMELINE_ENABLED: true, WECOM_TEMPLATE_CARD_ENABLED: true },
        incidentFlags: { INCIDENT_CORRELATION_ENABLED: true, INCIDENT_PUBLIC_NOTICE_ENABLED: true, INCIDENT_PRIVATE_NOTICE_ENABLED: true },
        reporterHmacSecret: 'synthetic-g2-reporter-key-at-least-32-bytes', allowLocalHttp: true,
        allowedHosts: [new URL(origin).host], personDestinationAuthorizer });
      const worker = createP2016OrchestrationWorker({ pool, identityHmacKey: 'synthetic-g2-identity-key',
        notifications: runtime.notifications, realtime: runtime.realtimeProjector, personDestinationAuthorizer, directoryPort });
      const providerCalls = [];
      const sender = createP2012DynamicWeComSender({ pool, enabled: true, botId, cardEnabled: true,
        allowedTargetHashes: [...personHashes, ...groupHashes], approvedGroupHashes: groupHashes,
        reporterAccess: runtime.reporterAccess, origin, allowedHosts: [new URL(origin).host], allowLocalHttp: true,
        gateway: { getAuthenticatedClient: () => ({ sendMessage: async (...args) => {
          providerCalls.push(args); return { errcode: 0, headers: { req_id: 'synthetic-g2-ack' } };
        } }) } });
      const delivery = createCommunicationDeliveryWorker({ pool, sender, enabled: true, batchSize: 20 });
      let primaryError=null;
      try {
        const started = await runtime.start(), cookies=(started.cookies??[started.cookie]).map(c=>c.name+'='+c.value),cookie=cookies[0];
        const get = async (path,index=0) => { const r = await fetch(origin + path, { headers: { cookie:cookies[index] } }); assert.equal(r.status, 200); return r.json(); };
        const bootstraps=await Promise.all(cookies.map((_,i)=>get('/api/lifecycle/bootstrap',i)));
        const post = async (path, body, version = body.expected_row_version ?? body.expected_version,index=0) => {
          const response = await fetch(origin + path, { method: 'POST', headers: { cookie:cookies[index], origin,
            'content-type': 'application/json', 'x-csrf-token': bootstraps[index].csrf_token,
            'idempotency-key': body.client_command_id, ...(version === undefined ? {} : { 'if-match': '"' + version + '"' }) }, body: JSON.stringify(body) });
          return { status: response.status, body: await response.json() };
        };
        const inbound = async (text, { chatType = 'group', reporter = reporters[0], msgid = randomUUID(), messageType = 'text' } = {}) => {
          assert.ok(['text', 'image'].includes(messageType));
          const frame = { cmd: 'aibot_msg_callback', headers: { req_id: 'synthetic-' + msgid }, body: {
            msgid, aibotid: botId, chattype: chatType, ...(chatType === 'group' ? { chatid: groupId } : {}),
            from: { userid: reporter }, msgtype: messageType,
            ...(messageType === 'text' ? { text: { content: text } } : {
              image: { url: 'https://synthetic.invalid/image-never-fetched', aeskey: 'synthetic-unused-key' } }),
          } };
          const result = await runtime.assembly.handleFrame(frame); assert.equal(result.ok, true);
          return { msgid, frame, result };
        };
        const pump = () => worker.processDueBatch({ feature_flags: G2_RULE_FLAGS, now_epoch_ms: String(Date.now() + 15000) });
        await run({ pool, runtime, worker, delivery, sender, providerCalls, personDestinationAuthorizer,
          origin, cookie, cookies, admin, principals, botId, groupId, reporters, get, post, inbound, pump });
      } catch(error){primaryError=error;} finally { await closeBrowserTestResources([()=>worker.stop(),()=>runtime.stop(),async()=>assert.equal(runtime.server.listening,false)],primaryError); }
    } });
  } finally { await assertNoP2012Residual({ databaseUrl }); }
}
