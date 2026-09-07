BEGIN;

CREATE SCHEMA IF NOT EXISTS incident;
ALTER TABLE conversation.realtime_event DROP CONSTRAINT conversation_realtime_event_type_vocabulary_check;
ALTER TABLE conversation.realtime_event ADD CONSTRAINT conversation_realtime_event_type_vocabulary_check CHECK (event_type IN ('conversation.session.created',
  'conversation.session.updated',
  'conversation.item.created',
  'conversation.timeline.rebuilt',
  'conversation.mode.changed',
  'conversation.assigned',
  'conversation.handoff.requested',
  'conversation.handoff.accepted',
  'conversation.read_cursor.changed',
  'communication.delivery.changed',
  'ticket.updated',
  'incident.updated',
  'incident.candidate.review_started',
  'incident.candidate.rejected',
  'incident.candidate.expired',
  'incident.candidate.confirmed',
  'incident.confirmed',
  'incident.status.changed',
  'incident.scope.changed',
  'incident.primary_ticket.changed',
  'incident.report.linked',
  'incident.report.unlinked',
  'incident.report.recovered',
  'incident.subscription.changed',
  'incident.notification.changed',
  'gateway.connection.changed',
  'manual_review.created',
  'manual_review.resolved',
  'ticket.command.committed',
  'ticket.status.changed',
  'ticket.assignment.changed',
  'ticket.notification.created',
  'ticket.notification.delivery_changed'));
ALTER TABLE conversation.realtime_event DROP CONSTRAINT conversation_realtime_event_aggregate_type_check;
ALTER TABLE conversation.realtime_event ADD CONSTRAINT conversation_realtime_event_aggregate_type_check CHECK (aggregate_type IN (
 'CONVERSATION_SESSION','CONVERSATION_ITEM','CONVERSATION_TIMELINE','COMMUNICATION_DELIVERY','TICKET',
 'CONVERSATION_HANDOFF','CONVERSATION_READ_CURSOR','INCIDENT','INCIDENT_CANDIDATE','GATEWAY_CONNECTION','MANUAL_REVIEW'));


