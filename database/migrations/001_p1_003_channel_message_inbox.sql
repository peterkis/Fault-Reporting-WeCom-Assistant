BEGIN;

CREATE SCHEMA IF NOT EXISTS channel;

CREATE TABLE IF NOT EXISTS channel.message_inbox (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    schema_version SMALLINT NOT NULL,
    provider TEXT NOT NULL,
    msg_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    req_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    chat_type TEXT NOT NULL,
    chat_id TEXT,
    sender_user_id TEXT NOT NULL,
    msg_type TEXT NOT NULL,
    create_time TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL,
    raw_text TEXT,
    clean_text TEXT,
    normalized_message JSONB NOT NULL,
    raw_payload_encrypted BYTEA,
    processing_status TEXT NOT NULL DEFAULT 'PROCESSING',
    response_snapshot JSONB,
    privacy_class TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    retention_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    CONSTRAINT message_inbox_provider_msg_unique UNIQUE (provider, msg_id),
    CONSTRAINT message_inbox_schema_version_check CHECK (schema_version = 1),
    CONSTRAINT message_inbox_provider_length_check CHECK (char_length(provider) BETWEEN 1 AND 64),
    CONSTRAINT message_inbox_msg_id_length_check CHECK (char_length(msg_id) BETWEEN 1 AND 256),
    CONSTRAINT message_inbox_idempotency_key_check CHECK (idempotency_key = provider || ':' || msg_id),
    CONSTRAINT message_inbox_req_id_length_check CHECK (char_length(req_id) BETWEEN 1 AND 256),
    CONSTRAINT message_inbox_bot_id_length_check CHECK (char_length(bot_id) BETWEEN 1 AND 256),
    CONSTRAINT message_inbox_chat_type_check CHECK (chat_type IN ('single', 'group')),
    CONSTRAINT message_inbox_chat_id_check CHECK (
        (chat_type = 'single' AND chat_id IS NULL)
        OR (chat_type = 'group' AND char_length(chat_id) BETWEEN 1 AND 256)
    ),
    CONSTRAINT message_inbox_sender_length_check CHECK (char_length(sender_user_id) BETWEEN 1 AND 256),
    CONSTRAINT message_inbox_msg_type_check CHECK (msg_type IN ('text', 'image', 'mixed', 'voice', 'file', 'video')),
    CONSTRAINT message_inbox_normalized_message_check CHECK (jsonb_typeof(normalized_message) = 'object'),
    CONSTRAINT message_inbox_processing_status_check CHECK (processing_status IN ('PROCESSING', 'COMPLETED')),
    CONSTRAINT message_inbox_processing_result_check CHECK (
        (processing_status = 'PROCESSING' AND response_snapshot IS NULL AND completed_at IS NULL)
        OR (
            processing_status = 'COMPLETED'
            AND jsonb_typeof(response_snapshot) = 'object'
            AND completed_at IS NOT NULL
        )
    ),
    CONSTRAINT message_inbox_privacy_class_check CHECK (
        privacy_class IN ('PUBLIC', 'INTERNAL', 'SENSITIVE_INTERNAL', 'PERSONAL', 'PATIENT_SENSITIVE', 'SECRET')
    ),
    CONSTRAINT message_inbox_trace_id_length_check CHECK (char_length(trace_id) BETWEEN 1 AND 128),
    CONSTRAINT message_inbox_retention_check CHECK (retention_until > received_at)
);

DO $p1_003_migration$
DECLARE
    inbox_relation OID := to_regclass('channel.message_inbox');
    schema_valid BOOLEAN := TRUE;
