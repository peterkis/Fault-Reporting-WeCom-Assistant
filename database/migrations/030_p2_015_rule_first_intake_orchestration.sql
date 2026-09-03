BEGIN;

ALTER TABLE intake.service_intake_event
    DROP CONSTRAINT IF EXISTS service_intake_event_type_check;
ALTER TABLE intake.service_intake_event
    ADD CONSTRAINT service_intake_event_type_check CHECK (
        event_type IN (
            'intake.received',
            'intake.needs_clarification',
            'intake.message_added',
            'intake.clarification_added',
            'intake.ticket_created',
            'intake.rule_decision_applied',
            'intake.manual_review_required',
            'intake.description_requested'
        )
    );

CREATE TABLE IF NOT EXISTS intake.contact_journey (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    creation_key TEXT NOT NULL UNIQUE,
    origin_intake_id UUID NOT NULL UNIQUE REFERENCES intake.service_intake(id) ON DELETE RESTRICT,
    origin_session_id UUID REFERENCES conversation.session(id) ON DELETE RESTRICT,
    current_session_id UUID REFERENCES conversation.session(id) ON DELETE RESTRICT,
    linked_ticket_id UUID REFERENCES pilot_ticket.ticket(id) ON DELETE RESTRICT,
    entry_mode TEXT NOT NULL,
    origin_channel TEXT NOT NULL,
    current_channel TEXT NOT NULL,
    reporter_identity_hash TEXT NOT NULL,
    profile_resolution_status TEXT NOT NULL,
    profile_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    profile_snapshot_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    row_version BIGINT NOT NULL DEFAULT 1,
    evaluation_due_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    evaluation_due_epoch_ms BIGINT NOT NULL,
    reported_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    last_activity_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    ended_at TIMESTAMP WITHOUT TIME ZONE,
    privacy_class TEXT NOT NULL,
    retention_until TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    retention_until_epoch_ms BIGINT NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    CONSTRAINT contact_journey_creation_key_check CHECK (char_length(creation_key) BETWEEN 16 AND 256),
    CONSTRAINT contact_journey_entry_mode_check CHECK (entry_mode IN ('GROUP_MENTION_INLINE','GROUP_MENTION_TO_DIRECT_GUIDED','DIRECT_ORGANIC')),
    CONSTRAINT contact_journey_origin_channel_check CHECK (origin_channel IN ('WECOM_GROUP','WECOM_DIRECT')),
    CONSTRAINT contact_journey_current_channel_check CHECK (current_channel IN ('WECOM_GROUP','WECOM_DIRECT')),
    CONSTRAINT contact_journey_entry_origin_check CHECK ((entry_mode LIKE 'GROUP_%' AND origin_channel = 'WECOM_GROUP') OR (entry_mode = 'DIRECT_ORGANIC' AND origin_channel = 'WECOM_DIRECT')),
    CONSTRAINT contact_journey_reporter_hash_check CHECK (reporter_identity_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT contact_journey_profile_status_check CHECK (profile_resolution_status IN ('RESOLVED','DEFERRED','NOT_FOUND','NOT_REQUIRED')),
    CONSTRAINT contact_journey_profile_object_check CHECK (jsonb_typeof(profile_snapshot) = 'object'),
    CONSTRAINT contact_journey_profile_hash_check CHECK (profile_snapshot_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT contact_journey_status_check CHECK (status IN ('OPEN','WAITING_DESCRIPTION','WAITING_REVIEW','TICKET_LINKED','ENDED')),
    CONSTRAINT contact_journey_row_version_check CHECK (row_version >= 1),
    CONSTRAINT contact_journey_due_pair_check CHECK (evaluation_due_epoch_ms >= 0 AND evaluation_due_at = platform.local_from_epoch_ms(evaluation_due_epoch_ms)),
    CONSTRAINT contact_journey_retention_pair_check CHECK (retention_until_epoch_ms >= 0 AND retention_until = platform.local_from_epoch_ms(retention_until_epoch_ms)),
    CONSTRAINT contact_journey_privacy_check CHECK (privacy_class IN ('PUBLIC','INTERNAL','SENSITIVE_INTERNAL','PERSONAL','PATIENT_SENSITIVE','SECRET')),
    CONSTRAINT contact_journey_time_check CHECK (last_activity_at >= reported_at AND retention_until > reported_at AND updated_at >= created_at),
    CONSTRAINT contact_journey_end_check CHECK ((status = 'ENDED' AND ended_at IS NOT NULL) OR (status <> 'ENDED' AND ended_at IS NULL))
);

CREATE TABLE IF NOT EXISTS intake.channel_leg (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    journey_id UUID NOT NULL REFERENCES intake.contact_journey(id) ON DELETE CASCADE,
    leg_ordinal INTEGER NOT NULL,
    leg_type TEXT NOT NULL,
    source_intake_id UUID NOT NULL UNIQUE REFERENCES intake.service_intake(id) ON DELETE RESTRICT,
    conversation_thread_id UUID REFERENCES conversation.thread(id) ON DELETE RESTRICT,
    conversation_session_id UUID REFERENCES conversation.session(id) ON DELETE RESTRICT,
    origin_channel_message_id BIGINT REFERENCES channel.message_inbox(id) ON DELETE RESTRICT,
    provider_context_hash TEXT NOT NULL,
    channel_identity_hash TEXT NOT NULL,
    reporter_identity_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    row_version BIGINT NOT NULL DEFAULT 1,
    opened_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    closed_at TIMESTAMP WITHOUT TIME ZONE,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    CONSTRAINT channel_leg_journey_ordinal_unique UNIQUE (journey_id, leg_ordinal),
    CONSTRAINT channel_leg_ordinal_check CHECK (leg_ordinal >= 1),
    CONSTRAINT channel_leg_type_check CHECK (leg_type IN ('GROUP_ORIGIN','DIRECT_GUIDED','DIRECT_ORGANIC','GROUP_CONTINUATION')),
    CONSTRAINT channel_leg_hashes_check CHECK (provider_context_hash ~ '^[a-f0-9]{64}$' AND channel_identity_hash ~ '^[a-f0-9]{64}$' AND reporter_identity_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT channel_leg_status_check CHECK (status IN ('OPEN','CLOSED')),
    CONSTRAINT channel_leg_row_version_check CHECK (row_version >= 1),
    CONSTRAINT channel_leg_close_check CHECK ((status = 'CLOSED' AND closed_at IS NOT NULL) OR (status = 'OPEN' AND closed_at IS NULL)),
    CONSTRAINT channel_leg_time_check CHECK (updated_at >= created_at AND (closed_at IS NULL OR closed_at >= opened_at))
);

CREATE TABLE IF NOT EXISTS intake.continuation_ref (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    journey_id UUID NOT NULL REFERENCES intake.contact_journey(id) ON DELETE CASCADE,
    origin_leg_id UUID NOT NULL REFERENCES intake.channel_leg(id) ON DELETE RESTRICT,
    target_leg_id UUID REFERENCES intake.channel_leg(id) ON DELETE RESTRICT,
    token_hash TEXT NOT NULL UNIQUE,
    purpose TEXT NOT NULL,
    reporter_binding_hash TEXT NOT NULL,
    bot_binding_hash TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'ISSUED',
    issue_idempotency_key TEXT NOT NULL UNIQUE,
    row_version BIGINT NOT NULL DEFAULT 1,
    issued_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    issued_epoch_ms BIGINT NOT NULL,
    expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    expires_epoch_ms BIGINT NOT NULL,
    consumed_at TIMESTAMP WITHOUT TIME ZONE,
    consumed_epoch_ms BIGINT,
    revoked_at TIMESTAMP WITHOUT TIME ZONE,
    revoked_epoch_ms BIGINT,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    CONSTRAINT continuation_ref_token_hash_check CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT continuation_ref_binding_hash_check CHECK (reporter_binding_hash ~ '^[a-f0-9]{64}$' AND bot_binding_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT continuation_ref_purpose_check CHECK (purpose IN ('GROUP_TO_DIRECT_GUIDANCE','USER_SELECTION','EXPLICIT_CONTINUATION')),
    CONSTRAINT continuation_ref_state_check CHECK (state IN ('ISSUED','BOUND','CONSUMED','REVOKED','EXPIRED')),
    CONSTRAINT continuation_ref_issue_key_check CHECK (char_length(issue_idempotency_key) BETWEEN 16 AND 256),
    CONSTRAINT continuation_ref_row_version_check CHECK (row_version >= 1),
    CONSTRAINT continuation_ref_issued_pair_check CHECK (issued_epoch_ms >= 0 AND issued_at = platform.local_from_epoch_ms(issued_epoch_ms)),
    CONSTRAINT continuation_ref_expiry_pair_check CHECK (expires_epoch_ms > issued_epoch_ms AND expires_at = platform.local_from_epoch_ms(expires_epoch_ms) AND expires_epoch_ms - issued_epoch_ms <= 7200000),
    CONSTRAINT continuation_ref_consumed_pair_check CHECK ((consumed_at IS NULL AND consumed_epoch_ms IS NULL) OR (consumed_at = platform.local_from_epoch_ms(consumed_epoch_ms) AND consumed_epoch_ms >= issued_epoch_ms)),
    CONSTRAINT continuation_ref_revoked_pair_check CHECK ((revoked_at IS NULL AND revoked_epoch_ms IS NULL) OR (revoked_at = platform.local_from_epoch_ms(revoked_epoch_ms) AND revoked_epoch_ms >= issued_epoch_ms)),
    CONSTRAINT continuation_ref_state_shape_check CHECK ((state IN ('ISSUED','BOUND','EXPIRED') AND consumed_at IS NULL AND revoked_at IS NULL) OR (state = 'CONSUMED' AND consumed_at IS NOT NULL AND revoked_at IS NULL) OR (state = 'REVOKED' AND revoked_at IS NOT NULL AND consumed_at IS NULL)),
    CONSTRAINT continuation_ref_target_check CHECK (state = 'ISSUED' OR target_leg_id IS NOT NULL OR state IN ('REVOKED','EXPIRED'))
);

CREATE TABLE IF NOT EXISTS intake.deterministic_decision (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    journey_id UUID NOT NULL REFERENCES intake.contact_journey(id) ON DELETE CASCADE,
    channel_leg_id UUID NOT NULL REFERENCES intake.channel_leg(id) ON DELETE RESTRICT,
    service_intake_id UUID NOT NULL REFERENCES intake.service_intake(id) ON DELETE RESTRICT,
    conversation_session_id UUID REFERENCES conversation.session(id) ON DELETE RESTRICT,
    linked_ticket_id UUID REFERENCES pilot_ticket.ticket(id) ON DELETE RESTRICT,
    decision_ordinal INTEGER NOT NULL,
    decision_key TEXT NOT NULL UNIQUE,
    source_window_start_sequence INTEGER NOT NULL,
    source_window_end_sequence INTEGER NOT NULL,
    source_message_count INTEGER NOT NULL,
    source_hash TEXT NOT NULL,
    catalog_version TEXT NOT NULL,
    rule_set_version TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    decision_policy_version TEXT NOT NULL,
    result_code TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    result_hash TEXT NOT NULL,
    safe_result JSONB NOT NULL,
    requires_manual_review BOOLEAN NOT NULL,
    ticket_creation_recommended BOOLEAN NOT NULL,
    incident_review_candidate BOOLEAN NOT NULL,
    status TEXT NOT NULL DEFAULT 'RECORDED',
    observed_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    CONSTRAINT deterministic_decision_journey_ordinal_unique UNIQUE (journey_id, decision_ordinal),
    CONSTRAINT deterministic_decision_ordinal_check CHECK (decision_ordinal >= 1),
    CONSTRAINT deterministic_decision_window_check CHECK (source_window_start_sequence >= 1 AND source_window_end_sequence >= source_window_start_sequence AND source_message_count = source_window_end_sequence - source_window_start_sequence + 1 AND source_message_count <= 50),
    CONSTRAINT deterministic_decision_hashes_check CHECK (source_hash ~ '^[a-f0-9]{64}$' AND input_hash ~ '^[a-f0-9]{64}$' AND result_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT deterministic_decision_version_check CHECK (char_length(catalog_version) BETWEEN 1 AND 64 AND char_length(rule_set_version) BETWEEN 1 AND 64 AND char_length(engine_version) BETWEEN 1 AND 64 AND char_length(decision_policy_version) BETWEEN 1 AND 64),
    CONSTRAINT deterministic_decision_result_check CHECK (result_code IN ('TICKET_ELIGIBLE','NEEDS_DESCRIPTION','MANUAL_REVIEW_REQUIRED','RELATED_FOLLOW_UP','STATUS_QUERY','SERVICE_REQUEST','BUSINESS_CONSULTATION','ACKNOWLEDGEMENT','OUT_OF_SCOPE','INCIDENT_REVIEW_CANDIDATE')),
    CONSTRAINT deterministic_decision_reason_check CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    CONSTRAINT deterministic_decision_safe_result_check CHECK (jsonb_typeof(safe_result) = 'object'),
    CONSTRAINT deterministic_decision_status_check CHECK (status IN ('RECORDED','SUPERSEDED','CONFLICTED','HUMAN_OVERRIDDEN','ACTION_FAILED'))
);

CREATE TABLE IF NOT EXISTS intake.manual_review_item (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    review_key TEXT NOT NULL UNIQUE,
    journey_id UUID NOT NULL REFERENCES intake.contact_journey(id) ON DELETE CASCADE,
    decision_id UUID NOT NULL REFERENCES intake.deterministic_decision(id) ON DELETE RESTRICT,
    service_intake_id UUID NOT NULL REFERENCES intake.service_intake(id) ON DELETE RESTRICT,
    linked_ticket_id UUID REFERENCES pilot_ticket.ticket(id) ON DELETE RESTRICT,
    review_reason_code TEXT NOT NULL,
    priority TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    row_version BIGINT NOT NULL DEFAULT 1,
    resolution_command_id UUID,
    resolution_command_hash TEXT,
    resolution_code TEXT,
    resolution_reason_code TEXT,
    resolved_by_principal_id UUID REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    resolution_decision_id UUID REFERENCES intake.deterministic_decision(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    resolved_at TIMESTAMP WITHOUT TIME ZONE,
    CONSTRAINT manual_review_reason_check CHECK (review_reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    CONSTRAINT manual_review_priority_check CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
    CONSTRAINT manual_review_status_check CHECK (status IN ('PENDING','RESOLVED','CANCELLED')),
    CONSTRAINT manual_review_row_version_check CHECK (row_version >= 1),
    CONSTRAINT manual_review_command_hash_check CHECK (resolution_command_hash IS NULL OR resolution_command_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT manual_review_resolution_code_check CHECK (resolution_code IS NULL OR resolution_code IN ('CONFIRM_TICKET_ELIGIBLE','REQUEST_DESCRIPTION','CLASSIFY_SERVICE_REQUEST','CLASSIFY_BUSINESS_CONSULTATION','ACKNOWLEDGE','MARK_OUT_OF_SCOPE','LINK_EXISTING_JOURNEY','KEEP_INCIDENT_REVIEW_CANDIDATE','CANCEL_REVIEW')),
    CONSTRAINT manual_review_resolution_shape_check CHECK ((status = 'PENDING' AND resolution_command_id IS NULL AND resolution_command_hash IS NULL AND resolution_code IS NULL AND resolved_by_principal_id IS NULL AND resolution_decision_id IS NULL AND resolved_at IS NULL) OR (status IN ('RESOLVED','CANCELLED') AND resolution_command_id IS NOT NULL AND resolution_command_hash IS NOT NULL AND resolution_code IS NOT NULL AND resolved_by_principal_id IS NOT NULL AND resolution_decision_id IS NOT NULL AND resolved_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS intake.safe_action_suggestion (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    decision_id UUID NOT NULL REFERENCES intake.deterministic_decision(id) ON DELETE CASCADE,
    action_ordinal INTEGER NOT NULL,
    action_key TEXT NOT NULL UNIQUE,
    action_type TEXT NOT NULL,
    execution_policy TEXT NOT NULL,
    safe_payload JSONB NOT NULL,
    payload_hash TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'PROPOSED',
    row_version BIGINT NOT NULL DEFAULT 1,
    execution_command_id UUID,
    execution_command_hash TEXT,
    result_ref_type TEXT,
    result_ref_id TEXT,
    error_code TEXT,
    retryable BOOLEAN,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai'),
    executed_at TIMESTAMP WITHOUT TIME ZONE,
    CONSTRAINT safe_action_decision_ordinal_unique UNIQUE (decision_id, action_ordinal),
    CONSTRAINT safe_action_ordinal_check CHECK (action_ordinal >= 1),
    CONSTRAINT safe_action_type_check CHECK (action_type IN ('CREATE_MINIMAL_TICKET','APPLY_INTAKE_CLASSIFICATION','REQUEST_ONE_DESCRIPTION','ENQUEUE_MANUAL_REVIEW','APPEND_RELATED_FOLLOW_UP','QUERY_AUTHORIZED_STATUS','ROUTE_SERVICE_REQUEST','ROUTE_BUSINESS_CONSULTATION','SEND_FIXED_ACKNOWLEDGEMENT','SEND_FIXED_SCOPE_NOTICE','ENQUEUE_INCIDENT_REVIEW')),
    CONSTRAINT safe_action_policy_check CHECK (execution_policy IN ('AUTO_SAFE_DB_ONLY','HUMAN_CONFIRM_REQUIRED','NO_EXECUTION_IN_P2_015')),
    CONSTRAINT safe_action_payload_check CHECK (jsonb_typeof(safe_payload) = 'object' AND payload_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT safe_action_state_check CHECK (state IN ('PROPOSED','EXECUTED','REPLAYED','FAILED','CANCELLED')),
    CONSTRAINT safe_action_row_version_check CHECK (row_version >= 1),
    CONSTRAINT safe_action_command_hash_check CHECK (execution_command_hash IS NULL OR execution_command_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT safe_action_result_check CHECK (result_ref_type IS NULL OR result_ref_type IN ('INTAKE','TICKET','COMMUNICATION','MANUAL_REVIEW','JOURNEY')),
    CONSTRAINT safe_action_execution_shape_check CHECK ((state = 'PROPOSED' AND execution_command_id IS NULL AND execution_command_hash IS NULL AND result_ref_type IS NULL AND result_ref_id IS NULL AND error_code IS NULL AND retryable IS NULL AND executed_at IS NULL) OR (state IN ('EXECUTED','REPLAYED') AND execution_command_id IS NOT NULL AND execution_command_hash IS NOT NULL AND result_ref_type IS NOT NULL AND result_ref_id IS NOT NULL AND error_code IS NULL AND executed_at IS NOT NULL) OR (state = 'FAILED' AND execution_command_id IS NOT NULL AND execution_command_hash IS NOT NULL AND error_code IS NOT NULL AND retryable IS NOT NULL AND executed_at IS NOT NULL) OR (state = 'CANCELLED' AND executed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS contact_journey_reporter_status_activity_idx ON intake.contact_journey (reporter_identity_hash, status, last_activity_at DESC, id);
CREATE INDEX IF NOT EXISTS contact_journey_origin_intake_idx ON intake.contact_journey (origin_intake_id);
CREATE INDEX IF NOT EXISTS contact_journey_linked_ticket_idx ON intake.contact_journey (linked_ticket_id) WHERE linked_ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contact_journey_evaluation_due_idx ON intake.contact_journey (evaluation_due_epoch_ms, id) WHERE status IN ('OPEN','WAITING_DESCRIPTION');
CREATE INDEX IF NOT EXISTS channel_leg_journey_ordinal_idx ON intake.channel_leg (journey_id, leg_ordinal);
CREATE INDEX IF NOT EXISTS channel_leg_session_idx ON intake.channel_leg (conversation_session_id) WHERE conversation_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS channel_leg_source_message_idx ON intake.channel_leg (origin_channel_message_id) WHERE origin_channel_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS continuation_ref_active_journey_purpose_idx ON intake.continuation_ref (journey_id, purpose, expires_epoch_ms, id) WHERE state IN ('ISSUED','BOUND');
CREATE INDEX IF NOT EXISTS continuation_ref_expiry_state_idx ON intake.continuation_ref (expires_epoch_ms, state, id);
CREATE INDEX IF NOT EXISTS deterministic_decision_source_window_idx ON intake.deterministic_decision (service_intake_id, source_window_start_sequence, source_window_end_sequence);
CREATE INDEX IF NOT EXISTS deterministic_decision_result_review_idx ON intake.deterministic_decision (result_code, requires_manual_review, status, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS manual_review_one_pending_per_decision_idx ON intake.manual_review_item (decision_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS manual_review_pending_priority_keyset_idx ON intake.manual_review_item ((CASE priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END), created_at, id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS manual_review_ticket_journey_idx ON intake.manual_review_item (journey_id, linked_ticket_id, id);
CREATE INDEX IF NOT EXISTS safe_action_state_created_idx ON intake.safe_action_suggestion (state, created_at, id);
CREATE INDEX IF NOT EXISTS safe_action_result_ref_idx ON intake.safe_action_suggestion (result_ref_type, result_ref_id) WHERE result_ref_id IS NOT NULL;

COMMENT ON TABLE intake.contact_journey IS 'P2-015 cross-channel association without merging provider threads or owning Ticket state.';
COMMENT ON TABLE intake.channel_leg IS 'P2-015 independent group/direct channel leg; provider identifiers are stored only as safe hashes or existing FKs.';
COMMENT ON TABLE intake.continuation_ref IS 'P2-015 bounded one-time continuation reference; only the token hash is persisted.';
COMMENT ON TABLE intake.deterministic_decision IS 'P2-015 immutable deterministic decision, version identity, safe provenance and source window.';
COMMENT ON TABLE intake.manual_review_item IS 'P2-015 first-class manual review queue; human resolution appends an override decision.';
COMMENT ON TABLE intake.safe_action_suggestion IS 'P2-015 auditable safe action suggestion executed only through injected ports.';

COMMIT;
