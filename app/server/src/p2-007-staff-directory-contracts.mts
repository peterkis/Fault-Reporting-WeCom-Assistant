import type { JsonValue } from './p2-007-domain-utils.mjs';
export interface DirectoryMember { provider_user_id: string; employee_id: string; nickname: string | null; phone: string | null; provider_wecom_id: string | null }
export interface DirectoryDepartment { provider_department_id: string; parent_provider_department_id: string | null; name: string; provider_gid: string | null; provider_gid_type: string | null; depth: number }
export interface DirectoryMembership { provider_department_id: string; provider_user_id: string }
export interface DirectorySnapshot { departments: DirectoryDepartment[]; members: DirectoryMember[]; memberships: DirectoryMembership[]; protocol_warnings: string[]; snapshot_version: string; counts: { departments: number; members: number; memberships: number; max_depth: number } }
export interface PersonProfile { provider_user_id: string; employee_id: string; display_name: string | null; phone: string | null; sex: string | null; avatar_url: string | null }
export type UidResolution = { status: 'RESOLVED'; uid: string; method?: string; namespace?: string } | { status: 'DEFERRED'; reason_code: string };
export interface UidResolver { resolveQueryUid(input: { source_namespace?: unknown; source_identity_ref?: unknown; local_binding?: unknown }): Promise<UidResolution> }
export type DirectoryLimits = { [K in keyof typeof THIRD_STAFF_DIRECTORY_LIMITS]: number };
import { createHash } from 'node:crypto';
import { assertPlainJson, deepFreeze } from './p2-007-domain-utils.mjs';

export const THIRD_STAFF_SOURCE = 'THIRD_PARTY_STAFF_DIRECTORY';
export const THIRD_STAFF_FORMAL_BASE_URL = 'https://rd-api.mobimedical.cn/8024';
export const THIRD_STAFF_DIRECTORY_LIMITS = Object.freeze({
  maximumDepartments: 5_000,
  maximumMembers: 20_000,
  maximumMemberships: 40_000,
  maximumDepth: 16,
  maximumResponseBytes: 4 * 1024 * 1024,
  maximumTokenResponseBytes: 64 * 1024,
  maximumDetailResponseBytes: 256 * 1024,
});

function fail(code: string): never {
  const error = new TypeError(code);
  (error as Error & { code: string }).code = code;
  throw error;
}

function text(value: unknown, code: string, maximum = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) fail(code);
  return value;
}

function optionalText(value: unknown, maximum = 256) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > maximum) fail('THIRD_STAFF_DIRECTORY_FIELD_INVALID');
  return value;
}

function detectCycle(value: unknown, maximumDepth: number, ancestors = new Set<object>(), depth = 0): void {
  if (!value || typeof value !== 'object') return;
  if (ancestors.has(value)) fail('THIRD_STAFF_DIRECTORY_CYCLE');
  if (depth > maximumDepth) fail('THIRD_STAFF_DIRECTORY_DEPTH_EXCEEDED');
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const item of value) detectCycle(item, maximumDepth, ancestors, depth + 1);
  } else {
    detectCycle((value as Record<string, unknown>).children, maximumDepth, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

function normalizeGid(value: unknown, warnings: Set<string>) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    warnings.add('GID_DOCUMENTED_STRING_OBSERVED_NUMBER');
    return String(value);
  }
  if (typeof value === 'string' && value.length <= 256) return value;
  fail('THIRD_STAFF_DIRECTORY_GID_INVALID');
}

function normalizeUser(value: unknown): DirectoryMember {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('THIRD_STAFF_DIRECTORY_USER_INVALID');
  const providerUserId = text((value as Record<string, unknown>).user_id, 'THIRD_STAFF_DIRECTORY_USER_ID_INVALID');
  const employeeId = text((value as Record<string, unknown>).tuishiben_id, 'THIRD_STAFF_DIRECTORY_EMPLOYEE_ID_INVALID');
  return {
    provider_user_id: providerUserId,
    employee_id: employeeId,
    nickname: optionalText((value as Record<string, unknown>).nickname),
    phone: optionalText((value as Record<string, unknown>).phone, 64),
    provider_wecom_id: optionalText((value as Record<string, unknown>).wecom_id, 256),
  };
}

function directoryLimits(overrides: Partial<DirectoryLimits>) {
  const limits = { ...THIRD_STAFF_DIRECTORY_LIMITS, ...overrides };
  for (const key of ['maximumDepartments', 'maximumMembers', 'maximumMemberships', 'maximumDepth'] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0
      || limits[key] > THIRD_STAFF_DIRECTORY_LIMITS[key]) fail('THIRD_STAFF_DIRECTORY_LIMITS_INVALID');
  }
  return limits;
}

