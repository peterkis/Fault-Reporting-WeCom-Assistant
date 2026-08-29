BEGIN;

ALTER TABLE pilot_ticket.ticket
    ADD COLUMN IF NOT EXISTS auto_close_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS auto_close_reminder_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS pilot_ticket.ticket_supplement (
    ticket_id UUID NOT NULL REFERENCES pilot_ticket.ticket(id) ON DELETE CASCADE,
    channel_message_id BIGINT NOT NULL UNIQUE
        REFERENCES channel.message_inbox(id) ON DELETE RESTRICT,
    reporter_wecom_user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ticket_id, channel_message_id),
    CONSTRAINT ticket_supplement_reporter_check CHECK (
        char_length(reporter_wecom_user_id) BETWEEN 1 AND 256
    )
);

CREATE TABLE IF NOT EXISTS notification.card_action_task (
    task_id UUID PRIMARY KEY DEFAULT uuidv7(),
    ticket_id UUID NOT NULL REFERENCES pilot_ticket.ticket(id) ON DELETE CASCADE,
    ticket_event_id UUID NOT NULL REFERENCES pilot_ticket.ticket_event(event_id) ON DELETE CASCADE,
    action_key TEXT NOT NULL,
    actor_wecom_user_id TEXT NOT NULL,
    expected_version INTEGER NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT card_action_task_key_check CHECK (
        action_key IN ('confirm_resolved', 'still_broken', 'add_information')
    ),
    CONSTRAINT card_action_task_actor_check CHECK (char_length(actor_wecom_user_id) BETWEEN 1 AND 256),
    CONSTRAINT card_action_task_version_check CHECK (expected_version >= 1),
    CONSTRAINT card_action_task_expiry_check CHECK (expires_at > created_at),
    CONSTRAINT card_action_task_event_action_actor_unique UNIQUE (
        ticket_event_id, action_key, actor_wecom_user_id
    )
);

CREATE TABLE IF NOT EXISTS notification.card_action_receipt (
    task_id UUID NOT NULL REFERENCES notification.card_action_task(task_id) ON DELETE CASCADE,
    event_req_id TEXT NOT NULL,
    response_snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (task_id, event_req_id),
    CONSTRAINT card_action_receipt_request_check CHECK (char_length(event_req_id) BETWEEN 1 AND 256),
    CONSTRAINT card_action_receipt_snapshot_check CHECK (jsonb_typeof(response_snapshot) = 'object')
);

CREATE INDEX IF NOT EXISTS ticket_auto_close_idx
    ON pilot_ticket.ticket (auto_close_at)
    WHERE status = 'RESOLVED' AND auto_close_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS card_action_task_expiry_idx
    ON notification.card_action_task (expires_at)
    WHERE consumed_at IS NULL;

COMMENT ON TABLE pilot_ticket.ticket_supplement IS
    'P1-010 one-time Ticket-level acknowledgement of a persisted Channel Message supplement.';
COMMENT ON TABLE notification.card_action_task IS
    'Opaque, actor-bound, expiring Pilot card action. Provider acknowledgement is not client-visible proof.';

COMMIT;
