import type { PlainJsonLimits } from './p2-007-domain-utils.mjs';
import type { P2015ResultCode, P2015EntryMode } from '../contracts/p2_015_contracts.js';
export type { P2015ResultCode, P2015EntryMode };
import { createHmac, randomBytes } from 'node:crypto';
import {
  assertPlainJson,
  deepFreeze,
  sha256Canonical,
  sha256Text,
} from './p2-007-domain-utils.mjs';

export const P2_015_RESULT_CODES = Object.freeze([
  'TICKET_ELIGIBLE', 'NEEDS_DESCRIPTION', 'MANUAL_REVIEW_REQUIRED',
  'RELATED_FOLLOW_UP', 'STATUS_QUERY', 'SERVICE_REQUEST',
  'BUSINESS_CONSULTATION', 'ACKNOWLEDGEMENT', 'OUT_OF_SCOPE',
  'INCIDENT_REVIEW_CANDIDATE',
] as const);
export const P2_015_ENTRY_MODES = Object.freeze([
  'GROUP_MENTION_INLINE', 'GROUP_MENTION_TO_DIRECT_GUIDED', 'DIRECT_ORGANIC',
] as const);
export const P2_015_ACTION_TYPES = Object.freeze([
  'CREATE_MINIMAL_TICKET', 'APPLY_INTAKE_CLASSIFICATION', 'REQUEST_ONE_DESCRIPTION',
  'ENQUEUE_MANUAL_REVIEW', 'APPEND_RELATED_FOLLOW_UP', 'QUERY_AUTHORIZED_STATUS',
  'ROUTE_SERVICE_REQUEST', 'ROUTE_BUSINESS_CONSULTATION',
  'SEND_FIXED_ACKNOWLEDGEMENT', 'SEND_FIXED_SCOPE_NOTICE', 'ENQUEUE_INCIDENT_REVIEW',
]);
export const P2_015_LIMITS = Object.freeze({
  workerCount: 1,
  poolMax: 4,
  defaultBatch: 20,
  maximumBatch: 100,
  defaultReviewPage: 30,
  maximumReviewPage: 100,
  messageWindowTurns: 50,
  evaluatedTextCharacters: 20_000,
  openJourneyCandidates: 10,
  continuationTtlMinutes: 120,
  recoveryPollMilliseconds: 5_000,
});
export const P2_015_ERROR_CODES = Object.freeze({
  inputInvalid: 'P2_015_INPUT_INVALID',
  limitExceeded: 'P2_015_LIMIT_EXCEEDED',
  featureFlagInvalid: 'P2_015_FEATURE_FLAG_INVALID',
  featureDisabled: 'P2_015_FEATURE_DISABLED',
  storageFailed: 'P2_015_STORAGE_FAILED',
  ruleFailed: 'P2_015_RULE_FAILED',
  decisionConflict: 'P2_015_DECISION_CONFLICT',
  continuationInvalid: 'P2_015_CONTINUATION_INVALID',
  continuationBindingMismatch: 'P2_015_CONTINUATION_BINDING_MISMATCH',
  continuationExpired: 'P2_015_CONTINUATION_EXPIRED',
  continuationConsumed: 'P2_015_CONTINUATION_CONSUMED',
  authorizationDenied: 'P2_015_AUTHORIZATION_DENIED',
  commandConflict: 'P2_015_COMMAND_CONFLICT',
  versionConflict: 'P2_015_VERSION_CONFLICT',
  actionFailed: 'P2_015_ACTION_FAILED',
});

export class P2015Error extends Error {
  declare code: string;
  constructor(code: string) {
    super(code);
    this.name = 'P2015Error';
    this.code = code;
  }
}

export function failP2015(code: string): never {
  throw new P2015Error(code);
}

export function snapshotP2015Json<T>(value: T, limits: PlainJsonLimits = {}): T {
  try {
    return assertPlainJson(value, {
      errorCode: P2_015_ERROR_CODES.inputInvalid,
      maxDepth: limits.maxDepth ?? 16,
      maxNodes: limits.maxNodes ?? 20_000,
      maxArrayLength: limits.maxArrayLength ?? 5_000,
      maxStringLength: limits.maxStringLength ?? P2_015_LIMITS.evaluatedTextCharacters,
    });
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'P2_007_LIMIT_EXCEEDED') failP2015(P2_015_ERROR_CODES.limitExceeded);
    failP2015(P2_015_ERROR_CODES.inputInvalid);
  }
}

function strictBoolean(value: unknown) {
  if (value === undefined || value === null || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  failP2015(P2_015_ERROR_CODES.featureFlagInvalid);
}

export function normalizeP2015FeatureFlags(flags: unknown = {}) {
  const safe = snapshotP2015Json(flags, { maxDepth: 2, maxNodes: 10, maxArrayLength: 1, maxStringLength: 16 }) as Record<string, unknown>;
  return deepFreeze({
    rule_first_orchestration_enabled: strictBoolean(safe.RULE_FIRST_ORCHESTRATION_ENABLED ?? safe.rule_first_orchestration_enabled),
    manual_review_queue_enabled: strictBoolean(safe.MANUAL_REVIEW_QUEUE_ENABLED ?? safe.manual_review_queue_enabled),
  });
}

export function safeHash(value: unknown) {
  return sha256Canonical(snapshotP2015Json(value));
}

export function safeTextHash(value: unknown) {
  if (typeof value !== 'string') failP2015(P2_015_ERROR_CODES.inputInvalid);
  return sha256Text(value);
}

export function hmacIdentity(value: unknown, key: unknown) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
    || typeof key !== 'string' || key.length < 16) failP2015(P2_015_ERROR_CODES.inputInvalid);
  return createHmac('sha256', key).update(value).digest('hex');
}

export function defaultTokenGenerator() {
  return randomBytes(32).toString('base64url');
}

export function freezePublic<T>(value: T): T {
  return deepFreeze(snapshotP2015Json(value));
}

export function normalizeLimit(value: unknown, fallback: number, maximum: number): number {
  const selected = value as number | null | undefined ?? fallback;
  if (!Number.isInteger(selected) || selected < 1 || selected > maximum) failP2015(P2_015_ERROR_CODES.limitExceeded);
  return selected;
}

export function publicError(code: string) {
  return freezePublic({ ok: false, error: { code, retryable: false } });
}
