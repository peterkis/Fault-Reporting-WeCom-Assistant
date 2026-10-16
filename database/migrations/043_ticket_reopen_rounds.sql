BEGIN;

-- Extend the existing Web command ledger; feedback is not another Web material revision.
ALTER TABLE intake.web_command_receipt DROP CONSTRAINT web_command_receipt_kind_check;
ALTER TABLE intake.web_command_receipt ADD CONSTRAINT web_command_receipt_kind_check
  CHECK(command_kind IN ('SUBMIT','SUPPLEMENT','FEEDBACK'));
ALTER TABLE intake.web_command_receipt ADD COLUMN feedback_result JSONB;
ALTER TABLE intake.web_command_receipt ADD CONSTRAINT web_feedback_result_purpose
  CHECK((command_kind='FEEDBACK' AND feedback_result IS NOT NULL AND jsonb_typeof(feedback_result)='object')
     OR (command_kind<>'FEEDBACK' AND feedback_result IS NULL));

-- One immutable completed-cycle basis is shared by Reporter feedback and authorized staff reopen.
-- Ticket, events, current owner and the existing command ledgers remain their only authorities.
CREATE TABLE pilot_ticket.ticket_cycle_reopen (
  completed_cycle_id UUID PRIMARY KEY,
  ticket_id UUID NOT NULL,
  completion_event_id UUID NOT NULL,
  source_intake_id UUID NOT NULL,
  reopen_event_id UUID NOT NULL UNIQUE,
  new_cycle_id UUID NOT NULL UNIQUE,
  origin TEXT NOT NULL CHECK(origin IN ('WEB_REPORTER','STAFF')),
  client_command_id UUID NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
  FOREIGN KEY(ticket_id,completed_cycle_id,completion_event_id,source_intake_id)
    REFERENCES pilot_ticket.ticket_handling_cycle(ticket_id,id,staff_completion_event_id,source_intake_id),
  FOREIGN KEY(ticket_id,reopen_event_id) REFERENCES pilot_ticket.ticket_event(ticket_id,event_id),
  FOREIGN KEY(ticket_id,new_cycle_id,reopen_event_id)
    REFERENCES pilot_ticket.ticket_handling_cycle_event(ticket_id,cycle_id,ticket_event_id),
  CHECK(completed_cycle_id<>new_cycle_id)
);
CREATE FUNCTION pilot_ticket.guard_cycle_reopen_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'CYCLE_REOPEN_IMMUTABLE'; END $$;
CREATE TRIGGER cycle_reopen_immutable BEFORE UPDATE OR DELETE ON pilot_ticket.ticket_cycle_reopen
  FOR EACH ROW EXECUTE FUNCTION pilot_ticket.guard_cycle_reopen_immutable();

COMMIT;
