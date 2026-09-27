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
const isPlainObject = value => value !== null && typeof value === 'object' && !utilTypes.isProxy(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const nullableText = value => value === null || typeof value === 'string';

export function snapshotReporterProfile(value) {
  // Read a data descriptor, not a getter. Unrecognized providers retain the
  // original generic guards, including accessor/proxy/prototype rejection.
  if (!isPlainObject(value) || Object.getOwnPropertyDescriptor(value, 'source')?.value !== THIRD_STAFF_SOURCE) {
    return snapshotP2015Json(value);
  }
  const safe = snapshotP2015Json(value, REPORTER_PROFILE_JSON_LIMITS);
  if (Object.keys(safe).some(key => !PROFILE_FIELDS.has(key)) || !Array.isArray(safe.memberships)) invalid();
  for (const key of ['valid_at', 'fetched_at', 'directory_snapshot_version', 'account_status', 'sex', 'version']) {
    if (Object.hasOwn(safe, key) && !nullableText(safe[key])) invalid();
  }
  if (!isPlainObject(safe.contact) || Object.keys(safe.contact).some(key => !['name', 'mobile'].includes(key))
    || !nullableText(safe.contact.name) || !nullableText(safe.contact.mobile)) invalid();
  for (const membership of safe.memberships) {
    if (!isPlainObject(membership) || Object.keys(membership).length !== 3
      || typeof membership.department_ref !== 'string' || !membership.department_ref
      || typeof membership.name !== 'string' || membership.role !== 'MEMBER') invalid();
  }
  return safe;
}

// Validate a single designated profile separately from its containing command
// or result. Non-profile fields keep the original generic budget; do not raise
// every command's allowance just because one directory profile is larger.
export function snapshotReporterProfileEnvelope(value, field = 'profile_snapshot') {
  if (!isPlainObject(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const selected = descriptors[field];
  if (selected && !Object.hasOwn(selected, 'value')) invalid();
  if (selected) descriptors[field] = { ...selected, value: null };
  // Retain descriptors/symbols so the shared validator still rejects accessors,
  // polluted keys and symbol properties without executing supplied code.
  const safe = snapshotP2015Json(Object.defineProperties({}, descriptors));
  if (selected) safe[field] = snapshotReporterProfile(selected.value);
  return safe;
}

export function freezeReporterProfileEnvelope(value, field = 'profile_snapshot') {
  return deepFreeze(snapshotReporterProfileEnvelope(value, field));
}

export function hashReporterProfile(value) {
  const safe = snapshotReporterProfile(value);
  if (safe?.source !== THIRD_STAFF_SOURCE) return sha256Canonical(safe);
  const hash = createHash('sha256');
  // Same canonical bytes as the existing utility; no full JSON string and no
  // second validation against that utility's smaller generic node allowance.
  function write(current) {
    if (current === null || typeof current !== 'object') { hash.update(JSON.stringify(current)); return; }
    const array = Array.isArray(current);
    hash.update(array ? '[' : '{');
    let first = true;
    for (const key of array ? current.keys() : Object.keys(current).sort()) {
      if (!first) hash.update(',');
      first = false;
      if (!array) hash.update(`${JSON.stringify(key)}:`);
      write(current[key]);
    }
    hash.update(array ? ']' : '}');
  }
  write(safe);
  return hash.digest('hex');
}
