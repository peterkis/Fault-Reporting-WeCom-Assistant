BEGIN;

-- Extend the already integrated Core constraints; retain every other event and metadata rule.
DO $migration$
DECLARE old_type TEXT; old_metadata TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO old_type FROM pg_constraint
    WHERE conrelid='pilot_ticket.ticket_event'::regclass AND conname='ticket_event_type_check'
      AND contype='c' AND convalidated AND conenforced AND NOT condeferrable;
  SELECT pg_get_constraintdef(oid) INTO old_metadata FROM pg_constraint
    WHERE conrelid='pilot_ticket.ticket_event'::regclass AND conname='p2016_assignment_metadata_check'
      AND contype='c' AND convalidated AND conenforced AND NOT condeferrable;
  IF old_type IS NULL OR left(old_type,6)<>'CHECK ' OR old_metadata IS NULL OR left(old_metadata,6)<>'CHECK '
    THEN RAISE EXCEPTION 'RETURN_FOLLOW_UP_CORE_CHECKS_REQUIRED'; END IF;

  ALTER TABLE pilot_ticket.ticket_event DROP CONSTRAINT ticket_event_type_check;
  EXECUTE 'ALTER TABLE pilot_ticket.ticket_event ADD CONSTRAINT ticket_event_type_check CHECK ('
    || substring(old_type FROM 7)
    || ' OR event_type IN (''ticket.returned_to_dispatch'',''ticket.follow_up_scheduled'',''ticket.follow_up_cancelled''))';

  ALTER TABLE pilot_ticket.ticket_event DROP CONSTRAINT p2016_assignment_metadata_check;
  EXECUTE 'ALTER TABLE pilot_ticket.ticket_event ADD CONSTRAINT p2016_assignment_metadata_check CHECK ('
    || '(event_type<>''ticket.returned_to_dispatch'' AND ' || substring(old_metadata FROM 7) || ') OR '
    || $return$(event_type='ticket.returned_to_dispatch' AND assignment_metadata IS NOT NULL
      AND jsonb_typeof(assignment_metadata)='object'
      AND assignment_metadata ?& ARRAY['old_assignee_id','new_assignee_id','old_team_id','new_team_id']::text[]
      AND assignment_metadata - ARRAY['old_assignee_id','new_assignee_id','old_team_id','new_team_id']::text[]='{}'::jsonb
      AND jsonb_typeof(assignment_metadata->'old_assignee_id')='string'
      AND assignment_metadata->>'old_assignee_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND assignment_metadata->'new_assignee_id'='null'::jsonb
      AND jsonb_typeof(assignment_metadata->'old_team_id')='string'
      AND assignment_metadata->>'old_team_id' ~ '^[A-Z][A-Z0-9_]{0,63}$'
      AND assignment_metadata->'old_team_id'=assignment_metadata->'new_team_id'
      AND old_status IS NOT NULL AND old_status IN ('IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR') AND new_status='QUEUED'
      AND operator_type='PILOT_USER' AND operator_id IS NOT NULL
      AND internal_note IS NOT NULL AND char_length(internal_note) BETWEEN 1 AND 2000 AND btrim(internal_note)<>''
      AND external_note IS NULL AND reason_code IS NOT NULL))$return$;
END;
$migration$;

COMMIT;
