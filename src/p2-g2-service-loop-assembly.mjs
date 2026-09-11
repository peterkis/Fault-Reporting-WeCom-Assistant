import { createChannelMessageInbox } from './p1-003-channel-message-inbox.mjs';
import { createP2016DirectIntakeProcessor } from './p2-016-direct-intake.mjs';
import { parseExplicitContinuation } from './p2-015-explicit-continuation.mjs';
import { createP2012ApprovedGroupReporterRegistry, createP2012LiveReporterScope } from './p2-012-live-reporter-scope.mjs';
import { normalizeHospitalText } from './p2-007-domain-utils.mjs';
import { validateG2Manifest, readG2Configuration, minimalG2Environment, G2_TEST_PREFIX, G2_LIMITS, G2_LIVE_FUSES, g2Hash, failG2 } from './p2-g2-validation-config.mjs';
import { createP2G1ProcessCluster } from './p2-g1-process-cluster.mjs';
import { verifyG2Candidate, verifyG2ApprovalFile, requirePreparedG2Candidate } from './p2-g2-candidate.mjs';
import { openG2SendBudget } from './p2-g2-send-budget.mjs';
import { isAbsolute } from 'node:path';
import { createPostgresPool } from './platform/postgres-pool.mjs';
import { requireG2DatabaseScope } from './p2-g2-database-scope.mjs';
import { G2_RESOURCE_SQL } from './p2-g2-resource-sampler.mjs';
import { collectG2Reconciliation } from './p2-g2-reconciliation.mjs';

