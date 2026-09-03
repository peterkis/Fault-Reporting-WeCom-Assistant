CREATE SCHEMA IF NOT EXISTS platform;

CREATE OR REPLACE FUNCTION platform.local_now()
RETURNS timestamp without time zone
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, platform
AS $arch005_local_now$
    SELECT date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai')::timestamp without time zone
$arch005_local_now$;

CREATE OR REPLACE FUNCTION platform.physical_epoch_ms()
RETURNS bigint
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, platform
AS $arch005_physical_epoch_ms$
    SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
$arch005_physical_epoch_ms$;

CREATE OR REPLACE FUNCTION platform.local_from_epoch_ms(p_epoch_ms bigint)
RETURNS timestamp without time zone
LANGUAGE plpgsql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = pg_catalog, platform
AS $arch005_local_from_epoch_ms$
BEGIN
    IF p_epoch_ms < 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'ARCH_005_EPOCH_MS_INVALID';
    END IF;
    RETURN date_trunc(
        'second',
        to_timestamp(p_epoch_ms::double precision / 1000.0) AT TIME ZONE 'Asia/Shanghai'
    )::timestamp without time zone;
EXCEPTION
    WHEN datetime_field_overflow THEN
        RAISE EXCEPTION USING
            ERRCODE = '22008',
            MESSAGE = 'ARCH_005_EPOCH_MS_OUT_OF_RANGE';
END
$arch005_local_from_epoch_ms$;

CREATE TABLE IF NOT EXISTS platform.time_contract (
    contract_version text PRIMARY KEY,
    business_timezone text NOT NULL,
    local_date_pattern text NOT NULL,
    local_time_pattern text NOT NULL,
    local_datetime_pattern text NOT NULL,
    epoch_ms_pattern text NOT NULL,
    precision text NOT NULL,
    activated_at timestamp without time zone NOT NULL,
    activated_epoch_ms bigint NOT NULL,
    owned_schemas text[] NOT NULL,
    CONSTRAINT platform_time_contract_version_check CHECK (contract_version = 'ARCH-005/v1'),
    CONSTRAINT platform_time_contract_timezone_check CHECK (business_timezone = 'Asia/Shanghai'),
    CONSTRAINT platform_time_contract_precision_check CHECK (precision = 'second'),
    CONSTRAINT platform_time_contract_epoch_check CHECK (activated_epoch_ms >= 0),
    CONSTRAINT platform_time_contract_activation_check CHECK (
        activated_at = platform.local_from_epoch_ms(activated_epoch_ms)
    ),
    CONSTRAINT platform_time_contract_owned_schemas_check CHECK (
        owned_schemas = ARRAY[
            'channel', 'intake', 'pilot_ticket', 'notification', 'operations',
            'conversation', 'communication', 'platform', 'integration'
        ]::text[]
    )
);

