import { EventEmitter } from 'node:events';
import {createWeComMemberDirectory} from '../src/p2-015-wecom-member-directory.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { appendG2WebhookReceipt } from '../src/p2-g2-webhook-receipts.mjs';
import { runApp, runGateway, runWorker } from './p2-g1-process-role.mjs';
import { createP2012WorkerExtension } from './p2-012-process-role.mjs';
import { createP2012Runtime } from '../src/p2-012-workbench-assembly.mjs';
import { createP2016ReporterAccess } from '../src/p2-016-reporter-access.mjs';
import { createP2012PersonDestinationAuthorizer, createP2012DynamicWeComSender } from '../src/p2-012-live-reporter-scope.mjs';
import { createP2G1WeComGateway } from '../src/p2-g1-wecom-gateway.mjs';
import { createG2OperationalIntake } from '../src/p2-g2-service-loop-assembly.mjs';
import { readG2Configuration, G2_TEST_PREFIX, failG2 } from '../src/p2-g2-validation-config.mjs';
import { verifyG2Candidate, verifyG2ApprovalFile, requirePreparedG2Candidate } from '../src/p2-g2-candidate.mjs';
import { createG2SendGuard, createG2ProviderGate, approvalCheck } from '../src/p2-g2-send-guard.mjs';
import { appendG2Communication } from '../src/p2-g2-communication-append.mjs';
import { installG2NetworkBoundary, probeG2NetworkBoundary } from '../src/p2-g2-network-boundary.mjs';
import {readYxxG2AppConfiguration} from '../src/p2-g2-yixiaoxiu-g2-config.mjs';
import {createWeComOAuthCodeResolver} from '../src/p2-g2-wecom-oauth-provider.mjs';
import {createWeComAppTokenProvider} from '../src/p2-g2-wecom-app-token.mjs';

