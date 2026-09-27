import { assertPlainJson, deepFreeze, sha256Canonical } from './p2-007-domain-utils.mjs';

export const THIRD_STAFF_SOURCE = 'THIRD_PARTY_STAFF_DIRECTORY';
export const THIRD_STAFF_FORMAL_BASE_URL = 'https://rd-api.mobimedical.cn/8024';
export const THIRD_STAFF_DIRECTORY_LIMITS = Object.freeze({
  maximumDepartments: 5_000,
  maximumMembers: 20_000,
  maximumDepth: 16,
  maximumResponseBytes: 4 * 1024 * 1024,
  maximumTokenResponseBytes: 64 * 1024,
  maximumDetailResponseBytes: 256 * 1024,
});

function fail(code) {
  const error = new TypeError(code);
  error.code = code;
  throw error;
}

function text(value, code, maximum = 256) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) fail(code);
  return value;
}

function optionalText(value, maximum = 256) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > maximum) fail('THIRD_STAFF_DIRECTORY_FIELD_INVALID');
  return value;
}

function detectCycle(value, ancestors = new Set()) {
  if (!value || typeof value !== 'object') return;
  if (ancestors.has(value)) fail('THIRD_STAFF_DIRECTORY_CYCLE');
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const item of value) detectCycle(item, ancestors);
  } else {
    detectCycle(value.children, ancestors);
    if (Array.isArray(value.children)) for (const child of value.children) detectCycle(child, ancestors);
  }
  ancestors.delete(value);
}

function normalizeGid(value, warnings) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    warnings.add('GID_DOCUMENTED_STRING_OBSERVED_NUMBER');
    return String(value);
  }
  if (typeof value === 'string' && value.length <= 256) return value;
  fail('THIRD_STAFF_DIRECTORY_GID_INVALID');
}

function normalizeUser(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('THIRD_STAFF_DIRECTORY_USER_INVALID');
  const providerUserId = text(value.user_id, 'THIRD_STAFF_DIRECTORY_USER_ID_INVALID');
  const employeeId = text(value.tuishiben_id, 'THIRD_STAFF_DIRECTORY_EMPLOYEE_ID_INVALID');
  return {
    provider_user_id: providerUserId,
    employee_id: employeeId,
    nickname: optionalText(value.nickname),
    phone: optionalText(value.phone, 64),
    provider_wecom_id: optionalText(value.wecom_id, 256),
  };
}

export function normalizeOrganizationTree(input, limits = THIRD_STAFF_DIRECTORY_LIMITS) {
  detectCycle(input);
  const data = assertPlainJson(input, {
    maxDepth: limits.maximumDepth + 4,
    maxNodes: limits.maximumDepartments + limits.maximumMembers * 3,
    maxArrayLength: limits.maximumMembers,
    maxStringLength: 4_096,
  });
  if (!Array.isArray(data)) fail('THIRD_STAFF_DIRECTORY_TREE_INVALID');

  const departments = [];
  const members = new Map();
  const memberships = new Map();
  const departmentIds = new Set();
  const warnings = new Set();

  function walk(node, parentId, depth) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) fail('THIRD_STAFF_DIRECTORY_DEPARTMENT_INVALID');
    if (depth > limits.maximumDepth) fail('THIRD_STAFF_DIRECTORY_DEPTH_EXCEEDED');
    const departmentId = text(node.id, 'THIRD_STAFF_DIRECTORY_DEPARTMENT_ID_INVALID');
    if (departmentIds.has(departmentId)) fail('THIRD_STAFF_DIRECTORY_DUPLICATE_DEPARTMENT');
    departmentIds.add(departmentId);
    if (departments.length >= limits.maximumDepartments) fail('THIRD_STAFF_DIRECTORY_DEPARTMENT_LIMIT_EXCEEDED');
    departments.push({
      provider_department_id: departmentId,
      parent_provider_department_id: parentId,
      name: text(node.name, 'THIRD_STAFF_DIRECTORY_DEPARTMENT_NAME_INVALID'),
      provider_gid: normalizeGid(node.gid, warnings),
      provider_gid_type: node.gid === undefined || node.gid === null || node.gid === '' ? null : typeof node.gid,
      depth,
    });

    const users = node.users === undefined ? [] : node.users;
    if (!Array.isArray(users)) fail('THIRD_STAFF_DIRECTORY_USERS_INVALID');
    for (const rawUser of users) {
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
    const children = node.children === undefined ? [] : node.children;
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
  const snapshotVersion = sha256Canonical(normalized);
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

function normalizeAvatar(value, warnings) {
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

export function normalizePersonDetail(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('THIRD_STAFF_DIRECTORY_DETAIL_INVALID');
  if (input.result !== 'TRUE') fail('THIRD_STAFF_DIRECTORY_PROVIDER_REJECTED');
  const data = input.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('THIRD_STAFF_DIRECTORY_DETAIL_INVALID');
  const warnings = new Set();
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

export function matchDirectoryProfile(profile, member) {
  const mismatches = [];
  if (!profile || !member || profile.provider_user_id !== member.provider_user_id) mismatches.push('user_id');
  const memberEmployeeId = member?.employee_id ?? member?.tuishiben_id;
  if (profile?.employee_id !== memberEmployeeId) mismatches.push('employee_id');
  if (profile?.display_name && member?.nickname && profile.display_name !== member.nickname) mismatches.push('nickname');
  if (profile?.phone && member?.phone && profile.phone !== member.phone) mismatches.push('phone');
  return Object.freeze({ matched: mismatches.length === 0, mismatches: [...new Set(mismatches)] });
}

export function createFailClosedUidResolver(reasonCode = 'UID_RESOLVER_DISABLED') {
  return Object.freeze({
    async resolveQueryUid() {
      return Object.freeze({ status: 'DEFERRED', reason_code: reasonCode });
    },
  });
}

export function createBotRawUidResolver({ namespace = 'WECOM_AIBOT' } = {}) {
  if (typeof namespace !== 'string' || namespace.length === 0 || namespace.length > 128) fail('THIRD_STAFF_DIRECTORY_RESOLVER_INVALID');
  return Object.freeze({
    async resolveQueryUid(input = {}) {
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
