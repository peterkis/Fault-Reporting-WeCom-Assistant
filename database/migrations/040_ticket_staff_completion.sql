BEGIN;

ALTER TABLE pilot_ticket.ticket_handling_cycle_event ADD CONSTRAINT handling_cycle_event_identity UNIQUE(ticket_id,cycle_id,ticket_event_id);
ALTER TABLE pilot_ticket.ticket_handling_cycle ADD COLUMN staff_completion_event_id UUID UNIQUE;
ALTER TABLE pilot_ticket.ticket_handling_cycle ADD CONSTRAINT handling_cycle_completion_event
  FOREIGN KEY(ticket_id,id,staff_completion_event_id) REFERENCES pilot_ticket.ticket_handling_cycle_event(ticket_id,cycle_id,ticket_event_id);
ALTER TABLE pilot_ticket.ticket_handling_cycle ADD CONSTRAINT handling_cycle_completion_source UNIQUE(ticket_id,id,staff_completion_event_id,source_intake_id);

CREATE FUNCTION pilot_ticket.guard_staff_completion_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.staff_completion_event_id IS NOT NULL AND NEW.staff_completion_event_id IS DISTINCT FROM OLD.staff_completion_event_id THEN
    RAISE EXCEPTION 'STAFF_COMPLETION_IMMUTABLE';
  END IF;
  IF NEW.staff_completion_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pilot_ticket.ticket_event e WHERE e.ticket_id=NEW.ticket_id AND e.event_id=NEW.staff_completion_event_id
      AND e.event_type='ticket.closed' AND e.old_status='IN_PROGRESS' AND e.new_status='CLOSED'
      AND e.operator_type='PILOT_USER' AND e.operator_id IS NOT NULL AND e.reason_code='STAFF_COMPLETED'
      AND char_length(btrim(e.internal_note)) BETWEEN 1 AND 2000 AND char_length(btrim(e.external_note)) BETWEEN 1 AND 500
  ) THEN RAISE EXCEPTION 'STAFF_COMPLETION_EVENT_INVALID'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_completion_event_guard BEFORE UPDATE OF staff_completion_event_id ON pilot_ticket.ticket_handling_cycle
  FOR EACH ROW EXECUTE FUNCTION pilot_ticket.guard_staff_completion_event();

-- A durable consumer boundary, not a second status, owner, receipt or Delivery. Text remains on the authoritative event.
CREATE TABLE pilot_ticket.staff_completion_notification_commitment (
  cycle_id UUID PRIMARY KEY,
  ticket_id UUID NOT NULL,
  ticket_event_id UUID NOT NULL UNIQUE,
  source_intake_id UUID NOT NULL,
  FOREIGN KEY(ticket_id,cycle_id,ticket_event_id,source_intake_id)
    REFERENCES pilot_ticket.ticket_handling_cycle(ticket_id,id,staff_completion_event_id,source_intake_id)
);
CREATE FUNCTION pilot_ticket.guard_completion_commitment_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'STAFF_COMPLETION_COMMITMENT_IMMUTABLE'; END $$;
CREATE TRIGGER completion_commitment_immutable BEFORE UPDATE OR DELETE ON pilot_ticket.staff_completion_notification_commitment
  FOR EACH ROW EXECUTE FUNCTION pilot_ticket.guard_completion_commitment_immutable();

COMMIT;
