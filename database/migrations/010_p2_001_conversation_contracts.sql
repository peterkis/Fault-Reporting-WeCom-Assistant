BEGIN;

CREATE SCHEMA IF NOT EXISTS conversation;

CREATE TABLE IF NOT EXISTS conversation.thread (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    provider TEXT NOT NULL,
    channel_account_id TEXT NOT NULL,
    chat_type TEXT NOT NULL,
    external_thread_key TEXT NOT NULL,
    thread_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT conversation_thread_natural_key_unique UNIQUE (
        provider,
        channel_account_id,
        chat_type,
        external_thread_key
    ),
    CONSTRAINT conversation_thread_key_unique UNIQUE (thread_key),
    CONSTRAINT conversation_thread_provider_length_check CHECK (
        char_length(provider) BETWEEN 1 AND 64
    ),
    CONSTRAINT conversation_thread_channel_account_length_check CHECK (
        char_length(channel_account_id) BETWEEN 1 AND 256
    ),
    CONSTRAINT conversation_thread_chat_type_check CHECK (
        chat_type IN ('single', 'group')
    ),
    CONSTRAINT conversation_thread_external_key_length_check CHECK (
        char_length(external_thread_key) BETWEEN 1 AND 256
    ),
    CONSTRAINT conversation_thread_key_check CHECK (
        thread_key ~ '^ctk_v1_[a-f0-9]{64}$'
    ),
    CONSTRAINT conversation_thread_status_check CHECK (
        status IN ('OPEN', 'ARCHIVED')
    )
);

CREATE TABLE IF NOT EXISTS conversation.session (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    thread_id UUID NOT NULL,
    participant_key TEXT NOT NULL,
    service_intake_id UUID,
    session_scope_key TEXT NOT NULL,
    creation_idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    control_mode TEXT NOT NULL DEFAULT 'HUMAN',
    generation_version BIGINT NOT NULL DEFAULT 1,
    row_version BIGINT NOT NULL DEFAULT 1,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMPTZ,
    close_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT conversation_session_thread_fk FOREIGN KEY (thread_id)
        REFERENCES conversation.thread(id) ON DELETE RESTRICT,
    CONSTRAINT conversation_session_service_intake_fk FOREIGN KEY (service_intake_id)
        REFERENCES intake.service_intake(id) ON DELETE RESTRICT,
    CONSTRAINT conversation_session_creation_idempotency_key_unique UNIQUE (
        creation_idempotency_key
    ),
    CONSTRAINT conversation_session_participant_length_check CHECK (
        char_length(participant_key) BETWEEN 1 AND 256
    ),
    CONSTRAINT conversation_session_scope_key_check CHECK (
        session_scope_key ~ '^csk_v1_[a-f0-9]{64}$'
    ),
    CONSTRAINT conversation_session_creation_key_length_check CHECK (
        char_length(creation_idempotency_key) BETWEEN 16 AND 256
    ),
    CONSTRAINT conversation_session_status_check CHECK (
        status IN ('OPEN', 'WAITING_USER', 'ENDED')
    ),
    CONSTRAINT conversation_session_control_mode_check CHECK (
        control_mode IN ('HUMAN', 'COPILOT', 'AUTO')
    ),
    CONSTRAINT conversation_session_generation_version_check CHECK (
        generation_version >= 1
    ),
    CONSTRAINT conversation_session_row_version_check CHECK (
        row_version >= 1
    ),
    CONSTRAINT conversation_session_close_reason_check CHECK (
        close_reason IS NULL OR char_length(close_reason) BETWEEN 1 AND 128
    ),
    CONSTRAINT conversation_session_ended_consistency_check CHECK (
        (status = 'ENDED' AND ended_at IS NOT NULL AND close_reason IS NOT NULL)
        OR (status <> 'ENDED' AND ended_at IS NULL AND close_reason IS NULL)
    )
);

DO $p2_001_relation_contract$
DECLARE
    thread_relation OID := to_regclass('conversation.thread');
    session_relation OID := to_regclass('conversation.session');
    contract_valid BOOLEAN := TRUE;
