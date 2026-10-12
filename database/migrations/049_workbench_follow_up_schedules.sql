BEGIN;

-- Preserve every earlier event vocabulary extension; add only the two T37 facts.
DO $migration$
DECLARE old_check TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO old_check FROM pg_constraint
    WHERE conrelid='pilot_ticket.ticket_event'::regclass AND conname='ticket_event_type_check';
  IF old_check IS NULL OR left(old_check,6)<>'CHECK ' THEN RAISE EXCEPTION 'FOLLOW_UP_EVENT_CHECK_REQUIRED'; END IF;
  ALTER TABLE pilot_ticket.ticket_event DROP CONSTRAINT ticket_event_type_check;
  EXECUTE 'ALTER TABLE pilot_ticket.ticket_event ADD CONSTRAINT ticket_event_type_check CHECK ('
    || substring(old_check FROM 7) || ' OR event_type IN (''ticket.follow_up_scheduled'',''ticket.follow_up_cancelled''))';
END;
$migration$;

-- A revision belongs to the existing Ticket/Event, without copying any owner or status.
CREATE UNIQUE INDEX follow_up_ticket_event_reference_idx ON pilot_ticket.ticket_event(ticket_id,event_id);
CREATE TABLE pilot_ticket.follow_up_schedule_revision (
    ticket_id UUID NOT NULL REFERENCES pilot_ticket.ticket(id),
    schedule_version BIGINT NOT NULL CHECK (schedule_version>=1),
    action TEXT NOT NULL CHECK (action IN ('SET','CANCEL')),
    due_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    due_epoch_ms BIGINT NOT NULL CHECK (due_epoch_ms>=0 AND due_epoch_ms%1000=0),
    ticket_event_id UUID NOT NULL,
    occurred_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY(ticket_id,schedule_version),
    UNIQUE(ticket_event_id),
    FOREIGN KEY(ticket_id,ticket_event_id) REFERENCES pilot_ticket.ticket_event(ticket_id,event_id),
    CONSTRAINT follow_up_revision_time_pair CHECK (due_at=platform.local_from_epoch_ms(due_epoch_ms))
);
CREATE TABLE pilot_ticket.follow_up_schedule (
    ticket_id UUID PRIMARY KEY REFERENCES pilot_ticket.ticket(id),
    schedule_version BIGINT NOT NULL CHECK (schedule_version>=1),
    due_at TIMESTAMP(0) WITHOUT TIME ZONE,
    due_epoch_ms BIGINT,
    scheduled_event_id UUID,
    FOREIGN KEY(ticket_id,schedule_version) REFERENCES pilot_ticket.follow_up_schedule_revision(ticket_id,schedule_version),
    FOREIGN KEY(ticket_id,scheduled_event_id) REFERENCES pilot_ticket.ticket_event(ticket_id,event_id),
    CONSTRAINT follow_up_current_time_pair CHECK (
      (due_at IS NULL AND due_epoch_ms IS NULL AND scheduled_event_id IS NULL) OR
      (due_at IS NOT NULL AND due_epoch_ms IS NOT NULL AND due_epoch_ms>=0 AND due_epoch_ms%1000=0 AND scheduled_event_id IS NOT NULL
        AND due_at=platform.local_from_epoch_ms(due_epoch_ms))
    )
);
CREATE INDEX follow_up_current_due_idx ON pilot_ticket.follow_up_schedule(due_epoch_ms,ticket_id) WHERE due_epoch_ms IS NOT NULL;

COMMIT;
