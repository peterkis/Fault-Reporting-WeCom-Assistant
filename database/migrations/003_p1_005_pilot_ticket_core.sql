BEGIN;

CREATE SCHEMA IF NOT EXISTS pilot_ticket;

CREATE SEQUENCE IF NOT EXISTS pilot_ticket.ticket_number_seq AS BIGINT;

CREATE TABLE IF NOT EXISTS pilot_ticket.resolver_team (
    team_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT resolver_team_id_check CHECK (team_id ~ '^[A-Z][A-Z0-9_]{1,63}$'),
    CONSTRAINT resolver_team_display_name_check CHECK (char_length(display_name) BETWEEN 1 AND 128)
);

INSERT INTO pilot_ticket.resolver_team (team_id, display_name)
VALUES ('PILOT_IT', 'Pilot 信息保障组')
ON CONFLICT (team_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS pilot_ticket.ticket (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    ticket_no TEXT NOT NULL,
    source_intake_id UUID NOT NULL UNIQUE
        REFERENCES intake.service_intake(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    request_type TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'NORMAL',
    resolver_team_id TEXT NOT NULL
        REFERENCES pilot_ticket.resolver_team(team_id) ON DELETE RESTRICT,
    assignee_id UUID,
    reported_campus_id TEXT,
    reported_department_id TEXT,
    reported_location_text TEXT,
    external_result TEXT,
    closure_reason TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ticket_number_unique UNIQUE (ticket_no),
    CONSTRAINT ticket_number_check CHECK (ticket_no ~ '^IT-[0-9]{8}-[0-9]{4,}$'),
    CONSTRAINT ticket_title_check CHECK (char_length(title) BETWEEN 1 AND 200),
    CONSTRAINT ticket_request_type_check CHECK (
        request_type IN (
            'INCIDENT', 'SERVICE_REQUEST', 'QUESTION', 'COMPLAINT',
            'STATUS_QUERY', 'FOLLOW_UP', 'CHATTER', 'UNKNOWN'
        )
    ),
    CONSTRAINT ticket_status_check CHECK (
        status IN (
            'NEW', 'QUEUED', 'ACCEPTED', 'IN_PROGRESS', 'WAITING_REQUESTER',
            'WAITING_VENDOR', 'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED',
            'DUPLICATE_LINKED'
        )
    ),
    CONSTRAINT ticket_priority_check CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
    CONSTRAINT ticket_campus_check CHECK (
        reported_campus_id IS NULL OR char_length(reported_campus_id) <= 64
    ),
    CONSTRAINT ticket_department_check CHECK (
        reported_department_id IS NULL OR char_length(reported_department_id) <= 64
    ),
    CONSTRAINT ticket_location_check CHECK (
        reported_location_text IS NULL OR char_length(reported_location_text) <= 500
    ),
    CONSTRAINT ticket_external_result_check CHECK (
        external_result IS NULL OR char_length(external_result) <= 2000
    ),
    CONSTRAINT ticket_closure_reason_check CHECK (
        closure_reason IS NULL OR char_length(closure_reason) BETWEEN 1 AND 128
    ),
    CONSTRAINT ticket_version_check CHECK (version >= 1),
    CONSTRAINT ticket_time_check CHECK (updated_at >= created_at)
);

ALTER TABLE intake.service_intake
    ADD COLUMN IF NOT EXISTS pilot_ticket_id UUID;

DO $p1_005_constraints$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'intake.service_intake'::regclass
          AND conname = 'service_intake_pilot_ticket_unique'
    ) THEN
        ALTER TABLE intake.service_intake
            ADD CONSTRAINT service_intake_pilot_ticket_unique UNIQUE (pilot_ticket_id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'intake.service_intake'::regclass
          AND conname = 'service_intake_pilot_ticket_fk'
    ) THEN
        ALTER TABLE intake.service_intake
            ADD CONSTRAINT service_intake_pilot_ticket_fk
            FOREIGN KEY (pilot_ticket_id)
            REFERENCES pilot_ticket.ticket(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'intake.service_intake'::regclass
          AND conname = 'service_intake_ticket_link_check'
    ) THEN
        ALTER TABLE intake.service_intake
            ADD CONSTRAINT service_intake_ticket_link_check CHECK (
                (pilot_ticket_id IS NULL AND status <> 'TICKET_CREATED')
                OR (pilot_ticket_id IS NOT NULL AND status = 'TICKET_CREATED')
            );
    END IF;
END
$p1_005_constraints$;

CREATE OR REPLACE FUNCTION pilot_ticket.ensure_intake_ticket_pair()
RETURNS trigger
LANGUAGE plpgsql
AS $p1_005_pair$
BEGIN
    IF NEW.pilot_ticket_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM pilot_ticket.ticket AS ticket
         WHERE ticket.id = NEW.pilot_ticket_id
           AND ticket.source_intake_id = NEW.id
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'P1_005_INTAKE_TICKET_PAIR_MISMATCH';
    END IF;
    RETURN NEW;
END
$p1_005_pair$;

DROP TRIGGER IF EXISTS service_intake_ticket_pair_check ON intake.service_intake;
CREATE CONSTRAINT TRIGGER service_intake_ticket_pair_check
AFTER INSERT OR UPDATE OF pilot_ticket_id ON intake.service_intake
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION pilot_ticket.ensure_intake_ticket_pair();

CREATE OR REPLACE FUNCTION pilot_ticket.ensure_ticket_intake_pair()
RETURNS trigger
LANGUAGE plpgsql
AS $p1_005_ticket_pair$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM intake.service_intake AS intake
         WHERE intake.id = NEW.source_intake_id
           AND intake.pilot_ticket_id = NEW.id
    ) OR EXISTS (
        SELECT 1
          FROM intake.service_intake AS intake
         WHERE intake.pilot_ticket_id = NEW.id
           AND intake.id <> NEW.source_intake_id
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'P1_005_TICKET_INTAKE_PAIR_MISMATCH';
    END IF;
    RETURN NEW;
END
$p1_005_ticket_pair$;

DROP TRIGGER IF EXISTS ticket_intake_pair_check ON pilot_ticket.ticket;
CREATE CONSTRAINT TRIGGER ticket_intake_pair_check
AFTER INSERT OR UPDATE OF source_intake_id ON pilot_ticket.ticket
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION pilot_ticket.ensure_ticket_intake_pair();

ALTER TABLE intake.service_intake_event
    DROP CONSTRAINT IF EXISTS service_intake_event_type_check;
ALTER TABLE intake.service_intake_event
    ADD CONSTRAINT service_intake_event_type_check CHECK (
        event_type IN (
            'intake.received',
            'intake.needs_clarification',
            'intake.message_added',
            'intake.clarification_added',
            'intake.ticket_created'
        )
    );

CREATE INDEX IF NOT EXISTS ticket_queue_idx
    ON pilot_ticket.ticket (resolver_team_id, status, created_at);

COMMENT ON TABLE pilot_ticket.ticket IS
    'P1-005 Pilot Ticket Core fact source. It has no Hospital Ticket dependency.';
COMMENT ON COLUMN pilot_ticket.ticket.source_intake_id IS
    'One Service Intake creates at most one Pilot Ticket.';
COMMENT ON COLUMN intake.service_intake.pilot_ticket_id IS
    'Reciprocal Pilot Ticket reference validated against the ticket source Intake.';

COMMIT;
