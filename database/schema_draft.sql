-- ============================================================================
-- V1.4 CONCEPTUAL SCHEMA DRAFT
-- ============================================================================
-- This file is NOT a production migration. NEVER execute or apply this file as
-- a whole, manually or automatically. Apply only reviewed numbered migrations.
--
-- Current G0/P1 production-like migrations remain authoritative, including:
--   channel.message_inbox
--   intake.service_intake
--   pilot_ticket.ticket
--   pilot_ticket.ticket_event
--   notification.outbox / delivery / delivery_attempt
--   pilot access control tables
--
-- V1.4 adds conceptual Conversation, Communication, AI and greenfield Integration tables.
-- Migration 010 is authoritative for the P2-001 Thread/Session physical shape.
-- Migration 011 is authoritative for the P2-002 Item/Item Source Binding/
-- Projection Checkpoint physical shape. The three matching blocks below are
-- navigation mirrors only and cannot supersede the numbered migrations.
--
-- P2-002 completed on 2026-08-30. Realtime Event, Handoff, Assignment,
-- Read Cursor, Communication, AI and Integration tables remain conceptual and
-- are NOT authorized by P2-002. Their presence below is not implementation or
-- Gate authorization. The remaining conceptual tables require their own task
-- and Assembly Gate approval.
-- Do not create a second long-term Ticket Core and do not rename pilot_ticket.*
-- in a big-bang migration.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS conversation;
CREATE SCHEMA IF NOT EXISTS communication;
CREATE SCHEMA IF NOT EXISTS ai;
CREATE SCHEMA IF NOT EXISTS integration;

-- ============================================================================
-- Conversation Center
-- ============================================================================

CREATE TABLE IF NOT EXISTS conversation.thread (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    provider text NOT NULL,
    channel_account_id text NOT NULL,
    chat_type text NOT NULL CHECK (chat_type IN ('single', 'group')),
    external_thread_key text NOT NULL,
    thread_key text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ARCHIVED')),
    last_activity_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, channel_account_id, chat_type, external_thread_key)
);

CREATE INDEX IF NOT EXISTS idx_conversation_thread_last_activity
    ON conversation.thread (last_activity_at DESC);

CREATE TABLE IF NOT EXISTS conversation.session (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    thread_id uuid NOT NULL REFERENCES conversation.thread(id),
    participant_key text NOT NULL,
    service_intake_id uuid NULL REFERENCES intake.service_intake(id),
    session_scope_key text NOT NULL,
    creation_idempotency_key text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'WAITING_USER', 'ENDED')),
    control_mode text NOT NULL DEFAULT 'HUMAN'
        CHECK (control_mode IN ('AUTO', 'COPILOT', 'HUMAN')),
    generation_version bigint NOT NULL DEFAULT 1 CHECK (generation_version >= 1),
    row_version bigint NOT NULL DEFAULT 1 CHECK (row_version >= 1),
    started_at timestamptz NOT NULL DEFAULT now(),
    last_activity_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz NULL,
    close_reason text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'ENDED' AND ended_at IS NOT NULL) OR status <> 'ENDED')
);

