import type { StaffDirectoryAdapter } from './p2-007-third-party-staff-directory-adapter.mjs';
import type { StaffDirectoryStore } from './p2-007-staff-directory-store.mjs';
export interface DirectorySyncOptions { enabled?: boolean | undefined; provider?: Pick<StaffDirectoryAdapter, 'syncOrganizationTree'> | undefined; store?: Pick<StaffDirectoryStore, 'publishSnapshot' | 'recordSyncFailure'> | undefined; sourceScope?: string | undefined; rootRef?: string | undefined; intervalMs?: number | undefined; nowEpochMs?: (() => number) | undefined }
type RunInput = { force?: boolean; signal?: AbortSignal | undefined };
const DEFAULT_INTERVAL_MS = 86_400_000;

function failure(code: string) {
  const error = new Error(code);
  (error as Error & { code: string }).code = code;
  return error;
}

function errorCode(error: unknown) {
  return typeof (error as { code?: unknown } | null)?.code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/u.test((error as { code: string }).code)
    ? (error as { code: string }).code : 'THIRD_STAFF_DIRECTORY_SYNC_FAILED';
}

export function createThirdPartyStaffDirectorySyncJob({
  enabled = false,
  provider,
  store,
  sourceScope = 'FORMAL',
  rootRef,
  intervalMs = DEFAULT_INTERVAL_MS,
  nowEpochMs = () => Date.now(),
}: DirectorySyncOptions = {}) {
  if (enabled && (!provider || typeof provider.syncOrganizationTree !== 'function'
    || !store || typeof store.publishSnapshot !== 'function' || typeof store.recordSyncFailure !== 'function'
    || typeof rootRef !== 'string' || rootRef.length === 0
    || !Number.isInteger(intervalMs) || intervalMs < 60_000)) {
    throw failure('THIRD_STAFF_DIRECTORY_SYNC_CONFIGURATION_INVALID');
  }
  let running = false;
  let stopped = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let nextDueEpochMs = 0;

  async function runOnce({ force = false, signal }: RunInput = {}) {
    if (!enabled) return Object.freeze({ status: 'DISABLED', skipped: true });
    const now = Number(nowEpochMs());
    if (!Number.isSafeInteger(now)) throw failure('THIRD_STAFF_DIRECTORY_CLOCK_INVALID');
    if (!force && now < nextDueEpochMs) return Object.freeze({ status: 'NOT_DUE', next_due_epoch_ms: String(nextDueEpochMs) });
    if (running) return Object.freeze({ status: 'ALREADY_RUNNING', skipped: true });
    running = true;
    nextDueEpochMs = now + intervalMs;
    try {
      const snapshot = await (provider as NonNullable<DirectorySyncOptions['provider']>).syncOrganizationTree({ source_scope: sourceScope, root_ref: rootRef, signal });
      const published = await (store as NonNullable<DirectorySyncOptions['store']>).publishSnapshot({ source_scope: sourceScope, root_ref: rootRef as string, snapshot });
      return Object.freeze({ status: 'SUCCEEDED', ...published as Omit<typeof published, 'status'> });
    } catch (error) {
      const code = errorCode(error);
      await (store as NonNullable<DirectorySyncOptions['store']>).recordSyncFailure({ source_scope: sourceScope, root_ref: rootRef as string, error_code: code });
      return Object.freeze({ status: 'FAILED', error_code: code });
    } finally {
      running = false;
    }
  }

  function schedule(signal?: AbortSignal): void {
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
    start({ signal }: { signal?: AbortSignal } = {}) {
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
  } satisfies Record<string, unknown> & { runIfDue: (input?: RunInput) => unknown });
}