CREATE TABLE incident.incident (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    incident_no TEXT NOT NULL UNIQUE CHECK (incident_no ~ '^INC-[A-F0-9]{32}$'),
    status TEXT NOT NULL CHECK (status IN ('CONFIRMED_LOCAL','CONFIRMED_BUILDING','CONFIRMED_CAMPUS','CONFIRMED_HOSPITAL_WIDE','INVESTIGATING','RESOLVED','CLOSED')),
    confirmed_scope TEXT NOT NULL CHECK (confirmed_scope IN ('LOCAL','BUILDING','CAMPUS','HOSPITAL_WIDE')),
    service_family TEXT NOT NULL CHECK (service_family ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    symptom_family TEXT NOT NULL CHECK (symptom_family ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    severity TEXT NOT NULL CHECK (severity IN ('UNKNOWN','LOW','MEDIUM','HIGH','CRITICAL')),
    safe_title TEXT NOT NULL CHECK (safe_title='公共信息系统故障'),
    safe_public_summary_code TEXT NOT NULL CHECK (safe_public_summary_code='PUBLIC_IT_INCIDENT'),
    owner_principal_id UUID NOT NULL REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    owner_team_id TEXT REFERENCES pilot_ticket.resolver_team(team_id) ON DELETE RESTRICT,
    primary_ticket_id UUID REFERENCES pilot_ticket.ticket(id) ON DELETE RESTRICT,
    row_version BIGINT NOT NULL DEFAULT 1 CHECK (row_version>=1),
    event_ordinal BIGINT NOT NULL DEFAULT 0 CHECK (event_ordinal>=0),
    confirmed_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    investigating_at TIMESTAMP WITHOUT TIME ZONE,
    resolved_at TIMESTAMP WITHOUT TIME ZONE,
    closed_at TIMESTAMP WITHOUT TIME ZONE,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    retention_until TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    retention_until_epoch_ms BIGINT NOT NULL CHECK (retention_until_epoch_ms>=0),
    CONSTRAINT p2012_incident_retention CHECK (retention_until=platform.local_from_epoch_ms(retention_until_epoch_ms) AND retention_until>created_at),
    CONSTRAINT p2012_incident_confirmed_scope CHECK (status NOT LIKE 'CONFIRMED_%' OR status='CONFIRMED_'||confirmed_scope),
    CONSTRAINT p2012_incident_lifecycle CHECK (
      (status LIKE 'CONFIRMED_%' AND investigating_at IS NULL AND resolved_at IS NULL AND closed_at IS NULL)
      OR (status='INVESTIGATING' AND investigating_at IS NOT NULL AND resolved_at IS NULL AND closed_at IS NULL)
      OR (status='RESOLVED' AND investigating_at IS NOT NULL AND resolved_at IS NOT NULL AND closed_at IS NULL)
      OR (status='CLOSED' AND investigating_at IS NOT NULL AND resolved_at IS NOT NULL AND closed_at IS NOT NULL)),
    CONSTRAINT p2012_incident_times CHECK (confirmed_at>=created_at AND updated_at>=created_at AND investigating_at>=confirmed_at AND resolved_at>=investigating_at AND closed_at>=resolved_at)
);

CREATE TABLE incident.candidate_review (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    candidate_key TEXT NOT NULL UNIQUE CHECK (candidate_key ~ '^candidate_v1_[a-f0-9]{64}$'),
    source_decision_id UUID NOT NULL REFERENCES intake.deterministic_decision(id) ON DELETE RESTRICT,
    source_manual_review_id UUID REFERENCES intake.manual_review_item(id) ON DELETE RESTRICT,
    cluster_key_hash TEXT CHECK (cluster_key_hash ~ '^[a-f0-9]{64}$'),
    source_result_hash TEXT NOT NULL CHECK (source_result_hash ~ '^[a-f0-9]{64}$'),
    service_family TEXT NOT NULL CHECK (service_family ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    symptom_family TEXT NOT NULL CHECK (symptom_family ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    scope_candidate TEXT NOT NULL CHECK (scope_candidate IN ('UNKNOWN','ROOM','DEPARTMENT','CAMPUS','HOSPITAL_WIDE')),
    clinical_severity_candidate TEXT NOT NULL CHECK (clinical_severity_candidate IN ('UNKNOWN','LOW','MEDIUM','HIGH','CRITICAL')),
    distinct_reporters INTEGER CHECK (distinct_reporters>=0),
    distinct_departments INTEGER CHECK (distinct_departments>=0),
    distinct_locations INTEGER CHECK (distinct_locations>=0),
    correlation_window_ms INTEGER CHECK (correlation_window_ms>=0),
    first_seen_at TIMESTAMP WITHOUT TIME ZONE,
    last_seen_at TIMESTAMP WITHOUT TIME ZONE,
    reason_codes JSONB NOT NULL CHECK (jsonb_typeof(reason_codes)='array' AND jsonb_array_length(reason_codes)<=100),
    evidence_fact_ids JSONB NOT NULL CHECK (jsonb_typeof(evidence_fact_ids)='array' AND jsonb_array_length(evidence_fact_ids)<=1000),
    source_versions JSONB NOT NULL CHECK (jsonb_typeof(source_versions)='object'),
    status TEXT NOT NULL DEFAULT 'CANDIDATE' CHECK (status IN ('CANDIDATE','UNDER_REVIEW','CONFIRMED','REJECTED','EXPIRED')),
    row_version BIGINT NOT NULL DEFAULT 1 CHECK (row_version>=1),
    event_ordinal BIGINT NOT NULL DEFAULT 0 CHECK (event_ordinal>=0),
    opened_by_principal_id UUID REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    opened_at TIMESTAMP WITHOUT TIME ZONE,
    confirmed_incident_id UUID REFERENCES incident.incident(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    expires_epoch_ms BIGINT NOT NULL CHECK (expires_epoch_ms>=0),
    CONSTRAINT p2012_candidate_identity UNIQUE (source_decision_id,source_result_hash),
    CONSTRAINT p2012_candidate_expiry CHECK (expires_at=platform.local_from_epoch_ms(expires_epoch_ms) AND expires_at>created_at),
    CONSTRAINT p2012_candidate_opened CHECK ((opened_at IS NULL)=(opened_by_principal_id IS NULL)),
    CONSTRAINT p2012_candidate_confirmed CHECK ((status='CONFIRMED')=(confirmed_incident_id IS NOT NULL)),
    CONSTRAINT p2012_candidate_review CHECK (status NOT IN ('UNDER_REVIEW','CONFIRMED') OR opened_at IS NOT NULL)
);

CREATE TABLE incident.incident_report (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    candidate_review_id UUID REFERENCES incident.candidate_review(id) ON DELETE RESTRICT,
    incident_id UUID REFERENCES incident.incident(id) ON DELETE RESTRICT,
    source_decision_id UUID NOT NULL REFERENCES intake.deterministic_decision(id) ON DELETE RESTRICT,
    journey_id UUID REFERENCES intake.contact_journey(id) ON DELETE RESTRICT,
    service_intake_id UUID NOT NULL REFERENCES intake.service_intake(id) ON DELETE RESTRICT,
    ticket_id UUID REFERENCES pilot_ticket.ticket(id) ON DELETE RESTRICT,
    reporter_identity_hash TEXT NOT NULL CHECK (reporter_identity_hash ~ '^[a-f0-9]{64}$'),
    origin_channel_leg_id UUID REFERENCES intake.channel_leg(id) ON DELETE RESTRICT,
    direct_channel_leg_id UUID REFERENCES intake.channel_leg(id) ON DELETE RESTRICT,
    link_state TEXT NOT NULL CHECK (link_state IN ('CANDIDATE','LINKED','UNLINKED','REJECTED')),
    impact_state TEXT NOT NULL DEFAULT 'IMPACTED' CHECK (impact_state IN ('UNKNOWN','IMPACTED','RECOVERED')),
    link_reason_code TEXT NOT NULL CHECK (link_reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    unlink_reason_code TEXT CHECK (unlink_reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    recovery_reason_code TEXT CHECK (recovery_reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    linked_by_principal_id UUID REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    unlinked_by_principal_id UUID REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    recovered_by_principal_id UUID REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    row_version BIGINT NOT NULL DEFAULT 1 CHECK (row_version>=1),
    linked_at TIMESTAMP WITHOUT TIME ZONE,
    unlinked_at TIMESTAMP WITHOUT TIME ZONE,
    recovered_at TIMESTAMP WITHOUT TIME ZONE,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    CONSTRAINT p2012_report_source CHECK (candidate_review_id IS NOT NULL OR incident_id IS NOT NULL),
    CONSTRAINT p2012_report_identity UNIQUE (incident_id,source_decision_id),
    CONSTRAINT p2012_report_linked CHECK (link_state<>'LINKED' OR (incident_id IS NOT NULL AND linked_at IS NOT NULL AND linked_by_principal_id IS NOT NULL)),
    CONSTRAINT p2012_report_unlinked CHECK (link_state<>'UNLINKED' OR (unlinked_at IS NOT NULL AND unlinked_by_principal_id IS NOT NULL AND unlink_reason_code IS NOT NULL)),
    CONSTRAINT p2012_report_recovered CHECK (impact_state<>'RECOVERED' OR (recovered_at IS NOT NULL AND recovered_by_principal_id IS NOT NULL AND recovery_reason_code IS NOT NULL))
);
-- Multiple reports may reference the same Ticket within one Incident. The command
-- service serializes Link decisions and rejects links to another current Incident.
CREATE INDEX p2012_ticket_link_idx ON incident.incident_report(ticket_id,incident_id) WHERE link_state='LINKED' AND ticket_id IS NOT NULL;

CREATE TABLE incident.reporter_subscription (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    incident_id UUID NOT NULL REFERENCES incident.incident(id) ON DELETE RESTRICT,
    reporter_identity_hash TEXT NOT NULL CHECK (reporter_identity_hash ~ '^[a-f0-9]{64}$'),
    representative_report_id UUID NOT NULL REFERENCES incident.incident_report(id) ON DELETE RESTRICT,
    direct_channel_leg_id UUID REFERENCES intake.channel_leg(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('PENDING_DESTINATION','ACTIVE','PAUSED','ENDED')),
    impact_state TEXT NOT NULL DEFAULT 'IMPACTED' CHECK (impact_state IN ('UNKNOWN','IMPACTED','RECOVERED')),
    row_version BIGINT NOT NULL DEFAULT 1 CHECK (row_version>=1),
    last_notified_incident_version BIGINT CHECK (last_notified_incident_version>=1),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    ended_at TIMESTAMP WITHOUT TIME ZONE,
    CONSTRAINT p2012_subscription_identity UNIQUE (incident_id,reporter_identity_hash),
    CONSTRAINT p2012_subscription_destination CHECK (status<>'ACTIVE' OR direct_channel_leg_id IS NOT NULL),
    CONSTRAINT p2012_subscription_ended CHECK ((status='ENDED')=(ended_at IS NOT NULL))
);

CREATE TABLE incident.command_receipt (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    command_scope TEXT NOT NULL CHECK (char_length(command_scope) BETWEEN 1 AND 128),
    client_command_id UUID NOT NULL,
    command_hash TEXT NOT NULL CHECK (command_hash ~ '^[a-f0-9]{64}$'),
    command_type TEXT NOT NULL CHECK (command_type IN ('START_REVIEW','REJECT_CANDIDATE','EXPIRE_CANDIDATE','CONFIRM_INCIDENT','START_INVESTIGATING','CORRECT_SCOPE','SET_PRIMARY_TICKET','LINK_REPORT','UNLINK_REPORT','MARK_REPORTER_RECOVERED','PAUSE_SUBSCRIPTION','RESUME_SUBSCRIPTION','RESOLVE_INCIDENT','CLOSE_INCIDENT')),
    candidate_review_id UUID REFERENCES incident.candidate_review(id) ON DELETE RESTRICT,
    incident_id UUID REFERENCES incident.incident(id) ON DELETE RESTRICT,
    incident_report_id UUID REFERENCES incident.incident_report(id) ON DELETE RESTRICT,
    actor_principal_id UUID REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    expected_row_version BIGINT NOT NULL CHECK (expected_row_version>=1),
    state TEXT NOT NULL DEFAULT 'STARTED' CHECK (state IN ('STARTED','COMMITTED','FAILED')),
    result_ref_type TEXT CHECK (result_ref_type IN ('CANDIDATE','INCIDENT')),
    result_ref_id UUID,
    result_row_version BIGINT CHECK (result_row_version>=1),
    result_event_id UUID,
    error_code TEXT CHECK (error_code ~ '^P2_012_[A-Z0-9_]{1,96}$'),
    retryable BOOLEAN,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    completed_at TIMESTAMP WITHOUT TIME ZONE,
    CONSTRAINT p2012_command_identity UNIQUE (command_scope,client_command_id),
    CONSTRAINT p2012_command_resource CHECK (candidate_review_id IS NOT NULL OR incident_id IS NOT NULL),
    CONSTRAINT p2012_command_actor CHECK (actor_principal_id IS NOT NULL OR command_type='EXPIRE_CANDIDATE'),
    CONSTRAINT p2012_command_result CHECK (
      (state='STARTED' AND completed_at IS NULL AND result_ref_id IS NULL AND error_code IS NULL)
      OR (state='COMMITTED' AND completed_at IS NOT NULL AND result_ref_type IS NOT NULL AND result_ref_id IS NOT NULL AND result_row_version IS NOT NULL AND result_event_id IS NOT NULL AND error_code IS NULL)
      OR (state='FAILED' AND completed_at IS NOT NULL AND result_ref_id IS NULL AND error_code IS NOT NULL AND retryable IS NOT NULL))
);

CREATE TABLE incident.incident_event (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    event_key TEXT NOT NULL UNIQUE CHECK (event_key ~ '^incident_event_v1_[a-f0-9]{64}$'),
    incident_id UUID REFERENCES incident.incident(id) ON DELETE RESTRICT,
    candidate_review_id UUID REFERENCES incident.candidate_review(id) ON DELETE RESTRICT,
    event_ordinal BIGINT NOT NULL CHECK (event_ordinal>=1),
    event_type TEXT NOT NULL CHECK (event_type IN ('candidate.review_started','candidate.rejected','candidate.expired','candidate.confirmed','incident.confirmed','incident.investigating','incident.resolved','incident.closed','incident.primary_ticket_changed','incident.report.linked','incident.report.unlinked','incident.report.recovered','incident.subscription.created','incident.subscription.activated','incident.subscription.paused','incident.subscription.ended','incident.scope.corrected')),
    actor_kind TEXT NOT NULL CHECK (actor_kind IN ('HUMAN','SYSTEM')),
    actor_principal_id UUID REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    old_status TEXT,
    new_status TEXT,
    old_scope TEXT,
    new_scope TEXT,
    source_command_id UUID NOT NULL REFERENCES incident.command_receipt(id) ON DELETE RESTRICT,
    safe_payload JSONB NOT NULL CHECK (jsonb_typeof(safe_payload)='object'),
    payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
    occurred_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    CONSTRAINT p2012_event_resource CHECK ((incident_id IS NULL)<>(candidate_review_id IS NULL)),
    CONSTRAINT p2012_event_actor CHECK ((actor_kind='HUMAN' AND actor_principal_id IS NOT NULL) OR (actor_kind='SYSTEM' AND actor_principal_id IS NULL AND event_type='candidate.expired')),
    CONSTRAINT p2012_event_incident_ordinal UNIQUE (incident_id,event_ordinal),
    CONSTRAINT p2012_event_candidate_ordinal UNIQUE (candidate_review_id,event_ordinal)
);
ALTER TABLE incident.command_receipt ADD CONSTRAINT p2012_command_event_fk FOREIGN KEY (result_event_id) REFERENCES incident.incident_event(id) ON DELETE RESTRICT;

CREATE TABLE communication.incident_notification_binding (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    incident_id UUID NOT NULL REFERENCES incident.incident(id) ON DELETE RESTRICT,
    incident_event_id UUID NOT NULL REFERENCES incident.incident_event(id) ON DELETE RESTRICT,
    audience_type TEXT NOT NULL CHECK (audience_type IN ('GROUP','REPORTER_DIRECT')),
    audience_binding_hash TEXT NOT NULL CHECK (audience_binding_hash ~ '^[a-f0-9]{64}$'),
    reporter_subscription_id UUID REFERENCES incident.reporter_subscription(id) ON DELETE RESTRICT,
    origin_channel_leg_id UUID REFERENCES intake.channel_leg(id) ON DELETE RESTRICT,
    template_code TEXT NOT NULL CHECK (template_code IN ('INCIDENT_CONFIRMED_GROUP','INCIDENT_CONFIRMED_DIRECT','INCIDENT_INVESTIGATING_DIRECT','INCIDENT_RESOLVED_GROUP','INCIDENT_RESOLVED_DIRECT','INCIDENT_CLOSED_DIRECT')),
    template_version TEXT NOT NULL CHECK (template_version='1'),
    communication_message_id UUID NOT NULL UNIQUE REFERENCES communication.message(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    CONSTRAINT p2012_notification_identity UNIQUE (incident_event_id,audience_type,audience_binding_hash,template_code,template_version),
    CONSTRAINT p2012_notification_audience CHECK ((audience_type='GROUP' AND origin_channel_leg_id IS NOT NULL AND reporter_subscription_id IS NULL) OR (audience_type='REPORTER_DIRECT' AND reporter_subscription_id IS NOT NULL))
);

CREATE INDEX p2012_candidate_queue_idx ON incident.candidate_review(status,created_at,id);
CREATE INDEX p2012_candidate_expiry_idx ON incident.candidate_review(expires_epoch_ms,id) WHERE status='CANDIDATE';
CREATE INDEX p2012_incident_queue_idx ON incident.incident(status,updated_at DESC,id DESC);
CREATE INDEX p2012_report_incident_idx ON incident.incident_report(incident_id,created_at,id);
CREATE INDEX p2012_report_reporter_idx ON incident.incident_report(incident_id,reporter_identity_hash,link_state,id);
CREATE INDEX p2012_subscription_incident_idx ON incident.reporter_subscription(incident_id,created_at,id);
CREATE INDEX p2012_event_incident_idx ON incident.incident_event(incident_id,occurred_at,event_ordinal);
CREATE INDEX p2012_event_candidate_idx ON incident.incident_event(candidate_review_id,occurred_at,event_ordinal);
CREATE INDEX p2012_notification_incident_idx ON communication.incident_notification_binding(incident_id,created_at,id);

-- Second precision is a database boundary, not only a serializer convention.
DO $p2012_seconds$
DECLARE col RECORD;
BEGIN
  FOR col IN SELECT table_schema,table_name,column_name FROM information_schema.columns
    WHERE (table_schema='incident' OR (table_schema='communication' AND table_name='incident_notification_binding'))
      AND data_type='timestamp without time zone'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK (%I IS NULL OR %I=date_trunc(''second'',%I))',
      col.table_schema,col.table_name,'p2012_seconds_'||col.column_name,col.column_name,col.column_name,col.column_name);
  END LOOP;
END $p2012_seconds$;

COMMIT;
