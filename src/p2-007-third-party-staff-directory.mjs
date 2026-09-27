import { createThirdPartyStaffDirectoryAdapter } from './p2-007-third-party-staff-directory-adapter.mjs';
import { createThirdPartyReporterDirectory } from './p2-007-third-party-reporter-directory.mjs';
import { createThirdPartyStaffDirectoryStore } from './p2-007-staff-directory-store.mjs';
import { createThirdPartyStaffDirectorySyncJob } from './p2-007-staff-directory-sync.mjs';
import { THIRD_STAFF_SOURCE } from './p2-007-staff-directory-contracts.mjs';

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
