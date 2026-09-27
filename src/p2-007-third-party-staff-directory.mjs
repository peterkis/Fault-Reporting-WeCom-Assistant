import { createThirdPartyStaffDirectoryAdapter } from './p2-007-third-party-staff-directory-adapter.mjs';
import { createThirdPartyReporterDirectory } from './p2-007-third-party-reporter-directory.mjs';
import { createThirdPartyStaffDirectoryStore } from './p2-007-staff-directory-store.mjs';
import { createThirdPartyStaffDirectorySyncJob } from './p2-007-staff-directory-sync.mjs';
import { createBotRawUidResolver, THIRD_STAFF_SOURCE } from './p2-007-staff-directory-contracts.mjs';

export function createThirdPartyStaffDirectory({
  pool,
  enabled = false,
  keyProvider,
  uidResolver,
  rootRef,
  baseUrl,
  sourceScope = 'FORMAL',
  fetchImpl,
  beforeRequest,
  now,
  nowEpochMs,
} = {}) {
  const provider = createThirdPartyStaffDirectoryAdapter({ baseUrl, keyProvider, uidResolver, fetchImpl, beforeRequest });
  const store = createThirdPartyStaffDirectoryStore({ pool });
  const reporterDirectory = createThirdPartyReporterDirectory({ enabled, store, provider, sourceScope, now });
  const syncJob = createThirdPartyStaffDirectorySyncJob({ enabled, provider, store, sourceScope, rootRef, nowEpochMs });
  return Object.freeze({ source: THIRD_STAFF_SOURCE, provider, store, reporterDirectory, syncJob, close: provider.close });
}

// The deployed App only reads PostgreSQL. The existing Worker owns provider
// requests; neither role creates another pool, process or recurring timer.
export function createThirdPartyStaffDirectoryProcessOptions({
  pool, role, env = process.env,
  directoryFactory = createThirdPartyStaffDirectory,
  storeFactory = createThirdPartyStaffDirectoryStore,
} = {}) {
  const flag = env.THIRD_STAFF_DIRECTORY_ENABLED;
  if (flag === undefined || flag === 'false') return Object.freeze({});
  if (flag !== 'true') throw new Error('THIRD_STAFF_DIRECTORY_FLAG_INVALID');
  if (role === 'APP') return Object.freeze({ directoryStore: storeFactory({ pool }), directorySourceScope: 'FORMAL' });
  if (role === 'GATEWAY') return Object.freeze({});
  if (role !== 'WORKER') throw new Error('THIRD_STAFF_DIRECTORY_ROLE_INVALID');
  const rootRef = env.THIRD_STAFF_DIRECTORY_ROOT_ID;
  const key = env.THIRD_STAFF_INFO_SYNC_KEY;
  if (typeof rootRef !== 'string' || !rootRef.trim() || rootRef.length > 256 || rootRef.startsWith('replace-with-')
    || typeof key !== 'string' || !key.trim() || key.length > 4096 || key.startsWith('replace-with-')) {
    throw new Error('THIRD_STAFF_DIRECTORY_CONFIGURATION_REQUIRED');
  }
  const directory = directoryFactory({ pool, enabled: true, rootRef,
    baseUrl: env.THIRD_STAFF_DIRECTORY_BASE_URL,
    keyProvider: () => env.THIRD_STAFF_INFO_SYNC_KEY,
    uidResolver: createBotRawUidResolver(),
  });
  return Object.freeze({ directoryPort: directory.reporterDirectory,
    directorySource: THIRD_STAFF_SOURCE, directorySyncJob: directory.syncJob });
}