CREATE INDEX IF NOT EXISTS idx_conversation_session_thread_activity
    ON conversation.session (thread_id, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_session_scope
    ON conversation.session (session_scope_key);

-- P2-001 freezes one active Session per participant/thread. Parallel topic
-- Sessions require a future ADR and must not weaken this contract implicitly.
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_session_active_participant
    ON conversation.session (thread_id, participant_key)
    WHERE status <> 'ENDED';

CREATE TABLE IF NOT EXISTS conversation.item (
    id uuid NOT NULL DEFAULT uuidv7(),
    session_id uuid NOT NULL,
    sequence_no bigint NOT NULL,
    item_type text NOT NULL,
    sender_kind text NOT NULL,
    visibility text NOT NULL,
    text text NULL,
    safe_content jsonb NOT NULL DEFAULT '{}'::jsonb,
    source_type text NOT NULL,
    source_id text NOT NULL,
    projection_variant text NOT NULL,
    canonical_order_key text NOT NULL,
    content_hash text NOT NULL,
    privacy_class text NOT NULL,
    retention_until timestamptz NOT NULL,
    occurred_at timestamptz NOT NULL,
    projected_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT conversation_item_pkey PRIMARY KEY (id),
    CONSTRAINT conversation_item_id_session_unique UNIQUE (id, session_id),
    CONSTRAINT conversation_item_session_sequence_unique UNIQUE (session_id, sequence_no),
    CONSTRAINT conversation_item_session_fk FOREIGN KEY (session_id)
        REFERENCES conversation.session(id) ON DELETE CASCADE,
    CONSTRAINT conversation_item_sequence_check CHECK (sequence_no >= 1),
    CONSTRAINT conversation_item_type_check CHECK (item_type IN (
        'USER_MESSAGE',
        'AI_MESSAGE',
        'AGENT_MESSAGE',
        'INTERNAL_NOTE',
        'SYSTEM_EVENT',
        'TICKET_EVENT',
        'DELIVERY_STATUS',
        'HANDOFF_EVENT'
    )),
    CONSTRAINT conversation_item_sender_kind_check CHECK (sender_kind IN (
        'USER', 'AI', 'AGENT', 'SYSTEM', 'TOOL'
    )),
    CONSTRAINT conversation_item_visibility_check CHECK (visibility IN (
        'EXTERNAL', 'INTERNAL', 'RESTRICTED'
    )),
    CONSTRAINT conversation_item_text_length_check CHECK (
        text IS NULL OR char_length(text) <= 20000
    ),
    CONSTRAINT conversation_item_safe_content_check CHECK (
        jsonb_typeof(safe_content) = 'object'
    ),
    CONSTRAINT conversation_item_source_type_check CHECK (source_type IN (
        'CHANNEL_MESSAGE',
        'COMMUNICATION_MESSAGE',
        'TICKET_EVENT',
        'DELIVERY',
        'HANDOFF_EVENT'
    )),
    CONSTRAINT conversation_item_source_id_length_check CHECK (
        char_length(source_id) BETWEEN 1 AND 256
    ),
    CONSTRAINT conversation_item_projection_variant_check CHECK (
        char_length(projection_variant) BETWEEN 1 AND 64
        AND projection_variant ~ '^[A-Z][A-Z0-9_]{0,63}$'
    ),
    CONSTRAINT conversation_item_canonical_order_key_length_check CHECK (
        char_length(canonical_order_key) BETWEEN 1 AND 1024
    ),
    CONSTRAINT conversation_item_content_hash_check CHECK (
        content_hash ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT conversation_item_privacy_class_check CHECK (privacy_class IN (
        'PUBLIC',
        'INTERNAL',
        'SENSITIVE_INTERNAL',
        'PERSONAL',
        'PATIENT_SENSITIVE',
        'SECRET'
    ))
);

CREATE TABLE IF NOT EXISTS conversation.item_source_binding (
    projector_name text NOT NULL,
    projector_version text NOT NULL,
    source_stream text NOT NULL,
    source_type text NOT NULL,
    source_id text NOT NULL,
    projection_variant text NOT NULL,
    session_id uuid NOT NULL,
    item_id uuid NOT NULL,
    source_hash text NOT NULL,
    canonical_order_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT conversation_item_source_binding_pkey PRIMARY KEY (item_id),
    CONSTRAINT conversation_item_source_binding_identity_unique UNIQUE (
        projector_name,
        source_stream,
        source_type,
        source_id,
        projection_variant,
        session_id
    ),
    CONSTRAINT conversation_item_source_binding_session_fk FOREIGN KEY (session_id)
        REFERENCES conversation.session(id) ON DELETE CASCADE,
    CONSTRAINT conversation_item_source_binding_item_session_fk FOREIGN KEY (item_id, session_id)
        REFERENCES conversation.item(id, session_id) ON DELETE CASCADE,
    CONSTRAINT conversation_item_source_binding_projector_name_length_check CHECK (
        char_length(projector_name) BETWEEN 1 AND 128
        AND projector_name ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    ),
    CONSTRAINT conversation_item_source_binding_projector_version_length_check CHECK (
        char_length(projector_version) BETWEEN 1 AND 64
        AND projector_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'
    ),
    CONSTRAINT conversation_item_source_binding_source_stream_length_check CHECK (
        char_length(source_stream) BETWEEN 1 AND 128
        AND source_stream ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    ),
    CONSTRAINT conversation_item_source_binding_source_type_check CHECK (source_type IN (
        'CHANNEL_MESSAGE',
        'COMMUNICATION_MESSAGE',
        'TICKET_EVENT',
        'DELIVERY',
        'HANDOFF_EVENT'
    )),
    CONSTRAINT conversation_item_source_binding_source_id_length_check CHECK (
        char_length(source_id) BETWEEN 1 AND 256
    ),
    CONSTRAINT conversation_item_source_binding_projection_variant_check CHECK (
        char_length(projection_variant) BETWEEN 1 AND 64
        AND projection_variant ~ '^[A-Z][A-Z0-9_]{0,63}$'
    ),
    CONSTRAINT conversation_item_source_binding_source_hash_check CHECK (
        source_hash ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT conversation_item_source_binding_order_key_length_check CHECK (
        char_length(canonical_order_key) BETWEEN 1 AND 1024
    ),
    CONSTRAINT conversation_item_source_binding_seen_time_check CHECK (
        last_seen_at >= created_at
    )
);

CREATE INDEX IF NOT EXISTS conversation_item_external_timeline_idx
    ON conversation.item (session_id, sequence_no)
    WHERE visibility = 'EXTERNAL';

CREATE INDEX IF NOT EXISTS conversation_item_retention_idx
    ON conversation.item (retention_until);

CREATE INDEX IF NOT EXISTS conversation_item_source_binding_session_order_idx
    ON conversation.item_source_binding (session_id, canonical_order_key);

CREATE TABLE IF NOT EXISTS conversation.projection_checkpoint (
    projector_name text NOT NULL,
    projector_version text NOT NULL,
    source_stream text NOT NULL,
    cursor_value text NULL,
    last_source_occurred_at timestamptz NULL,
    last_batch_hash text NULL,
    row_version bigint NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT conversation_projection_checkpoint_pkey PRIMARY KEY (
        projector_name,
        source_stream
    ),
    CONSTRAINT conversation_projection_checkpoint_projector_name_length_check CHECK (
        char_length(projector_name) BETWEEN 1 AND 128
        AND projector_name ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    ),
    CONSTRAINT conversation_projection_checkpoint_version_length_check CHECK (
        char_length(projector_version) BETWEEN 1 AND 64
        AND projector_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'
    ),
    CONSTRAINT conversation_projection_checkpoint_source_stream_length_check CHECK (
        char_length(source_stream) BETWEEN 1 AND 128
        AND source_stream ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    ),
    CONSTRAINT conversation_projection_checkpoint_cursor_length_check CHECK (
        cursor_value IS NULL OR char_length(cursor_value) BETWEEN 1 AND 512
    ),
    CONSTRAINT conversation_projection_checkpoint_batch_hash_check CHECK (
        last_batch_hash IS NULL OR last_batch_hash ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT conversation_projection_checkpoint_row_version_check CHECK (
        row_version >= 1
    )
);

-- The three blocks above mirror migration 011 for human navigation only.
-- Migration 011, including its drift checks, is the executable authority.

-- NOT AUTHORIZED BY P2-002: assignment/read cursor/handoff are future P2-005
-- concepts. Keep them disabled and do not create them from this draft.
CREATE TABLE IF NOT EXISTS conversation.assignment_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES conversation.session(id),
    from_principal_id uuid NULL,
    to_principal_id uuid NULL,
    from_team_id uuid NULL,
    to_team_id uuid NULL,
    changed_by_principal_id uuid NOT NULL,
    reason_code text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation.read_cursor (
    principal_id uuid NOT NULL,
    thread_id uuid NOT NULL REFERENCES conversation.thread(id),
    last_read_sequence bigint NOT NULL DEFAULT 0 CHECK (last_read_sequence >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (principal_id, thread_id)
);

CREATE TABLE IF NOT EXISTS conversation.handoff (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES conversation.session(id),
    requested_by_kind text NOT NULL CHECK (requested_by_kind IN (
        'USER', 'AI', 'RULE', 'AGENT', 'ADMIN'
    )),
    requested_by_id text NULL,
    reason_code text NOT NULL,
    status text NOT NULL CHECK (status IN (
        'REQUESTED', 'ACCEPTED', 'RELEASED', 'CANCELLED'
    )),
    from_mode text NOT NULL CHECK (from_mode IN ('AUTO', 'COPILOT', 'HUMAN')),
    to_mode text NOT NULL CHECK (to_mode IN ('AUTO', 'COPILOT', 'HUMAN')),
    assigned_principal_id uuid NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),
    accepted_at timestamptz NULL,
    released_at timestamptz NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_conversation_handoff_session_time
    ON conversation.handoff (session_id, requested_at DESC);

-- NOT AUTHORIZED BY P2-002: realtime_event and SSE belong to future P2-003.
CREATE TABLE IF NOT EXISTS conversation.realtime_event (
    event_id bigserial PRIMARY KEY,
    event_type text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id text NOT NULL,
    aggregate_version bigint NULL,
    visibility_scope text NOT NULL DEFAULT 'WORKBENCH',
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_realtime_event_created
    ON conversation.realtime_event (event_id);

CREATE INDEX IF NOT EXISTS idx_realtime_event_aggregate
    ON conversation.realtime_event (aggregate_type, aggregate_id, event_id);

-- ============================================================================
-- Communication Outbox
-- ============================================================================
-- NOT AUTHORIZED BY P2-002: every communication.* table below belongs to
-- future P2-004 or later. P2-002 uses fixture-only Communication mapping.

CREATE TABLE IF NOT EXISTS communication.message (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NULL REFERENCES conversation.session(id),
    sender_kind text NOT NULL CHECK (sender_kind IN ('AI', 'AGENT', 'SYSTEM')),
    sender_id text NULL,
    message_type text NOT NULL CHECK (message_type IN (
        'text', 'markdown', 'image', 'file', 'mixed', 'template_card'
    )),
    visibility text NOT NULL CHECK (visibility IN ('EXTERNAL', 'INTERNAL')),
    body jsonb NOT NULL,
    reply_to_conversation_item_id uuid NULL REFERENCES conversation.item(id),
    client_command_id uuid NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (client_command_id)
);

CREATE TABLE IF NOT EXISTS communication.outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id uuid NOT NULL REFERENCES communication.message(id),
    channel_type text NOT NULL,
    target_type text NOT NULL CHECK (target_type IN ('PERSON', 'GROUP')),
    target_id text NOT NULL,
    idempotency_key text NOT NULL,
    priority integer NOT NULL DEFAULT 100,
    status text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING', 'LEASED', 'SENT', 'FAILED', 'DEAD_LETTER', 'CANCELLED'
    )),
    available_at timestamptz NOT NULL DEFAULT now(),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    lease_token uuid NULL,
    lease_expires_at timestamptz NULL,
    last_error_code text NULL,
    last_error_detail text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz NULL,
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_communication_outbox_claim
    ON communication.outbox (status, available_at, priority, created_at);

CREATE TABLE IF NOT EXISTS communication.delivery (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    outbox_id uuid NOT NULL REFERENCES communication.outbox(id),
    attempt_no integer NOT NULL CHECK (attempt_no >= 1),
    provider text NOT NULL,
    status text NOT NULL CHECK (status IN (
        'SENDING', 'SENT', 'ACKNOWLEDGED', 'FAILED'
    )),
    provider_message_id text NULL,
    request_id text NULL,
    error_code text NULL,
    error_detail text NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz NULL,
    UNIQUE (outbox_id, attempt_no)
);

-- A compatibility adapter may project existing notification.outbox/delivery into
-- the above logical contract instead of creating these tables immediately.

-- ============================================================================
-- AI jobs, runs and memory
-- ============================================================================
-- NOT AUTHORIZED BY P2-002: every ai.* table below belongs to P2-007 or later.

CREATE TABLE IF NOT EXISTS ai.job (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES conversation.session(id),
    trigger_item_id uuid NOT NULL REFERENCES conversation.item(id),
    generation_version bigint NOT NULL CHECK (generation_version >= 1),
    job_type text NOT NULL CHECK (job_type IN (
        'CONVERSATION_TURN', 'SUMMARY', 'FIELD_EXTRACTION', 'HANDOFF_SUMMARY'
    )),
    prompt_version text NOT NULL,
    idempotency_key text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING', 'LEASED', 'COMPLETED', 'FAILED', 'CANCELLED', 'STALE', 'DEAD_LETTER'
    )),
    available_at timestamptz NOT NULL DEFAULT now(),
    attempt_count integer NOT NULL DEFAULT 0,
    lease_token uuid NULL,
    lease_expires_at timestamptz NULL,
    last_error_code text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz NULL,
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_job_claim
    ON ai.job (status, available_at, created_at);

CREATE TABLE IF NOT EXISTS ai.run (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES ai.job(id),
    provider text NOT NULL,
    model text NOT NULL,
    model_version text NULL,
    prompt_version text NOT NULL,
    context_from_sequence bigint NULL,
    context_to_sequence bigint NULL,
    context_hash text NOT NULL,
    redaction_result jsonb NOT NULL DEFAULT '{}'::jsonb,
    structured_output jsonb NULL,
    input_tokens integer NULL,
    cached_input_tokens integer NULL,
    output_tokens integer NULL,
    estimated_cost numeric(12, 6) NULL,
    latency_ms integer NULL,
    status text NOT NULL CHECK (status IN (
        'STARTED', 'COMPLETED', 'FAILED', 'STALE', 'REJECTED'
    )),
    finish_reason text NULL,
    error_code text NULL,
    response_message_id uuid NULL REFERENCES communication.message(id),
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz NULL
);

CREATE TABLE IF NOT EXISTS ai.conversation_memory (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES conversation.session(id),
    memory_version bigint NOT NULL CHECK (memory_version >= 1),
    summary_text text NOT NULL,
    summary_until_sequence bigint NOT NULL CHECK (summary_until_sequence >= 0),
    structured_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
    input_hash text NOT NULL,
    prompt_version text NOT NULL,
    model_version text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (session_id, memory_version)
);

-- ============================================================================
-- Integration Hub (greenfield sources only)
-- ============================================================================

CREATE TABLE IF NOT EXISTS integration.source (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_code text NOT NULL,
    source_type text NOT NULL CHECK (source_type IN (
        'INTRANET_PORTAL', 'HOSPITAL_API', 'MONITORING_ALERT',
        'VENDOR_SERVICE', 'OTHER'
    )),
    direction text NOT NULL CHECK (direction IN (
        'INBOUND_ONLY', 'OUTBOUND_ONLY', 'BIDIRECTIONAL'
    )),
    authority_policy text NOT NULL DEFAULT 'LOCAL_TICKET_AUTHORITATIVE',
    connector_mode text NOT NULL CHECK (connector_mode IN (
        'INTRANET_OUTBOUND_AGENT', 'PUSH_API', 'PULL_API'
    )),
    data_classification text NOT NULL,
    contract_version text NOT NULL,
    status text NOT NULL DEFAULT 'DISABLED' CHECK (status IN (
        'DISABLED', 'TESTING', 'ACTIVE', 'SUSPENDED'
    )),
    config_reference text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_code)
);

CREATE TABLE IF NOT EXISTS integration.inbox_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id uuid NOT NULL REFERENCES integration.source(id),
    external_event_id text NOT NULL,
    external_record_type text NOT NULL,
    external_record_id text NOT NULL,
    event_type text NOT NULL,
    occurred_at timestamptz NOT NULL,
    cursor_value text NULL,
    payload_redacted jsonb NULL,
    payload_encrypted bytea NULL,
    payload_hash text NOT NULL,
    status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN (
        'RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'QUARANTINED'
    )),
    attempt_count integer NOT NULL DEFAULT 0,
    available_at timestamptz NOT NULL DEFAULT now(),
    last_error_code text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz NULL,
    UNIQUE (source_id, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_integration_inbox_claim
    ON integration.inbox_event (source_id, status, available_at, occurred_at);

CREATE TABLE IF NOT EXISTS integration.external_record_binding (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id uuid NOT NULL REFERENCES integration.source(id),
    external_record_type text NOT NULL,
    external_record_id text NOT NULL,
    local_aggregate_type text NOT NULL,
    local_aggregate_id uuid NOT NULL,
    mapping_version text NOT NULL,
    binding_status text NOT NULL DEFAULT 'ACTIVE' CHECK (binding_status IN (
        'ACTIVE', 'SUPERSEDED', 'CONFLICT', 'DELETED'
    )),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_id, external_record_type, external_record_id)
);

CREATE INDEX IF NOT EXISTS idx_external_binding_local
    ON integration.external_record_binding (local_aggregate_type, local_aggregate_id);

CREATE TABLE IF NOT EXISTS integration.outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id uuid NOT NULL REFERENCES integration.source(id),
    local_event_id text NOT NULL,
    projection_type text NOT NULL,
    external_record_type text NOT NULL,
    external_record_id text NULL,
    payload jsonb NOT NULL,
    idempotency_key text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING', 'LEASED', 'SENT', 'ACKNOWLEDGED',
        'FAILED', 'DEAD_LETTER', 'CANCELLED'
    )),
    available_at timestamptz NOT NULL DEFAULT now(),
    attempt_count integer NOT NULL DEFAULT 0,
    lease_token uuid NULL,
    lease_expires_at timestamptz NULL,
    last_error_code text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz NULL,
    UNIQUE (source_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_integration_outbox_claim
    ON integration.outbox (source_id, status, available_at, created_at);

CREATE TABLE IF NOT EXISTS integration.sync_cursor (
    source_id uuid NOT NULL REFERENCES integration.source(id),
    stream_name text NOT NULL,
    cursor_value text NOT NULL,
    cursor_hash text NULL,
    last_event_occurred_at timestamptz NULL,
    row_version bigint NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_id, stream_name)
);

