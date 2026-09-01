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
import { createP2G1InboundProjectionCoordinator } from './p2-g1-inbound-projection-coordinator.mjs';
import { createP2G1Observability } from './p2-g1-observability.mjs';
import { createP2G1TestAuthentication } from './p2-g1-test-authentication.mjs';
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
    || (senderAdapter !== null && typeof senderAdapter?.send !== 'function')) {
    throw new TypeError('P2_G1_RUNTIME_CONFIGURATION_INVALID');
  }
  const authenticate = createP2G1TestAuthentication({ pool, principalId, principalIds, publicOrigin });
  const authorization = createPilotWorkbenchAuthorizationAdapter({ pool });
  const controlAuthorization = createPilotConversationControlAuthorization({ pool });
  const controlService = createConversationControlService({
    pool,
    enabled: true,
    authorize: controlAuthorization,
    realtimeAppender: appendRealtimeEvent,
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
    operatorPort: createCommunicationDeliveryOperatorPort({ pool }),
    reconciliationPort: createCommunicationReconciliationPort({ pool }),
  });
  const realtime = createRealtimeSseHandler({
    enabled: true,
    pool,
    maxClients: 32,
    authenticate: authenticate.authenticate,
    authorize: async (authContext) => {
      const principal = await authorization.resolvePrincipal(authContext);
      return authorization.resolveRealtimeAuthorization(principal);
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
  const sender = senderAdapter ?? createP2G1WeComCommunicationSender({ gateway, allowedTargetHashes, enabled: senderEnabled });
  const communicationWorkerEnabled = senderEnabled || senderAdapter !== null;
  const communicationWorker = createCommunicationDeliveryWorker({ pool, sender, enabled: communicationWorkerEnabled, batchSize: 20 });
  const coordinator = createP2G1InboundProjectionCoordinator({ pool, enabled: true, batchSize: 20, wakeup: realtime.wakeup });
  const observability = createP2G1Observability({ pool, coordinator, gateway, realtime, enabled: true });
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
    ready: async () => observability.readiness({
      httpListening: listening,
      workbenchEnabled: true,
      projectionEnabled: !stopping,
      communicationEnabled: !stopping && (communicationWorkerEnabled || senderEnabled === false),
      requireGateway: gatewayEnabled,
      featureFlags: {},
    }),
  };
  const server = createConversationWorkbenchHttpServer({
    enabled: true,
    queryService,
    commandFacade,
    authenticate: authenticate.authenticate,
    sseHandler: realtime,
    healthProvider,
    publicOrigin,
  });
  server.maxConnections = 128;

  function scheduleWorkers() {
    projectionTimer = setInterval(() => {
      if (projectionRunning || stopping) return;
      projectionRunning = true;
      projectionTask = coordinator.runOnce().then((result) => observability.recordProjection(result)).catch(() => {}).finally(() => { projectionRunning = false; });
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
      return Object.freeze({ address, cookie: authenticate.browserCookie(), cookies: authenticate.browserCookies() });
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
    await gateway.stop();
    await realtime.close();
    server.closeAllConnections?.();
    await closeConversationWorkbenchServer(server);
    listening = false;
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
    authenticate,
    assembly,
  });
}