CREATE TABLE IF NOT EXISTS platform.schema_migration (
    migration_id text PRIMARY KEY,
    checksum_sha256 text NOT NULL,
    applied_at timestamp without time zone NOT NULL DEFAULT platform.local_now(),
    applied_epoch_ms bigint NOT NULL DEFAULT platform.physical_epoch_ms(),
    CONSTRAINT platform_schema_migration_id_check CHECK (
        migration_id ~ '^[0-9]{3}_[a-z0-9_]{1,120}$'
    ),
    CONSTRAINT platform_schema_migration_checksum_check CHECK (
        checksum_sha256 ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT platform_schema_migration_epoch_check CHECK (applied_epoch_ms >= 0),
    CONSTRAINT platform_schema_migration_time_check CHECK (
        applied_at = platform.local_from_epoch_ms(applied_epoch_ms)
    )
);

WITH activation AS (
    SELECT platform.physical_epoch_ms() AS epoch_ms
)
INSERT INTO platform.time_contract (
    contract_version,
    business_timezone,
    local_date_pattern,
    local_time_pattern,
    local_datetime_pattern,
    epoch_ms_pattern,
    precision,
    activated_at,
    activated_epoch_ms,
    owned_schemas
)
SELECT
    'ARCH-005/v1',
    'Asia/Shanghai',
    'YYYY-MM-DD',
    'HH:mm',
    'YYYY-MM-DD HH:mm:ss',
    '^(0|[1-9][0-9]*)$',
    'second',
    platform.local_from_epoch_ms(epoch_ms),
    epoch_ms,
    ARRAY[
        'channel', 'intake', 'pilot_ticket', 'notification', 'operations',
        'conversation', 'communication', 'platform', 'integration'
    ]::text[]
FROM activation
ON CONFLICT (contract_version) DO NOTHING;

CREATE OR REPLACE FUNCTION platform.forbidden_owned_schema_time_types()
RETURNS TABLE (
    schema_name text,
    table_name text,
    column_name text,
    data_type text,
    udt_name text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, platform, information_schema
AS $arch005_forbidden_types$
    SELECT
        columns.table_schema::text,
        columns.table_name::text,
        columns.column_name::text,
        columns.data_type::text,
        columns.udt_name::text
      FROM information_schema.columns
     WHERE columns.table_schema = ANY (
               ARRAY[
                   'channel', 'intake', 'pilot_ticket', 'notification', 'operations',
                   'conversation', 'communication', 'platform', 'integration'
               ]::text[]
           )
       AND (
           columns.data_type IN ('timestamp with time zone', 'time with time zone')
           OR columns.udt_name IN ('timestamptz', 'timetz', 'tstzrange', 'tstzmultirange')
       )
     ORDER BY columns.table_schema, columns.table_name, columns.ordinal_position
$arch005_forbidden_types$;

CREATE OR REPLACE FUNCTION platform.assert_time_contract()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, platform
AS $arch005_assert_time_contract$
DECLARE
    forbidden_count integer;
    contract_count integer;
BEGIN
    SELECT count(*) INTO contract_count
      FROM platform.time_contract
     WHERE contract_version = 'ARCH-005/v1'
       AND business_timezone = 'Asia/Shanghai'
       AND precision = 'second';
    IF contract_count <> 1 THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'ARCH_005_TIME_CONTRACT_MISSING';
    END IF;

    SELECT count(*) INTO forbidden_count
      FROM platform.forbidden_owned_schema_time_types();
    IF forbidden_count <> 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'ARCH_005_FORBIDDEN_TIME_TYPE_COUNT_NONZERO',
            DETAIL = format('count=%s', forbidden_count);
    END IF;
END
$arch005_assert_time_contract$;

CREATE OR REPLACE FUNCTION platform.sync_local_epoch_pair()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, platform
AS $arch005_sync_local_epoch_pair$
DECLARE
    local_column text := TG_ARGV[0];
    epoch_column text := TG_ARGV[1];
    local_text text;
    epoch_text text;
    old_local_text text;
    old_epoch_text text;
    derived_epoch bigint;
    derived_local timestamp without time zone;
BEGIN
    local_text := to_jsonb(NEW) ->> local_column;
    epoch_text := to_jsonb(NEW) ->> epoch_column;
    IF TG_OP = 'UPDATE' THEN
        old_local_text := to_jsonb(OLD) ->> local_column;
        old_epoch_text := to_jsonb(OLD) ->> epoch_column;
    END IF;

    IF local_text IS NULL AND epoch_text IS NULL THEN
        RETURN NEW;
    END IF;

    IF epoch_text IS NULL
       OR (TG_OP = 'UPDATE' AND local_text IS DISTINCT FROM old_local_text
           AND epoch_text IS NOT DISTINCT FROM old_epoch_text) THEN
        derived_epoch := floor(extract(
            epoch FROM (local_text::timestamp without time zone AT TIME ZONE 'Asia/Shanghai')
        ) * 1000)::bigint;
        NEW := jsonb_populate_record(NEW, jsonb_build_object(epoch_column, derived_epoch));
        RETURN NEW;
    END IF;

    derived_local := platform.local_from_epoch_ms(epoch_text::bigint);
    IF local_text IS NULL
       OR (TG_OP = 'UPDATE' AND epoch_text IS DISTINCT FROM old_epoch_text
           AND local_text IS NOT DISTINCT FROM old_local_text) THEN
        NEW := jsonb_populate_record(NEW, jsonb_build_object(local_column, derived_local));
        RETURN NEW;
    END IF;

    IF local_text::timestamp without time zone <> derived_local THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'ARCH_005_LOCAL_EPOCH_PAIR_MISMATCH',
            DETAIL = format('%s.%s.%s/%s', TG_TABLE_SCHEMA, TG_TABLE_NAME, local_column, epoch_column);
    END IF;
    RETURN NEW;
END
$arch005_sync_local_epoch_pair$;

CREATE TEMP TABLE arch005_column_plan (
    schema_name text NOT NULL,
    table_name text NOT NULL,
    column_name text NOT NULL,
    classification text NOT NULL,
    epoch_column_name text,
    local_default boolean NOT NULL DEFAULT false,
    PRIMARY KEY (schema_name, table_name, column_name)
) ON COMMIT DROP;

INSERT INTO arch005_column_plan (
    schema_name, table_name, column_name, classification, epoch_column_name, local_default
)
VALUES
    ('channel','message_inbox','create_time','EXTERNAL_SOURCE_INSTANT','provider_create_epoch_ms',false),
    ('channel','message_inbox','received_at','EXTERNAL_SOURCE_INSTANT','received_epoch_ms',false),
    ('channel','message_inbox','retention_until','TECHNICAL_DEADLINE','retention_until_epoch_ms',false),
    ('channel','message_inbox','created_at','BUSINESS_LOCAL',NULL,true),
    ('channel','message_inbox','completed_at','BUSINESS_LOCAL',NULL,false),

    ('intake','service_intake','retention_until','TECHNICAL_DEADLINE','retention_until_epoch_ms',false),
    ('intake','service_intake','last_message_at','BUSINESS_LOCAL',NULL,false),
    ('intake','service_intake','created_at','BUSINESS_LOCAL',NULL,true),
    ('intake','service_intake','updated_at','BUSINESS_LOCAL',NULL,true),
    ('intake','service_intake_message','linked_at','BUSINESS_LOCAL',NULL,false),
    ('intake','service_intake_event','occurred_at','BUSINESS_LOCAL',NULL,true),

    ('pilot_ticket','resolver_team','created_at','BUSINESS_LOCAL',NULL,true),
    ('pilot_ticket','ticket','created_at','BUSINESS_LOCAL',NULL,true),
    ('pilot_ticket','ticket','updated_at','BUSINESS_LOCAL',NULL,true),
    ('pilot_ticket','ticket','auto_close_at','TECHNICAL_DEADLINE','auto_close_epoch_ms',false),
    ('pilot_ticket','ticket','auto_close_reminder_at','TECHNICAL_DEADLINE','auto_close_reminder_epoch_ms',false),
    ('pilot_ticket','ticket_event','created_at','BUSINESS_LOCAL',NULL,true),
    ('pilot_ticket','pilot_principal','created_at','BUSINESS_LOCAL',NULL,true),
    ('pilot_ticket','pilot_principal','updated_at','BUSINESS_LOCAL',NULL,true),
    ('pilot_ticket','pilot_team_member','created_at','BUSINESS_LOCAL',NULL,true),
    ('pilot_ticket','ticket_supplement','created_at','BUSINESS_LOCAL',NULL,true),

    ('notification','outbox','created_at','BUSINESS_LOCAL',NULL,true),
    ('notification','delivery','next_attempt_at','TECHNICAL_DEADLINE','next_attempt_epoch_ms',true),
    ('notification','delivery','lease_expires_at','TECHNICAL_DEADLINE','lease_expires_epoch_ms',false),
    ('notification','delivery','sent_at','ELAPSED_TIME_ANCHOR','sent_epoch_ms',false),
    ('notification','delivery','created_at','BUSINESS_LOCAL',NULL,true),
    ('notification','delivery','updated_at','BUSINESS_LOCAL',NULL,true),
    ('notification','delivery_attempt','occurred_at','ELAPSED_TIME_ANCHOR','occurred_epoch_ms',true),
    ('notification','card_action_task','expires_at','TECHNICAL_DEADLINE','expires_epoch_ms',false),
    ('notification','card_action_task','consumed_at','BUSINESS_LOCAL',NULL,false),
    ('notification','card_action_task','created_at','BUSINESS_LOCAL',NULL,true),
    ('notification','card_action_receipt','created_at','BUSINESS_LOCAL',NULL,true),

    ('operations','audit_event','occurred_at','BUSINESS_LOCAL',NULL,true),
    ('operations','backup_checkpoint','retention_until','TECHNICAL_DEADLINE','retention_until_epoch_ms',false),
    ('operations','backup_checkpoint','created_at','BUSINESS_LOCAL',NULL,true),
    ('operations','restore_drill','completed_at','BUSINESS_LOCAL',NULL,true),

    ('conversation','thread','last_activity_at','BUSINESS_LOCAL',NULL,true),
    ('conversation','thread','created_at','BUSINESS_LOCAL',NULL,true),
    ('conversation','thread','updated_at','BUSINESS_LOCAL',NULL,true),
    ('conversation','session','started_at','BUSINESS_LOCAL',NULL,true),
    ('conversation','session','last_activity_at','ELAPSED_TIME_ANCHOR','last_activity_epoch_ms',true),
    ('conversation','session','ended_at','BUSINESS_LOCAL',NULL,false),
    ('conversation','session','created_at','BUSINESS_LOCAL',NULL,true),
    ('conversation','session','updated_at','BUSINESS_LOCAL',NULL,true),
    ('conversation','item','retention_until','TECHNICAL_DEADLINE','retention_until_epoch_ms',false),
    ('conversation','item','occurred_at','BUSINESS_LOCAL',NULL,false),
    ('conversation','item','projected_at','BUSINESS_LOCAL',NULL,true),
    ('conversation','item_source_binding','created_at','BUSINESS_LOCAL',NULL,true),
    ('conversation','item_source_binding','last_seen_at','BUSINESS_LOCAL',NULL,true),
    ('conversation','projection_checkpoint','last_source_occurred_at','BUSINESS_LOCAL',NULL,false),
    ('conversation','projection_checkpoint','updated_at','BUSINESS_LOCAL',NULL,true),
    ('conversation','realtime_event','occurred_at','BUSINESS_LOCAL',NULL,false),
    ('conversation','realtime_event','expires_at','TECHNICAL_DEADLINE','expires_epoch_ms',false),
    ('conversation','realtime_event','created_at','BUSINESS_LOCAL',NULL,true),
    ('conversation','realtime_stream_state','updated_at','BUSINESS_LOCAL',NULL,true),
    ('conversation','assignment','assigned_at','BUSINESS_LOCAL',NULL,false),
    ('conversation','assignment','released_at','BUSINESS_LOCAL',NULL,false),
    ('conversation','assignment','updated_at','BUSINESS_LOCAL',NULL,true),
    ('conversation','handoff','requested_at','BUSINESS_LOCAL',NULL,false),
    ('conversation','handoff','accepted_at','BUSINESS_LOCAL',NULL,false),
    ('conversation','handoff','released_at','BUSINESS_LOCAL',NULL,false),
    ('conversation','handoff','cancelled_at','BUSINESS_LOCAL',NULL,false),
    ('conversation','handoff','updated_at','BUSINESS_LOCAL',NULL,false),
    ('conversation','read_cursor','created_at','BUSINESS_LOCAL',NULL,true),
    ('conversation','read_cursor','updated_at','BUSINESS_LOCAL',NULL,true),
    ('conversation','control_event','occurred_at','BUSINESS_LOCAL',NULL,true),

    ('communication','message','retention_until','TECHNICAL_DEADLINE','retention_until_epoch_ms',false),
    ('communication','message','created_at','BUSINESS_LOCAL',NULL,true),
    ('communication','outbox','created_at','BUSINESS_LOCAL',NULL,true),
    ('communication','delivery','next_attempt_at','TECHNICAL_DEADLINE','next_attempt_epoch_ms',true),
    ('communication','delivery','lease_expires_at','TECHNICAL_DEADLINE','lease_expires_epoch_ms',false),
    ('communication','delivery','send_started_at','ELAPSED_TIME_ANCHOR','send_started_epoch_ms',false),
    ('communication','delivery','sent_at','ELAPSED_TIME_ANCHOR','sent_epoch_ms',false),
    ('communication','delivery','created_at','BUSINESS_LOCAL',NULL,true),
    ('communication','delivery','updated_at','BUSINESS_LOCAL',NULL,true),
    ('communication','delivery_attempt','started_at','ELAPSED_TIME_ANCHOR','started_epoch_ms',false),
    ('communication','delivery_attempt','completed_at','ELAPSED_TIME_ANCHOR','completed_epoch_ms',false);

DO $arch005_verify_inventory$
DECLARE
    plan_count integer;
    live_count integer;
BEGIN
    SELECT count(*) INTO plan_count FROM arch005_column_plan;
    IF plan_count <> 77 THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'ARCH_005_COLUMN_PLAN_COUNT_INVALID',
            DETAIL = format('count=%s', plan_count);
    END IF;

    SELECT count(*) INTO live_count
      FROM information_schema.columns AS columns
      JOIN arch005_column_plan AS plan
        ON plan.schema_name = columns.table_schema
       AND plan.table_name = columns.table_name
       AND plan.column_name = columns.column_name;
    IF live_count <> plan_count THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'ARCH_005_COLUMN_PLAN_TARGET_MISSING',
            DETAIL = format('expected=%s actual=%s', plan_count, live_count);
    END IF;
END
$arch005_verify_inventory$;

DO $arch005_add_epoch_columns$
DECLARE
    plan record;
    current_type text;
    is_nullable text;
BEGIN
    FOR plan IN
        SELECT * FROM arch005_column_plan
         WHERE epoch_column_name IS NOT NULL
         ORDER BY schema_name, table_name, column_name
    LOOP
        EXECUTE format(
            'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS %I bigint',
            plan.schema_name, plan.table_name, plan.epoch_column_name
        );

        SELECT columns.data_type, columns.is_nullable
          INTO current_type, is_nullable
          FROM information_schema.columns AS columns
         WHERE columns.table_schema = plan.schema_name
           AND columns.table_name = plan.table_name
           AND columns.column_name = plan.column_name;

        IF current_type = 'timestamp with time zone' THEN
            EXECUTE format(
                'UPDATE %I.%I SET %I = floor(extract(epoch FROM %I) * 1000)::bigint WHERE %I IS NULL AND %I IS NOT NULL',
                plan.schema_name, plan.table_name, plan.epoch_column_name,
                plan.column_name, plan.epoch_column_name, plan.column_name
            );
        ELSIF current_type = 'timestamp without time zone' THEN
            EXECUTE format(
                'UPDATE %I.%I SET %I = floor(extract(epoch FROM (%I AT TIME ZONE ''Asia/Shanghai'')) * 1000)::bigint WHERE %I IS NULL AND %I IS NOT NULL',
                plan.schema_name, plan.table_name, plan.epoch_column_name,
                plan.column_name, plan.epoch_column_name, plan.column_name
            );
        ELSE
            RAISE EXCEPTION USING
                ERRCODE = '55000',
                MESSAGE = 'ARCH_005_COLUMN_TYPE_UNEXPECTED',
                DETAIL = format('%s.%s.%s=%s', plan.schema_name, plan.table_name, plan.column_name, current_type);
        END IF;

        IF is_nullable = 'NO' THEN
            EXECUTE format(
                'ALTER TABLE %I.%I ALTER COLUMN %I SET NOT NULL',
                plan.schema_name, plan.table_name, plan.epoch_column_name
            );
        END IF;
    END LOOP;
END
$arch005_add_epoch_columns$;

DO $arch005_convert_local_columns$
DECLARE
    plan record;
    current_type text;
    constraint_name text;
BEGIN
    FOR plan IN SELECT * FROM arch005_column_plan ORDER BY schema_name, table_name, column_name
    LOOP
        SELECT columns.data_type
          INTO current_type
          FROM information_schema.columns AS columns
         WHERE columns.table_schema = plan.schema_name
           AND columns.table_name = plan.table_name
           AND columns.column_name = plan.column_name;

        IF current_type = 'timestamp with time zone' THEN
            EXECUTE format(
                'ALTER TABLE %I.%I ALTER COLUMN %I DROP DEFAULT',
                plan.schema_name, plan.table_name, plan.column_name
            );
            EXECUTE format(
                'ALTER TABLE %I.%I ALTER COLUMN %I TYPE timestamp without time zone USING date_trunc(''second'', %I AT TIME ZONE ''Asia/Shanghai'')',
                plan.schema_name, plan.table_name, plan.column_name, plan.column_name
            );
        ELSIF current_type <> 'timestamp without time zone' THEN
            RAISE EXCEPTION USING
                ERRCODE = '55000',
                MESSAGE = 'ARCH_005_COLUMN_TYPE_UNEXPECTED',
                DETAIL = format('%s.%s.%s=%s', plan.schema_name, plan.table_name, plan.column_name, current_type);
        END IF;

        IF plan.local_default THEN
            EXECUTE format(
                'ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT platform.local_now()',
                plan.schema_name, plan.table_name, plan.column_name
            );
        END IF;

        constraint_name := format('arch005_local_%s', substr(md5(
            plan.schema_name || '.' || plan.table_name || '.' || plan.column_name
        ), 1, 16));
        EXECUTE format(
            'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
            plan.schema_name, plan.table_name, constraint_name
        );
        EXECUTE format(
            'ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK (%I IS NULL OR %I = date_trunc(''second'', %I))',
            plan.schema_name, plan.table_name, constraint_name,
            plan.column_name, plan.column_name, plan.column_name
        );
    END LOOP;
END
$arch005_convert_local_columns$;

DO $arch005_epoch_consistency$
DECLARE
    plan record;
    constraint_name text;
BEGIN
    FOR plan IN
        SELECT * FROM arch005_column_plan
         WHERE epoch_column_name IS NOT NULL
         ORDER BY schema_name, table_name, column_name
    LOOP
        constraint_name := format('arch005_epoch_%s', substr(md5(
            plan.schema_name || '.' || plan.table_name || '.' || plan.epoch_column_name
        ), 1, 16));
        EXECUTE format(
            'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
            plan.schema_name, plan.table_name, constraint_name
        );
        EXECUTE format(
            'ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK ((%I IS NULL AND %I IS NULL) OR (%I IS NOT NULL AND %I IS NOT NULL AND %I >= 0 AND %I = platform.local_from_epoch_ms(%I)))',
            plan.schema_name, plan.table_name, constraint_name,
            plan.column_name, plan.epoch_column_name,
            plan.column_name, plan.epoch_column_name, plan.epoch_column_name,
            plan.column_name, plan.epoch_column_name
        );
    END LOOP;
END
$arch005_epoch_consistency$;

DO $arch005_epoch_triggers$
DECLARE
    plan record;
    trigger_name text;
BEGIN
    FOR plan IN
        SELECT * FROM arch005_column_plan
         WHERE epoch_column_name IS NOT NULL
         ORDER BY schema_name, table_name, column_name
    LOOP
        trigger_name := format('arch005_sync_%s', substr(md5(
            plan.schema_name || '.' || plan.table_name || '.' || plan.epoch_column_name
        ), 1, 16));
        EXECUTE format(
            'DROP TRIGGER IF EXISTS %I ON %I.%I',
            trigger_name, plan.schema_name, plan.table_name
        );
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I, %I ON %I.%I FOR EACH ROW EXECUTE FUNCTION platform.sync_local_epoch_pair(%L, %L)',
            trigger_name, plan.column_name, plan.epoch_column_name,
            plan.schema_name, plan.table_name, plan.column_name, plan.epoch_column_name
        );
    END LOOP;
END
$arch005_epoch_triggers$;

CREATE INDEX IF NOT EXISTS channel_message_inbox_retention_epoch_idx
    ON channel.message_inbox (retention_until_epoch_ms, id);
CREATE INDEX IF NOT EXISTS notification_delivery_claim_epoch_idx
    ON notification.delivery (status, next_attempt_epoch_ms, lease_expires_epoch_ms, id);
CREATE INDEX IF NOT EXISTS pilot_ticket_auto_close_epoch_idx
    ON pilot_ticket.ticket (auto_close_epoch_ms, id)
    WHERE auto_close_epoch_ms IS NOT NULL;
CREATE INDEX IF NOT EXISTS operations_backup_retention_epoch_idx
    ON operations.backup_checkpoint (retention_until_epoch_ms, created_at DESC);
CREATE INDEX IF NOT EXISTS conversation_item_retention_epoch_idx
    ON conversation.item (retention_until_epoch_ms, session_id, sequence_no);
CREATE INDEX IF NOT EXISTS conversation_realtime_expiry_epoch_idx
    ON conversation.realtime_event (expires_epoch_ms, event_id);
CREATE INDEX IF NOT EXISTS communication_delivery_claim_epoch_idx
    ON communication.delivery (status, next_attempt_epoch_ms, lease_expires_epoch_ms, id);

SELECT platform.assert_time_contract();

COMMENT ON SCHEMA platform IS
    'Project-owned ARCH-005 time contract functions, inventory, and migration markers.';
COMMENT ON FUNCTION platform.local_now() IS
    'Transaction-consistent Asia/Shanghai LocalDateTime at second precision.';
COMMENT ON FUNCTION platform.physical_epoch_ms() IS
    'Physical clock epoch milliseconds for leases, retry, timeout, expiry, retention, and elapsed time.';
COMMENT ON FUNCTION platform.local_from_epoch_ms(bigint) IS
    'One-time adapter/migration/display conversion from absolute epoch milliseconds to Asia/Shanghai LocalDateTime.';
