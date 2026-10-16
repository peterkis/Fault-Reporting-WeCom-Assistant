BEGIN;

-- Preserve the complete currently validated legacy resource predicate, including
-- optional Intake and Manual-report branches. No existing resource is rewritten.
DO $conversation_delivery$
DECLARE
  legacy_predicate TEXT;
  intake_empty TEXT := 'TRUE';
BEGIN
  SELECT pg_get_expr(c.conbin,c.conrelid,true) INTO STRICT legacy_predicate
    FROM pg_constraint c
    WHERE c.conrelid='pilot_ticket.ticket_command_receipt'::regclass
      AND c.conname='p2016_command_resource' AND c.contype='c'
      AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred;
  IF legacy_predicate LIKE '%CONVERSATION_DELIVERY_%' THEN
    RAISE EXCEPTION 'CONVERSATION_DELIVERY_PARTIAL_SCHEMA';
  END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='pilot_ticket'
    AND table_name='ticket_command_receipt' AND column_name='source_intake_id') THEN
    intake_empty := 'source_intake_id IS NULL';
  END IF;
  EXECUTE 'ALTER TABLE pilot_ticket.ticket_command_receipt DROP CONSTRAINT p2016_command_resource';
  EXECUTE format(
    'ALTER TABLE pilot_ticket.ticket_command_receipt ADD CONSTRAINT p2016_command_resource CHECK ((%s) OR (command_type IN (''CONVERSATION_DELIVERY_RETRY'',''CONVERSATION_DELIVERY_RECONCILE'') AND conversation_session_id IS NOT NULL))',
    legacy_predicate);
  EXECUTE format($strict$
    ALTER TABLE pilot_ticket.ticket_command_receipt
    ADD CONSTRAINT p2016_conversation_delivery_command CHECK (
      command_type NOT IN ('CONVERSATION_DELIVERY_RETRY','CONVERSATION_DELIVERY_RECONCILE')
      OR (
        actor_principal_id IS NOT NULL
        AND command_scope='P2_006_DELIVERY:'||actor_principal_id::text
        AND conversation_session_id IS NOT NULL
        AND ticket_id IS NULL AND review_id IS NULL AND %s
        AND expected_ticket_version IS NULL AND expected_session_version IS NULL
        AND result_ticket_version IS NULL AND result_ticket_event_id IS NULL
        AND result_control_event_id IS NULL
        AND (
          (state IN ('STARTED','FAILED') AND result_snapshot IS NULL)
          OR (
            state='COMMITTED' AND result_snapshot IS NOT NULL
            AND jsonb_typeof(result_snapshot)='object'
            AND result_snapshot-ARRAY['ok','reason_code','resolution','expected_delivery_attempt_count','result']::text[]='{}'::jsonb
            AND result_snapshot ?& ARRAY['ok','reason_code','resolution','expected_delivery_attempt_count','result']
            AND result_snapshot->'ok'='true'::jsonb
            AND jsonb_typeof(result_snapshot->'reason_code')='string'
            AND result_snapshot->>'reason_code' ~ '^[A-Z0-9_]{1,128}$'
            AND (
              (command_type='CONVERSATION_DELIVERY_RETRY' AND result_snapshot->'resolution'='null'::jsonb)
              OR (command_type='CONVERSATION_DELIVERY_RECONCILE'
                AND jsonb_typeof(result_snapshot->'resolution')='string'
                AND result_snapshot->>'resolution' IN ('CONFIRMED_SENT','CONFIRMED_NOT_SENT_REQUEUE','CANCEL'))
            )
            AND jsonb_typeof(result_snapshot->'expected_delivery_attempt_count')='number'
            AND result_snapshot->>'expected_delivery_attempt_count' ~ '^(0|[1-9][0-9]{0,9})$'
            AND (result_snapshot->>'expected_delivery_attempt_count')::numeric BETWEEN 0 AND 2147483647
            AND jsonb_typeof(result_snapshot->'result')='object'
            AND (result_snapshot->'result')-ARRAY['ok','session_id','delivery_id','client_command_id','status','side_effect_state','attempt_count','replayed']::text[]='{}'::jsonb
            AND (result_snapshot->'result') ?& ARRAY['ok','session_id','delivery_id','client_command_id','status','side_effect_state','attempt_count','replayed']
            AND result_snapshot->'result'->'ok'='true'::jsonb
            AND jsonb_typeof(result_snapshot->'result'->'session_id')='string'
            AND result_snapshot->'result'->>'session_id'=conversation_session_id::text
            AND jsonb_typeof(result_snapshot->'result'->'client_command_id')='string'
            AND result_snapshot->'result'->>'client_command_id'=client_command_id::text
            AND jsonb_typeof(result_snapshot->'result'->'delivery_id')='string'
            AND result_snapshot->'result'->>'delivery_id' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
            AND jsonb_typeof(result_snapshot->'result'->'status')='string'
            AND result_snapshot->'result'->>'status' IN ('PENDING','LEASED','SENDING','SENT','RECONCILIATION_REQUIRED','DEAD_LETTER','CANCELLED')
            AND jsonb_typeof(result_snapshot->'result'->'side_effect_state')='string'
            AND result_snapshot->'result'->>'side_effect_state' IN ('NOT_ATTEMPTED','ACKNOWLEDGED','UNKNOWN')
            AND jsonb_typeof(result_snapshot->'result'->'attempt_count')='number'
            AND result_snapshot->'result'->>'attempt_count' ~ '^(0|[1-9][0-9]{0,9})$'
            AND (result_snapshot->'result'->>'attempt_count')::numeric BETWEEN 0 AND 2147483647
            AND result_snapshot->'result'->'replayed'='false'::jsonb
          )
        )
      )
    )
  $strict$,intake_empty);
END
$conversation_delivery$;

COMMIT;
