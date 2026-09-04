BEGIN;

ALTER TABLE conversation.realtime_event DROP CONSTRAINT conversation_realtime_event_type_vocabulary_check;
ALTER TABLE conversation.realtime_event ADD CONSTRAINT conversation_realtime_event_type_vocabulary_check CHECK (event_type IN (
    'conversation.session.created','conversation.session.updated','conversation.item.created','conversation.timeline.rebuilt',
    'conversation.mode.changed','conversation.assigned','conversation.handoff.requested','conversation.handoff.accepted',
    'conversation.read_cursor.changed','communication.delivery.changed','ticket.updated','incident.updated','gateway.connection.changed',
    'manual_review.created','manual_review.resolved','ticket.command.committed','ticket.status.changed',
    'ticket.assignment.changed','ticket.notification.created','ticket.notification.delivery_changed'
));
ALTER TABLE conversation.realtime_event DROP CONSTRAINT conversation_realtime_event_source_type_check;
ALTER TABLE conversation.realtime_event ADD CONSTRAINT conversation_realtime_event_source_type_check CHECK (source_type IN (
    'CONVERSATION_SESSION','CONVERSATION_ITEM','TIMELINE_REBUILD','COMMUNICATION_DELIVERY','TICKET_EVENT',
    'HANDOFF_EVENT','READ_CURSOR','INCIDENT_EVENT','GATEWAY_EVENT','MANUAL_REVIEW'
));
ALTER TABLE conversation.realtime_event DROP CONSTRAINT conversation_realtime_event_aggregate_type_check;
ALTER TABLE conversation.realtime_event ADD CONSTRAINT conversation_realtime_event_aggregate_type_check CHECK (aggregate_type IN (
    'CONVERSATION_SESSION','CONVERSATION_ITEM','CONVERSATION_TIMELINE','COMMUNICATION_DELIVERY','TICKET',
    'CONVERSATION_HANDOFF','CONVERSATION_READ_CURSOR','INCIDENT','GATEWAY_CONNECTION','MANUAL_REVIEW'
));

ALTER TABLE pilot_ticket.ticket_event ADD COLUMN IF NOT EXISTS assignment_metadata JSONB;
ALTER TABLE pilot_ticket.ticket_event DROP CONSTRAINT ticket_event_type_check;
ALTER TABLE pilot_ticket.ticket_event ADD CONSTRAINT ticket_event_type_check CHECK (event_type IN (
    'ticket.created','ticket.queued','ticket.accepted','ticket.started','ticket.waiting_requester',
    'ticket.waiting_vendor','ticket.resumed','ticket.resolved','ticket.closed','ticket.reopened',
    'ticket.cancelled','ticket.duplicate_linked','ticket.unlinked','ticket.note_added',
    'ticket.information_added','ticket.auto_close_reminder','ticket.assignment_transferred'
));
ALTER TABLE pilot_ticket.ticket_event ADD CONSTRAINT p2016_assignment_metadata_check CHECK (
    assignment_metadata IS NULL OR (
        event_type='ticket.assignment_transferred' AND jsonb_typeof(assignment_metadata)='object'
        AND assignment_metadata - ARRAY['old_assignee_id','new_assignee_id','old_team_id','new_team_id']::text[]='{}'::jsonb
    )
);

