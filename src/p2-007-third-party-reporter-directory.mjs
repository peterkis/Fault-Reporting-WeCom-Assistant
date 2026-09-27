import { createReporterDirectoryPort } from './p2-015-contact-journey.mjs';
import { matchDirectoryProfile, THIRD_STAFF_SOURCE } from './p2-007-staff-directory-contracts.mjs';
import { sha256Canonical } from './p2-007-domain-utils.mjs';

function reportSnapshot(current, detail = null, now) {
  const name = detail?.display_name ?? current.nickname ?? null;
  const phone = detail?.phone ?? current.phone ?? null;
  const sex = detail?.sex ?? current.sex ?? null;
  const snapshot = {
    source: THIRD_STAFF_SOURCE,
    valid_at: current.fetched_at ?? now,
    fetched_at: now,
    directory_snapshot_version: current.snapshot_version ?? null,
    account_status: current.account_status ?? 'UNKNOWN',
    contact: { name, mobile: phone },
    sex,
    memberships: Array.isArray(current.memberships) ? current.memberships : [],
  };
  return { ...snapshot, version: `third-party-member-${sha256Canonical(snapshot)}` };
}

export function createThirdPartyReporterDirectory({
  enabled = false,
  store,
  provider,
  sourceScope = 'FORMAL',
  timeoutMs = 2_000,
  now = () => new Date().toISOString().replace('T', ' ').replace('Z', ''),
} = {}) {
  if (!enabled) return createReporterDirectoryPort({ timeoutMs, resolveProfile: async () => ({ status: 'DEFERRED' }) });
  if (!store || typeof store.findByReporterHash !== 'function'
    || typeof store.findMemberByProviderUserId !== 'function'
    || typeof store.saveResolvedProfile !== 'function'
    || !provider || typeof provider.getPersonProfile !== 'function') {
    throw new TypeError('THIRD_STAFF_REPORTER_DIRECTORY_CONFIGURATION_INVALID');
  }

  return createReporterDirectoryPort({
    timeoutMs,
    resolveProfile: async (input, { signal } = {}) => {
      if (!enabled || input.source !== THIRD_STAFF_SOURCE || typeof input.reporter_identity_hash !== 'string') {
        return { status: 'DEFERRED' };
      }

      const current = await store.findByReporterHash({
        source_scope: sourceScope,
        reporter_identity_hash: input.reporter_identity_hash,
      });
      if (current) return { status: 'RESOLVED', snapshot: reportSnapshot(current, null, now()) };

      if (typeof input.reporter_external_id !== 'string' || input.reporter_external_id.length === 0) {
        return { status: 'DEFERRED' };
      }
      const detail = await provider.getPersonProfile({
        source_identity: {
          namespace: input.source_namespace ?? input.source_provider ?? 'WECOM_AIBOT',
          value: input.reporter_external_id,
        },
        signal,
      });
      if (detail?.status !== 'RESOLVED' || !detail.profile) {
        return { status: detail?.status === 'NOT_FOUND' ? 'NOT_FOUND' : 'DEFERRED' };
      }

      const member = await store.findMemberByProviderUserId({
        source_scope: sourceScope,
        provider_user_id: detail.profile.provider_user_id,
      });
      if (!member || !matchDirectoryProfile(detail.profile, member).matched) return { status: 'DEFERRED' };

      const saved = await store.saveResolvedProfile({
        source_scope: sourceScope,
        reporter_identity_hash: input.reporter_identity_hash,
        profile: detail.profile,
        member,
        resolution_method: detail.resolution_method ?? null,
      });
      return { status: 'RESOLVED', snapshot: reportSnapshot(saved ?? { ...member, ...detail.profile }, detail.profile, now()) };
    },
  });
}

export { reportSnapshot as buildThirdPartyReportSnapshot };
