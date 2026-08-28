BEGIN;

CREATE SCHEMA IF NOT EXISTS channel;

CREATE TABLE IF NOT EXISTS channel.message_inbox (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    schema_version SMALLINT NOT NULL,
    provider TEXT NOT NULL,
    msg_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    req_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    chat_type TEXT NOT NULL,
    chat_id TEXT,
    sender_user_id TEXT NOT NULL,
    msg_type TEXT NOT NULL,
    create_time TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL,
    raw_text TEXT,
    clean_text TEXT,
    normalized_message JSONB NOT NULL,
    raw_payload_encrypted BYTEA,
    processing_status TEXT NOT NULL DEFAULT 'PROCESSING',
    response_snapshot JSONB,
    privacy_class TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    retention_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    CONSTRAINT message_inbox_provider_msg_unique UNIQUE (provider, msg_id),
    CONSTRAINT message_inbox_schema_version_check CHECK (schema_version = 1),
    CONSTRAINT message_inbox_provider_length_check CHECK (char_length(provider) BETWEEN 1 AND 64),
    CONSTRAINT message_inbox_msg_id_length_check CHECK (char_length(msg_id) BETWEEN 1 AND 256),
    CONSTRAINT message_inbox_idempotency_key_check CHECK (idempotency_key = provider || ':' || msg_id),
    CONSTRAINT message_inbox_req_id_length_check CHECK (char_length(req_id) BETWEEN 1 AND 256),
    CONSTRAINT message_inbox_bot_id_length_check CHECK (char_length(bot_id) BETWEEN 1 AND 256),
    CONSTRAINT message_inbox_chat_type_check CHECK (chat_type IN ('single', 'group')),
    CONSTRAINT message_inbox_chat_id_check CHECK (
        (chat_type = 'single' AND chat_id IS NULL)
        OR (chat_type = 'group' AND char_length(chat_id) BETWEEN 1 AND 256)
    ),
    CONSTRAINT message_inbox_sender_length_check CHECK (char_length(sender_user_id) BETWEEN 1 AND 256),
    CONSTRAINT message_inbox_msg_type_check CHECK (msg_type IN ('text', 'image', 'mixed', 'voice', 'file', 'video')),
    CONSTRAINT message_inbox_normalized_message_check CHECK (jsonb_typeof(normalized_message) = 'object'),
    CONSTRAINT message_inbox_processing_status_check CHECK (processing_status IN ('PROCESSING', 'COMPLETED')),
    CONSTRAINT message_inbox_processing_result_check CHECK (
        (processing_status = 'PROCESSING' AND response_snapshot IS NULL AND completed_at IS NULL)
        OR (
            processing_status = 'COMPLETED'
            AND jsonb_typeof(response_snapshot) = 'object'
            AND completed_at IS NOT NULL
        )
    ),
    CONSTRAINT message_inbox_privacy_class_check CHECK (
        privacy_class IN ('PUBLIC', 'INTERNAL', 'SENSITIVE_INTERNAL', 'PERSONAL', 'PATIENT_SENSITIVE', 'SECRET')
    ),
    CONSTRAINT message_inbox_trace_id_length_check CHECK (char_length(trace_id) BETWEEN 1 AND 128),
    CONSTRAINT message_inbox_retention_check CHECK (retention_until > received_at)
);

CREATE INDEX IF NOT EXISTS message_inbox_retention_idx
    ON channel.message_inbox (retention_until);

COMMENT ON TABLE channel.message_inbox IS
    'P1-003 Channel Message persistence and provider/message idempotency boundary.';
COMMENT ON COLUMN channel.message_inbox.req_id IS
    'Provider request correlation only; never part of the business idempotency key.';
COMMENT ON COLUMN channel.message_inbox.raw_payload_encrypted IS
    'Optional caller-encrypted SDK payload. Plain SDK payloads are not accepted by the Inbox API.';
COMMENT ON COLUMN channel.message_inbox.response_snapshot IS
    'Opaque first-processing result returned unchanged for duplicate deliveries.';

COMMIT;
