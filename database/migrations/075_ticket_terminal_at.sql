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
  sync_trigger text := 'arch005_sync_' || substr(md5('pilot_ticket.ticket.terminal_epoch_ms'), 1, 16);
BEGIN
  IF to_regclass('pilot_ticket.ticket') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE pilot_ticket.ticket ADD COLUMN IF NOT EXISTS terminal_at TIMESTAMP WITHOUT TIME ZONE;
  ALTER TABLE pilot_ticket.ticket ADD COLUMN IF NOT EXISTS terminal_epoch_ms BIGINT;

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

  -- Backfill only from the evidence the pre-075 board already displayed; never invent a time.
  -- DISMISSED: the active closure record's ended_at (the old completed_at / closure ended_at).
  IF has_closure AND has_closure_ended_at THEN
    UPDATE pilot_ticket.ticket t
       SET terminal_at = date_trunc('second', c.ended_at),
           terminal_epoch_ms = floor(extract(epoch FROM (date_trunc('second', c.ended_at) AT TIME ZONE 'Asia/Shanghai')) * 1000)::bigint
      FROM pilot_ticket.closure_record c
     WHERE c.ticket_id = t.id
       AND c.restored_at IS NULL
       AND t.status = 'DISMISSED'
       AND (t.terminal_at IS NULL OR t.terminal_epoch_ms IS NULL);
  END IF;

  -- RESOLVED / COMPLETED: the latest status-changing ticket.resolved / ticket.completed event (the old ended LATERAL).
  UPDATE pilot_ticket.ticket t
     SET terminal_at = v.chosen_at,
         terminal_epoch_ms = floor(extract(epoch FROM (v.chosen_at AT TIME ZONE 'Asia/Shanghai')) * 1000)::bigint
    FROM (
      SELECT t2.id,
             date_trunc('second', (SELECT e.created_at
                  FROM pilot_ticket.ticket_event e
                 WHERE e.ticket_id = t2.id
                   AND e.new_status = t2.status
                   AND e.old_status IS DISTINCT FROM e.new_status
                   AND e.event_type IN ('ticket.resolved', 'ticket.completed')
                 ORDER BY e.aggregate_version DESC, e.event_ordinal DESC
                 LIMIT 1)) AS chosen_at
        FROM pilot_ticket.ticket t2
       WHERE t2.status IN ('RESOLVED', 'COMPLETED')
         AND (t2.terminal_at IS NULL OR t2.terminal_epoch_ms IS NULL)
    ) v
   WHERE t.id = v.id AND v.chosen_at IS NOT NULL;

  -- Rows without evidence are surfaced for explicit repair instead of receiving a guessed time.
  SELECT count(*), string_agg(id::text || ':' || status, ', ' ORDER BY id) FILTER (WHERE rn <= 20)
    INTO missing_count, missing_sample
    FROM (SELECT t.id, t.status, row_number() OVER (ORDER BY t.id) AS rn
            FROM pilot_ticket.ticket t
           WHERE t.status IN ('RESOLVED', 'COMPLETED', 'DISMISSED') AND t.terminal_at IS NULL) missing;
  IF missing_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'TICKET_TERMINAL_AT_BACKFILL_EVIDENCE_MISSING',
      DETAIL = format('count=%s sample=%s', missing_count, missing_sample),
      HINT = 'Repair the terminal event or active closure record of these tickets, then re-run 075.';
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
