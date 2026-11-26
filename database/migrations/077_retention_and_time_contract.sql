BEGIN;

-- Card 42C-2: Keyset scan indexes for retention_until_epoch_ms across all remaining tables.
-- Note: all 9 target columns below are BIGINT NOT NULL, so non-partial indexes match the
-- WHERE retention_until_epoch_ms <= $1 ORDER BY retention_until_epoch_ms ASC, <cursor> ASC plan.
-- (channel.message_inbox and conversation.item already received their epoch indexes in 022.)

CREATE INDEX service_intake_retention_epoch_idx
    ON intake.service_intake (retention_until_epoch_ms, id);

CREATE INDEX communication_message_retention_epoch_idx
    ON communication.message (retention_until_epoch_ms, id);

CREATE INDEX contact_journey_retention_epoch_idx
    ON intake.contact_journey (retention_until_epoch_ms, id);

CREATE INDEX incident_retention_epoch_idx
    ON incident.incident (retention_until_epoch_ms, id);

CREATE INDEX web_submission_retention_epoch_idx
    ON intake.web_submission (retention_until_epoch_ms, id);

CREATE INDEX web_request_binding_retention_epoch_idx
    ON intake.web_request_binding (retention_until_epoch_ms, intake_id);

CREATE INDEX web_report_urge_retention_epoch_idx
    ON intake.web_report_urge (retention_until_epoch_ms, id);

CREATE INDEX web_report_evaluation_retention_epoch_idx
    ON intake.web_report_evaluation (retention_until_epoch_ms, id);

CREATE INDEX operations_backup_retention_epoch_id_idx
    ON operations.backup_checkpoint (retention_until_epoch_ms, id);

-- Rollback restores the exact 012 index and 022 function. Check both before
-- changing either, including when the SQL body is applied directly.
LOCK TABLE conversation.realtime_event IN ACCESS EXCLUSIVE MODE;
DO $card42c_predecessors$
BEGIN
    IF NOT EXISTS (
        SELECT FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE i.indexrelid = to_regclass('conversation.conversation_realtime_event_expiry_event_idx')
          AND i.indrelid = 'conversation.realtime_event'::regclass
          AND c.relkind = 'i' AND c.relpersistence = 'p'
          AND c.reloptions IS NULL AND c.reltablespace = 0 AND obj_description(c.oid, 'pg_class') IS NULL
          AND i.indisvalid AND i.indisready AND i.indislive AND i.indimmediate
          AND NOT i.indisclustered AND NOT i.indisreplident
          AND pg_get_indexdef(c.oid) = 'CREATE INDEX conversation_realtime_event_expiry_event_idx ON conversation.realtime_event USING btree (expires_at, event_id)'
    ) THEN
        RAISE EXCEPTION 'RETENTION_TIME_CONTRACT_PREDECESSOR_DRIFT:conversation.conversation_realtime_event_expiry_event_idx';
    END IF;
    IF NOT EXISTS (
        SELECT FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = to_regprocedure('platform.local_now()') AND p.prokind = 'f'
          AND l.lanname = 'sql' AND p.provolatile = 's' AND p.proparallel = 'u'
          AND NOT p.prosecdef AND NOT p.proleakproof AND NOT p.proisstrict AND NOT p.proretset
          AND p.procost = 100 AND p.prosupport = 0 AND p.prosqlbody IS NULL
          AND p.prorettype = 'timestamp without time zone'::regtype
          AND p.proconfig = ARRAY['search_path=pg_catalog, platform']
          AND btrim(regexp_replace(p.prosrc, '[[:space:]]+', ' ', 'g')) =
              $$SELECT date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai')::timestamp without time zone$$
          AND obj_description(p.oid, 'pg_proc') = 'Transaction-consistent Asia/Shanghai LocalDateTime at second precision.'
    ) THEN
        RAISE EXCEPTION 'RETENTION_TIME_CONTRACT_PREDECESSOR_DRIFT:platform.local_now';
    END IF;
END
$card42c_predecessors$;

-- Card 42C-3: Recreate platform.local_now() without SET search_path so PostgreSQL can inline it.
-- Safety: SECURITY INVOKER with every function/type reference explicitly pg_catalog-qualified.
-- platform.physical_epoch_ms() stays VOLATILE and unchanged.
CREATE OR REPLACE FUNCTION platform.local_now()
RETURNS timestamp without time zone
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $card42c_local_now$
    SELECT pg_catalog.date_trunc('second', pg_catalog.timezone('Asia/Shanghai', pg_catalog.transaction_timestamp()))::timestamp without time zone