CREATE TABLE IF NOT EXISTS integration.reconciliation_run (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id uuid NOT NULL REFERENCES integration.source(id),
    run_type text NOT NULL CHECK (run_type IN (
        'CONTRACT_CHECK', 'INCREMENTAL', 'PERIODIC', 'ON_DEMAND', 'RECOVERY'
    )),
    status text NOT NULL CHECK (status IN (
        'RUNNING', 'PASSED', 'FAILED', 'NEEDS_REVIEW'
    )),
    source_cursor_from text NULL,
    source_cursor_to text NULL,
    checked_count bigint NOT NULL DEFAULT 0,
    explained_difference_count bigint NOT NULL DEFAULT 0,
    unexplained_difference_count bigint NOT NULL DEFAULT 0,
    summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz NULL
);

CREATE TABLE IF NOT EXISTS integration.reconciliation_item (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL REFERENCES integration.reconciliation_run(id),
    external_record_type text NOT NULL,
    external_record_id text NOT NULL,
    local_aggregate_id uuid NULL,
    difference_type text NOT NULL,
    severity text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'ERROR')),
    explained boolean NOT NULL DEFAULT false,
    explanation_code text NULL,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_item_run
    ON integration.reconciliation_item (run_id, severity, explained);

CREATE TABLE IF NOT EXISTS integration.identity_binding (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id uuid NOT NULL REFERENCES integration.source(id),
    external_identity_type text NOT NULL,
    external_identity_id text NOT NULL,
    local_principal_id uuid NULL,
    person_id text NULL,
    employee_no text NULL,
    department_id text NULL,
    campus_id text NULL,
    roles jsonb NOT NULL DEFAULT '[]'::jsonb,
    valid_from timestamptz NULL,
    valid_to timestamptz NULL,
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN (
        'ACTIVE', 'INACTIVE', 'NEEDS_REVIEW'
    )),
    snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_id, external_identity_type, external_identity_id, valid_from)
);

