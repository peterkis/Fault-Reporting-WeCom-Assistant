BEGIN;

-- ADR-0056 supplement (system restoration): a Web Intake that the system itself closed as outside IT scope
-- (source SYSTEM, NOT_IT_SCOPE / OUT_OF_SCOPE_CONFIRMED) is restored by the system when the reporter submits a later supplement.
-- Such a restoration has no staff actor, so restored_by is empty and restore_source reads SYSTEM. Every other restoration keeps a
-- staff actor (restore_source MANUAL). restore_source is derived from the stored actor, so existing rows need no backfill and
-- the manual write path is unchanged. The registered migrator requires 071; on a partial test chain without the closure record
-- table the body does nothing. When the table exists it must already carry the 073 ended_at name. The body is re-runnable.
DO $$
BEGIN
  IF to_regclass('pilot_ticket.closure_record') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='pilot_ticket' AND table_name='closure_record' AND column_name='ended_at') THEN
    RAISE EXCEPTION 'SYSTEM_CLOSURE_RESTORE_REQUIRES_073';
  END IF;
  ALTER TABLE pilot_ticket.closure_record ADD COLUMN IF NOT EXISTS restore_source TEXT
    GENERATED ALWAYS AS (CASE WHEN restored_at IS NULL THEN NULL WHEN restored_by IS NULL THEN 'SYSTEM' ELSE 'MANUAL' END) STORED;
  ALTER TABLE pilot_ticket.closure_record DROP CONSTRAINT IF EXISTS closure_restore_actor;
  ALTER TABLE pilot_ticket.closure_record ADD CONSTRAINT closure_restore_actor CHECK(
    (restored_at IS NULL AND restored_by IS NULL AND restoration_event_id IS NULL)
    OR (restored_at IS NOT NULL AND restoration_event_id IS NOT NULL AND restored_at>=ended_at
        AND (restored_by IS NOT NULL
          OR (source='SYSTEM' AND subject_type='INTAKE' AND reason_code='NOT_IT_SCOPE'
              AND secondary_reason_code='OUT_OF_SCOPE_CONFIRMED'))));
END $$;

COMMIT;
