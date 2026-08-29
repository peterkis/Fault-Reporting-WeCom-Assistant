BEGIN;

ALTER TABLE pilot_ticket.ticket_event
    DROP CONSTRAINT IF EXISTS ticket_event_type_check;
ALTER TABLE pilot_ticket.ticket_event
    ADD CONSTRAINT ticket_event_type_check CHECK (
        event_type IN (
            'ticket.created', 'ticket.queued', 'ticket.accepted', 'ticket.started',
            'ticket.waiting_requester', 'ticket.waiting_vendor', 'ticket.resumed',
            'ticket.resolved', 'ticket.closed', 'ticket.reopened', 'ticket.cancelled',
            'ticket.duplicate_linked', 'ticket.unlinked', 'ticket.note_added',
            'ticket.information_added', 'ticket.auto_close_reminder'
        )
    );

ALTER TABLE pilot_ticket.ticket_event
    DROP CONSTRAINT IF EXISTS ticket_event_operator_id_check;
ALTER TABLE pilot_ticket.ticket_event
    ADD CONSTRAINT ticket_event_operator_id_check CHECK (
        operator_id IS NULL OR char_length(operator_id) BETWEEN 1 AND 256
    );

ALTER TABLE pilot_ticket.ticket
    ADD COLUMN IF NOT EXISTS auto_close_reminder_at TIMESTAMPTZ;

DO $p1_010_existing_pair$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pilot_ticket.ticket AS ticket
          LEFT JOIN intake.service_intake AS intake ON intake.id = ticket.source_intake_id
         WHERE intake.id IS NULL OR intake.pilot_ticket_id IS DISTINCT FROM ticket.id
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'P1_005_TICKET_INTAKE_PAIR_MISMATCH';
    END IF;
END
$p1_010_existing_pair$;

CREATE OR REPLACE FUNCTION pilot_ticket.ensure_ticket_intake_pair()
RETURNS trigger
LANGUAGE plpgsql
AS $p1_010_ticket_pair$
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
$p1_010_ticket_pair$;

DROP TRIGGER IF EXISTS ticket_intake_pair_check ON pilot_ticket.ticket;
CREATE CONSTRAINT TRIGGER ticket_intake_pair_check
AFTER INSERT OR UPDATE OF source_intake_id ON pilot_ticket.ticket
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION pilot_ticket.ensure_ticket_intake_pair();

COMMIT;