export function createG2ProcessCluster({ manifest, env = process.env, budgetFile }) {
  const c = readG2Configuration({ manifest, env, candidateFingerprint: manifest?.candidate_fingerprint });
  if(c.liveApproved&&c.groupClosureWebhookRoutes.length!==c.manifest.scope.group_hashes.length)failG2('GROUP_CLOSURE_ROUTES_REQUIRED');
  verifyG2Candidate(c.manifest.candidate_fingerprint);
  verifyG2ApprovalFile(c.manifest);
  if(c.liveApproved)requirePreparedG2Candidate(c.manifest.candidate_fingerprint);
  if (typeof budgetFile !== 'string' || !isAbsolute(budgetFile)) failG2('SEND_BUDGET_PATH_REQUIRED');
  openG2SendBudget({ file: budgetFile, manifest: c.manifest });
  const cluster = createP2G1ProcessCluster({ databaseUrl: c.databaseUrl, identityHashKey: c.identityHashKey,
    principalIds: c.manifest.scope.principal_ids, listenPort: c.manifest.listen_port, testAuthTtlMs: 65 * 60000,
    gatewayEnabled: true, senderEnabled: true, botId: c.botId, secret: c.secret, wsUrl: c.wsUrl,
    allowedTargetHashes: [...c.manifest.scope.person_hashes, ...c.manifest.scope.group_hashes],
    baseEnvironment: minimalG2Environment(env), workerHealthEvents: true, allowRoleRestart: true,
    roleScriptUrl: new URL('../scripts/p2-g2-process-role.mjs', import.meta.url),
    controlledMessageTypes: ['g2-synthetic-inbound', 'g2-provider-counts', 'g2-environment','g2-scope-counts'],
    roleEnvironment: role => ({ P2_G2_MANIFEST: JSON.stringify(c.manifest), WECOM_BOT_ID: c.botId,
      ...(c.liveApproved ? Object.fromEntries(G2_LIVE_FUSES.map(k=>[k,env[k]])) : {}),
      PILOT_LOG_IDENTITY_HASH_KEY: c.identityHashKey, P2_G2_REPORTER_HMAC_SECRET: c.reporterHmacSecret,
      ...(role==='WORKER'&&c.memberDirectoryAccessToken?{P2_G2_DIRECTORY_ACCESS_TOKEN:c.memberDirectoryAccessToken}:{}),
      ...(role === 'GATEWAY' ? { WECOM_BOT_SECRET: c.secret, WECOM_WS_URL: c.wsUrl, P2_G2_SEND_BUDGET_FILE: budgetFile,
        P2_G2_GROUP_WEBHOOK_ROUTES:JSON.stringify(c.groupClosureWebhookRoutes.map(r=>({group_id:r.groupId,url:r.url}))) } : {}) }),
  });
  const fault = (role, id) => {
    if (!c.manifest.scope.allowed_faults.includes(id) || id !== 'G2-F02' || !['APP', 'WORKER'].includes(role)) failG2('FAULT_NOT_APPROVED');
  };
  let controllerPool, controller, started = false, stopping, expiryTimer;
  async function stop() {
    if (!stopping) stopping = (async () => {
      clearTimeout(expiryTimer);
      try { try{await cluster.disconnectGateway();}catch{/* It may not have started. */}return await cluster.stop(); }
      finally {
        // Destroying this private session releases the advisory lock as well.
        controller?.release(true); controller = null;
        await controllerPool?.end(); controllerPool = null;
      }
    })();
    return stopping;
  }
  async function start() {
    if (started || stopping) failG2('PROCESS_CLUSTER_STATE_INVALID');
    started = true;
    try {
      verifyG2Candidate(c.manifest.candidate_fingerprint);
      readG2Configuration({ manifest: c.manifest, env, candidateFingerprint: c.manifest.candidate_fingerprint });
      verifyG2ApprovalFile(c.manifest);
  if(c.liveApproved)requirePreparedG2Candidate(c.manifest.candidate_fingerprint);
      controllerPool = createPostgresPool({ connectionString: c.databaseUrl, max: 1,
        connectionTimeoutMillis: 2000, application_name: 'p2_g2_controller' });
      controller = await controllerPool.connect();
      controller.on('error', () => { void stop().catch(() => {}); });
      const lock = await controller.query("SELECT pg_try_advisory_lock(hashtextextended('P2_G2_PROCESS_CLUSTER',0)) AS acquired");
      if (lock.rows[0].acquired !== true) failG2('COMPETING_CONTROLLER');
      const startupScope=await requireG2DatabaseScope({ transaction: controller, manifest: c.manifest });
      const result=await cluster.start();
      if(c.liveApproved) expiryTimer=setTimeout(()=>{void stop().catch(()=>{});},
        Math.max(1,Number(BigInt(c.manifest.approval.expires_epoch_ms)-BigInt(Date.now()))));
      return {...result,startup_scope:startupScope};
    } catch (error) { await stop(); throw error; }
  }
  return Object.freeze({ start, stop, status: cluster.status, metrics: ()=>cluster.metrics(),
    resourceRoleMetrics({phase,faultId}){
      const allowStoppedWorker=['FAULT','RECOVERY'].includes(phase)&&faultId==='G2-F02'&&c.manifest.scope.allowed_faults.includes(faultId);
      return cluster.metrics({allowStoppedWorker});
    },
    async resourceDatabaseMetrics(){if(!controller||stopping)failG2('PROCESS_CLUSTER_STATE_INVALID');return (await controller.query(G2_RESOURCE_SQL)).rows[0];},
    async captureReconciliation(){
      if(!controller||stopping)failG2('PROCESS_CLUSTER_STATE_INVALID');const tx=controller;
      try{await tx.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');return await collectG2Reconciliation({transaction:tx,manifest:c.manifest});}
      finally{await tx.query('ROLLBACK').catch(()=>{});}
    },
    scopeCounts:()=>cluster.controlledRequest('GATEWAY','g2-scope-counts'),
    submitSyntheticFrame: frame => {
      if(c.liveApproved)failG2('SYNTHETIC_CONTROL_FORBIDDEN');
      return cluster.controlledRequest('GATEWAY', 'g2-synthetic-inbound', { frame });
    },
    syntheticProviderCounts: () => cluster.controlledRequest('GATEWAY', 'g2-provider-counts'),
    async syntheticEnvironment() {
      const roles = await Promise.all(['APP', 'WORKER', 'GATEWAY'].map(role => cluster.controlledRequest(role, 'g2-environment')));
      return { model_environment_keys: roles.reduce((n, r) => n + r.model_environment_keys, 0),
        old_approval_keys: roles.reduce((n, r) => n + r.old_approval_keys, 0), expose_gc: roles.some(r => r.expose_gc),
        model_network_unreachable:roles.every(r=>r.model_network_unreachable===true),
        blocked_model_http_probes:roles.reduce((n,r)=>n+r.blocked_model_http_probes,0),network_boundary:'PROCESS_HTTP_ALLOWLIST_NOT_OS_FIREWALL' };
    },
    stopRoleForFault(role, id) { fault(role, id); return cluster.controlledStopRole(role); },
    restartRoleForFault(role, id) { fault(role, id); return cluster.controlledRestartRole(role); },
    disconnectGatewayForFault(id) {
      if (id !== 'G2-F01' || !c.manifest.scope.allowed_faults.includes(id)) failG2('FAULT_NOT_APPROVED');
      return cluster.disconnectGateway();
    },
    reconnectGatewayForFault(id) {
      if (id !== 'G2-F01' || !c.manifest.scope.allowed_faults.includes(id)) failG2('FAULT_NOT_APPROVED');
      return cluster.reconnectGateway();
    },
  });
}

export function createG2OperationalIntake({ pool, configuration }) {
  const manifest = validateG2Manifest(configuration?.manifest);
  if (g2Hash(configuration.botId ?? '') !== manifest.scope.bot_hash) failG2('BOT_SCOPE_MISMATCH');
  const registry = createP2012ApprovedGroupReporterRegistry({ pool, botId: configuration.botId,
    groupHashes: manifest.scope.group_hashes, testLabel: G2_TEST_PREFIX, labelSource: 'raw' });
  const scope = createP2012LiveReporterScope({ bot_id: configuration.botId, person_hashes: manifest.scope.person_hashes,
    group_hashes: manifest.scope.group_hashes, ...registry, testLabel: G2_TEST_PREFIX, labelSource: 'raw' });
  const inbox = createChannelMessageInbox({ pool }), processor = createP2016DirectIntakeProcessor({ idleTimeoutMs: G2_LIMITS.direct_session_idle_timeout_ms });
  const approved = new Set(manifest.scope.approved_inputs.map(normalizeHospitalText));
  const approvedInput=text=>{
    const normalized=normalizeHospitalText(text);if(approved.has(normalized))return true;
    const claim=parseExplicitContinuation(normalized);
    return Boolean(claim?.public_ref&&approved.has(normalizeHospitalText('续接工单 {PUBLIC_REF}：'+claim.description)));
  };
  let rejected = 0, accepted = 0;
  return Object.freeze({
    async accept(input) {
      if(manifest.mode==='live') {
        if(BigInt(Date.now())>=BigInt(manifest.approval.expires_epoch_ms))failG2('APPROVAL_EXPIRED');
        verifyG2ApprovalFile(manifest);verifyG2Candidate(manifest.candidate_fingerprint);
      }
      const message = input?.message, items = message?.content;
      // An image cannot carry a text label. It requires a separately approved
      // image-only turn and an explicitly listed Reporter in the dedicated scope.
      // Persist the real media fact unchanged; do not manufacture label/OCR text.
      const imageApproved = approved.has('[图片]') && message?.provider === 'WECOM_AIBOT'
        && message.bot_id === configuration.botId && typeof message.sender_user_id === 'string'
        && manifest.scope.person_hashes.includes(g2Hash(message.sender_user_id))
        && (message.chat_type === 'single' || message.chat_type === 'group'
          && typeof message.chat_id === 'string' && manifest.scope.group_hashes.includes(g2Hash(message.chat_id)))
        && Array.isArray(items) && items.length === 1 && items[0]?.kind === 'media' && items[0].media?.type === 'image';
      if (imageApproved) {
        const result = await inbox.accept(input, processor);
        if (result.ok) accepted++;
        return result;
      }
      if (!Array.isArray(items) || items.length !== 1 || items[0]?.kind !== 'text'
        || typeof items[0].text?.raw !== 'string' || !items[0].text.raw.trimStart().startsWith(G2_TEST_PREFIX)
        || typeof items[0].text.clean !== 'string' || !items[0].text.clean.startsWith(G2_TEST_PREFIX)
        || !approvedInput(items[0].text.clean.slice(G2_TEST_PREFIX.length)) || !await scope.accepts(message)) {
        rejected++; return { ok: false, error: { code: 'P2_G2_INBOUND_SCOPE_REJECTED', retryable: false } };
      }
      // Strip only the approved leading run label. The original raw text remains
      // in the existing Inbox for evidence and dynamic group-reporter scope.
      const content = [{ ...items[0], text: { ...items[0].text, clean: items[0].text.clean.slice(G2_TEST_PREFIX.length).trim() } }];
      const result = await inbox.accept({ ...input, message: { ...message, content } }, processor);
      if (result.ok) accepted++;
      return result;
    },
    counts: () => Object.freeze({ accepted_inputs: accepted, scope_unexpected_inputs: rejected }),
  });
}