-- The Integration Hub is for new sources. It intentionally contains no
-- historical-ticket batch, final-cutover, legacy-state or old-system lifecycle fields.

-- ============================================================================
-- Cross-schema foreign keys
-- ============================================================================
-- Add real foreign keys to intake.service_intake and pilot_ticket.ticket only
-- after checking their exact current types and approved numbered schema changes.
--
-- Example logical bindings:
--   conversation.session.service_intake_id -> intake.service_intake.id
--   integration.external_record_binding.local_aggregate_id -> pilot_ticket.ticket.id
--
-- Where polymorphism prevents a database FK, enforce aggregate type and ID in the
-- service layer and reconciliation checks.

-- ============================================================================
-- Required transactional patterns
-- ============================================================================
-- 1. Inbound:
--    INSERT channel/integration inbox
--    INSERT/update conversation projection intent
--    COMMIT
--    THEN enqueue optional AI work.
--
-- 2. Human/AI reply:
--    INSERT communication.message
--    INSERT communication.outbox
--    INSERT conversation.realtime_event
--    COMMIT
--    THEN send via Delivery Worker.
--
-- 3. Ticket action:
--    UPDATE pilot_ticket.ticket with expected version
--    INSERT pilot_ticket.ticket_event
--    INSERT notification/communication outbox
--    COMMIT
--
-- 4. External projection:
--    INSERT integration.outbox from committed local event
--    COMMIT
--    THEN connector sends and records delivery.
--
-- 5. No external API calls are allowed while holding these transactions.
