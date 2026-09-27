const DEFAULT_INTERVAL_MS = 86_400_000;

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function errorCode(error) {
  return typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/u.test(error.code)
    ? error.code : 'THIRD_STAFF_DIRECTORY_SYNC_FAILED';
}

export function createThirdPartyStaffDirectorySyncJob({
  enabled = false,
  provider,
  store,
  sourceScope = 'FORMAL',
  rootRef,
  intervalMs = DEFAULT_INTERVAL_MS,
  nowEpochMs = () => Date.now(),
} = {}) {
  if (enabled && (!provider || typeof provider.syncOrganizationTree !== 'function'
    || !store || typeof store.publishSnapshot !== 'function' || typeof store.recordSyncFailure !== 'function'
    || typeof rootRef !== 'string' || rootRef.length === 0
    || !Number.isInteger(intervalMs) || intervalMs < 60_000)) {
    throw failure('THIRD_STAFF_DIRECTORY_SYNC_CONFIGURATION_INVALID');
  }
  let running = false;
  let stopped = true;
  let timer = null;
  let nextDueEpochMs = 0;

  async function runOnce({ force = false, signal } = {}) {
    if (!enabled) return Object.freeze({ status: 'DISABLED', skipped: true });
    const now = Number(nowEpochMs());
    if (!Number.isSafeInteger(now)) throw failure('THIRD_STAFF_DIRECTORY_CLOCK_INVALID');
    if (!force && now < nextDueEpochMs) return Object.freeze({ status: 'NOT_DUE', next_due_epoch_ms: String(nextDueEpochMs) });
    if (running) return Object.freeze({ status: 'ALREADY_RUNNING', skipped: true });
    running = true;
    nextDueEpochMs = now + intervalMs;
    try {
      const snapshot = await provider.syncOrganizationTree({ source_scope: sourceScope, root_ref: rootRef, signal });
      const published = await store.publishSnapshot({ source_scope: sourceScope, root_ref: rootRef, snapshot });
      return Object.freeze({ status: 'SUCCEEDED', ...published });
    } catch (error) {
      const code = errorCode(error);
      await store.recordSyncFailure({ source_scope: sourceScope, root_ref: rootRef, error_code: code });
      return Object.freeze({ status: 'FAILED', error_code: code });
    } finally {
      running = false;
    }
  }

  function schedule(signal) {
    if (stopped || signal?.aborted) return;
    const delay = Math.max(1_000, nextDueEpochMs - Number(nowEpochMs()));
    timer = setTimeout(async () => {
      timer = null;
      try { await runOnce({ signal }); } catch { /* the next scheduled run must remain available */ }
      schedule(signal);
    }, delay);
    timer.unref?.();
  }

  return Object.freeze({
    runOnce,
    runIfDue: input => runOnce(input),
    start({ signal } = {}) {
      if (!enabled || !stopped) return false;
      stopped = false;
      nextDueEpochMs = 0;
      schedule(signal);
      return true;
    },
    async stop() {
      stopped = true;
      if (timer) { clearTimeout(timer); timer = null; }
      while (running) await new Promise(resolve => setTimeout(resolve, 10));
      return Object.freeze({ stopped: true, running: false });
    },
    state() { return Object.freeze({ enabled, stopped, running, next_due_epoch_ms: String(nextDueEpochMs) }); },
  });
}
