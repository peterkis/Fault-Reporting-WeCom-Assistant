BEGIN;

-- Exact supplemental material disposition, independent of Ticket lifecycle,
-- responsibility, personal read position and Communication delivery state.
CREATE TABLE pilot_ticket.workbench_supplement_disposition (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    command_receipt_id UUID NOT NULL UNIQUE REFERENCES pilot_ticket.ticket_command_receipt(id) ON DELETE RESTRICT,
    ticket_id UUID NOT NULL REFERENCES pilot_ticket.ticket(id) ON DELETE RESTRICT,
    source_intake_id UUID NOT NULL REFERENCES intake.service_intake(id) ON DELETE RESTRICT,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('WEB','BOT')),
    source_ref TEXT NOT NULL CHECK (source_ref ~ '^(web:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|channel:[1-9][0-9]{0,18})$'),
    revision BIGINT NOT NULL CHECK (revision >= 1),
    actor_principal_id UUID NOT NULL REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    disposition_note TEXT NOT NULL CHECK (char_length(disposition_note) BETWEEN 1 AND 2000 AND disposition_note ~ '[^[:space:]]'),
    occurred_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    CONSTRAINT supplement_disposition_source_kind CHECK (
      (source_kind='WEB' AND source_ref LIKE 'web:%') OR (source_kind='BOT' AND source_ref LIKE 'channel:%'))
);
CREATE INDEX supplement_disposition_target_idx ON pilot_ticket.workbench_supplement_disposition
    (ticket_id,source_intake_id,source_ref,revision,occurred_at,id);

CREATE TABLE pilot_ticket.workbench_supplement_reply_binding (
    message_id UUID PRIMARY KEY REFERENCES communication.message(id) ON DELETE RESTRICT,
    ticket_id UUID NOT NULL REFERENCES pilot_ticket.ticket(id) ON DELETE RESTRICT,
    source_intake_id UUID NOT NULL REFERENCES intake.service_intake(id) ON DELETE RESTRICT,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('WEB','BOT')),
    source_ref TEXT NOT NULL CHECK (source_ref ~ '^(web:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|channel:[1-9][0-9]{0,18})$'),
    revision BIGINT NOT NULL CHECK (revision >= 1),
    CONSTRAINT supplement_reply_source_kind CHECK (
      (source_kind='WEB' AND source_ref LIKE 'web:%') OR (source_kind='BOT' AND source_ref LIKE 'channel:%'))
);
CREATE INDEX supplement_reply_target_idx ON pilot_ticket.workbench_supplement_reply_binding
    (ticket_id,source_intake_id,source_ref,revision,message_id);

COMMIT;
