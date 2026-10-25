export interface SyntheticG2ProviderResult {errcode:0;headers:{req_id:string}}
import type { G2Manifest, G2Role, CandidateFingerprint } from '../src/p2-g2-validation-config.mjs';
import type { PostgresPool } from '../src/platform/postgres-pool.mjs';
import type { WeComGateway } from '../src/p2-g1-wecom-gateway.mjs';
import type { G1RoleCommand } from './p2-g1-process-role.mjs';
export type G2ControlMessage = G1RoleCommand | {type:'g2-environment'|'g2-provider-counts'|'g2-scope-counts';request_id:string} | {type:'g2-synthetic-inbound';request_id:string;frame:unknown};
export type G2RoleControl<Role extends G2Role> = Role extends 'GATEWAY' ? G2ControlMessage : Exclude<G2ControlMessage,{type:'g2-synthetic-inbound'}>;
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
import {readYxxG2AppConfiguration,readYxxSelfServiceFlags} from '../src/p2-g2-yixiaoxiu-g2-config.mjs';
import {createYxxDelegatedIdentityMapping} from '../src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {createWeComOAuthCodeResolver} from '../src/p2-g2-wecom-oauth-provider.mjs';
import {createWeComAppTokenProvider} from '../src/p2-g2-wecom-app-token.mjs';

