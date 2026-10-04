import type { StoredDirectoryMember, StaffDirectoryStore } from './p2-007-staff-directory-store.mjs';
import type { PersonProfile } from './p2-007-staff-directory-contracts.mjs';
import type { StaffDirectoryAdapter, DirectoryProfileResult } from './p2-007-third-party-staff-directory-adapter.mjs';
import type { ThirdPartyReporterProfile } from './p2-015-reporter-profile.mjs';
export interface ReporterProfileProvider { getPersonProfile(input: Parameters<StaffDirectoryAdapter['getPersonProfile']>[0]): Promise<DirectoryProfileResult | { status: 'NOT_FOUND' }> }
export interface ReporterDirectoryOptions { enabled?: boolean | undefined; store?: StaffDirectoryStore | undefined; provider?: ReporterProfileProvider | undefined; sourceScope?: string | undefined; timeoutMs?: number | undefined; now?: (() => string) | undefined }
import { formatEpochMsToShanghaiLocal } from './platform/time-contract.mjs';
import { createReporterDirectoryPort } from './p2-015-contact-journey.mjs';
import { matchDirectoryProfile, THIRD_STAFF_SOURCE } from './p2-007-staff-directory-contracts.mjs';
import { hashReporterProfile } from './p2-015-reporter-profile.mjs';

function reportSnapshot(current: Partial<StoredDirectoryMember>, detail: PersonProfile | null = null, now: string): ThirdPartyReporterProfile {
  const name = detail?.display_name ?? current.nickname ?? null;
  const phone = detail?.phone ?? current.phone ?? null;
  const sex = detail?.sex ?? current.sex ?? null;
  const snapshot: ThirdPartyReporterProfile = {
    source: THIRD_STAFF_SOURCE,
    valid_at: current.fetched_at ?? now,
    fetched_at: now,
    directory_snapshot_version: current.snapshot_version ?? null,
    account_status: current.account_status ?? 'UNKNOWN',
    contact: { name, mobile: phone },
    sex,
    memberships: Array.isArray(current.memberships) ? current.memberships : [],
  };
  return { ...snapshot, version: `third-party-member-${hashReporterProfile(snapshot)}` };
}

export function createThirdPartyReporterDirectory({
  enabled = false,
  store,
  provider,
  sourceScope = 'FORMAL',
  timeoutMs = 2_000,
  now = () => formatEpochMsToShanghaiLocal(String(Date.now())),
}: ReporterDirectoryOptions = {}) {
  if (!enabled) return createReporterDirectoryPort({ timeoutMs, resolveProfile: async () => ({ status: 'DEFERRED' }) });
  if (!store || typeof store.findByReporterHash !== 'function'
    || typeof store.findMemberByProviderUserId !== 'function'
    || typeof store.saveResolvedProfile !== 'function'
    || !provider || typeof provider.getPersonProfile !== 'function') {
    throw new TypeError('THIRD_STAFF_REPORTER_DIRECTORY_CONFIGURATION_INVALID');
  }

  return createReporterDirectoryPort({
    timeoutMs,
    resolveProfile: async (input: Record<string, unknown>, { signal }: { signal?: AbortSignal } = {}) => {
      if (!enabled || input.source !== THIRD_STAFF_SOURCE || typeof input.reporter_identity_hash !== 'string') {
        return { status: 'DEFERRED' };
      }

      const current = await (store as StaffDirectoryStore).findByReporterHash({
        source_scope: sourceScope,
        reporter_identity_hash: input.reporter_identity_hash,
      });
      if (current) return { status: 'RESOLVED', snapshot: reportSnapshot(current, null, now()) };

      if (typeof input.reporter_external_id !== 'string' || input.reporter_external_id.length === 0) {
        return { status: 'DEFERRED' };
      }
      const detail = await (provider as NonNullable<ReporterDirectoryOptions['provider']>).getPersonProfile({
        source_identity: {
          namespace: input.source_namespace ?? input.source_provider ?? 'WECOM_AIBOT',
          value: input.reporter_external_id,
        },
        signal,
      });
      if (detail?.status !== 'RESOLVED' || !detail.profile) {
        return { status: detail?.status === 'NOT_FOUND' ? 'NOT_FOUND' : 'DEFERRED' };
      }

      const member = await (store as StaffDirectoryStore).findMemberByProviderUserId({
        source_scope: sourceScope,
        provider_user_id: detail.profile.provider_user_id,
      });
      if (!member || !matchDirectoryProfile(detail.profile, member).matched) return { status: 'DEFERRED' };

      const saved = await (store as StaffDirectoryStore).saveResolvedProfile({
        source_scope: sourceScope,
        reporter_identity_hash: input.reporter_identity_hash,
        source_namespace: input.source_namespace ?? input.source_provider ?? 'WECOM_AIBOT',
        profile: detail.profile,
        member,
        resolution_method: detail.resolution_method ?? null,
      });
      return { status: 'RESOLVED', snapshot: reportSnapshot(saved ?? { ...member, ...detail.profile }, detail.profile, now()) };
    },
  });
}

export { reportSnapshot as buildThirdPartyReportSnapshot };
