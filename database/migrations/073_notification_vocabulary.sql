BEGIN;

-- ADR-0058 supplement (card 32D-L): the dismissal notice is TICKET_DISMISSED, restoration has its own TICKET_RESTORED (reopening
-- keeps TICKET_REOPENED), and the reminder before automatic completion is ticket.auto_complete_reminder /
-- TICKET_AUTO_COMPLETE_REMINDER. The automatic-completion deadline columns become auto_complete_* (data kept, with their indexes
-- and ARCH-005 local/epoch sync triggers), and the closure record end fields become ended_by / ended_at. Development stage: no value
-- mapping. Any legacy value fails the migration; clean the affected
-- development / test database (ADR-0056 U7) and rebuild it from fixtures instead.
-- Each probe runs through EXECUTE only after its tables exist, so partial fixture chains are never planned against a missing table.
DO $$
DECLARE
  legacy text := '';
  probe record;
  found boolean;
BEGIN
  FOR probe IN SELECT * FROM (VALUES
    (ARRAY['pilot_ticket.ticket_event'], ' ticket_event',
     $q$SELECT EXISTS (SELECT 1 FROM pilot_ticket.ticket_event WHERE event_type='ticket.auto_close_reminder')$q$),
    (ARRAY['communication.ticket_notification_binding'], ' ticket_notification_binding',
     $q$SELECT EXISTS (SELECT 1 FROM communication.ticket_notification_binding WHERE notification_type='TICKET_CANCELLED')$q$),
    (ARRAY['communication.ticket_notification_binding','pilot_ticket.closure_record'], ' restoration_binding',
     $q$SELECT EXISTS (SELECT 1 FROM communication.ticket_notification_binding b
        WHERE b.notification_type='TICKET_REOPENED' AND b.template_version='service-closure/1'
          AND EXISTS (SELECT 1 FROM pilot_ticket.closure_record r WHERE r.restoration_event_id=b.ticket_event_id))$q$),
    (ARRAY['notification.outbox'], ' notification_outbox',
     $q$SELECT EXISTS (SELECT 1 FROM notification.outbox WHERE event_type='ticket.auto_close_reminder' OR template_code='TICKET_AUTO_CLOSE_REMINDER')$q$)
  ) AS checks(relations, label, query)
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM unnest(probe.relations) AS relation WHERE to_regclass(relation) IS NULL);
    EXECUTE probe.query INTO found;
    IF found THEN legacy := legacy||probe.label; END IF;
  END LOOP;
  IF legacy <> '' THEN RAISE EXCEPTION 'NOTIFICATION_VOCABULARY_LEGACY_DATA_PRESENT:%', legacy USING HINT = 'Clean this development/test database (ADR-0056 U7) and rebuild it from fixtures; 073 never rewrites data.'; END IF;
END $$;

