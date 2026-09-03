import type { LocalDateTime } from './time_contracts';

export type P2007EntryMode =
  | "GROUP_MENTION_INLINE"
  | "GROUP_MENTION_TO_DIRECT_GUIDED"
  | "DIRECT_ORGANIC";

export type P2007JourneyChannel = "WECOM_GROUP" | "WECOM_DIRECT";

export type P2007DescriptionSufficiency =
  | "EMPTY"
  | "PARTIAL"
  | "SUFFICIENT_FOR_INTAKE"
  | "SUFFICIENT_FOR_ROUTING"
  | "SENSITIVE_MOVE_TO_PRIVATE"
  | "CONFLICTED";

export interface P2007ProviderContextSnapshot {
  provider: "WECOM_AIBOT";
  message_ref: string;
  callback_request_ref: string | null;
  chat_ref: string | null;
  chat_type: "GROUP" | "DIRECT";
  sender_ref: string;
  quote_present: boolean;
  response_url_present: boolean;
  occurred_at: LocalDateTime;
}

export interface P2007ContactJourney {
  schema_version: "1.0.0";
  journey_id: string;
  entry_mode: P2007EntryMode;
  origin_channel: P2007JourneyChannel;
  current_channel: P2007JourneyChannel;
  origin_trigger:
    | "BOT_MENTION_WITH_DESCRIPTION"
    | "BOT_MENTION_ONLY"
    | "DIRECT_USER_MESSAGE";
  reporter_person_id: string;
  reported_at: LocalDateTime;
  origin_message_ref: string;
  provider_context: P2007ProviderContextSnapshot;
  continuation_state:
    | "NOT_REQUIRED"
    | "PENDING"
    | "BOUND"
    | "AMBIGUOUS"
    | "EXPIRED"
    | "REVOKED";
  same_user_and_time_only_used: false;
}

export interface P2007ReporterProfileSnapshot {
  schema_version: "1.0.0";
  snapshot_id: string;
  person_id: string;
  lookup_status: "RESOLVED" | "PARTIAL" | "DEFERRED" | "NOT_FOUND" | "FAILED_SAFE";
  profile_authority: "WECOM_DIRECTORY" | "HOSPITAL_PERSON_MASTER" | "NONE";
  display_name_state: "KNOWN_INTERNAL" | "UNKNOWN" | "REDACTED";
  display_name: string | null;
  memberships: Array<{
    department_ref: string;
    department_name_state: "KNOWN_INTERNAL" | "UNKNOWN" | "REDACTED";
    department_name: string | null;
    is_primary: boolean;
    membership_role: "PRIMARY" | "SECONDARY" | "ROTATION" | "TEMPORARY" | "UNKNOWN";
    source: "WECOM_DIRECTORY" | "HOSPITAL_PERSON_MASTER" | "HUMAN_CONFIRMED";
    valid_at: LocalDateTime;
  }>;
  observed_at: LocalDateTime;
  fetched_at: LocalDateTime;
  snapshot_hash: string;
  directory_failure_blocked_intake: false;
}

export interface P2007IncidentCandidate {
  schema_version: "1.0.0";
  candidate_id: string;
  candidate_state: "CANDIDATE" | "UNDER_REVIEW" | "REJECTED" | "EXPIRED";
  scope_candidate: "LOCAL" | "CROSS_DEPARTMENT" | "BUILDING" | "CAMPUS" | "HOSPITAL_WIDE" | "UNKNOWN";
  signature_hash: string;
  policy_version: string;
  window_seconds: number;
  distinct_reporter_count: number;
  department_count: number;
  building_count: number;
  human_confirmation_required: true;
  automatic_incident_creation: false;
  automatic_ticket_linking: false;
  automatic_public_broadcast: false;
}

export interface P2007NotificationRecommendation {
  schema_version: "1.0.0";
  recommendation_id: string;
  purpose:
    | "GROUP_RECEIPT"
    | "DIRECT_GUIDANCE"
    | "TICKET_CREATED_CARD"
    | "TICKET_STATUS_CARD"
    | "INCIDENT_INTERNAL_ALERT"
    | "INCIDENT_GROUP_NOTICE"
    | "INCIDENT_PRIVATE_NOTICE";
  channel: "WECOM_GROUP" | "WECOM_DIRECT" | "WORKBENCH_INTERNAL";
  transport: "CALLBACK_REPLY" | "AIBOT_SEND_MSG" | "COMMUNICATION_PIPELINE" | "INTERNAL_REALTIME_EVENT";
  idempotency_key: string;
  external_side_effect_performed: false;
}