export async function main(argv = process.argv.slice(2)) {
  if (typeof process.send !== 'function' || argv.length !== 1 || !['--role=app', '--role=worker', '--role=gateway'].includes(argv[0] as string)) failG2('PROCESS_ROLE_INVALID');
  const role = (argv[0] as string).slice(7).toUpperCase() as G2Role;
  // Losing the owning controller is an unplanned crash boundary. Exit all
  // resources with this process, especially the sole authenticated Gateway.
  process.once('disconnect', () => process.exit(1));
  let manifest:unknown; try { manifest = JSON.parse(process.env.P2_G2_MANIFEST as string); } catch { failG2('MANIFEST_INVALID'); }
  const c = readG2Configuration({ manifest, role, candidateFingerprint: (manifest as G2Manifest).candidate_fingerprint });
  verifyG2Candidate((manifest as G2Manifest).candidate_fingerprint);
  verifyG2ApprovalFile(manifest as G2Manifest);
  if(c.liveApproved)requirePreparedG2Candidate((manifest as G2Manifest).candidate_fingerprint);
  const memberConfig=role==='APP'?readYxxG2AppConfiguration({manifest:manifest as G2Manifest,env:process.env}):null;
  const webFlags=readYxxSelfServiceFlags(process.env);
  const yxxSelfService=Object.values(webFlags).some(Boolean)?{featureFlags:webFlags}:null;
  if(yxxSelfService&&c.reporterPolicy!=='MEMBER_REQUIRED')failG2('CONFIGURATION_INVALID');
  installG2NetworkBoundary(manifest,{memberOAuthEnabled:memberConfig!==null,memberDelegatedMappingEnabled:memberConfig?.identityMode==='VERIFIED_DELEGATED_MAPPING'});
  const tokenProvider=memberConfig?createWeComAppTokenProvider({corpId:memberConfig.corpId,appSecret:process.env.APP_SECRET}):null;
  const identityMapping=memberConfig?.identityMode==='VERIFIED_DELEGATED_MAPPING'
    ?await createYxxDelegatedIdentityMapping({config:memberConfig,accessTokenProvider:tokenProvider as NonNullable<typeof tokenProvider>}):null;
  const send = (request:{request_id:string}, result:unknown, ok = true) => process.send?.({ type: 'control-response', role, request_id: request.request_id, ok,
    ...(ok ? { result } : { error_code: 'P2_G2_CONTROL_REJECTED' }) });
  process.on('message', async (message:unknown) => {
    if ((message as Partial<G2ControlMessage>|null)?.type === 'g2-environment') send(message as {request_id:string}, {
      model_environment_keys: Object.keys(process.env).filter(k => /API_KEY|MODEL_KEY|PROVIDER_KEY/u.test(k)).length,
      old_approval_keys: Object.keys(process.env).filter(k => /^P2_(?:012|016|G1)_.*APPROVED/u.test(k)).length,
      expose_gc: typeof global.gc === 'function' || process.execArgv.includes('--expose-gc'),
      ...await probeG2NetworkBoundary(),
    });
  });
  const access = (pool:PostgresPool) => createP2016ReporterAccess({ pool, enabled: true, hmacSecret: c.reporterHmacSecret });
  const authorizer = (pool:PostgresPool) => createP2012PersonDestinationAuthorizer({ pool, botId: c.botId,
    personHashes: (manifest as G2Manifest).scope.person_hashes, groupHashes: (manifest as G2Manifest).scope.group_hashes, testLabel: G2_TEST_PREFIX, labelSource: 'raw' });
  if (role === 'APP') return runApp({ runtimeFactory: options => createP2012Runtime({ ...options,
    reporterPolicy:c.reporterPolicy,identityMapping,yxxSelfService,...(memberConfig?{reporterMemberEntry:memberConfig,wecomWebOAuth:{enabled:true,
      corpId:memberConfig.corpId,agentId:memberConfig.agentId,resolveCode:createWeComOAuthCodeResolver({accessTokenProvider:tokenProvider as NonNullable<typeof tokenProvider>})}}:{}),
    flags: { TICKET_LIFECYCLE_WORKBENCH_ENABLED: true, REPORTER_TIMELINE_ENABLED: true, WECOM_TEMPLATE_CARD_ENABLED: true } as {TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},
    incidentFlags: { INCIDENT_CORRELATION_ENABLED: true, INCIDENT_PUBLIC_NOTICE_ENABLED: true, INCIDENT_PRIVATE_NOTICE_ENABLED: true },
    incidentBackgroundMaintenance: false, communicationAppend: appendG2Communication,ticketNotificationAdditionalEvents:c.ticketNotificationAdditionalEvents,
    reporterOrigin: (manifest as G2Manifest).reporter_origin, reporterHmacSecret: c.reporterHmacSecret,
    allowedHosts: [new URL((manifest as G2Manifest).reporter_origin).host], allowLocalHttp: (manifest as G2Manifest).mode==='synthetic', personDestinationAuthorizer: authorizer(options.pool) }) });
  if (role === 'WORKER') return runWorker({ reportCycleHealth: true,
    extensionFactory: ({ pool }) => createP2012WorkerExtension({ pool, reporterAccess: access(pool),
      identityHashKey: c.identityHashKey, personDestinationAuthorizer: authorizer(pool), testLabel: false, communicationAppend: appendG2Communication,
      directoryPort:createWeComMemberDirectory({enabled:c.liveApproved&&c.memberDirectoryEnabled,botId:c.botId,
        memberIdsConfirmed:(manifest as G2Manifest).scope.member_directory?.internal_member_ids_confirmed===true,
        accessTokenProvider:async()=>c.memberDirectoryAccessToken,
        beforeRequest:async()=>{
          readG2Configuration({manifest,role:'WORKER',candidateFingerprint:(manifest as G2Manifest).candidate_fingerprint});
          verifyG2Candidate((manifest as G2Manifest).candidate_fingerprint);verifyG2ApprovalFile(manifest as G2Manifest);
        }}),
      ticketNotificationAdditionalEvents:c.ticketNotificationAdditionalEvents,yxxSelfService }) });
  let client:SyntheticSdk|undefined, gateway:WeComGateway|undefined, operationalIntake:ReturnType<typeof createG2OperationalIntake>|undefined, calls = 0, inFlight = 0;
  const pending = new WeakMap<object,{request_id:string}>();
  class SyntheticSdk extends EventEmitter {
    connect() { queueMicrotask(() => this.emit('authenticated')); }
    disconnect() { this.emit('disconnected'); }
    async sendMessage(): Promise<SyntheticG2ProviderResult> { calls++; return { errcode: 0, headers: { req_id: 'synthetic-g2-' + calls } }; }
  }
  process.on('message', (message:unknown) => {
    if ((message as Partial<G2ControlMessage>|null)?.type === 'g2-provider-counts') send(message as {request_id:string}, { calls, model_provider_calls: 0 });
    if((message as Partial<G2ControlMessage>|null)?.type==='g2-scope-counts')send(message as {request_id:string},operationalIntake?.counts()??{scope_unexpected_inputs:0});
    if ((message as Partial<G2ControlMessage>|null)?.type === 'g2-synthetic-inbound') {
      if((manifest as G2Manifest).mode!=='synthetic'){send(message as {request_id:string},null,false);return;}
      if (!gateway?.getStatus().authenticated || !(message as Partial<Extract<G2ControlMessage,{type:'g2-synthetic-inbound'}>>).frame || typeof (message as Partial<Extract<G2ControlMessage,{type:'g2-synthetic-inbound'}>>).frame !== 'object' || inFlight >= 50) { send(message as {request_id:string}, null, false); return; }
      inFlight++; pending.set((message as Partial<Extract<G2ControlMessage,{type:'g2-synthetic-inbound'}>>).frame as object, message as {request_id:string});
      (client as SyntheticSdk).emit('message.text', (message as Partial<Extract<G2ControlMessage,{type:'g2-synthetic-inbound'}>>).frame);
    }
  });
  return runGateway({
    intakeFactory: ({ pool }) => (operationalIntake=createG2OperationalIntake({ pool, configuration: c })),
    gatewayFactory: options => {
      if((manifest as G2Manifest).mode==='live')return (gateway=createP2G1WeComGateway(options));
      gateway = createP2G1WeComGateway({ ...options, clientFactory: () => (client = new SyntheticSdk()),
        onFrame: async frame => {
          const request = pending.get(frame as object);
          try { const result = await ((options as NonNullable<typeof options>).onFrame as NonNullable<NonNullable<typeof options>['onFrame']>)(frame); if (request) send(request, { ok: (result as {ok:unknown}).ok, p1_committed: (result as {p1_committed:unknown}).p1_committed === true }); }
          catch { if (request) send(request, null, false); }
          finally { if (request) { pending.delete(frame as object); inFlight--; } }
        } });
      return gateway;
    },
    senderFactory: ({ pool, gateway: actualGateway, ...options }) => createG2SendGuard({ pool, manifest, env: process.env, budgetFile: process.env.P2_G2_SEND_BUDGET_FILE as string,
      sender: createP2012DynamicWeComSender({ pool, ...options,
        groupClosureWebhook:{routes:c.groupClosureWebhookRoutes,beforeSend:()=>approvalCheck(manifest as G2Manifest,process.env),
          recordProviderResult:(record:unknown)=>appendG2WebhookReceipt({file:path.join(path.dirname(process.env.P2_G2_SEND_BUDGET_FILE as string),'webhook-receipts.jsonl'),manifest,record}),
          ...((manifest as G2Manifest).mode==='synthetic'?{fetchImpl:async()=>{calls++;return new Response('{"errcode":0}',{status:200});}}:{})},
        gateway: createG2ProviderGate({ gateway: actualGateway, manifest, env: process.env,
          receiptFile:path.join(path.dirname(process.env.P2_G2_SEND_BUDGET_FILE as string),'provider-receipts.jsonl') }), botId: c.botId,
      approvedGroupHashes: (manifest as G2Manifest).scope.group_hashes, cardEnabled: true, reporterAccess: access(pool), origin: (manifest as G2Manifest).reporter_origin,
      allowedHosts: [new URL((manifest as G2Manifest).reporter_origin).host], allowLocalHttp: (manifest as G2Manifest).mode==='synthetic', testLabel: G2_TEST_PREFIX, labelSource: 'raw',linkMode:c.reporterPolicy }) }),
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main().catch(error => {
  process.send?.({ type: 'role-failed', role: process.argv[2]?.slice(7).toUpperCase(),
    error_code: /^P2_G2_[A-Z_]+$/u.test((error as {code?:string}|null)?.code ?? '') ? (error as {code:string}).code : 'P2_G2_PROCESS_FAILED' }); process.exitCode = 1;
});
