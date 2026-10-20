BEGIN;

ALTER TABLE communication.ticket_round_notification_binding
  DROP CONSTRAINT ticket_round_notification_binding_node_check;
ALTER TABLE communication.ticket_round_notification_binding
  ADD CONSTRAINT ticket_round_notification_binding_node_check
  CHECK(node IN ('FIRST_RESPONSIBILITY','FIRST_HANDLING','STAFF_COMPLETED'));

CREATE OR REPLACE FUNCTION communication.guard_ticket_round_notification_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'ROUND_NOTIFICATION_BINDING_IMMUTABLE'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pilot_ticket.ticket_handling_cycle c
    JOIN communication.ticket_notification_binding b ON b.id=NEW.notification_binding_id AND b.ticket_id=c.ticket_id
    JOIN pilot_ticket.ticket_handling_cycle_event ce ON ce.ticket_id=c.ticket_id AND ce.cycle_id=c.id AND ce.ticket_event_id=b.ticket_event_id
    WHERE c.ticket_id=NEW.ticket_id AND c.id=NEW.cycle_id
      AND b.recipient_binding_hash=NEW.recipient_binding_hash AND b.destination_type=NEW.destination_type
      AND ((NEW.node='FIRST_RESPONSIBILITY' AND b.ticket_event_id=c.first_responsibility_event_id AND b.notification_type='TICKET_ACCEPTED')
        OR (NEW.node='FIRST_HANDLING' AND NEW.destination_type='PERSON' AND b.notification_type='TICKET_ACCEPTED'
          AND b.ticket_event_id=(SELECT he.event_id FROM pilot_ticket.ticket_handling_cycle_event hc
            JOIN pilot_ticket.ticket_event he ON he.ticket_id=hc.ticket_id AND he.event_id=hc.ticket_event_id
            WHERE hc.cycle_id=c.id AND hc.ticket_id=c.ticket_id AND he.operator_type='PILOT_USER'
              AND ((he.event_type='ticket.accepted' AND he.new_status='ACCEPTED')
                OR (he.event_type='ticket.started' AND he.new_status='IN_PROGRESS'))
            ORDER BY he.aggregate_version,he.event_id LIMIT 1))
        OR (NEW.node='STAFF_COMPLETED' AND b.ticket_event_id=c.staff_completion_event_id AND b.notification_type='TICKET_CLOSED'
          AND EXISTS(SELECT 1 FROM pilot_ticket.staff_completion_notification_commitment p WHERE p.cycle_id=c.id AND p.ticket_event_id=b.ticket_event_id)))
  ) THEN RAISE EXCEPTION 'ROUND_NOTIFICATION_BINDING_INVALID'; END IF;
  RETURN NEW;
END $$;

-- A request-scoped recipient is independent of the short-lived OAuth session.
-- Existing owner hashes, proofs and notification intents are not rewritten.
ALTER TABLE intake.web_request_binding
  ADD COLUMN notify_recipient_id TEXT,
  ADD COLUMN notify_identity_namespace TEXT,
  ADD COLUMN notify_proof_ref TEXT,
  ADD COLUMN notify_verified_epoch_ms BIGINT,
  ADD CONSTRAINT web_binding_notification_recipient_check CHECK (
    (notify_recipient_id IS NULL AND notify_identity_namespace IS NULL AND notify_proof_ref IS NULL AND notify_verified_epoch_ms IS NULL)
    OR (notify_recipient_id IS NOT NULL AND notify_identity_namespace IS NOT NULL AND notify_identity_namespace='APP_OPEN_USERID' AND notify_proof_ref IS NOT NULL AND notify_verified_epoch_ms IS NOT NULL
      AND octet_length(notify_recipient_id) BETWEEN 1 AND 64 AND notify_recipient_id<>'@all'
      AND notify_recipient_id !~ '[[:space:][:cntrl:]/\\]'
      AND char_length(notify_proof_ref) BETWEEN 1 AND 256
      AND notify_verified_epoch_ms>=0 AND notify_verified_epoch_ms<retention_until_epoch_ms));

CREATE FUNCTION intake.guard_web_notification_recipient() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.notify_recipient_id,NEW.notify_identity_namespace,NEW.notify_proof_ref,NEW.notify_verified_epoch_ms)
    IS DISTINCT FROM ROW(OLD.notify_recipient_id,OLD.notify_identity_namespace,OLD.notify_proof_ref,OLD.notify_verified_epoch_ms)
  THEN RAISE EXCEPTION 'WEB_NOTIFICATION_RECIPIENT_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER web_notification_recipient_immutable BEFORE UPDATE ON intake.web_request_binding
  FOR EACH ROW EXECUTE FUNCTION intake.guard_web_notification_recipient();

COMMIT;
