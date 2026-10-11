BEGIN;

-- Reporter commands retain the existing Ticket ledger, with no fabricated staff
-- principal and no historical App pin on the original Bot public reference.
ALTER TABLE pilot_ticket.ticket_command_receipt ALTER COLUMN actor_principal_id DROP NOT NULL;
ALTER TABLE pilot_ticket.ticket_command_receipt ADD CONSTRAINT bot_feedback_actor_purpose CHECK (
  (command_type<>'BOT_REPORTER_FEEDBACK' AND actor_principal_id IS NOT NULL
    AND command_scope NOT LIKE 'BOT_REPORTER_FEEDBACK:%')
  OR (command_type='BOT_REPORTER_FEEDBACK' AND actor_principal_id IS NULL
    AND command_scope ~ '^BOT_REPORTER_FEEDBACK:[a-f0-9]{64}$'
    AND ticket_id IS NOT NULL AND review_id IS NULL AND conversation_session_id IS NULL
    AND expected_ticket_version IS NOT NULL AND expected_session_version IS NULL
    AND state='COMMITTED' AND result_ticket_event_id IS NOT NULL AND result_control_event_id IS NULL
    AND result_ticket_version IS NOT NULL AND result_ticket_version::bigint=expected_ticket_version::bigint+1
    AND COALESCE(jsonb_typeof(result_snapshot->'public_ref')='string'
      AND result_snapshot->>'public_ref' ~ '^[A-Za-z0-9_-]{32}$',false))
);

ALTER TABLE pilot_ticket.ticket_cycle_reopen DROP CONSTRAINT ticket_cycle_reopen_origin_check;
ALTER TABLE pilot_ticket.ticket_cycle_reopen ADD CONSTRAINT ticket_cycle_reopen_origin_check
  CHECK(origin IN ('WEB_REPORTER','BOT_REPORTER','STAFF'));

COMMIT;
