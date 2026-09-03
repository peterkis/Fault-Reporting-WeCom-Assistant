import {
  P2_007_ERROR_CODES,
  assertPlainJson,
  deepFreeze,
  failP2007,
  sha256Canonical,
  uniqueSorted,
} from './p2-007-domain-utils.mjs';

const PROFILES = Object.freeze({
  GROUP_MENTION_RECEIVED: ['GROUP_RECEIPT', 'ORIGIN_GROUP', 'WECOM_GROUP', 'WECOM_DIRECT', 'PUBLIC_SAFE'],
  PRIVATE_GUIDANCE_REQUIRED: ['PRIVATE_GUIDANCE', 'REPORTER', 'WECOM_DIRECT', 'NONE', 'PERSONAL'],
  TICKET_CREATED: ['TICKET_ACKNOWLEDGEMENT', 'REPORTER', 'WECOM_DIRECT', 'NONE', 'PERSONAL'],
  INCIDENT_CANDIDATE_DETECTED: ['INCIDENT_UNDER_REVIEW', 'ASSIGNED_AGENTS', 'WORKBENCH_INTERNAL', 'NONE', 'INTERNAL'],
  INCIDENT_CONFIRMED: ['INCIDENT_STATUS_UPDATE', 'INCIDENT_SUBSCRIBERS', 'WECOM_DIRECT', 'WECOM_GROUP', 'PUBLIC_SAFE'],
  INCIDENT_UPDATED: ['INCIDENT_STATUS_UPDATE', 'INCIDENT_SUBSCRIBERS', 'WECOM_DIRECT', 'WECOM_GROUP', 'PUBLIC_SAFE'],
  INCIDENT_RESOLVED: ['INCIDENT_RESOLUTION', 'INCIDENT_SUBSCRIBERS', 'WECOM_DIRECT', 'WECOM_GROUP', 'PUBLIC_SAFE'],
  DELIVERY_UNKNOWN: ['DELIVERY_RECONCILIATION', 'ASSIGNED_AGENTS', 'WORKBENCH_INTERNAL', 'NONE', 'INTERNAL'],
  INTERNAL_NOTE_CREATED: ['NO_EXTERNAL_NOTIFICATION', 'NONE', 'NONE', 'NONE', 'INTERNAL'],
});

const TYPE_TO_TRIGGER = Object.freeze({
  DIRECT_GUIDANCE_REQUIRED: 'PRIVATE_GUIDANCE_REQUIRED',
  GROUP_RECEIPT: 'GROUP_MENTION_RECEIVED',
  TICKET_CREATED_CARD: 'TICKET_CREATED',
  INCIDENT_INTERNAL_ALERT: 'INCIDENT_CANDIDATE_DETECTED',
});

export function generateNotificationRecommendation(input) {
  const safe = assertPlainJson(input);
  const trigger = TYPE_TO_TRIGGER[safe.type] ?? safe.trigger;
  const profile = PROFILES[trigger];
  if (!profile) failP2007(P2_007_ERROR_CODES.inputInvalid);
  const [purpose, audience, preferredChannel, fallbackChannel, contentClass] = profile;
  const scopeRef = safe.idempotency_scope ?? [
    'p2-007', trigger.toLowerCase(), safe.journey_ref ?? safe.candidate_ref ?? safe.source_ref ?? 'unknown', 'v1',
  ].join(':');
  if (typeof scopeRef !== 'string' || scopeRef.length > 256) failP2007(P2_007_ERROR_CODES.inputInvalid);
  const factIds = uniqueSorted(Array.isArray(safe.provenance_fact_ids) ? safe.provenance_fact_ids : []);
  if (factIds.some((id) => !/^fact_[A-Za-z0-9_-]{8,96}$/u.test(id))) failP2007(P2_007_ERROR_CODES.inputInvalid);
  const semantic = { trigger, purpose, audience, preferred_channel: preferredChannel, idempotency_scope: scopeRef };
  return deepFreeze({
    schema_version: '1.0.0',
    recommendation_ref: `recommendation:${sha256Canonical(semantic).slice(0, 32)}`,
    trigger,
    purpose,
    audience,
    preferred_channel: preferredChannel,
    fallback_channel: fallbackChannel,
    content_class: contentClass,
    idempotency_scope: scopeRef,
    requires_outbox: purpose !== 'NO_EXTERNAL_NOTIFICATION' && preferredChannel !== 'WORKBENCH_INTERNAL',
    execution_owner: 'P2_004_COMMUNICATION_OUTBOX_DELIVERY',
    preserve_origin_journey: true,
    send_authorized: false,
    provenance_fact_ids: factIds,
  });
}

export const recommendNotification = generateNotificationRecommendation;
