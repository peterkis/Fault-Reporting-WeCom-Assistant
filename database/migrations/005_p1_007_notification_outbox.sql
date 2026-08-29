BEGIN;

CREATE SCHEMA IF NOT EXISTS notification;

CREATE TABLE IF NOT EXISTS notification.outbox (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    ticket_id UUID NOT NULL REFERENCES pilot_ticket.ticket(id) ON DELETE CASCADE,
    ticket_event_id UUID NOT NULL REFERENCES pilot_ticket.ticket_event(event_id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    aggregate_version INTEGER NOT NULL,
    template_code TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT notification_outbox_event_type_check CHECK (char_length(event_type) BETWEEN 1 AND 128),
    CONSTRAINT notification_outbox_version_check CHECK (aggregate_version >= 1),
    CONSTRAINT notification_outbox_template_check CHECK (char_length(template_code) BETWEEN 1 AND 128),
    CONSTRAINT notification_outbox_payload_check CHECK (jsonb_typeof(payload) = 'object'),
    CONSTRAINT notification_outbox_event_template_unique UNIQUE (ticket_event_id, template_code)
);

CREATE TABLE IF NOT EXISTS notification.delivery (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    outbox_id UUID NOT NULL REFERENCES notification.outbox(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    target_key TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_token UUID,
    lease_expires_at TIMESTAMPTZ,
    last_error_code TEXT,
    provider_message_id TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT notification_delivery_channel_check CHECK (
        channel IN ('WECOM_DIRECT', 'PILOT_TEAM')
    ),
    CONSTRAINT notification_delivery_target_check CHECK (char_length(target_key) BETWEEN 1 AND 512),
    CONSTRAINT notification_delivery_idempotency_check CHECK (char_length(idempotency_key) BETWEEN 1 AND 256),
    CONSTRAINT notification_delivery_status_check CHECK (
        status IN ('PENDING', 'SENDING', 'SENT', 'DEAD_LETTER')
    ),
    CONSTRAINT notification_delivery_attempt_count_check CHECK (attempt_count >= 0),
    CONSTRAINT notification_delivery_lease_check CHECK (
        (status = 'SENDING' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (status <> 'SENDING' AND lease_token IS NULL AND lease_expires_at IS NULL)
    ),
    CONSTRAINT notification_delivery_sent_check CHECK (
        (status = 'SENT' AND sent_at IS NOT NULL)
        OR (status <> 'SENT' AND sent_at IS NULL)
    ),
    CONSTRAINT notification_delivery_error_check CHECK (
        last_error_code IS NULL OR char_length(last_error_code) BETWEEN 1 AND 128
    ),
    CONSTRAINT notification_delivery_outbox_target_unique UNIQUE (outbox_id, channel, target_key)
);

CREATE TABLE IF NOT EXISTS notification.delivery_attempt (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    delivery_id UUID NOT NULL REFERENCES notification.delivery(id) ON DELETE CASCADE,
    attempt_no INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    error_code TEXT,
    provider_message_id TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT notification_delivery_attempt_no_check CHECK (attempt_no >= 1),
    CONSTRAINT notification_delivery_attempt_outcome_check CHECK (
        outcome IN ('SENT', 'RETRY_SCHEDULED', 'DEAD_LETTER')
    ),
    CONSTRAINT notification_delivery_attempt_error_check CHECK (
        error_code IS NULL OR char_length(error_code) BETWEEN 1 AND 128
    ),
    CONSTRAINT notification_delivery_attempt_unique UNIQUE (delivery_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS notification_delivery_claim_idx
    ON notification.delivery (status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS notification_outbox_ticket_idx
    ON notification.outbox (ticket_id, aggregate_version, created_at);

COMMENT ON TABLE notification.outbox IS
    'P1-007 committed notification intent, separate from delivery attempts.';
COMMENT ON TABLE notification.delivery IS
    'Per-target delivery state with idempotency, retry, lease, and dead-letter facts.';

COMMIT;
