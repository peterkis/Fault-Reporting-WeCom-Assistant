import { createCommunicationService } from './p2-004-communication-core.mjs';
import { createCommunicationDeliveryWorker, createCommunicationDeliveryOperatorPort, createCommunicationReconciliationPort } from './p2-004-communication-delivery-worker.mjs';
import { appendRealtimeEvent } from './p2-003-realtime-event-log.mjs';
import { createRealtimeSseHandler } from './p2-003-realtime-sse.mjs';
import { createAssignedCommunicationAuthorizer, createConversationControlService, createPilotConversationControlAuthorization } from './p2-005-conversation-control.mjs';
import { createPilotWorkbenchAuthorizationAdapter } from './p2-006-workbench-authorization.mjs';
import { createConversationWorkbenchCommandFacade } from './p2-006-workbench-command-facade.mjs';
import { createWorkbenchDeliveryControl } from './p2-006-workbench-delivery-control.mjs';
import { closeConversationWorkbenchServer, createConversationWorkbenchHttpServer, listenConversationWorkbenchServer } from './p2-006-workbench-http.mjs';
import { createConversationWorkbenchQueryService } from './p2-006-workbench-query.mjs';
import { createP2G1HumanOnlyAssembly } from './p2-g1-human-only-assembly.mjs';
import { createP2G1InboundProjectionCoordinator,createP2G1TimelineProjector } from './p2-g1-inbound-projection-coordinator.mjs';
import { createP2G1Observability } from './p2-g1-observability.mjs';
import { createP2G1TestAuthentication, P2_G1_TEST_AUTH_MAX_TTL_MS } from './p2-g1-test-authentication.mjs';
import { createP2G1WeComGateway } from './p2-g1-wecom-gateway.mjs';
import { createP2G1WeComCommunicationSender } from './p2-g1-wecom-sender.mjs';