export async function main(argv = process.argv.slice(2)) {
  if (typeof process.send !== 'function' || argv.length !== 1 || !['--role=app', '--role=worker', '--role=gateway'].includes(argv[0])) failG2('PROCESS_ROLE_INVALID');
  const role = argv[0].slice(7).toUpperCase();
  // Losing the owning controller is an unplanned crash boundary. Exit all
  // resources with this process, especially the sole authenticated Gateway.
  process.once('disconnect', () => process.exit(1));
  let manifest; try { manifest = JSON.parse(process.env.P2_G2_MANIFEST); } catch { failG2('MANIFEST_INVALID'); }
  const c = readG2Configuration({ manifest, role, candidateFingerprint: manifest.candidate_fingerprint });
  verifyG2Candidate(manifest.candidate_fingerprint);
  verifyG2ApprovalFile(manifest);
  if(c.liveApproved)requirePreparedG2Candidate(manifest.candidate_fingerprint);
  const memberConfig=role==='APP'?readYxxG2AppConfiguration({manifest,env:process.env}):null;
  installG2NetworkBoundary(manifest,{memberOAuthEnabled:memberConfig!==null});
  const send = (request, result, ok = true) => process.send?.({ type: 'control-response', role, request_id: request.request_id, ok,
    ...(ok ? { result } : { error_code: 'P2_G2_CONTROL_REJECTED' }) });
  process.on('message', async message => {
    if (message?.type === 'g2-environment') send(message, {
      model_environment_keys: Object.keys(process.env).filter(k => /API_KEY|MODEL_KEY|PROVIDER_KEY/u.test(k)).length,
      old_approval_keys: Object.keys(process.env).filter(k => /^P2_(?:012|016|G1)_.*APPROVED/u.test(k)).length,
      expose_gc: typeof global.gc === 'function' || process.execArgv.includes('--expose-gc'),
      ...await probeG2NetworkBoundary(),
    });
  });
  const access = pool => createP2016ReporterAccess({ pool, enabled: true, hmacSecret: c.reporterHmacSecret });
  const authorizer = pool => createP2012PersonDestinationAuthorizer({ pool, botId: c.botId,
    personHashes: manifest.scope.person_hashes, groupHashes: manifest.scope.group_hashes, testLabel: G2_TEST_PREFIX, labelSource: 'raw' });
  if (role === 'APP') return runApp({ runtimeFactory: options => createP2012Runtime({ ...options,
    reporterPolicy:c.reporterPolicy,...(memberConfig?{reporterMemberEntry:memberConfig,wecomWebOAuth:{enabled:true,
      corpId:memberConfig.corpId,agentId:memberConfig.agentId,resolveCode:createWeComOAuthCodeResolver({accessTokenProvider:createWeComAppTokenProvider({corpId:memberConfig.corpId,appSecret:process.env.APP_SECRET})})}}:{}),
    flags: { TICKET_LIFECYCLE_WORKBENCH_ENABLED: true, REPORTER_TIMELINE_ENABLED: true, WECOM_TEMPLATE_CARD_ENABLED: true },
    incidentFlags: { INCIDENT_CORRELATION_ENABLED: true, INCIDENT_PUBLIC_NOTICE_ENABLED: true, INCIDENT_PRIVATE_NOTICE_ENABLED: true },
    incidentBackgroundMaintenance: false, communicationAppend: appendG2Communication,ticketNotificationAdditionalEvents:c.ticketNotificationAdditionalEvents,
    reporterOrigin: manifest.reporter_origin, reporterHmacSecret: c.reporterHmacSecret,
    allowedHosts: [new URL(manifest.reporter_origin).host], allowLocalHttp: manifest.mode==='synthetic', personDestinationAuthorizer: authorizer(options.pool) }) });
  if (role === 'WORKER') return runWorker({ reportCycleHealth: true,
    extensionFactory: ({ pool }) => createP2012WorkerExtension({ pool, reporterAccess: access(pool),
      identityHashKey: c.identityHashKey, personDestinationAuthorizer: authorizer(pool), testLabel: false, communicationAppend: appendG2Communication,
      directoryPort:createWeComMemberDirectory({enabled:c.liveApproved&&c.memberDirectoryEnabled,botId:c.botId,
        memberIdsConfirmed:manifest.scope.member_directory?.internal_member_ids_confirmed===true,
        accessTokenProvider:async()=>c.memberDirectoryAccessToken,
        beforeRequest:async()=>{
          readG2Configuration({manifest,role:'WORKER',candidateFingerprint:manifest.candidate_fingerprint});
          verifyG2Candidate(manifest.candidate_fingerprint);verifyG2ApprovalFile(manifest);
        }}),
      ticketNotificationAdditionalEvents:c.ticketNotificationAdditionalEvents }) });
  let client, gateway, operationalIntake, calls = 0, inFlight = 0;
  const pending = new WeakMap();
  class SyntheticSdk extends EventEmitter {
    connect() { queueMicrotask(() => this.emit('authenticated')); }
    disconnect() { this.emit('disconnected'); }
    async sendMessage() { calls++; return { errcode: 0, headers: { req_id: 'synthetic-g2-' + calls } }; }
  }
  process.on('message', message => {
    if (message?.type === 'g2-provider-counts') send(message, { calls, model_provider_calls: 0 });
    if(message?.type==='g2-scope-counts')send(message,operationalIntake?.counts()??{scope_unexpected_inputs:0});
    if (message?.type === 'g2-synthetic-inbound') {
      if(manifest.mode!=='synthetic'){send(message,null,false);return;}
      if (!gateway?.getStatus().authenticated || !message.frame || typeof message.frame !== 'object' || inFlight >= 50) { send(message, null, false); return; }
      inFlight++; pending.set(message.frame, message);
      client.emit('message.text', message.frame);
    }
  });
  return runGateway({
    intakeFactory: ({ pool }) => (operationalIntake=createG2OperationalIntake({ pool, configuration: c })),
    gatewayFactory: options => {
      if(manifest.mode==='live')return (gateway=createP2G1WeComGateway(options));
      gateway = createP2G1WeComGateway({ ...options, clientFactory: () => (client = new SyntheticSdk()),
        onFrame: async frame => {
          const request = pending.get(frame);
          try { const result = await options.onFrame(frame); if (request) send(request, { ok: result.ok, p1_committed: result.p1_committed === true }); }
          catch { if (request) send(request, null, false); }
          finally { if (request) { pending.delete(frame); inFlight--; } }
        } });
      return gateway;
    },
    senderFactory: ({ pool, gateway: actualGateway, ...options }) => createG2SendGuard({ pool, manifest, env: process.env, budgetFile: process.env.P2_G2_SEND_BUDGET_FILE,
      sender: createP2012DynamicWeComSender({ pool, ...options,
        groupClosureWebhook:{routes:c.groupClosureWebhookRoutes,beforeSend:()=>approvalCheck(manifest,process.env),
          recordProviderResult:record=>appendG2WebhookReceipt({file:path.join(path.dirname(process.env.P2_G2_SEND_BUDGET_FILE),'webhook-receipts.jsonl'),manifest,record}),
          ...(manifest.mode==='synthetic'?{fetchImpl:async()=>{calls++;return new Response('{"errcode":0}',{status:200});}}:{})},
        gateway: createG2ProviderGate({ gateway: actualGateway, manifest, env: process.env,
          receiptFile:path.join(path.dirname(process.env.P2_G2_SEND_BUDGET_FILE),'provider-receipts.jsonl') }), botId: c.botId,
      approvedGroupHashes: manifest.scope.group_hashes, cardEnabled: true, reporterAccess: access(pool), origin: manifest.reporter_origin,
      allowedHosts: [new URL(manifest.reporter_origin).host], allowLocalHttp: manifest.mode==='synthetic', testLabel: G2_TEST_PREFIX, labelSource: 'raw',linkMode:c.reporterPolicy }) }),
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main().catch(error => {
  process.send?.({ type: 'role-failed', role: process.argv[2]?.slice(7).toUpperCase(),
    error_code: /^P2_G2_[A-Z_]+$/u.test(error?.code ?? '') ? error.code : 'P2_G2_PROCESS_FAILED' }); process.exitCode = 1;
});