$card42c_local_now$;

COMMENT ON FUNCTION platform.local_now() IS
    'Transaction-consistent Asia/Shanghai LocalDateTime at second precision (inlinable, no SET search_path).';

-- Card 42C-4: Drop redundant pre-ARCH-005 expires_at index on conversation.realtime_event.
-- Retention cleanup and append expiry tightening both operate on expires_epoch_ms / event_id,
-- keeping conversation_realtime_expiry_epoch_idx (expires_epoch_ms, event_id) from 022.
DROP INDEX IF EXISTS conversation.conversation_realtime_event_expiry_event_idx;

DO $card42c_local_now_contract$
DECLARE
    local_now_ok boolean := false;
    physical_epoch_ok boolean := false;
BEGIN
    SELECT (
        l.lanname = 'sql'
        AND p.provolatile = 's'
        AND NOT p.prosecdef
        AND NOT p.proisstrict
        AND NOT p.proretset
        AND p.proconfig IS NULL
        AND p.prorettype = 'timestamp without time zone'::regtype
        AND btrim(regexp_replace(p.prosrc, '[[:space:]]+', ' ', 'g')) =
            $$SELECT pg_catalog.date_trunc('second', pg_catalog.timezone('Asia/Shanghai', pg_catalog.transaction_timestamp()))::timestamp without time zone$$
    )
    INTO local_now_ok
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    JOIN pg_language AS l ON l.oid = p.prolang
    WHERE n.nspname = 'platform'
      AND p.proname = 'local_now'
      AND p.pronargs = 0;

    IF local_now_ok IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'CARD42C_LOCAL_NOW_CONTRACT_INVALID';
    END IF;

    SELECT (
        p.provolatile = 'v'
        AND NOT p.proretset
        AND p.prorettype = 'bigint'::regtype
    )
    INTO physical_epoch_ok
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform'
      AND p.proname = 'physical_epoch_ms'
      AND p.pronargs = 0;

    IF physical_epoch_ok IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'CARD42C_PHYSICAL_EPOCH_CONTRACT_INVALID';
    END IF;
END
$card42c_local_now_contract$;

DO $card42c_realtime_expiry_index_contract$
DECLARE
    event_relation oid := to_regclass('conversation.realtime_event');
    dropped_index oid := to_regclass('conversation.conversation_realtime_event_expiry_event_idx');
    kept_index oid := to_regclass('conversation.conversation_realtime_expiry_epoch_idx');
    kept_valid boolean := false;
BEGIN
    IF event_relation IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'CARD42C_REALTIME_EVENT_RELATION_MISSING';
    END IF;

    IF dropped_index IS NOT NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'CARD42C_REALTIME_EXPIRY_LEGACY_INDEX_STILL_EXISTS';
    END IF;

    SELECT (
        idx.indrelid = event_relation
        AND cls.relkind = 'i'
        AND cls.relpersistence = 'p'
        AND am.amname = 'btree'
        AND idx.indisvalid
        AND idx.indisready
        AND idx.indislive
        AND idx.indimmediate
        AND NOT idx.indisunique
        AND idx.indpred IS NULL
        AND idx.indexprs IS NULL
        AND idx.indnatts = idx.indnkeyatts
        AND idx.indnkeyatts = 2
        AND ARRAY(
            SELECT a.attname::text
            FROM unnest(idx.indkey::smallint[]) WITH ORDINALITY AS k(attnum, pos)
            JOIN pg_attribute AS a
              ON a.attrelid = event_relation
             AND a.attnum = k.attnum
            ORDER BY k.pos
        ) = ARRAY['expires_epoch_ms', 'event_id']::text[]
    )
    INTO kept_valid
    FROM pg_index AS idx
    JOIN pg_class AS cls ON cls.oid = idx.indexrelid
    JOIN pg_am AS am ON am.oid = cls.relam
    WHERE idx.indexrelid = kept_index;

    IF kept_valid IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'CARD42C_REALTIME_EXPIRY_EPOCH_INDEX_INVALID';
    END IF;
END
$card42c_realtime_expiry_index_contract$;

SELECT platform.assert_time_contract();

COMMIT;