export function createP2G1Runtime({
  pool,
  operationalIntake,
  principalId,
  principalIds = null,
  publicOrigin,
  listenPort = 0,
  botId,
  secret,
  wsUrl,
  allowedTargetHashes,
  gatewayEnabled = false,
  senderEnabled = false,
  senderAdapter = null,
  senderFactory = null,
  extensionFactory = null,
  realtimeAppender = appendRealtimeEvent,
  projectionTransactionStart = null,
  realtimeScopeLimit = 5000,
  gatewayStatusProvider = null,
  communicationStatusProvider = null,
  requireGateway = gatewayEnabled,
  testAuthTtlMs = 15 * 60_000,
  authentication = null,
  externalSendEnabled = true,
  clientFactory,
  projectionIntervalMs = 250,
  communicationIntervalMs = 250,
  closePoolOnStop = false,
} = {}) {
  if (!pool || typeof pool.query !== 'function' || !operationalIntake || typeof operationalIntake.accept !== 'function'
    || (Number.isInteger(pool.options?.max) && pool.options.max > 4)
    || !Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535
    || !Number.isInteger(projectionIntervalMs) || projectionIntervalMs < 50
    || !Number.isInteger(communicationIntervalMs) || communicationIntervalMs < 50
    || (senderAdapter !== null && typeof senderAdapter?.send !== 'function')
    || (senderFactory !== null && typeof senderFactory !== 'function')
    || (extensionFactory !== null && typeof extensionFactory !== 'function')
    || typeof realtimeAppender !== 'function'
    || (projectionTransactionStart !== null && typeof projectionTransactionStart !== 'function')
    || !Number.isInteger(realtimeScopeLimit) || realtimeScopeLimit<1 || realtimeScopeLimit>5000
    || (gatewayStatusProvider !== null && typeof gatewayStatusProvider?.getStatus !== 'function')
    || (communicationStatusProvider !== null && typeof communicationStatusProvider?.isReady !== 'function')
    || typeof requireGateway !== 'boolean'
    || !Number.isInteger(testAuthTtlMs) || testAuthTtlMs < 10_000 || testAuthTtlMs > P2_G1_TEST_AUTH_MAX_TTL_MS
    || (authentication !== null && typeof authentication?.authenticate !== 'function')
    || typeof externalSendEnabled !== 'boolean') {
    throw new TypeError('P2_G1_RUNTIME_CONFIGURATION_INVALID');
  }
  const authPort = authentication ?? createP2G1TestAuthentication({ pool, principalId, principalIds, publicOrigin, ttlMs: testAuthTtlMs });
  const authorization = createPilotWorkbenchAuthorizationAdapter({ pool });
  const controlAuthorization = createPilotConversationControlAuthorization({ pool });
  const controlService = createConversationControlService({
    pool,
    enabled: true,
    authorize: controlAuthorization,
    realtimeAppender,
  });
  const communicationService = createCommunicationService({
    pool,
    enabled: true,
    authorizeCommand: createAssignedCommunicationAuthorizer({ controlService, authorization: controlAuthorization, featureFlags: {} }),
  });
  const deliveryControl = createWorkbenchDeliveryControl({
    pool,
    authorize: authorization,
    enabled: true,
    externalSendEnabled,
    operatorPort: createCommunicationDeliveryOperatorPort({ pool }),
    reconciliationPort: createCommunicationReconciliationPort({ pool }),
  });
  const realtime = createRealtimeSseHandler({
    enabled: true,
    refreshAuthorization: true,
    pool,
    maxClients: 32,
    authenticate: authPort.authenticate,
    authorize: async (authContext) => {
      const principal = await authorization.resolvePrincipal(authContext);
      return authorization.resolveRealtimeAuthorization(principal,{limit:realtimeScopeLimit});
    },
  });
  let assembly;
  const gateway = createP2G1WeComGateway({
    enabled: gatewayEnabled,
    botId,
    secret,
    wsUrl,
    clientFactory,
    onFrame: async (frame) => assembly.handleFrame(frame),
  });
  const sender = senderAdapter ?? (senderFactory ? senderFactory({gateway}) : createP2G1WeComCommunicationSender({ gateway, allowedTargetHashes, enabled: senderEnabled }));
  const communicationWorkerEnabled = senderEnabled || senderAdapter !== null;
  const communicationWorker = createCommunicationDeliveryWorker({ pool, sender, enabled: communicationWorkerEnabled, batchSize: 20 });
  const coordinator = createP2G1InboundProjectionCoordinator({ pool, enabled: true, batchSize: 20, wakeup: realtime.wakeup,
    projector:createP2G1TimelineProjector({pool,enabled:true,batchSize:20,realtimeAppender,transactionStartHook:projectionTransactionStart,wakeup:realtime.wakeup}) });
  const observedGateway = gatewayStatusProvider ?? gateway;
  const observability = createP2G1Observability({ pool, coordinator, gateway: observedGateway, realtime, enabled: true });
  assembly = createP2G1HumanOnlyAssembly({ operationalIntake, coordinator, observability });
  const queryService = createConversationWorkbenchQueryService({
    pool,
    enabled: true,
    authorize: authorization,
    featureStatus: { workbench_enabled: true, realtime_sse_enabled: true, ai_enabled: false, incident_enabled: false, attachments_enabled: false },
  });
  const commandFacade = createConversationWorkbenchCommandFacade({
    controlService,
    communicationService,
    deliveryControl,
    authorize: authorization,
    enabled: true,
  });
  const extension=extensionFactory?.({controlService,authorization,realtime,coordinator,queryService,commandFacade})??{};
  let listening = false;
  let stopping = false;
  let projectionTimer = null;
  let communicationTimer = null;
  let projectionRunning = false;
  let communicationRunning = false;
  let projectionTask = Promise.resolve();
  let communicationTask = Promise.resolve();
  const healthProvider = {
    live: async () => Object.freeze({ ok: !stopping, service: 'P2_G1_HUMAN_ONLY' }),
    metrics: observability.metrics,
    ready: async () => {
      const base=await observability.readiness({
      httpListening: listening,
      workbenchEnabled: true,
      projectionEnabled: !stopping,
      communicationEnabled: !stopping && (communicationStatusProvider?.isReady?.() ?? (communicationWorkerEnabled || senderEnabled === false)),
      requireGateway,
      featureFlags: {},
      });
      return extension.readiness?extension.readiness(base):base;
    },
  };
  const server = createConversationWorkbenchHttpServer({
    enabled: true,
    queryService,
    commandFacade,
    authenticate: authPort.authenticate,
    sseHandler: realtime,
    healthProvider,
    publicOrigin,
    ...(extension.staticHandler?{staticHandler:extension.staticHandler}:{}),
    authenticatedHandler:extension.authenticatedHandler??null,
    unauthenticatedHandler:extension.unauthenticatedHandler??null,
  });
  server.maxConnections = 128;

  function scheduleWorkers() {
    projectionTimer = setInterval(() => {
      if (projectionRunning || stopping) return;
      projectionRunning = true;
      projectionTask = coordinator.runOnce().then(async(result) => {observability.recordProjection(result);await extension.runOnce?.();}).catch(() => {}).finally(() => { projectionRunning = false; });
    }, projectionIntervalMs);
    if (communicationWorkerEnabled) {
      communicationTimer = setInterval(() => {
        if (communicationRunning || stopping) return;
        communicationRunning = true;
        communicationTask = communicationWorker.runOnce().catch(() => {}).finally(() => { communicationRunning = false; });
      }, communicationIntervalMs);
    }
    projectionTimer.unref?.(); communicationTimer?.unref?.();
  }

  async function start() {
    stopping = false;
    try {
      const address = await listenConversationWorkbenchServer(server, { port: listenPort });
      listening = true;
      if (gatewayEnabled) await gateway.start();
      scheduleWorkers();
      const cookies = typeof authPort.browserCookies === 'function' ? authPort.browserCookies() : undefined;
      return Object.freeze({ address, ...(cookies ? { cookie: cookies[0], cookies } : {}) });
    } catch (error) {
      await stop();
      throw error;
    }
  }

  async function stop() {
    if (stopping) return Object.freeze({ stopped: true });
    stopping = true;
    clearInterval(projectionTimer); clearInterval(communicationTimer);
    await Promise.allSettled([projectionTask, communicationTask]);
    await extension.stop?.();
    await gateway.stop();
    await realtime.close();
    server.closeAllConnections?.();
    await closeConversationWorkbenchServer(server);
    listening = false;
    await authPort.close?.();
    await observability.close();
    if (closePoolOnStop && typeof pool.end === 'function') await pool.end();
    return Object.freeze({ stopped: true });
  }

  return Object.freeze({
    start,
    stop,
    server,
    gateway,
    sender,
    coordinator,
    communicationWorker,
    observability,
    authenticate: authPort,
    assembly,
    disconnectRealtimePrincipal: (index = 0) => {
      const identities = principalIds ?? [principalId];
      if (!Number.isInteger(index) || index < 0 || index >= identities.length) throw new TypeError('P2_G1_REALTIME_PRINCIPAL_INDEX_INVALID');
      return realtime.disconnectPrincipal(identities[index]);
    },
  });
}