CREATE TABLE pilot_ticket.ticket_command_receipt (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    command_scope TEXT NOT NULL CHECK (char_length(command_scope) BETWEEN 1 AND 128),
    client_command_id UUID NOT NULL,
    command_hash TEXT NOT NULL CHECK (command_hash ~ '^[a-f0-9]{64}$'),
    command_type TEXT NOT NULL CHECK (char_length(command_type) BETWEEN 1 AND 64),
    ticket_id UUID REFERENCES pilot_ticket.ticket(id) ON DELETE RESTRICT,
    review_id UUID REFERENCES intake.manual_review_item(id) ON DELETE RESTRICT,
    conversation_session_id UUID REFERENCES conversation.session(id) ON DELETE RESTRICT,
    actor_principal_id UUID NOT NULL REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    expected_ticket_version INTEGER CHECK (expected_ticket_version >= 1),
    expected_session_version BIGINT CHECK (expected_session_version >= 1),
    state TEXT NOT NULL DEFAULT 'STARTED' CHECK (state IN ('STARTED','COMMITTED','FAILED')),
    result_ticket_version INTEGER,
    result_ticket_event_id UUID REFERENCES pilot_ticket.ticket_event(event_id) ON DELETE RESTRICT,
    result_control_event_id UUID REFERENCES conversation.control_event(id) ON DELETE RESTRICT,
    result_snapshot JSONB,
    error_code TEXT CHECK (error_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
    retryable BOOLEAN,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    completed_at TIMESTAMP WITHOUT TIME ZONE,
    CONSTRAINT p2016_command_identity UNIQUE (command_scope,client_command_id),
    CONSTRAINT p2016_command_resource CHECK (ticket_id IS NOT NULL OR review_id IS NOT NULL),
    CONSTRAINT p2016_command_result CHECK (
      (state='STARTED' AND completed_at IS NULL AND result_snapshot IS NULL AND error_code IS NULL)
      OR (state='COMMITTED' AND completed_at IS NOT NULL AND jsonb_typeof(result_snapshot)='object' AND error_code IS NULL)
      OR (state='FAILED' AND completed_at IS NOT NULL AND result_snapshot IS NULL AND error_code IS NOT NULL AND retryable IS NOT NULL)
    )
);
CREATE INDEX p2016_command_ticket_idx ON pilot_ticket.ticket_command_receipt(ticket_id,created_at,id);
CREATE INDEX p2016_command_review_idx ON pilot_ticket.ticket_command_receipt(review_id);
CREATE INDEX p2016_command_actor_idx ON pilot_ticket.ticket_command_receipt(actor_principal_id);
CREATE INDEX p2016_command_session_idx ON pilot_ticket.ticket_command_receipt(conversation_session_id);
CREATE INDEX p2016_command_ticket_event_idx ON pilot_ticket.ticket_command_receipt(result_ticket_event_id);
CREATE INDEX p2016_command_control_event_idx ON pilot_ticket.ticket_command_receipt(result_control_event_id);

CREATE TABLE pilot_ticket.reporter_public_ref (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    ticket_id UUID NOT NULL UNIQUE REFERENCES pilot_ticket.ticket(id) ON DELETE RESTRICT,
    public_ref TEXT NOT NULL UNIQUE CHECK (public_ref ~ '^[A-Za-z0-9_-]{32}$'),
    reporter_binding_hash TEXT NOT NULL CHECK (reporter_binding_hash ~ '^[a-f0-9]{64}$'),
    journey_id UUID REFERENCES intake.contact_journey(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    revoked_at TIMESTAMP WITHOUT TIME ZONE,
    row_version BIGINT NOT NULL DEFAULT 1 CHECK (row_version>=1),
    CONSTRAINT p2016_public_ref_binding UNIQUE (id,ticket_id,reporter_binding_hash),
    CONSTRAINT p2016_public_ref_state CHECK ((status='ACTIVE' AND revoked_at IS NULL) OR (status='REVOKED' AND revoked_at IS NOT NULL))
);
CREATE INDEX p2016_public_ref_journey_idx ON pilot_ticket.reporter_public_ref(journey_id);

CREATE TABLE communication.ticket_notification_binding (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    ticket_event_id UUID NOT NULL REFERENCES pilot_ticket.ticket_event(event_id) ON DELETE RESTRICT,
    ticket_id UUID NOT NULL REFERENCES pilot_ticket.ticket(id) ON DELETE RESTRICT,
    notification_type TEXT NOT NULL CHECK (notification_type IN ('TICKET_CREATED','TICKET_ACCEPTED','TICKET_IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR','TICKET_RESOLVED','TICKET_CLOSED','TICKET_REOPENED','TICKET_CANCELLED')),
    recipient_binding_hash TEXT NOT NULL CHECK (recipient_binding_hash ~ '^[a-f0-9]{64}$'),
    destination_type TEXT NOT NULL CHECK (destination_type IN ('PERSON','GROUP')),
    template_version TEXT NOT NULL CHECK (char_length(template_version) BETWEEN 1 AND 64),
    message_id UUID NOT NULL UNIQUE REFERENCES communication.message(id) ON DELETE RESTRICT,
    outbox_id UUID NOT NULL UNIQUE REFERENCES communication.outbox(id) ON DELETE RESTRICT,
    delivery_id UUID NOT NULL UNIQUE REFERENCES communication.delivery(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    CONSTRAINT p2016_notification_identity UNIQUE (ticket_event_id,notification_type,recipient_binding_hash,destination_type,template_version)
);
CREATE INDEX p2016_notification_ticket_idx ON communication.ticket_notification_binding(ticket_id,created_at,id);

CREATE TABLE pilot_ticket.reporter_access_grant (
    grant_id UUID PRIMARY KEY DEFAULT uuidv7(),
    ticket_id UUID NOT NULL REFERENCES pilot_ticket.ticket(id) ON DELETE RESTRICT,
    public_ref_id UUID NOT NULL,
    delivery_id UUID NOT NULL UNIQUE REFERENCES communication.delivery(id) ON DELETE RESTRICT,
    message_id UUID NOT NULL REFERENCES communication.message(id) ON DELETE RESTRICT,
    reporter_binding_hash TEXT NOT NULL CHECK (reporter_binding_hash ~ '^[a-f0-9]{64}$'),
    nonce TEXT NOT NULL CHECK (nonce ~ '^[A-Za-z0-9_-]{43}$'),
    token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    purpose TEXT NOT NULL DEFAULT 'REPORTER_TIMELINE' CHECK (purpose='REPORTER_TIMELINE'),
    state TEXT NOT NULL DEFAULT 'ISSUED' CHECK (state IN ('ISSUED','CONSUMED','REVOKED','EXPIRED')),
    row_version BIGINT NOT NULL DEFAULT 1 CHECK (row_version>=1),
    issued_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    issued_epoch_ms BIGINT NOT NULL,
    expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    expires_epoch_ms BIGINT NOT NULL,
    consumed_at TIMESTAMP WITHOUT TIME ZONE,
    consumed_epoch_ms BIGINT,
    revoked_at TIMESTAMP WITHOUT TIME ZONE,
    revoked_epoch_ms BIGINT,
    CONSTRAINT p2016_grant_binding FOREIGN KEY (public_ref_id,ticket_id,reporter_binding_hash) REFERENCES pilot_ticket.reporter_public_ref(id,ticket_id,reporter_binding_hash) ON DELETE RESTRICT,
    CONSTRAINT p2016_grant_issued CHECK (issued_epoch_ms>=0 AND issued_at=platform.local_from_epoch_ms(issued_epoch_ms)),
    CONSTRAINT p2016_grant_expiry CHECK (expires_epoch_ms>issued_epoch_ms AND expires_epoch_ms-issued_epoch_ms<=1800000 AND expires_at=platform.local_from_epoch_ms(expires_epoch_ms)),
    CONSTRAINT p2016_grant_consumed CHECK ((consumed_at IS NULL AND consumed_epoch_ms IS NULL) OR (consumed_at IS NOT NULL AND consumed_epoch_ms IS NOT NULL AND consumed_epoch_ms>=issued_epoch_ms AND consumed_at=platform.local_from_epoch_ms(consumed_epoch_ms))),
    CONSTRAINT p2016_grant_revoked CHECK ((revoked_at IS NULL AND revoked_epoch_ms IS NULL) OR (revoked_at IS NOT NULL AND revoked_epoch_ms IS NOT NULL AND revoked_epoch_ms>=issued_epoch_ms AND revoked_at=platform.local_from_epoch_ms(revoked_epoch_ms))),
    CONSTRAINT p2016_grant_state CHECK ((state IN ('ISSUED','EXPIRED') AND consumed_at IS NULL AND revoked_at IS NULL) OR (state='CONSUMED' AND consumed_at IS NOT NULL AND revoked_at IS NULL) OR (state='REVOKED' AND revoked_at IS NOT NULL))
);
CREATE INDEX p2016_grant_public_ref_idx ON pilot_ticket.reporter_access_grant(public_ref_id,ticket_id,reporter_binding_hash);
CREATE INDEX p2016_grant_ticket_idx ON pilot_ticket.reporter_access_grant(ticket_id);
CREATE INDEX p2016_grant_message_idx ON pilot_ticket.reporter_access_grant(message_id);
CREATE INDEX p2016_grant_expiry_idx ON pilot_ticket.reporter_access_grant(state,expires_epoch_ms);

CREATE TABLE pilot_ticket.reporter_access_session (
    session_id UUID PRIMARY KEY DEFAULT uuidv7(),
    session_token_hash TEXT NOT NULL UNIQUE CHECK (session_token_hash ~ '^[a-f0-9]{64}$'),
    public_ref_id UUID NOT NULL,
    ticket_id UUID NOT NULL REFERENCES pilot_ticket.ticket(id) ON DELETE RESTRICT,
    reporter_binding_hash TEXT NOT NULL CHECK (reporter_binding_hash ~ '^[a-f0-9]{64}$'),
    grant_id UUID NOT NULL UNIQUE REFERENCES pilot_ticket.reporter_access_grant(grant_id) ON DELETE RESTRICT,
    state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','REVOKED','EXPIRED')),
    issued_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    issued_epoch_ms BIGINT NOT NULL,
    expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    expires_epoch_ms BIGINT NOT NULL,
    last_seen_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    last_seen_epoch_ms BIGINT NOT NULL,
    revoked_at TIMESTAMP WITHOUT TIME ZONE,
    revoked_epoch_ms BIGINT,
    CONSTRAINT p2016_session_binding FOREIGN KEY (public_ref_id,ticket_id,reporter_binding_hash) REFERENCES pilot_ticket.reporter_public_ref(id,ticket_id,reporter_binding_hash) ON DELETE RESTRICT,
    CONSTRAINT p2016_session_issued CHECK (issued_epoch_ms>=0 AND issued_at=platform.local_from_epoch_ms(issued_epoch_ms)),
    CONSTRAINT p2016_session_expiry CHECK (expires_epoch_ms>issued_epoch_ms AND expires_epoch_ms-issued_epoch_ms<=86400000 AND expires_at=platform.local_from_epoch_ms(expires_epoch_ms)),
    CONSTRAINT p2016_session_seen CHECK (last_seen_epoch_ms>=issued_epoch_ms AND last_seen_at=platform.local_from_epoch_ms(last_seen_epoch_ms)),
    CONSTRAINT p2016_session_revoked CHECK ((revoked_at IS NULL AND revoked_epoch_ms IS NULL) OR (revoked_at IS NOT NULL AND revoked_epoch_ms IS NOT NULL AND revoked_epoch_ms>=issued_epoch_ms AND revoked_at=platform.local_from_epoch_ms(revoked_epoch_ms))),
    CONSTRAINT p2016_session_state CHECK ((state IN ('ACTIVE','EXPIRED') AND revoked_at IS NULL) OR (state='REVOKED' AND revoked_at IS NOT NULL))
);
CREATE INDEX p2016_session_public_ref_idx ON pilot_ticket.reporter_access_session(public_ref_id,ticket_id,reporter_binding_hash);
CREATE INDEX p2016_session_ticket_idx ON pilot_ticket.reporter_access_session(ticket_id);
CREATE INDEX p2016_session_expiry_idx ON pilot_ticket.reporter_access_session(state,expires_epoch_ms);

CREATE TABLE pilot_ticket.reporter_access_event (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    ticket_id UUID REFERENCES pilot_ticket.ticket(id) ON DELETE RESTRICT,
    grant_id UUID REFERENCES pilot_ticket.reporter_access_grant(grant_id) ON DELETE RESTRICT,
    session_id UUID REFERENCES pilot_ticket.reporter_access_session(session_id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL CHECK (event_type IN ('GRANT_ISSUED','EXCHANGE_SUCCEEDED','ACCESS_DENIED','TIMELINE_READ','LOGOUT','REVOKED')),
    actor_principal_id UUID REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    reason_code TEXT NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    occurred_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now()
);
CREATE INDEX p2016_access_event_ticket_idx ON pilot_ticket.reporter_access_event(ticket_id,occurred_at,id);
CREATE INDEX p2016_access_event_grant_idx ON pilot_ticket.reporter_access_event(grant_id);
CREATE INDEX p2016_access_event_session_idx ON pilot_ticket.reporter_access_event(session_id);
CREATE INDEX p2016_access_event_actor_idx ON pilot_ticket.reporter_access_event(actor_principal_id);

CREATE INDEX p2016_ticket_keyset_idx ON pilot_ticket.ticket(updated_at DESC,id DESC);
COMMIT;
