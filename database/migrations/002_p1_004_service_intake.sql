BEGIN;

CREATE SCHEMA IF NOT EXISTS intake;

CREATE SEQUENCE IF NOT EXISTS intake.service_intake_number_seq AS BIGINT;

CREATE TABLE IF NOT EXISTS intake.service_intake (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    intake_no TEXT NOT NULL UNIQUE,
    source_channel TEXT NOT NULL,
    source_provider TEXT NOT NULL,
    source_bot_id TEXT NOT NULL,
    source_chat_type TEXT NOT NULL,
    source_chat_id TEXT,
    reporter_wecom_userid TEXT NOT NULL,
    request_type TEXT NOT NULL,
    summary TEXT,
    reported_campus_id TEXT,
    reported_department_id TEXT,
    reported_location_text TEXT,
    status TEXT NOT NULL,
    primary_message_id BIGINT NOT NULL UNIQUE
        REFERENCES channel.message_inbox(id) ON DELETE RESTRICT,
    message_count INTEGER NOT NULL DEFAULT 1,
    last_message_at TIMESTAMPTZ NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT service_intake_number_check CHECK (intake_no ~ '^INT-[0-9]{8}-[0-9]{4,}$'),
    CONSTRAINT service_intake_source_channel_check CHECK (
        source_channel IN ('WECOM_GROUP', 'WECOM_DIRECT', 'PORTAL', 'MANUAL')
    ),
    CONSTRAINT service_intake_provider_length_check CHECK (char_length(source_provider) BETWEEN 1 AND 64),
    CONSTRAINT service_intake_bot_length_check CHECK (char_length(source_bot_id) BETWEEN 1 AND 256),
    CONSTRAINT service_intake_chat_type_check CHECK (source_chat_type IN ('single', 'group')),
    CONSTRAINT service_intake_chat_id_check CHECK (
        (source_chat_type = 'single' AND source_chat_id IS NULL)
        OR (source_chat_type = 'group' AND char_length(source_chat_id) BETWEEN 1 AND 256)
    ),
    CONSTRAINT service_intake_reporter_length_check CHECK (
        char_length(reporter_wecom_userid) BETWEEN 1 AND 256
    ),
    CONSTRAINT service_intake_request_type_check CHECK (
        request_type IN (
            'INCIDENT', 'SERVICE_REQUEST', 'QUESTION', 'COMPLAINT',
            'STATUS_QUERY', 'FOLLOW_UP', 'CHATTER', 'UNKNOWN'
        )
    ),
    CONSTRAINT service_intake_summary_check CHECK (summary IS NULL OR char_length(summary) <= 500),
    CONSTRAINT service_intake_campus_check CHECK (
        reported_campus_id IS NULL OR char_length(reported_campus_id) <= 64
    ),
    CONSTRAINT service_intake_department_check CHECK (
        reported_department_id IS NULL OR char_length(reported_department_id) <= 64
    ),
    CONSTRAINT service_intake_location_check CHECK (
        reported_location_text IS NULL OR char_length(reported_location_text) <= 500
    ),
    CONSTRAINT service_intake_status_check CHECK (
        status IN (
            'RECEIVED', 'TICKET_CREATED', 'WAITING_DESCRIPTION', 'WAITING_TRIAGE',
            'LINKED_INCIDENT', 'COMPLETED', 'IGNORED', 'FAILED'
        )
    ),
    CONSTRAINT service_intake_message_count_check CHECK (message_count >= 1),
    CONSTRAINT service_intake_version_check CHECK (version >= 1),
    CONSTRAINT service_intake_time_check CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS service_intake_aggregation_idx
    ON intake.service_intake (
        source_provider,
        source_bot_id,
        source_chat_type,
        source_chat_id,
        reporter_wecom_userid,
        last_message_at DESC
    )
    WHERE status IN ('RECEIVED', 'WAITING_DESCRIPTION', 'WAITING_TRIAGE', 'TICKET_CREATED');

CREATE TABLE IF NOT EXISTS intake.service_intake_message (
    intake_id UUID NOT NULL REFERENCES intake.service_intake(id) ON DELETE CASCADE,
    channel_message_id BIGINT NOT NULL UNIQUE
        REFERENCES channel.message_inbox(id) ON DELETE RESTRICT,
    relation_type TEXT NOT NULL,
    sequence_no INTEGER NOT NULL,
    linked_at TIMESTAMPTZ NOT NULL,
    trace_id TEXT NOT NULL,
    PRIMARY KEY (intake_id, channel_message_id),
    CONSTRAINT service_intake_message_relation_check CHECK (
        relation_type IN ('PRIMARY', 'SUPPLEMENT', 'CLARIFICATION')
    ),
    CONSTRAINT service_intake_message_sequence_check CHECK (sequence_no >= 1),
    CONSTRAINT service_intake_message_trace_length_check CHECK (char_length(trace_id) BETWEEN 1 AND 128),
    CONSTRAINT service_intake_message_sequence_unique UNIQUE (intake_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS intake.service_intake_event (
    event_id UUID PRIMARY KEY DEFAULT uuidv7(),
    event_type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL DEFAULT 'intake',
    intake_id UUID NOT NULL REFERENCES intake.service_intake(id) ON DELETE CASCADE,
    aggregate_version INTEGER NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    trace_id TEXT NOT NULL,
    payload JSONB NOT NULL,
    CONSTRAINT service_intake_event_type_check CHECK (
        event_type IN (
            'intake.received',
            'intake.needs_clarification',
            'intake.message_added',
            'intake.clarification_added'
        )
    ),
    CONSTRAINT service_intake_event_aggregate_check CHECK (aggregate_type = 'intake'),
    CONSTRAINT service_intake_event_version_check CHECK (aggregate_version >= 1),
    CONSTRAINT service_intake_event_trace_length_check CHECK (char_length(trace_id) BETWEEN 1 AND 128),
    CONSTRAINT service_intake_event_payload_check CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS service_intake_event_intake_version_idx
    ON intake.service_intake_event (intake_id, aggregate_version, occurred_at);

COMMENT ON TABLE intake.service_intake IS
    'P1-004 service request context aggregate. It is separate from Channel Message and Pilot Ticket.';
COMMENT ON COLUMN intake.service_intake.primary_message_id IS
    'The first Channel Message in this Intake; later messages are represented by the relation table.';
COMMENT ON TABLE intake.service_intake_message IS
    'One-to-many Channel Message membership with explicit primary, supplement, or clarification semantics.';
COMMENT ON TABLE intake.service_intake_event IS
    'P1-004 audit events. Payloads contain identifiers and classifications, never original report text.';

COMMIT;
