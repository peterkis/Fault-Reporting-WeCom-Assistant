BEGIN;

-- Only semantic deduplication. Message/Outbox/Delivery keep their existing authority.
CREATE TABLE communication.ticket_round_notification_binding (
  ticket_id UUID NOT NULL,
  cycle_id UUID NOT NULL,
  node TEXT NOT NULL CHECK(node IN ('FIRST_RESPONSIBILITY','STAFF_COMPLETED')),
  recipient_binding_hash TEXT NOT NULL CHECK(recipient_binding_hash ~ '^[a-f0-9]{64}$'),
  destination_type TEXT NOT NULL CHECK(destination_type='PERSON'),
  notification_binding_id UUID NOT NULL UNIQUE REFERENCES communication.ticket_notification_binding(id),
  PRIMARY KEY(cycle_id,node,recipient_binding_hash,destination_type),
  UNIQUE(cycle_id,node,destination_type),
  FOREIGN KEY(ticket_id,cycle_id) REFERENCES pilot_ticket.ticket_handling_cycle(ticket_id,id)
);
CREATE INDEX ticket_round_notification_ticket_idx ON communication.ticket_round_notification_binding(ticket_id,cycle_id);

CREATE FUNCTION communication.guard_ticket_round_notification_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'ROUND_NOTIFICATION_BINDING_IMMUTABLE'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pilot_ticket.ticket_handling_cycle c
    JOIN communication.ticket_notification_binding b ON b.id=NEW.notification_binding_id AND b.ticket_id=c.ticket_id
    JOIN pilot_ticket.ticket_handling_cycle_event ce ON ce.ticket_id=c.ticket_id AND ce.cycle_id=c.id AND ce.ticket_event_id=b.ticket_event_id
    WHERE c.ticket_id=NEW.ticket_id AND c.id=NEW.cycle_id
      AND b.recipient_binding_hash=NEW.recipient_binding_hash AND b.destination_type=NEW.destination_type
      AND ((NEW.node='FIRST_RESPONSIBILITY' AND b.ticket_event_id=c.first_responsibility_event_id AND b.notification_type='TICKET_ACCEPTED')
        OR (NEW.node='STAFF_COMPLETED' AND b.ticket_event_id=c.staff_completion_event_id AND b.notification_type='TICKET_CLOSED'
          AND EXISTS(SELECT 1 FROM pilot_ticket.staff_completion_notification_commitment p WHERE p.cycle_id=c.id AND p.ticket_event_id=b.ticket_event_id)))
  ) THEN RAISE EXCEPTION 'ROUND_NOTIFICATION_BINDING_INVALID'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ticket_round_notification_guard BEFORE INSERT OR UPDATE OR DELETE ON communication.ticket_round_notification_binding
  FOR EACH ROW EXECUTE FUNCTION communication.guard_ticket_round_notification_binding();

COMMIT;
