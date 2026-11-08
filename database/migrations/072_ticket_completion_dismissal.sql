BEGIN;

-- ADR-0058: 「完成」COMPLETED / 「关闭」DISMISSED. Development stage: no data mapping. Any legacy value fails the migration;
-- clean the affected development / test database (ADR-0056 U7) and rebuild it from fixtures instead.
-- Each probe runs through EXECUTE only after its table exists: a static query naming a missing table fails at planning
-- time, before any `to_regclass(...) IS NOT NULL AND ...` guard could short-circuit (partial fixture chains lack later tables).
DO $$
DECLARE
  legacy text := '';
  probe record;
  found boolean;
BEGIN
  FOR probe IN SELECT * FROM (VALUES
    ('pilot_ticket.ticket', ' ticket.status',
     $q$SELECT EXISTS (SELECT 1 FROM pilot_ticket.ticket WHERE status IN ('CLOSED','CANCELLED','DUPLICATE_LINKED'))$q$),
    ('pilot_ticket.ticket_event', ' ticket_event',
     $q$SELECT EXISTS (SELECT 1 FROM pilot_ticket.ticket_event
        WHERE old_status IN ('CLOSED','CANCELLED','DUPLICATE_LINKED') OR new_status IN ('CLOSED','CANCELLED','DUPLICATE_LINKED')
           OR event_type IN ('ticket.closed','ticket.cancelled','ticket.duplicate_linked','ticket.unlinked'))$q$),
    ('intake.service_intake', ' service_intake.status',
     $q$SELECT EXISTS (SELECT 1 FROM intake.service_intake WHERE status='IGNORED')$q$),
    ('intake.service_intake_event', ' service_intake_event',
     $q$SELECT EXISTS (SELECT 1 FROM intake.service_intake_event WHERE event_type='intake.closed')$q$),
    ('communication.ticket_notification_binding', ' ticket_notification_binding',
     $q$SELECT EXISTS (SELECT 1 FROM communication.ticket_notification_binding WHERE notification_type='TICKET_CLOSED')$q$)
  ) AS checks(relation, label, query)
  LOOP
    CONTINUE WHEN to_regclass(probe.relation) IS NULL;
    EXECUTE probe.query INTO found;
    IF found THEN legacy := legacy||probe.label; END IF;
  END LOOP;
  IF legacy <> '' THEN RAISE EXCEPTION 'COMPLETION_DISMISSAL_LEGACY_DATA_PRESENT:%', legacy USING HINT = 'Clean this development/test database (ADR-0056 U7) and rebuild it from fixtures; 072 never rewrites data.'; END IF;
END $$;

-- Original definitions for rollback. Intake-only fixtures may apply 072 before 003; 003 also uses IF NOT EXISTS.
-- The body is re-runnable: test fixtures that add older migrations afterwards (e.g. 040 / 041 / 063 guards) run it again;
-- objects already in the new vocabulary are skipped and the first recorded original definition is kept.
CREATE SCHEMA IF NOT EXISTS pilot_ticket;
CREATE TABLE IF NOT EXISTS pilot_ticket.completion_dismissal_baseline(
  object_kind TEXT NOT NULL CHECK (object_kind IN ('CONSTRAINT','FUNCTION')),
  object_name TEXT NOT NULL,
  relation TEXT,
  definition TEXT NOT NULL,
  PRIMARY KEY (object_kind, object_name)
);

-- Rewrite each status / event / notification vocabulary constraint from its current definition (several earlier
-- migrations rebuilt the same constraint), replacing whole quoted literals only.
DO $$
DECLARE
  target record;
  old_def text;
  new_def text;
