BEGIN;

-- Extend the existing per-round identity; all 041 facts, keys and guards remain.
ALTER TABLE communication.ticket_round_notification_binding
  DROP CONSTRAINT ticket_round_notification_binding_destination_type_check;
ALTER TABLE communication.ticket_round_notification_binding
  ADD CONSTRAINT ticket_round_notification_binding_destination_type_check
  CHECK(destination_type IN ('PERSON','GROUP'));

COMMIT;
