BEGIN;

-- Card 42A-2: store terminal_at / terminal_epoch_ms directly on pilot_ticket.ticket so handled-column
-- filtering and keyset pagination use partial indexes instead of scanning ticket_event or closure_record.
-- Re-runnable: test chains that apply older migrations afterwards can run this body again safely.
DO $$
DECLARE
  has_closure boolean := false;
  has_closure_ended_at boolean := false;
  has_local_from_epoch boolean := false;
  missing_count bigint := 0;
  missing_sample text;
  missing_evidence boolean;
  dismissal_time text := 'NULL::timestamp';
  sync_trigger text := 'arch005_sync_' || substr(md5('pilot_ticket.ticket.terminal_epoch_ms'), 1, 16);
BEGIN
  IF to_regclass('pilot_ticket.ticket') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE pilot_ticket.ticket ADD COLUMN IF NOT EXISTS terminal_at TIMESTAMP WITHOUT TIME ZONE;
  ALTER TABLE pilot_ticket.ticket ADD COLUMN IF NOT EXISTS terminal_epoch_ms BIGINT;

  -- Ticket Core omits both fields for QUEUED. Reject inherited defaults before any backfill or ledger insert.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='pilot_ticket' AND table_name='ticket'
      AND column_name IN ('terminal_at','terminal_epoch_ms') AND column_default IS NOT NULL) THEN
    RAISE EXCEPTION 'TICKET_TERMINAL_AT_SCHEMA_DRIFT';
  END IF;

  UPDATE pilot_ticket.ticket
     SET terminal_at = NULL,
         terminal_epoch_ms = NULL
   WHERE status NOT IN ('RESOLVED', 'COMPLETED', 'DISMISSED')
     AND (terminal_at IS NOT NULL OR terminal_epoch_ms IS NOT NULL);

  has_closure := to_regclass('pilot_ticket.closure_record') IS NOT NULL;
  IF has_closure THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'pilot_ticket'
         AND table_name = 'closure_record'
         AND column_name = 'ended_at'
    ) INTO has_closure_ended_at;
  END IF;

  -- Validate supplied values as well as absent ones before registering the migration.
  -- Some isolated partial chains have no closure table yet.
  IF has_closure AND has_closure_ended_at THEN
    dismissal_time := '(SELECT c.ended_at FROM pilot_ticket.closure_record c WHERE c.ticket_id=t.id AND c.closure_ticket_event_id=e.event_id AND c.restored_at IS NULL)';
  END IF;
  EXECUTE format($backfill$
    WITH evidence AS MATERIALIZED (
      SELECT t.id,t.status,t.terminal_at,t.terminal_epoch_ms,date_trunc('second',
        CASE WHEN e.new_status=t.status THEN CASE
          WHEN t.status='DISMISSED' AND e.event_type='ticket.dismissed' THEN %s
          WHEN t.status='RESOLVED' AND e.event_type='ticket.resolved' THEN e.created_at
          WHEN t.status='COMPLETED' AND e.event_type='ticket.completed' THEN e.created_at
        END END) AS chosen_at
      FROM pilot_ticket.ticket t LEFT JOIN LATERAL (
        SELECT event_id,new_status,event_type,created_at FROM pilot_ticket.ticket_event
        WHERE ticket_id=t.id AND old_status IS DISTINCT FROM new_status
        ORDER BY aggregate_version DESC,event_ordinal DESC LIMIT 1
      ) e ON TRUE
      WHERE t.status IN ('RESOLVED','COMPLETED','DISMISSED')
    ), expected AS (
      SELECT *,floor(extract(epoch FROM (chosen_at AT TIME ZONE 'Asia/Shanghai'))*1000)::bigint AS chosen_epoch FROM evidence
    ), invalid AS (
      SELECT *,row_number() OVER (ORDER BY id) AS rn FROM expected
      WHERE chosen_at IS NULL OR terminal_at IS NOT NULL AND terminal_at<>chosen_at
        OR terminal_epoch_ms IS NOT NULL AND terminal_epoch_ms<>chosen_epoch
    ), filled AS (
      UPDATE pilot_ticket.ticket t SET terminal_at=e.chosen_at,terminal_epoch_ms=e.chosen_epoch
        FROM expected e WHERE t.id=e.id AND (e.terminal_at IS NULL OR e.terminal_epoch_ms IS NULL)
          AND NOT EXISTS (SELECT 1 FROM invalid)
    )
    SELECT count(*),bool_or(chosen_at IS NULL),string_agg(id::text||':'||status,', ' ORDER BY id) FILTER (WHERE rn<=20)
      FROM invalid
  $backfill$,dismissal_time) INTO missing_count,missing_evidence,missing_sample;
  IF missing_count > 0 THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE=CASE WHEN missing_evidence THEN 'TICKET_TERMINAL_AT_BACKFILL_EVIDENCE_MISSING' ELSE 'TICKET_TERMINAL_AT_BACKFILL_EVIDENCE_MISMATCH' END,
      DETAIL=format('count=%s sample=%s',missing_count,missing_sample);
  END IF;

  -- The rewritten board selects dismissed Intakes through their active closure record. A DISMISSED Intake
  -- without one already failed the pre-075 closure projection; refuse it here rather than hide it.
  IF has_closure AND has_closure_ended_at AND to_regclass('intake.service_intake') IS NOT NULL THEN
    SELECT count(*), string_agg(id::text, ', ' ORDER BY id) FILTER (WHERE rn <= 20)
      INTO missing_count, missing_sample
      FROM (SELECT i.id, row_number() OVER (ORDER BY i.id) AS rn
              FROM intake.service_intake i
             WHERE i.status = 'DISMISSED'
               AND NOT EXISTS (SELECT 1 FROM pilot_ticket.closure_record c WHERE c.intake_id = i.id AND c.restored_at IS NULL)) missing;
    IF missing_count > 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'INTAKE_DISMISSAL_CLOSURE_MISSING',
        DETAIL = format('count=%s sample=%s', missing_count, missing_sample),
        HINT = 'Each DISMISSED Intake needs its active closure record before 075.';
    END IF;
  END IF;

  ALTER TABLE pilot_ticket.ticket DROP CONSTRAINT IF EXISTS ticket_terminal_at_second_check;
  ALTER TABLE pilot_ticket.ticket ADD CONSTRAINT ticket_terminal_at_second_check
    CHECK (terminal_at IS NULL OR terminal_at = date_trunc('second', terminal_at));

  ALTER TABLE pilot_ticket.ticket DROP CONSTRAINT IF EXISTS ticket_terminal_status_check;
  ALTER TABLE pilot_ticket.ticket ADD CONSTRAINT ticket_terminal_status_check
    CHECK ((status IN ('RESOLVED', 'COMPLETED', 'DISMISSED')) = (terminal_at IS NOT NULL));

  has_local_from_epoch := to_regprocedure('platform.local_from_epoch_ms(bigint)') IS NOT NULL;
  ALTER TABLE pilot_ticket.ticket DROP CONSTRAINT IF EXISTS ticket_terminal_epoch_check;
  IF has_local_from_epoch THEN
    ALTER TABLE pilot_ticket.ticket ADD CONSTRAINT ticket_terminal_epoch_check
      CHECK (
        (terminal_at IS NULL AND terminal_epoch_ms IS NULL)
        OR (terminal_at IS NOT NULL AND terminal_epoch_ms IS NOT NULL
            AND terminal_epoch_ms >= 0
            AND terminal_at = platform.local_from_epoch_ms(terminal_epoch_ms))
      );
    IF to_regprocedure('platform.sync_local_epoch_pair()') IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON pilot_ticket.ticket', sync_trigger);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF terminal_at, terminal_epoch_ms ON pilot_ticket.ticket FOR EACH ROW EXECUTE FUNCTION platform.sync_local_epoch_pair(%L, %L)',
        sync_trigger, 'terminal_at', 'terminal_epoch_ms'
      );
    END IF;
  ELSE
    ALTER TABLE pilot_ticket.ticket ADD CONSTRAINT ticket_terminal_epoch_check
      CHECK (
        (terminal_at IS NULL AND terminal_epoch_ms IS NULL)
        OR (terminal_at IS NOT NULL AND terminal_epoch_ms IS NOT NULL AND terminal_epoch_ms >= 0)
      );
  END IF;

  CREATE INDEX IF NOT EXISTS ticket_terminal_idx
    ON pilot_ticket.ticket (terminal_at DESC, id DESC)
    WHERE status IN ('COMPLETED', 'DISMISSED');
  CREATE INDEX IF NOT EXISTS ticket_resolved_terminal_idx
    ON pilot_ticket.ticket (terminal_at DESC, id DESC)
    WHERE status = 'RESOLVED';
  CREATE INDEX IF NOT EXISTS ticket_open_updated_idx
    ON pilot_ticket.ticket (updated_at DESC, id DESC)
    WHERE status NOT IN ('RESOLVED', 'COMPLETED', 'DISMISSED');
END $$;

COMMIT;