BEGIN
  FOR target IN
    SELECT c.conrelid::regclass::text AS relation, c.conname, pg_get_constraintdef(c.oid, true) AS def
    FROM pg_constraint c
    WHERE c.contype = 'c' AND (
      (c.conrelid = to_regclass('pilot_ticket.ticket') AND c.conname = 'ticket_status_check')
      OR (c.conrelid = to_regclass('pilot_ticket.ticket_event') AND c.conname IN ('ticket_event_status_check','ticket_event_type_check'))
      OR (c.conrelid = to_regclass('intake.service_intake') AND c.conname = 'service_intake_status_check')
      OR (c.conrelid = to_regclass('intake.service_intake_event') AND c.conname = 'service_intake_event_type_check')
      OR (c.conrelid = to_regclass('communication.ticket_notification_binding') AND pg_get_constraintdef(c.oid, true) LIKE '%''TICKET_CLOSED''%'))
  LOOP
    old_def := target.def;
    new_def := old_def;
    new_def := replace(new_def, '''CLOSED''::text', '''COMPLETED''::text');
    new_def := replace(new_def, '''CANCELLED''::text', '''DISMISSED''::text');
    new_def := replace(new_def, '''IGNORED''::text', '''DISMISSED''::text');
    new_def := replace(new_def, '''ticket.closed''::text', '''ticket.completed''::text');
    new_def := replace(new_def, '''ticket.cancelled''::text', '''ticket.dismissed''::text');
    new_def := replace(new_def, '''intake.closed''::text', '''intake.dismissed''::text');
    new_def := replace(new_def, '''TICKET_CLOSED''::text', '''TICKET_COMPLETED''::text');
    new_def := regexp_replace(new_def, ',\s*''(DUPLICATE_LINKED|ticket\.duplicate_linked|ticket\.unlinked)''::text', '', 'g');
    new_def := regexp_replace(new_def, '''(DUPLICATE_LINKED|ticket\.duplicate_linked|ticket\.unlinked)''::text,\s*', '', 'g');
    IF new_def ~ '''(CLOSED|CANCELLED|IGNORED|DUPLICATE_LINKED|ticket\.closed|ticket\.cancelled|ticket\.duplicate_linked|ticket\.unlinked|intake\.closed|TICKET_CLOSED)''' THEN
      RAISE EXCEPTION 'COMPLETION_DISMISSAL_REWRITE_INCOMPLETE:%.%', target.relation, target.conname;
    END IF;
    CONTINUE WHEN new_def = old_def;
    INSERT INTO pilot_ticket.completion_dismissal_baseline(object_kind, object_name, relation, definition)
      VALUES ('CONSTRAINT', target.conname, target.relation, old_def) ON CONFLICT DO NOTHING;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', target.relation, target.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', target.relation, target.conname, new_def);
  END LOOP;
END $$;

-- Completion guards that name the completion event / status / notification literally (040, 041 / 063).
DO $$
DECLARE
  fn record;
  old_def text;
  new_def text;
BEGIN
  FOR fn IN
    SELECT p.oid, p.oid::regprocedure::text AS name
    FROM pg_proc p
    WHERE p.oid IN (
      COALESCE(to_regprocedure('pilot_ticket.guard_staff_completion_event()'), 0),
      COALESCE(to_regprocedure('communication.guard_ticket_round_notification_binding()'), 0))
  LOOP
    old_def := pg_get_functiondef(fn.oid);
    new_def := replace(old_def, '''ticket.closed''', '''ticket.completed''');
    new_def := replace(new_def, 'new_status=''CLOSED''', 'new_status=''COMPLETED''');
    new_def := replace(new_def, '''TICKET_CLOSED''', '''TICKET_COMPLETED''');
    IF new_def ~ '''(ticket\.closed|CLOSED|TICKET_CLOSED)''' THEN
      RAISE EXCEPTION 'COMPLETION_DISMISSAL_REWRITE_INCOMPLETE:%', fn.name;
    END IF;
    CONTINUE WHEN new_def = old_def;
    INSERT INTO pilot_ticket.completion_dismissal_baseline(object_kind, object_name, relation, definition)
      VALUES ('FUNCTION', fn.name, NULL, old_def) ON CONFLICT DO NOTHING;
    EXECUTE new_def;
  END LOOP;
END $$;

COMMIT;