BEGIN
    IF thread_relation IS NULL OR session_relation IS NULL THEN
        contract_valid := FALSE;
    END IF;

    IF NOT COALESCE((
        SELECT relation.relkind = 'r' AND relation.relpersistence = 'p'
          FROM pg_class AS relation
         WHERE relation.oid = thread_relation
    ), FALSE) OR NOT COALESCE((
        SELECT relation.relkind = 'r' AND relation.relpersistence = 'p'
          FROM pg_class AS relation
         WHERE relation.oid = session_relation
    ), FALSE) THEN
        contract_valid := FALSE;
    END IF;

    IF EXISTS (
        WITH expected(relation_oid, column_name, data_type, is_not_null) AS (
            VALUES
                (thread_relation, 'id', 'uuid', TRUE),
                (thread_relation, 'provider', 'text', TRUE),
                (thread_relation, 'channel_account_id', 'text', TRUE),
                (thread_relation, 'chat_type', 'text', TRUE),
                (thread_relation, 'external_thread_key', 'text', TRUE),
                (thread_relation, 'thread_key', 'text', TRUE),
                (thread_relation, 'status', 'text', TRUE),
                (thread_relation, 'last_activity_at', 'timestamp with time zone', TRUE),
                (thread_relation, 'created_at', 'timestamp with time zone', TRUE),
                (thread_relation, 'updated_at', 'timestamp with time zone', TRUE),
                (session_relation, 'id', 'uuid', TRUE),
                (session_relation, 'thread_id', 'uuid', TRUE),
                (session_relation, 'participant_key', 'text', TRUE),
                (session_relation, 'service_intake_id', 'uuid', FALSE),
                (session_relation, 'session_scope_key', 'text', TRUE),
                (session_relation, 'creation_idempotency_key', 'text', TRUE),
                (session_relation, 'status', 'text', TRUE),
                (session_relation, 'control_mode', 'text', TRUE),
                (session_relation, 'generation_version', 'bigint', TRUE),
                (session_relation, 'row_version', 'bigint', TRUE),
                (session_relation, 'started_at', 'timestamp with time zone', TRUE),
                (session_relation, 'last_activity_at', 'timestamp with time zone', TRUE),
                (session_relation, 'ended_at', 'timestamp with time zone', FALSE),
                (session_relation, 'close_reason', 'text', FALSE),
                (session_relation, 'created_at', 'timestamp with time zone', TRUE),
                (session_relation, 'updated_at', 'timestamp with time zone', TRUE)
        ), actual AS (
            SELECT attribute.attrelid AS relation_oid,
                   attribute.attname::text AS column_name,
                   format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
                   attribute.attnotnull AS is_not_null,
                   attribute.attidentity::text AS identity_kind,
                   attribute.attgenerated::text AS generated_kind
              FROM pg_attribute AS attribute
             WHERE attribute.attrelid IN (thread_relation, session_relation)
               AND attribute.attnum > 0
               AND NOT attribute.attisdropped
        )
        SELECT 1
          FROM expected
          FULL JOIN actual USING (relation_oid, column_name)
         WHERE expected.column_name IS NULL
            OR actual.column_name IS NULL
            OR expected.data_type IS DISTINCT FROM actual.data_type
            OR expected.is_not_null IS DISTINCT FROM actual.is_not_null
            OR actual.identity_kind IS DISTINCT FROM ''
            OR actual.generated_kind IS DISTINCT FROM ''
    ) THEN
        contract_valid := FALSE;
    END IF;

    IF EXISTS (
        WITH expected(relation_oid, column_name, default_expression) AS (
            VALUES
                (thread_relation, 'id', 'uuidv7()'),
                (thread_relation, 'status', '''OPEN''::text'),
                (thread_relation, 'last_activity_at', 'CURRENT_TIMESTAMP'),
                (thread_relation, 'created_at', 'CURRENT_TIMESTAMP'),
                (thread_relation, 'updated_at', 'CURRENT_TIMESTAMP'),
                (session_relation, 'id', 'uuidv7()'),
                (session_relation, 'status', '''OPEN''::text'),
                (session_relation, 'control_mode', '''HUMAN''::text'),
                (session_relation, 'generation_version', '1'),
                (session_relation, 'row_version', '1'),
                (session_relation, 'started_at', 'CURRENT_TIMESTAMP'),
                (session_relation, 'last_activity_at', 'CURRENT_TIMESTAMP'),
                (session_relation, 'created_at', 'CURRENT_TIMESTAMP'),
                (session_relation, 'updated_at', 'CURRENT_TIMESTAMP')
        ), actual AS (
            SELECT attribute.attrelid AS relation_oid,
                   attribute.attname::text AS column_name,
                   pg_get_expr(attribute_default.adbin, attribute_default.adrelid) AS default_expression
              FROM pg_attribute AS attribute
              JOIN pg_attrdef AS attribute_default
                ON attribute_default.adrelid = attribute.attrelid
               AND attribute_default.adnum = attribute.attnum
             WHERE attribute.attrelid IN (thread_relation, session_relation)
        )
        SELECT 1
          FROM expected
          FULL JOIN actual USING (relation_oid, column_name)
         WHERE expected.column_name IS NULL
            OR actual.column_name IS NULL
            OR expected.default_expression IS DISTINCT FROM actual.default_expression
    ) THEN
        contract_valid := FALSE;
    END IF;

    IF NOT (
        SELECT count(*) FILTER (WHERE constraint_record.contype = 'p') = 1
           AND count(*) FILTER (WHERE constraint_record.contype = 'u') = 2
           AND count(*) FILTER (WHERE constraint_record.contype = 'c') = 6
          FROM pg_constraint AS constraint_record
         WHERE constraint_record.conrelid = thread_relation
    ) OR NOT (
        SELECT count(*) FILTER (WHERE constraint_record.contype = 'p') = 1
           AND count(*) FILTER (WHERE constraint_record.contype = 'u') = 1
           AND count(*) FILTER (WHERE constraint_record.contype = 'f') = 2
           AND count(*) FILTER (WHERE constraint_record.contype = 'c') = 9
          FROM pg_constraint AS constraint_record
         WHERE constraint_record.conrelid = session_relation
    ) THEN
        contract_valid := FALSE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint AS constraint_record
         WHERE constraint_record.conrelid = thread_relation
           AND constraint_record.contype = 'p'
           AND constraint_record.convalidated
           AND NOT constraint_record.condeferrable
           AND ARRAY(
               SELECT attribute.attname
                 FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, position)
                 JOIN pg_attribute AS attribute
                   ON attribute.attrelid = thread_relation
                  AND attribute.attnum = key_column.attnum
                ORDER BY key_column.position
           ) = ARRAY['id']::name[]
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_constraint AS constraint_record
         WHERE constraint_record.conrelid = session_relation
           AND constraint_record.contype = 'p'
           AND constraint_record.convalidated
           AND NOT constraint_record.condeferrable
           AND ARRAY(
               SELECT attribute.attname
                 FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, position)
                 JOIN pg_attribute AS attribute
                   ON attribute.attrelid = session_relation
                  AND attribute.attnum = key_column.attnum
                ORDER BY key_column.position
           ) = ARRAY['id']::name[]
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_constraint AS constraint_record
         WHERE constraint_record.conrelid = thread_relation
           AND constraint_record.contype = 'u'
           AND constraint_record.conname = 'conversation_thread_natural_key_unique'
           AND constraint_record.convalidated
           AND NOT constraint_record.condeferrable
           AND ARRAY(
               SELECT attribute.attname
                 FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, position)
                 JOIN pg_attribute AS attribute
                   ON attribute.attrelid = thread_relation
                  AND attribute.attnum = key_column.attnum
                ORDER BY key_column.position
            ) = ARRAY['provider', 'channel_account_id', 'chat_type', 'external_thread_key']::name[]
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_constraint AS constraint_record
         WHERE constraint_record.conrelid = thread_relation
           AND constraint_record.contype = 'u'
           AND constraint_record.conname = 'conversation_thread_key_unique'
           AND constraint_record.convalidated
           AND NOT constraint_record.condeferrable
           AND ARRAY(
               SELECT attribute.attname
                 FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, position)
                 JOIN pg_attribute AS attribute
                   ON attribute.attrelid = thread_relation
                  AND attribute.attnum = key_column.attnum
                ORDER BY key_column.position
           ) = ARRAY['thread_key']::name[]
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_constraint AS constraint_record
         WHERE constraint_record.conrelid = session_relation
           AND constraint_record.contype = 'u'
           AND constraint_record.conname = 'conversation_session_creation_idempotency_key_unique'
           AND constraint_record.convalidated
           AND NOT constraint_record.condeferrable
           AND ARRAY(
               SELECT attribute.attname
                 FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, position)
                 JOIN pg_attribute AS attribute
                   ON attribute.attrelid = session_relation
                  AND attribute.attnum = key_column.attnum
                ORDER BY key_column.position
           ) = ARRAY['creation_idempotency_key']::name[]
    ) THEN
        contract_valid := FALSE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint AS constraint_record
         WHERE constraint_record.conrelid = session_relation
           AND constraint_record.conname = 'conversation_session_thread_fk'
           AND constraint_record.contype = 'f'
           AND constraint_record.convalidated
           AND constraint_record.confrelid = thread_relation
           AND constraint_record.confdeltype = 'r'
           AND NOT constraint_record.condeferrable
           AND ARRAY(
               SELECT attribute.attname
                 FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, position)
                 JOIN pg_attribute AS attribute
                   ON attribute.attrelid = session_relation
                  AND attribute.attnum = key_column.attnum
                ORDER BY key_column.position
           ) = ARRAY['thread_id']::name[]
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_constraint AS constraint_record
         WHERE constraint_record.conrelid = session_relation
           AND constraint_record.conname = 'conversation_session_service_intake_fk'
           AND constraint_record.contype = 'f'
           AND constraint_record.convalidated
           AND constraint_record.confrelid = 'intake.service_intake'::regclass
           AND constraint_record.confdeltype = 'r'
           AND NOT constraint_record.condeferrable
           AND ARRAY(
               SELECT attribute.attname
                 FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, position)
                 JOIN pg_attribute AS attribute
                   ON attribute.attrelid = session_relation
                  AND attribute.attnum = key_column.attnum
                ORDER BY key_column.position
           ) = ARRAY['service_intake_id']::name[]
    ) THEN
        contract_valid := FALSE;
    END IF;

    IF EXISTS (
        WITH expected(relation_oid, constraint_name, constraint_expression) AS (
            VALUES
                (thread_relation, 'conversation_thread_provider_length_check', '((char_length(provider) >= 1) AND (char_length(provider) <= 64))'),
                (thread_relation, 'conversation_thread_channel_account_length_check', '((char_length(channel_account_id) >= 1) AND (char_length(channel_account_id) <= 256))'),
                (thread_relation, 'conversation_thread_chat_type_check', '(chat_type = ANY (ARRAY[''single''::text, ''group''::text]))'),
                (thread_relation, 'conversation_thread_external_key_length_check', '((char_length(external_thread_key) >= 1) AND (char_length(external_thread_key) <= 256))'),
                (thread_relation, 'conversation_thread_key_check', '(thread_key ~ ''^ctk_v1_[a-f0-9]{64}$''::text)'),
                (thread_relation, 'conversation_thread_status_check', '(status = ANY (ARRAY[''OPEN''::text, ''ARCHIVED''::text]))'),
                (session_relation, 'conversation_session_participant_length_check', '((char_length(participant_key) >= 1) AND (char_length(participant_key) <= 256))'),
                (session_relation, 'conversation_session_scope_key_check', '(session_scope_key ~ ''^csk_v1_[a-f0-9]{64}$''::text)'),
                (session_relation, 'conversation_session_creation_key_length_check', '((char_length(creation_idempotency_key) >= 16) AND (char_length(creation_idempotency_key) <= 256))'),
                (session_relation, 'conversation_session_status_check', '(status = ANY (ARRAY[''OPEN''::text, ''WAITING_USER''::text, ''ENDED''::text]))'),
                (session_relation, 'conversation_session_control_mode_check', '(control_mode = ANY (ARRAY[''HUMAN''::text, ''COPILOT''::text, ''AUTO''::text]))'),
                (session_relation, 'conversation_session_generation_version_check', '(generation_version >= 1)'),
                (session_relation, 'conversation_session_row_version_check', '(row_version >= 1)'),
                (session_relation, 'conversation_session_close_reason_check', '((close_reason IS NULL) OR ((char_length(close_reason) >= 1) AND (char_length(close_reason) <= 128)))'),
                (session_relation, 'conversation_session_ended_consistency_check', '(((status = ''ENDED''::text) AND (ended_at IS NOT NULL) AND (close_reason IS NOT NULL)) OR ((status <> ''ENDED''::text) AND (ended_at IS NULL) AND (close_reason IS NULL)))')
        )
        SELECT 1
          FROM expected
          LEFT JOIN pg_constraint AS constraint_record
            ON constraint_record.conrelid = expected.relation_oid
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
        contract_valid := FALSE;
    END IF;

    IF NOT contract_valid THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'P2_001_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;
END
$p2_001_relation_contract$;

CREATE INDEX IF NOT EXISTS conversation_thread_last_activity_idx
    ON conversation.thread (last_activity_at DESC);

CREATE INDEX IF NOT EXISTS conversation_session_thread_activity_idx
    ON conversation.session (thread_id, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS conversation_session_scope_idx
    ON conversation.session (session_scope_key);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_session_one_active_participant_idx
    ON conversation.session (thread_id, participant_key)
    WHERE status <> 'ENDED';

DO $p2_001_index_contract$
DECLARE
    thread_relation OID := to_regclass('conversation.thread');
    session_relation OID := to_regclass('conversation.session');
    index_valid BOOLEAN := TRUE;
BEGIN
    IF NOT (
        SELECT count(*) = 4
          FROM pg_index AS index_record
         WHERE index_record.indrelid = thread_relation
    ) OR NOT (
        SELECT count(*) = 5
          FROM pg_index AS index_record
         WHERE index_record.indrelid = session_relation
    ) THEN
        index_valid := FALSE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_index AS index_record
          JOIN pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
          JOIN pg_am AS index_method ON index_method.oid = index_relation.relam
         WHERE index_record.indrelid = thread_relation
           AND index_relation.relname = 'conversation_thread_last_activity_idx'
           AND index_method.amname = 'btree'
           AND index_record.indisvalid
           AND index_record.indisready
           AND NOT index_record.indisunique
           AND index_record.indpred IS NULL
           AND index_record.indexprs IS NULL
           AND (index_record.indoption::smallint[])[0] & 1 = 1
           AND ARRAY(
               SELECT attribute.attname
                 FROM unnest(index_record.indkey::smallint[]) WITH ORDINALITY AS key_column(attnum, position)
                 JOIN pg_attribute AS attribute
                   ON attribute.attrelid = thread_relation
                  AND attribute.attnum = key_column.attnum
                ORDER BY key_column.position
           ) = ARRAY['last_activity_at']::name[]
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_index AS index_record
          JOIN pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
          JOIN pg_am AS index_method ON index_method.oid = index_relation.relam
         WHERE index_record.indrelid = session_relation
           AND index_relation.relname = 'conversation_session_thread_activity_idx'
           AND index_method.amname = 'btree'
           AND index_record.indisvalid
           AND index_record.indisready
           AND NOT index_record.indisunique
           AND index_record.indpred IS NULL
           AND index_record.indexprs IS NULL
           AND (index_record.indoption::smallint[])[1] & 1 = 1
           AND ARRAY(
               SELECT attribute.attname
                 FROM unnest(index_record.indkey::smallint[]) WITH ORDINALITY AS key_column(attnum, position)
                 JOIN pg_attribute AS attribute
                   ON attribute.attrelid = session_relation
                  AND attribute.attnum = key_column.attnum
                ORDER BY key_column.position
           ) = ARRAY['thread_id', 'last_activity_at']::name[]
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_index AS index_record
          JOIN pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
          JOIN pg_am AS index_method ON index_method.oid = index_relation.relam
         WHERE index_record.indrelid = session_relation
           AND index_relation.relname = 'conversation_session_scope_idx'
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
                   ON attribute.attrelid = session_relation
                  AND attribute.attnum = key_column.attnum
                ORDER BY key_column.position
           ) = ARRAY['session_scope_key']::name[]
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_index AS index_record
          JOIN pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
          JOIN pg_am AS index_method ON index_method.oid = index_relation.relam
         WHERE index_record.indrelid = session_relation
           AND index_relation.relname = 'conversation_session_one_active_participant_idx'
           AND index_method.amname = 'btree'
           AND index_record.indisvalid
           AND index_record.indisready
           AND index_record.indisunique
           AND index_record.indexprs IS NULL
           AND regexp_replace(
               pg_get_expr(index_record.indpred, index_record.indrelid),
               '\s+',
               '',
               'g'
           ) = '(status<>''ENDED''::text)'
           AND ARRAY(
               SELECT attribute.attname
                 FROM unnest(index_record.indkey::smallint[]) WITH ORDINALITY AS key_column(attnum, position)
                 JOIN pg_attribute AS attribute
                   ON attribute.attrelid = session_relation
                  AND attribute.attnum = key_column.attnum
                ORDER BY key_column.position
           ) = ARRAY['thread_id', 'participant_key']::name[]
    ) THEN
        index_valid := FALSE;
    END IF;

    IF NOT index_valid THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'P2_001_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;
END
$p2_001_index_contract$;

COMMENT ON TABLE conversation.thread IS
    'P2-001 durable channel conversation identity. It is not a Channel Message, Service Intake, or Ticket fact source.';
COMMENT ON COLUMN conversation.thread.channel_account_id IS
    'Opaque provider account identifier (the WeCom bot identifier for WeCom); never log the raw value.';
COMMENT ON COLUMN conversation.thread.external_thread_key IS
    'Opaque provider conversation key. Together with provider, account and chat type it identifies one Thread.';
COMMENT ON COLUMN conversation.thread.thread_key IS
    'Opaque deterministic digest used when deriving Session scope; the natural provider tuple remains authoritative.';
COMMENT ON TABLE conversation.session IS
    'P2-001 participant-isolated conversation lifecycle and control contract. It does not copy or own Ticket state.';
COMMENT ON COLUMN conversation.session.participant_key IS
    'Opaque participant boundary; required for both direct and group conversations and never logged raw.';
COMMENT ON COLUMN conversation.session.service_intake_id IS
    'Optional reference to the authoritative Service Intake. No Ticket state is copied into Conversation.';
COMMENT ON COLUMN conversation.session.session_scope_key IS
    'Deterministic topic/participant scope used for lookup. It is intentionally non-unique across successive Sessions.';
COMMENT ON COLUMN conversation.session.creation_idempotency_key IS
    'Unique command key for exactly-once Session creation; it is separate from the reusable session scope.';
COMMENT ON COLUMN conversation.session.control_mode IS
    'Defaults to HUMAN. COPILOT and AUTO remain contract values only while their feature flags are disabled.';
COMMENT ON COLUMN conversation.session.generation_version IS
    'Monotonic generation fence contract. P2-001 does not start or send any AI work.';
COMMENT ON COLUMN conversation.session.row_version IS
    'Optimistic concurrency version. Assignment and handoff behavior are outside P2-001.';

COMMIT;