BEGIN
    IF inbox_relation IS NULL OR NOT COALESCE((
        SELECT relation.relkind = 'r' AND relation.relpersistence = 'p'
          FROM pg_class AS relation
         WHERE relation.oid = inbox_relation
    ), FALSE) THEN
        schema_valid := FALSE;
    END IF;

    IF EXISTS (
        WITH expected(column_name, data_type, is_not_null, identity_kind) AS (
            VALUES
                ('id', 'bigint', TRUE, 'a'),
                ('schema_version', 'smallint', TRUE, ''),
                ('provider', 'text', TRUE, ''),
                ('msg_id', 'text', TRUE, ''),
                ('idempotency_key', 'text', TRUE, ''),
                ('req_id', 'text', TRUE, ''),
                ('bot_id', 'text', TRUE, ''),
                ('chat_type', 'text', TRUE, ''),
                ('chat_id', 'text', FALSE, ''),
                ('sender_user_id', 'text', TRUE, ''),
                ('msg_type', 'text', TRUE, ''),
                ('create_time', 'timestamp with time zone', FALSE, ''),
                ('received_at', 'timestamp with time zone', TRUE, ''),
                ('raw_text', 'text', FALSE, ''),
                ('clean_text', 'text', FALSE, ''),
                ('normalized_message', 'jsonb', TRUE, ''),
                ('raw_payload_encrypted', 'bytea', FALSE, ''),
                ('processing_status', 'text', TRUE, ''),
                ('response_snapshot', 'jsonb', FALSE, ''),
                ('privacy_class', 'text', TRUE, ''),
                ('trace_id', 'text', TRUE, ''),
                ('retention_until', 'timestamp with time zone', TRUE, ''),
                ('created_at', 'timestamp with time zone', TRUE, ''),
                ('completed_at', 'timestamp with time zone', FALSE, '')
        ), actual AS (
            SELECT attribute.attname::text AS column_name,
                   format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
                   attribute.attnotnull AS is_not_null,
                   attribute.attidentity::text AS identity_kind,
                   attribute.attgenerated::text AS generated_kind
              FROM pg_attribute AS attribute
             WHERE attribute.attrelid = inbox_relation
               AND attribute.attnum > 0
               AND NOT attribute.attisdropped
        )
        SELECT 1
          FROM expected
          FULL JOIN actual USING (column_name)
         WHERE expected.column_name IS NULL
            OR actual.column_name IS NULL
            OR expected.data_type IS DISTINCT FROM actual.data_type
            OR expected.is_not_null IS DISTINCT FROM actual.is_not_null
            OR expected.identity_kind IS DISTINCT FROM actual.identity_kind
            OR actual.generated_kind IS DISTINCT FROM ''
    ) THEN
        schema_valid := FALSE;
    END IF;

    IF NOT (
        SELECT count(*) FILTER (WHERE constraint_record.contype = 'p') = 1
           AND count(*) FILTER (WHERE constraint_record.contype = 'u') = 1
           AND count(*) FILTER (WHERE constraint_record.contype = 'c') = 16
          FROM pg_constraint AS constraint_record
         WHERE constraint_record.conrelid = inbox_relation
    ) OR NOT (
        SELECT count(*) FILTER (WHERE index_record.indisunique) = 2
          FROM pg_index AS index_record
         WHERE index_record.indrelid = inbox_relation
    ) THEN
        schema_valid := FALSE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint AS constraint_record
         WHERE constraint_record.conrelid = inbox_relation
           AND constraint_record.contype = 'p'
           AND constraint_record.convalidated
           AND NOT constraint_record.condeferrable
           AND NOT constraint_record.condeferred
           AND EXISTS (
               SELECT 1
                 FROM pg_index AS primary_index
                WHERE primary_index.indexrelid = constraint_record.conindid
                  AND primary_index.indisvalid
                  AND primary_index.indisready
                  AND primary_index.indimmediate
           )
           AND ARRAY(
               SELECT attribute.attname
                 FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, position)
                 JOIN pg_attribute AS attribute
                   ON attribute.attrelid = inbox_relation
                  AND attribute.attnum = key_column.attnum
                ORDER BY key_column.position
           ) = ARRAY['id']::name[]
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_constraint AS constraint_record
         WHERE constraint_record.conrelid = inbox_relation
           AND constraint_record.contype = 'u'
           AND constraint_record.convalidated
           AND NOT constraint_record.condeferrable
           AND NOT constraint_record.condeferred
           AND EXISTS (
               SELECT 1
                 FROM pg_index AS unique_index
                WHERE unique_index.indexrelid = constraint_record.conindid
                  AND unique_index.indisvalid
                  AND unique_index.indisready
                  AND unique_index.indimmediate
           )
           AND ARRAY(
               SELECT attribute.attname
                 FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, position)
                 JOIN pg_attribute AS attribute
                   ON attribute.attrelid = inbox_relation
                  AND attribute.attnum = key_column.attnum
                ORDER BY key_column.position
           ) = ARRAY['provider', 'msg_id']::name[]
    ) THEN
        schema_valid := FALSE;
    END IF;

    IF EXISTS (
        WITH expected(constraint_name, constraint_expression) AS (
            VALUES
                ('message_inbox_schema_version_check', '(schema_version = 1)'),
                ('message_inbox_provider_length_check', '((char_length(provider) >= 1) AND (char_length(provider) <= 64))'),
                ('message_inbox_msg_id_length_check', '((char_length(msg_id) >= 1) AND (char_length(msg_id) <= 256))'),
                ('message_inbox_idempotency_key_check', '(idempotency_key = ((provider || '':''::text) || msg_id))'),
                ('message_inbox_req_id_length_check', '((char_length(req_id) >= 1) AND (char_length(req_id) <= 256))'),
                ('message_inbox_bot_id_length_check', '((char_length(bot_id) >= 1) AND (char_length(bot_id) <= 256))'),
                ('message_inbox_chat_type_check', '(chat_type = ANY (ARRAY[''single''::text, ''group''::text]))'),
                ('message_inbox_chat_id_check', '(((chat_type = ''single''::text) AND (chat_id IS NULL)) OR ((chat_type = ''group''::text) AND ((char_length(chat_id) >= 1) AND (char_length(chat_id) <= 256))))'),
                ('message_inbox_sender_length_check', '((char_length(sender_user_id) >= 1) AND (char_length(sender_user_id) <= 256))'),
                ('message_inbox_msg_type_check', '(msg_type = ANY (ARRAY[''text''::text, ''image''::text, ''mixed''::text, ''voice''::text, ''file''::text, ''video''::text]))'),
                ('message_inbox_normalized_message_check', '(jsonb_typeof(normalized_message) = ''object''::text)'),
                ('message_inbox_processing_status_check', '(processing_status = ANY (ARRAY[''PROCESSING''::text, ''COMPLETED''::text]))'),
                ('message_inbox_processing_result_check', '(((processing_status = ''PROCESSING''::text) AND (response_snapshot IS NULL) AND (completed_at IS NULL)) OR ((processing_status = ''COMPLETED''::text) AND (jsonb_typeof(response_snapshot) = ''object''::text) AND (completed_at IS NOT NULL)))'),
                ('message_inbox_privacy_class_check', '(privacy_class = ANY (ARRAY[''PUBLIC''::text, ''INTERNAL''::text, ''SENSITIVE_INTERNAL''::text, ''PERSONAL''::text, ''PATIENT_SENSITIVE''::text, ''SECRET''::text]))'),
                ('message_inbox_trace_id_length_check', '((char_length(trace_id) >= 1) AND (char_length(trace_id) <= 128))'),
                ('message_inbox_retention_check', '(retention_until > received_at)')
        )
        SELECT 1
          FROM expected
          LEFT JOIN pg_constraint AS constraint_record
            ON constraint_record.conrelid = inbox_relation
           AND constraint_record.conname = expected.constraint_name
           AND constraint_record.contype = 'c'
           AND constraint_record.convalidated
           AND NOT constraint_record.connoinherit
         WHERE constraint_record.oid IS NULL
            OR regexp_replace(
                pg_get_expr(constraint_record.conbin, constraint_record.conrelid),
                '\s+',
                '',
                'g'
            ) IS DISTINCT FROM regexp_replace(expected.constraint_expression, '\s+', '', 'g')
    ) THEN
        schema_valid := FALSE;
    END IF;

    IF (
        SELECT pg_get_expr(attribute_default.adbin, attribute_default.adrelid)
          FROM pg_attribute AS attribute
          LEFT JOIN pg_attrdef AS attribute_default
            ON attribute_default.adrelid = attribute.attrelid
           AND attribute_default.adnum = attribute.attnum
         WHERE attribute.attrelid = inbox_relation
           AND attribute.attname = 'processing_status'
    ) IS DISTINCT FROM '''PROCESSING''::text' OR (
        SELECT pg_get_expr(attribute_default.adbin, attribute_default.adrelid)
          FROM pg_attribute AS attribute
          LEFT JOIN pg_attrdef AS attribute_default
            ON attribute_default.adrelid = attribute.attrelid
           AND attribute_default.adnum = attribute.attnum
         WHERE attribute.attrelid = inbox_relation
           AND attribute.attname = 'created_at'
    ) IS DISTINCT FROM 'CURRENT_TIMESTAMP' THEN
        schema_valid := FALSE;
    END IF;

    IF NOT schema_valid THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'P1_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;
END
$p1_003_migration$;

CREATE INDEX IF NOT EXISTS message_inbox_retention_idx
    ON channel.message_inbox (retention_until);

DO $p1_003_retention_index$
DECLARE
    inbox_relation OID := to_regclass('channel.message_inbox');
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_index AS index_record
          JOIN pg_class AS index_relation
            ON index_relation.oid = index_record.indexrelid
          JOIN pg_am AS index_method
            ON index_method.oid = index_relation.relam
         WHERE index_record.indrelid = inbox_relation
           AND index_relation.relname = 'message_inbox_retention_idx'
           AND index_method.amname = 'btree'
           AND index_record.indisvalid
           AND index_record.indisready
           AND NOT index_record.indisunique
           AND index_record.indpred IS NULL
           AND index_record.indexprs IS NULL
           AND ARRAY(
               SELECT attribute.attname
                 FROM unnest(index_record.indkey::smallint[]) WITH ORDINALITY AS key_column(attnum, position)
                 JOIN pg_attribute AS attribute
                   ON attribute.attrelid = inbox_relation
                  AND attribute.attnum = key_column.attnum
                ORDER BY key_column.position
           ) = ARRAY['retention_until']::name[]
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'P1_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;
END
$p1_003_retention_index$;

COMMENT ON TABLE channel.message_inbox IS
    'P1-003 Channel Message persistence and provider/message idempotency boundary.';
COMMENT ON COLUMN channel.message_inbox.req_id IS
    'Provider request correlation only; never part of the business idempotency key.';
COMMENT ON COLUMN channel.message_inbox.raw_payload_encrypted IS
    'Optional caller-encrypted SDK payload. Plain SDK payloads are not accepted by the Inbox API.';
COMMENT ON COLUMN channel.message_inbox.response_snapshot IS
    'Opaque first-processing result returned unchanged for duplicate deliveries.';

COMMIT;