function hashDirectorySnapshot(snapshot: Omit<DirectorySnapshot, 'snapshot_version' | 'counts'>, limits: DirectoryLimits) {
  // assertPlainJson counts containers, scalar fields and each array's length.
  // Envelope + warning: 10; department: 7; member: 6; membership: 3 nodes.
  const safe: unknown = assertPlainJson(snapshot, {
    maxDepth: 4,
    maxNodes: 10 + 7 * limits.maximumDepartments + 6 * limits.maximumMembers
      + 3 * limits.maximumMemberships,
    maxArrayLength: Math.max(limits.maximumDepartments, limits.maximumMembers, limits.maximumMemberships),
    maxStringLength: 4_096,
  });
  const hash = createHash('sha256');
  // Preserve canonicalJson's exact encoding without allocating one large JSON
  // string or relaxing the shared domain utility's limits for other callers.
  function write(value: JsonValue): void {
    if (value === null || typeof value !== 'object') { hash.update(JSON.stringify(value)); return; }
    const array = Array.isArray(value);
    hash.update(array ? '[' : '{');
    const keys = array ? value.keys() : Object.keys(value).sort();
    let first = true;
    for (const key of keys) {
      if (!first) hash.update(',');
      first = false;
      if (!array) hash.update(`${JSON.stringify(key)}:`);
      write((value as Record<string | number, JsonValue>)[key] as JsonValue);
    }
    hash.update(array ? ']' : '}');
  }
  write(safe as JsonValue);
  return hash.digest('hex');
}

export function normalizeOrganizationTree(input: unknown, overrides: Partial<DirectoryLimits> = THIRD_STAFF_DIRECTORY_LIMITS): DirectorySnapshot {
  const limits = directoryLimits(overrides);
  detectCycle(input, limits.maximumDepth * 2 + 2);
  const data = assertPlainJson(input, {
    maxDepth: limits.maximumDepth * 2 + 4,
    // Root array: 2; department with id/name/gid/users/children: 8;
    // each member occurrence with all five provider fields: 6.
    maxNodes: 2 + 8 * limits.maximumDepartments + 6 * limits.maximumMemberships,
    maxArrayLength: Math.max(limits.maximumDepartments, limits.maximumMembers, limits.maximumMemberships),
    maxStringLength: 4_096,
  });
  if (!Array.isArray(data)) fail('THIRD_STAFF_DIRECTORY_TREE_INVALID');

  const departments: DirectoryDepartment[] = [];
  const members = new Map<string, DirectoryMember>();
  const memberships = new Map<string, DirectoryMembership>();
  const departmentIds = new Set();
  const warnings = new Set<string>();
  let memberOccurrences = 0;

  function walk(node: unknown, parentId: string | null, depth: number): void {
    if (!node || typeof node !== 'object' || Array.isArray(node)) fail('THIRD_STAFF_DIRECTORY_DEPARTMENT_INVALID');
    if (depth > limits.maximumDepth) fail('THIRD_STAFF_DIRECTORY_DEPTH_EXCEEDED');
    const departmentId = text((node as Record<string, unknown>).id, 'THIRD_STAFF_DIRECTORY_DEPARTMENT_ID_INVALID');
    if (departmentIds.has(departmentId)) fail('THIRD_STAFF_DIRECTORY_DUPLICATE_DEPARTMENT');
    departmentIds.add(departmentId);
    if (departments.length >= limits.maximumDepartments) fail('THIRD_STAFF_DIRECTORY_DEPARTMENT_LIMIT_EXCEEDED');
    departments.push({
      provider_department_id: departmentId,
      parent_provider_department_id: parentId,
      name: text((node as Record<string, unknown>).name, 'THIRD_STAFF_DIRECTORY_DEPARTMENT_NAME_INVALID'),
      provider_gid: normalizeGid((node as Record<string, unknown>).gid, warnings),
      provider_gid_type: (node as Record<string, unknown>).gid === undefined || (node as Record<string, unknown>).gid === null || (node as Record<string, unknown>).gid === '' ? null : typeof (node as Record<string, unknown>).gid,
      depth,
    });

    const users = (node as Record<string, unknown>).users === undefined ? [] : (node as Record<string, unknown>).users;
    if (!Array.isArray(users)) fail('THIRD_STAFF_DIRECTORY_USERS_INVALID');
    for (const rawUser of users) {
      // Count occurrences before deduplication: repeated rows also consume the
      // bounded normalization budget, while a person may belong to many departments.
      if (++memberOccurrences > limits.maximumMemberships) fail('THIRD_STAFF_DIRECTORY_MEMBERSHIP_LIMIT_EXCEEDED');
      if (members.size >= limits.maximumMembers && !members.has(rawUser?.user_id)) {
        fail('THIRD_STAFF_DIRECTORY_MEMBER_LIMIT_EXCEEDED');
      }
      const member = normalizeUser(rawUser);
      const previous = members.get(member.provider_user_id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(member)) {
        fail('THIRD_STAFF_DIRECTORY_DUPLICATE_MEMBER');
      }
      if (!previous) members.set(member.provider_user_id, member);
      const membershipKey = `${departmentId}\u0000${member.provider_user_id}`;
      memberships.set(membershipKey, {
        provider_department_id: departmentId,
        provider_user_id: member.provider_user_id,
      });
    }
    const children = (node as Record<string, unknown>).children === undefined ? [] : (node as Record<string, unknown>).children;
    if (!Array.isArray(children)) fail('THIRD_STAFF_DIRECTORY_CHILDREN_INVALID');
    for (const child of children) walk(child, departmentId, depth + 1);
  }

  for (const root of data) walk(root, null, 0);
  const normalized = {
    departments: departments.sort((a, b) => a.provider_department_id.localeCompare(b.provider_department_id)),
    members: [...members.values()].sort((a, b) => a.provider_user_id.localeCompare(b.provider_user_id)),
    memberships: [...memberships.values()].sort((a, b) => `${a.provider_department_id}\u0000${a.provider_user_id}`.localeCompare(`${b.provider_department_id}\u0000${b.provider_user_id}`)),
    protocol_warnings: [...warnings].sort(),
  };
  const snapshotVersion = hashDirectorySnapshot(normalized, limits);
  return deepFreeze({
    ...normalized,
    snapshot_version: snapshotVersion,
    counts: {
      departments: normalized.departments.length,
      members: normalized.members.length,
      memberships: normalized.memberships.length,
      max_depth: normalized.departments.reduce((max, department) => Math.max(max, department.depth), 0),
    },
  });
}

