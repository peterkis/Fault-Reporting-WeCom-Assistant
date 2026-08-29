BEGIN;

CREATE TABLE IF NOT EXISTS pilot_ticket.ticket_event (
    event_id UUID PRIMARY KEY DEFAULT uuidv7(),
    ticket_id UUID NOT NULL REFERENCES pilot_ticket.ticket(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    old_status TEXT,
    new_status TEXT NOT NULL,
    aggregate_version INTEGER NOT NULL,
    event_ordinal INTEGER NOT NULL,
    operator_type TEXT NOT NULL,
    operator_id TEXT,
    internal_note TEXT,
    external_note TEXT,
    reason_code TEXT,
    attachment_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    trace_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ticket_event_type_check CHECK (
        event_type IN (
            'ticket.created', 'ticket.queued', 'ticket.accepted', 'ticket.started',
            'ticket.waiting_requester', 'ticket.waiting_vendor', 'ticket.resumed',
            'ticket.resolved', 'ticket.closed', 'ticket.reopened', 'ticket.cancelled',
            'ticket.duplicate_linked', 'ticket.unlinked', 'ticket.note_added',
            'ticket.information_added', 'ticket.auto_close_reminder'
        )
    ),
    CONSTRAINT ticket_event_status_check CHECK (
        (old_status IS NULL OR old_status IN (
            'NEW', 'QUEUED', 'ACCEPTED', 'IN_PROGRESS', 'WAITING_REQUESTER',
            'WAITING_VENDOR', 'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED',
            'DUPLICATE_LINKED'
        ))
        AND new_status IN (
            'NEW', 'QUEUED', 'ACCEPTED', 'IN_PROGRESS', 'WAITING_REQUESTER',
            'WAITING_VENDOR', 'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED',
            'DUPLICATE_LINKED'
        )
    ),
    CONSTRAINT ticket_event_version_check CHECK (aggregate_version >= 1),
    CONSTRAINT ticket_event_ordinal_check CHECK (event_ordinal >= 1),
    CONSTRAINT ticket_event_operator_type_check CHECK (
        operator_type IN ('PILOT_USER', 'REPORTER', 'SYSTEM')
    ),
    CONSTRAINT ticket_event_operator_id_check CHECK (
        operator_id IS NULL OR char_length(operator_id) BETWEEN 1 AND 256
    ),
    CONSTRAINT ticket_event_internal_note_check CHECK (
        internal_note IS NULL OR char_length(internal_note) BETWEEN 1 AND 2000
    ),
    CONSTRAINT ticket_event_external_note_check CHECK (
        external_note IS NULL OR char_length(external_note) BETWEEN 1 AND 2000
    ),
    CONSTRAINT ticket_event_reason_code_check CHECK (
        reason_code IS NULL OR char_length(reason_code) BETWEEN 1 AND 128
    ),
    CONSTRAINT ticket_event_attachment_ids_check CHECK (jsonb_typeof(attachment_ids) = 'array'),
    CONSTRAINT ticket_event_trace_id_check CHECK (char_length(trace_id) BETWEEN 1 AND 128),
    CONSTRAINT ticket_event_ordinal_unique UNIQUE (ticket_id, event_ordinal)
);

CREATE INDEX IF NOT EXISTS ticket_event_ticket_version_idx
    ON pilot_ticket.ticket_event (ticket_id, aggregate_version, event_ordinal);

COMMENT ON TABLE pilot_ticket.ticket_event IS
    'P1-006 append-only Pilot Ticket action timeline. Internal and external notes are separate fields.';

COMMIT;
