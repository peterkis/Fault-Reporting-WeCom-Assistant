import type { JsonValue } from './p2-007-domain-utils.mjs';
import type { ReporterMembership } from './p2-007-staff-directory-store.mjs';
export interface ThirdPartyReporterProfile { source: 'THIRD_PARTY_STAFF_DIRECTORY'; contact: { name: string | null; mobile: string | null }; memberships: ReporterMembership[]; valid_at?: string | null; fetched_at?: string | null; directory_snapshot_version?: string | null; account_status?: string | null; sex?: string | null; version?: string | null }
// Other supported providers keep their existing generic JSON snapshot contract.
export type ReporterProfileSnapshot = ThirdPartyReporterProfile | Record<string, unknown>;
import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { deepFreeze, sha256Canonical } from './p2-007-domain-utils.mjs';
import { THIRD_STAFF_SOURCE, THIRD_STAFF_DIRECTORY_LIMITS } from './p2-007-staff-directory-contracts.mjs';
import { failP2015, P2_015_ERROR_CODES, snapshotP2015Json } from './p2-015-domain-contracts.mjs';

// A member can appear once in every allowed department. Each membership has
// four JSON nodes (object + department_ref/name/role); reserve 32 for metadata.
export const REPORTER_PROFILE_JSON_LIMITS = Object.freeze({
  maxDepth: 4,
  maxNodes: 32 + 4 * THIRD_STAFF_DIRECTORY_LIMITS.maximumDepartments,
  maxArrayLength: THIRD_STAFF_DIRECTORY_LIMITS.maximumDepartments,
  maxStringLength: 256,
});
const PROFILE_FIELDS = new Set(['source', 'valid_at', 'fetched_at', 'directory_snapshot_version',
  'account_status', 'contact', 'sex', 'memberships', 'version']);
const invalid = () => failP2015(P2_015_ERROR_CODES.inputInvalid);
const isPlainObject: (value: unknown) => boolean = value => value !== null && typeof value === 'object' && !utilTypes.isProxy(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const nullableText: (value: unknown) => boolean = value => value === null || typeof value === 'string';

export function snapshotReporterProfile(value: unknown): ReporterProfileSnapshot {
  // Read a data descriptor, not a getter. Unrecognized providers retain the
  // original generic guards, including accessor/proxy/prototype rejection.
  if (!isPlainObject(value) || Object.getOwnPropertyDescriptor(value as object, 'source')?.value !== THIRD_STAFF_SOURCE) {
    return snapshotP2015Json(value) as ReporterProfileSnapshot;
  }
  const safe = snapshotP2015Json(value, REPORTER_PROFILE_JSON_LIMITS) as Record<string, unknown>;
  if (Object.keys(safe).some(key => !PROFILE_FIELDS.has(key)) || !Array.isArray(safe.memberships)) invalid();
  for (const key of ['valid_at', 'fetched_at', 'directory_snapshot_version', 'account_status', 'sex', 'version']) {
    if (Object.hasOwn(safe, key) && !nullableText(safe[key])) invalid();
  }
  if (!isPlainObject(safe.contact) || Object.keys(safe.contact as object).some(key => !['name', 'mobile'].includes(key))
    || !nullableText((safe.contact as Record<string, unknown>).name) || !nullableText((safe.contact as Record<string, unknown>).mobile)) invalid();
  for (const membership of safe.memberships as unknown[]) {
    if (!isPlainObject(membership) || Object.keys(membership as object).length !== 3
      || typeof (membership as Record<string, unknown>).department_ref !== 'string' || !(membership as Record<string, unknown>).department_ref
      || typeof (membership as Record<string, unknown>).name !== 'string' || (membership as Record<string, unknown>).role !== 'MEMBER') invalid();
  }
  return safe as ReporterProfileSnapshot;
}

// Validate a single designated profile separately from its containing command
// or result. Non-profile fields keep the original generic budget; do not raise
// every command's allowance just because one directory profile is larger.
export function snapshotReporterProfileEnvelope<T extends object>(value: T, field?: string): T;
export function snapshotReporterProfileEnvelope(value: unknown, field?: string): Record<string, unknown>;
export function snapshotReporterProfileEnvelope(value: unknown, field = 'profile_snapshot') {
  if (!isPlainObject(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value as object);
  const selected = descriptors[field];
  if (selected && !Object.hasOwn(selected, 'value')) invalid();
  if (selected) descriptors[field] = { ...selected, value: null };
  // Retain descriptors/symbols so the shared validator still rejects accessors,
  // polluted keys and symbol properties without executing supplied code.
  const safe = snapshotP2015Json(Object.defineProperties({}, descriptors)) as Record<string, unknown>;
  if (selected) safe[field] = snapshotReporterProfile(selected.value);
  return safe as ReporterProfileSnapshot;
}

export function freezeReporterProfileEnvelope<T extends object>(value: T, field?: string): T;
export function freezeReporterProfileEnvelope(value: unknown, field?: string): Record<string, unknown>;
export function freezeReporterProfileEnvelope(value: unknown, field = 'profile_snapshot') {
  return deepFreeze(snapshotReporterProfileEnvelope(value, field));
}

export function hashReporterProfile(value: unknown) {
  const safe = snapshotReporterProfile(value);
  if (safe?.source !== THIRD_STAFF_SOURCE) return sha256Canonical(safe);
  const hash = createHash('sha256');
  // Same canonical bytes as the existing utility; no full JSON string and no
  // second validation against that utility's smaller generic node allowance.
  function write(current: JsonValue): void {
    if (current === null || typeof current !== 'object') { hash.update(JSON.stringify(current)); return; }
    const array = Array.isArray(current);
    hash.update(array ? '[' : '{');
    let first = true;
    for (const key of array ? current.keys() : Object.keys(current).sort()) {
      if (!first) hash.update(',');
      first = false;
      if (!array) hash.update(`${JSON.stringify(key)}:`);
      write((current as Record<string | number, JsonValue>)[key] as JsonValue);
    }
    hash.update(array ? ']' : '}');
  }
  write(safe as JsonValue);
  return hash.digest('hex');
}