function normalizeAvatar(value: unknown, warnings: Set<string>) {
  const avatar = optionalText(value, 2_048);
  if (avatar === null) return null;
  try {
    const url = new URL(avatar);
    if (url.protocol !== 'https:') {
      warnings.add('AVATAR_NOT_HTTPS');
      return null;
    }
    return url.toString();
  } catch {
    warnings.add('AVATAR_URL_INVALID');
    return null;
  }
}

export function normalizePersonDetail(input: unknown): { profile: PersonProfile; protocol_warnings: string[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('THIRD_STAFF_DIRECTORY_DETAIL_INVALID');
  if ((input as Record<string, unknown>).result !== 'TRUE') fail('THIRD_STAFF_DIRECTORY_PROVIDER_REJECTED');
  const data = (input as Record<string, unknown>).data as Record<string, unknown>;
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('THIRD_STAFF_DIRECTORY_DETAIL_INVALID');
  const warnings = new Set<string>();
  const profile = {
    provider_user_id: text(data.user_id, 'THIRD_STAFF_DIRECTORY_USER_ID_INVALID'),
    employee_id: text(data.employee_id, 'THIRD_STAFF_DIRECTORY_EMPLOYEE_ID_INVALID'),
    display_name: optionalText(data.nickname),
    phone: optionalText(data.phoneno, 64),
    sex: optionalText(data.sex, 32),
    avatar_url: normalizeAvatar(data.avatar, warnings),
  };
  return deepFreeze({ profile, protocol_warnings: [...warnings].sort() });
}

export function matchDirectoryProfile(profile: PersonProfile | null | undefined, member: (Partial<DirectoryMember> & { tuishiben_id?: string }) | null | undefined) {
  const mismatches = [];
  if (!profile || !member || profile.provider_user_id !== member.provider_user_id) mismatches.push('user_id');
  const memberEmployeeId = member?.employee_id ?? member?.tuishiben_id;
  if (profile?.employee_id !== memberEmployeeId) mismatches.push('employee_id');
  if (profile?.display_name && member?.nickname && profile.display_name !== member.nickname) mismatches.push('nickname');
  if (profile?.phone && member?.phone && profile.phone !== member.phone) mismatches.push('phone');
  return Object.freeze({ matched: mismatches.length === 0, mismatches: [...new Set(mismatches)] });
}

export function createFailClosedUidResolver(reasonCode = 'UID_RESOLVER_DISABLED'): UidResolver {
  return Object.freeze({
    async resolveQueryUid() {
      return Object.freeze({ status: 'DEFERRED', reason_code: reasonCode });
    },
  });
}

export function createBotRawUidResolver({ namespace = 'WECOM_AIBOT' } = {}): UidResolver {
  if (typeof namespace !== 'string' || namespace.length === 0 || namespace.length > 128) fail('THIRD_STAFF_DIRECTORY_RESOLVER_INVALID');
  return Object.freeze({
    async resolveQueryUid(input: Parameters<UidResolver['resolveQueryUid']>[0] = {}) {
      if (input.source_namespace !== namespace || typeof input.source_identity_ref !== 'string' || input.source_identity_ref.length === 0) {
        return Object.freeze({ status: 'DEFERRED', reason_code: 'UID_NAMESPACE_UNSUPPORTED' });
      }
      return Object.freeze({
        status: 'RESOLVED', uid: input.source_identity_ref,
        method: 'BOT_RAW_USERID_EXPLICIT_PROFILE', namespace,
      });
    },
  });
}