-- Original definitions for rollback. The body is re-runnable: test fixtures that add older migrations afterwards run it again;
-- objects already in the new vocabulary are skipped and the first recorded original definition is kept.
CREATE SCHEMA IF NOT EXISTS pilot_ticket;
-- object_kind: 'constraint' (definition = original CHECK), 'column' / 'index' (object_name = new name, definition = original
-- name), 'trigger' (object_name = new trigger, definition = original CREATE TRIGGER statement).
CREATE TABLE IF NOT EXISTS pilot_ticket.notification_vocabulary_baseline(
  object_kind TEXT NOT NULL CHECK (object_kind IN ('constraint','column','index','trigger')),
  object_name TEXT NOT NULL,
  relation TEXT NOT NULL,
  definition TEXT NOT NULL,
  PRIMARY KEY (object_kind, object_name)
);

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
      (c.conrelid = to_regclass('pilot_ticket.ticket_event') AND c.conname = 'ticket_event_type_check')
      OR (c.conrelid = to_regclass('communication.ticket_notification_binding') AND pg_get_constraintdef(c.oid, true) LIKE '%''TICKET_REOPENED''%'))
  LOOP
    old_def := target.def;
    new_def := replace(old_def, '''ticket.auto_close_reminder''::text', '''ticket.auto_complete_reminder''::text');
    new_def := replace(new_def, '''TICKET_CANCELLED''::text', '''TICKET_DISMISSED''::text');
    IF new_def LIKE '%''TICKET_REOPENED''::text%' AND new_def NOT LIKE '%''TICKET_RESTORED''::text%' THEN
      new_def := replace(new_def, '''TICKET_REOPENED''::text', '''TICKET_REOPENED''::text, ''TICKET_RESTORED''::text');
    END IF;
    IF new_def ~ '''(ticket\.auto_close_reminder|TICKET_CANCELLED|TICKET_AUTO_CLOSE_REMINDER)''' THEN
      RAISE EXCEPTION 'NOTIFICATION_VOCABULARY_REWRITE_INCOMPLETE:%.%', target.relation, target.conname;
    END IF;
    CONTINUE WHEN new_def = old_def;
    INSERT INTO pilot_ticket.notification_vocabulary_baseline(object_kind, object_name, relation, definition)
      VALUES ('constraint', target.conname, target.relation, old_def) ON CONFLICT DO NOTHING;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', target.relation, target.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', target.relation, target.conname, new_def);
  END LOOP;
END $$;

-- Automatic-completion deadline columns. A historical migration re-run by a fixture after this body may add an empty old column
-- again; it is dropped only while it holds no value, otherwise the body fails instead of choosing between two values.
DO $$
DECLARE
  pair record;
  has_old boolean;
  has_new boolean;
  filled boolean;
  old_trigger text;
  new_trigger text;
  old_def text;
  old_name text;
  new_name text;
BEGIN
  IF to_regclass('pilot_ticket.ticket') IS NULL THEN RETURN; END IF;
  FOR pair IN SELECT * FROM (VALUES
    ('auto_close_at','auto_complete_at','auto_close_epoch_ms','auto_complete_epoch_ms'),
    ('auto_close_reminder_at','auto_complete_reminder_at','auto_close_reminder_epoch_ms','auto_complete_reminder_epoch_ms')
  ) AS pairs(old_local, new_local, old_epoch, new_epoch)
  LOOP
    old_trigger := 'arch005_sync_'||substr(md5('pilot_ticket.ticket.'||pair.old_epoch),1,16);
    new_trigger := 'arch005_sync_'||substr(md5('pilot_ticket.ticket.'||pair.new_epoch),1,16);
    SELECT pg_get_triggerdef(oid) INTO old_def FROM pg_trigger WHERE tgrelid='pilot_ticket.ticket'::regclass AND tgname=old_trigger AND NOT tgisinternal;
    IF old_def IS NOT NULL THEN
      INSERT INTO pilot_ticket.notification_vocabulary_baseline(object_kind, object_name, relation, definition)
        VALUES ('trigger', new_trigger, 'pilot_ticket.ticket', old_def) ON CONFLICT DO NOTHING;
      EXECUTE format('DROP TRIGGER %I ON pilot_ticket.ticket', old_trigger);
    END IF;
    FOR old_name, new_name IN SELECT * FROM (VALUES (pair.old_local, pair.new_local), (pair.old_epoch, pair.new_epoch)) AS names(o, n) LOOP
      SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='pilot_ticket' AND table_name='ticket' AND column_name=old_name) INTO has_old;
      SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='pilot_ticket' AND table_name='ticket' AND column_name=new_name) INTO has_new;
      IF has_old AND has_new THEN
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM pilot_ticket.ticket WHERE %I IS NOT NULL)', old_name) INTO filled;
        IF filled THEN RAISE EXCEPTION 'NOTIFICATION_VOCABULARY_DEADLINE_COLUMN_CONFLICT:%', old_name; END IF;
        EXECUTE format('ALTER TABLE pilot_ticket.ticket DROP COLUMN %I', old_name);
      ELSIF has_old THEN
        INSERT INTO pilot_ticket.notification_vocabulary_baseline(object_kind, object_name, relation, definition)
          VALUES ('column', new_name, 'pilot_ticket.ticket', old_name) ON CONFLICT DO NOTHING;
        EXECUTE format('ALTER TABLE pilot_ticket.ticket RENAME COLUMN %I TO %I', old_name, new_name);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='pilot_ticket' AND table_name='ticket' AND column_name=pair.new_epoch)
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='pilot_ticket' AND table_name='ticket' AND column_name=pair.new_local)
       AND old_def IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON pilot_ticket.ticket', new_trigger);
      EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I, %I ON pilot_ticket.ticket FOR EACH ROW EXECUTE FUNCTION platform.sync_local_epoch_pair(%L, %L)',
        new_trigger, pair.new_local, pair.new_epoch, pair.new_local, pair.new_epoch);
    END IF;
  END LOOP;
  FOR old_name, new_name IN SELECT * FROM (VALUES ('ticket_auto_close_idx','ticket_auto_complete_idx'),('pilot_ticket_auto_close_epoch_idx','pilot_ticket_auto_complete_epoch_idx')) AS idx(o, n) LOOP
    IF to_regclass('pilot_ticket.'||old_name) IS NOT NULL AND to_regclass('pilot_ticket.'||new_name) IS NOT NULL THEN
      EXECUTE format('DROP INDEX pilot_ticket.%I', old_name);
    ELSIF to_regclass('pilot_ticket.'||old_name) IS NOT NULL THEN
      INSERT INTO pilot_ticket.notification_vocabulary_baseline(object_kind, object_name, relation, definition)
        VALUES ('index', new_name, 'pilot_ticket.ticket', old_name) ON CONFLICT DO NOTHING;
      EXECUTE format('ALTER INDEX pilot_ticket.%I RENAME TO %I', old_name, new_name);
    END IF;
  END LOOP;
END $$;

-- Closure record end fields: the record covers both ways an item ends, so closed_by / closed_at become ended_by / ended_at.
-- Constraint and index expressions follow the rename; rollback renames back.
DO $$
DECLARE
  old_name text;
  new_name text;
  has_old boolean;
  has_new boolean;
BEGIN
  IF to_regclass('pilot_ticket.closure_record') IS NULL THEN RETURN; END IF;
  FOR old_name, new_name IN SELECT * FROM (VALUES ('closed_by','ended_by'),('closed_at','ended_at')) AS names(o, n) LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='pilot_ticket' AND table_name='closure_record' AND column_name=old_name) INTO has_old;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='pilot_ticket' AND table_name='closure_record' AND column_name=new_name) INTO has_new;
    IF has_old AND has_new THEN RAISE EXCEPTION 'NOTIFICATION_VOCABULARY_CLOSURE_COLUMN_CONFLICT:%', old_name; END IF;
    CONTINUE WHEN NOT has_old;
    INSERT INTO pilot_ticket.notification_vocabulary_baseline(object_kind, object_name, relation, definition)
      VALUES ('column', new_name, 'pilot_ticket.closure_record', old_name) ON CONFLICT DO NOTHING;
    EXECUTE format('ALTER TABLE pilot_ticket.closure_record RENAME COLUMN %I TO %I', old_name, new_name);
  END LOOP;
END $$;

COMMIT;
