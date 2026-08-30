BEGIN;

DO $p2_002_prerequisite_contract$
DECLARE
    session_relation OID := to_regclass('conversation.session');
    uuidv7_procedure OID := to_regprocedure('uuidv7()');
BEGIN
    IF session_relation IS NULL
       OR uuidv7_procedure IS NULL
       OR NOT COALESCE((
            SELECT procedure_record.prokind = 'f'
               AND procedure_record.prorettype = 'uuid'::regtype
               AND NOT procedure_record.proretset
              FROM pg_proc AS procedure_record
             WHERE procedure_record.oid = uuidv7_procedure
       ), FALSE)
       OR NOT COALESCE((
            SELECT relation.relkind = 'r' AND relation.relpersistence = 'p'
              FROM pg_class AS relation
             WHERE relation.oid = session_relation
       ), FALSE)
       OR NOT EXISTS (
            SELECT 1
              FROM pg_attribute AS attribute
             WHERE attribute.attrelid = session_relation
               AND attribute.attname = 'id'
               AND format_type(attribute.atttypid, attribute.atttypmod) = 'uuid'
               AND attribute.attnotnull
               AND NOT attribute.attisdropped
       )
       OR NOT EXISTS (
            SELECT 1
              FROM pg_constraint AS constraint_record
              JOIN pg_index AS index_record
                ON index_record.indexrelid = constraint_record.conindid
              JOIN pg_class AS index_relation
                ON index_relation.oid = index_record.indexrelid
              JOIN pg_am AS index_method
                ON index_method.oid = index_relation.relam
             WHERE constraint_record.conrelid = session_relation
               AND constraint_record.contype = 'p'
               AND constraint_record.convalidated
               AND NOT constraint_record.condeferrable
               AND NOT constraint_record.condeferred
               AND index_method.amname = 'btree'
               AND index_record.indisvalid
               AND index_record.indisready
               AND index_record.indimmediate
               AND ARRAY(
                   SELECT attribute.attname
                     FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, position)
                     JOIN pg_attribute AS attribute
                       ON attribute.attrelid = session_relation
                      AND attribute.attnum = key_column.attnum
                    ORDER BY key_column.position
               ) = ARRAY['id']::name[]
       ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;
END
$p2_002_prerequisite_contract$;

CREATE TABLE IF NOT EXISTS conversation.item (
    id UUID NOT NULL DEFAULT uuidv7(),
    session_id UUID NOT NULL,
    sequence_no BIGINT NOT NULL,
    item_type TEXT NOT NULL,
    sender_kind TEXT NOT NULL,
    visibility TEXT NOT NULL,
    text TEXT,
    safe_content JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    projection_variant TEXT NOT NULL,
    canonical_order_key TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    privacy_class TEXT NOT NULL,
    retention_until TIMESTAMPTZ NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    projected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT conversation_item_pkey PRIMARY KEY (id),
    CONSTRAINT conversation_item_id_session_unique UNIQUE (id, session_id),
    CONSTRAINT conversation_item_session_sequence_unique UNIQUE (session_id, sequence_no),
    CONSTRAINT conversation_item_session_fk FOREIGN KEY (session_id)
        REFERENCES conversation.session(id) ON DELETE CASCADE,
    CONSTRAINT conversation_item_sequence_check CHECK (sequence_no >= 1),
    CONSTRAINT conversation_item_type_check CHECK (
        item_type IN (
            'USER_MESSAGE',
            'AI_MESSAGE',
            'AGENT_MESSAGE',
            'INTERNAL_NOTE',
            'SYSTEM_EVENT',
            'TICKET_EVENT',
            'DELIVERY_STATUS',
            'HANDOFF_EVENT'
        )
    ),
    CONSTRAINT conversation_item_sender_kind_check CHECK (
        sender_kind IN ('USER', 'AI', 'AGENT', 'SYSTEM', 'TOOL')
    ),
    CONSTRAINT conversation_item_visibility_check CHECK (
        visibility IN ('EXTERNAL', 'INTERNAL', 'RESTRICTED')
    ),
    CONSTRAINT conversation_item_text_length_check CHECK (
        text IS NULL OR char_length(text) <= 20000
    ),
    CONSTRAINT conversation_item_safe_content_check CHECK (
        jsonb_typeof(safe_content) = 'object'
    ),
    CONSTRAINT conversation_item_source_type_check CHECK (
        source_type IN (
            'CHANNEL_MESSAGE',
            'COMMUNICATION_MESSAGE',
            'TICKET_EVENT',
            'DELIVERY',
            'HANDOFF_EVENT'
        )
    ),
    CONSTRAINT conversation_item_source_id_length_check CHECK (
        char_length(source_id) BETWEEN 1 AND 256
    ),
    CONSTRAINT conversation_item_projection_variant_check CHECK (
        char_length(projection_variant) BETWEEN 1 AND 64
        AND projection_variant ~ '^[A-Z][A-Z0-9_]{0,63}$'
    ),
    CONSTRAINT conversation_item_canonical_order_key_length_check CHECK (
        char_length(canonical_order_key) BETWEEN 1 AND 1024
    ),
    CONSTRAINT conversation_item_content_hash_check CHECK (
        content_hash ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT conversation_item_privacy_class_check CHECK (
        privacy_class IN (
            'PUBLIC',
            'INTERNAL',
            'SENSITIVE_INTERNAL',
            'PERSONAL',
            'PATIENT_SENSITIVE',
            'SECRET'
        )
    )
);

-- Validate the parent-facing Item shape before creating a Binding FK. This
-- turns a pre-existing incompatible Item table into the stable drift error
-- instead of leaking a PostgreSQL FK/type error.
DO $p2_002_item_dependency_contract$
DECLARE
    item_relation OID := to_regclass('conversation.item');
    dependency_valid BOOLEAN := TRUE;
BEGIN
    IF item_relation IS NULL OR NOT COALESCE((
        SELECT relation.relkind = 'r' AND relation.relpersistence = 'p'
          FROM pg_class AS relation
         WHERE relation.oid = item_relation
    ), FALSE) THEN
        dependency_valid := FALSE;
    END IF;

    IF EXISTS (
        WITH expected(column_name, data_type, is_not_null) AS (
            VALUES
                ('id', 'uuid', TRUE),
                ('session_id', 'uuid', TRUE),
                ('sequence_no', 'bigint', TRUE),
                ('item_type', 'text', TRUE),
                ('sender_kind', 'text', TRUE),
                ('visibility', 'text', TRUE),
                ('text', 'text', FALSE),
                ('safe_content', 'jsonb', TRUE),
                ('source_type', 'text', TRUE),
                ('source_id', 'text', TRUE),
                ('projection_variant', 'text', TRUE),
                ('canonical_order_key', 'text', TRUE),
                ('content_hash', 'text', TRUE),
                ('privacy_class', 'text', TRUE),
                ('retention_until', 'timestamp with time zone', TRUE),
                ('occurred_at', 'timestamp with time zone', TRUE),
                ('projected_at', 'timestamp with time zone', TRUE)
        ), actual AS (
            SELECT attribute.attname::text AS column_name,
                   format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
                   attribute.attnotnull AS is_not_null,
                   attribute.attidentity::text AS identity_kind,
                   attribute.attgenerated::text AS generated_kind
              FROM pg_attribute AS attribute
             WHERE attribute.attrelid = item_relation
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
            OR actual.identity_kind IS DISTINCT FROM ''
            OR actual.generated_kind IS DISTINCT FROM ''
    ) THEN
        dependency_valid := FALSE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint AS constraint_record
          JOIN pg_index AS index_record
            ON index_record.indexrelid = constraint_record.conindid
          JOIN pg_class AS index_relation
            ON index_relation.oid = index_record.indexrelid
          JOIN pg_am AS index_method
            ON index_method.oid = index_relation.relam
         WHERE constraint_record.conrelid = item_relation
           AND constraint_record.conname = 'conversation_item_pkey'
           AND constraint_record.contype = 'p'
           AND constraint_record.convalidated
           AND NOT constraint_record.condeferrable
           AND NOT constraint_record.condeferred
           AND index_method.amname = 'btree'
           AND index_record.indisvalid
           AND index_record.indisready
           AND index_record.indimmediate
           AND ARRAY(
               SELECT attribute.attname
                 FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, position)
                 JOIN pg_attribute AS attribute
                   ON attribute.attrelid = item_relation
                  AND attribute.attnum = key_column.attnum
                ORDER BY key_column.position
           ) = ARRAY['id']::name[]
    ) THEN
        dependency_valid := FALSE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint AS constraint_record
          JOIN pg_index AS index_record
            ON index_record.indexrelid = constraint_record.conindid
          JOIN pg_class AS index_relation
            ON index_relation.oid = index_record.indexrelid
          JOIN pg_am AS index_method
            ON index_method.oid = index_relation.relam
         WHERE constraint_record.conrelid = item_relation
           AND constraint_record.conname = 'conversation_item_id_session_unique'
           AND constraint_record.contype = 'u'
           AND constraint_record.convalidated
           AND NOT constraint_record.condeferrable
           AND NOT constraint_record.condeferred
           AND index_method.amname = 'btree'
           AND index_record.indisvalid
           AND index_record.indisready
           AND index_record.indimmediate
           AND ARRAY(
               SELECT attribute.attname
                 FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, position)
                 JOIN pg_attribute AS attribute
                   ON attribute.attrelid = item_relation
                  AND attribute.attnum = key_column.attnum
                ORDER BY key_column.position
           ) = ARRAY['id', 'session_id']::name[]
    ) THEN
        dependency_valid := FALSE;
    END IF;

    IF NOT dependency_valid THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;
END
$p2_002_item_dependency_contract$;

CREATE TABLE IF NOT EXISTS conversation.item_source_binding (
    projector_name TEXT NOT NULL,
    projector_version TEXT NOT NULL,
    source_stream TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    projection_variant TEXT NOT NULL,
    session_id UUID NOT NULL,
    item_id UUID NOT NULL,
    source_hash TEXT NOT NULL,
    canonical_order_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT conversation_item_source_binding_pkey PRIMARY KEY (item_id),
    CONSTRAINT conversation_item_source_binding_identity_unique UNIQUE (
        projector_name,
        source_stream,
        source_type,
        source_id,
        projection_variant,
        session_id
    ),
    CONSTRAINT conversation_item_source_binding_session_fk FOREIGN KEY (session_id)
        REFERENCES conversation.session(id) ON DELETE CASCADE,
    CONSTRAINT conversation_item_source_binding_item_session_fk FOREIGN KEY (item_id, session_id)
        REFERENCES conversation.item(id, session_id) ON DELETE CASCADE,
    CONSTRAINT conversation_item_source_binding_projector_name_length_check CHECK (
        char_length(projector_name) BETWEEN 1 AND 128
        AND projector_name ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    ),
    CONSTRAINT conversation_item_source_binding_projector_version_length_check CHECK (
        char_length(projector_version) BETWEEN 1 AND 64
        AND projector_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'
    ),
    CONSTRAINT conversation_item_source_binding_source_stream_length_check CHECK (
        char_length(source_stream) BETWEEN 1 AND 128
        AND source_stream ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    ),
    CONSTRAINT conversation_item_source_binding_source_type_check CHECK (
        source_type IN (
            'CHANNEL_MESSAGE',
            'COMMUNICATION_MESSAGE',
            'TICKET_EVENT',
            'DELIVERY',
            'HANDOFF_EVENT'
        )
    ),
    CONSTRAINT conversation_item_source_binding_source_id_length_check CHECK (
        char_length(source_id) BETWEEN 1 AND 256
    ),
    CONSTRAINT conversation_item_source_binding_projection_variant_check CHECK (
        char_length(projection_variant) BETWEEN 1 AND 64
        AND projection_variant ~ '^[A-Z][A-Z0-9_]{0,63}$'
    ),
    CONSTRAINT conversation_item_source_binding_source_hash_check CHECK (
        source_hash ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT conversation_item_source_binding_order_key_length_check CHECK (
        char_length(canonical_order_key) BETWEEN 1 AND 1024
    ),
    CONSTRAINT conversation_item_source_binding_seen_time_check CHECK (
        last_seen_at >= created_at
    )
);

CREATE TABLE IF NOT EXISTS conversation.projection_checkpoint (
    projector_name TEXT NOT NULL,
    projector_version TEXT NOT NULL,
    source_stream TEXT NOT NULL,
    cursor_value TEXT,
    last_source_occurred_at TIMESTAMPTZ,
    last_batch_hash TEXT,
    row_version BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT conversation_projection_checkpoint_pkey PRIMARY KEY (
        projector_name,
        source_stream
    ),
    CONSTRAINT conversation_projection_checkpoint_projector_name_length_check CHECK (
        char_length(projector_name) BETWEEN 1 AND 128
        AND projector_name ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    ),
    CONSTRAINT conversation_projection_checkpoint_version_length_check CHECK (
        char_length(projector_version) BETWEEN 1 AND 64
        AND projector_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'
    ),
    CONSTRAINT conversation_projection_checkpoint_source_stream_length_check CHECK (
        char_length(source_stream) BETWEEN 1 AND 128
        AND source_stream ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    ),
    CONSTRAINT conversation_projection_checkpoint_cursor_length_check CHECK (
        cursor_value IS NULL OR char_length(cursor_value) BETWEEN 1 AND 512
    ),
    CONSTRAINT conversation_projection_checkpoint_batch_hash_check CHECK (
        last_batch_hash IS NULL OR last_batch_hash ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT conversation_projection_checkpoint_row_version_check CHECK (
        row_version >= 1
    )
);

DO $p2_002_relation_contract$
DECLARE
    item_relation OID := to_regclass('conversation.item');
    binding_relation OID := to_regclass('conversation.item_source_binding');
    checkpoint_relation OID := to_regclass('conversation.projection_checkpoint');
    session_relation OID := to_regclass('conversation.session');
    contract_valid BOOLEAN := TRUE;
BEGIN
    IF item_relation IS NULL OR binding_relation IS NULL OR checkpoint_relation IS NULL THEN
        contract_valid := FALSE;
    END IF;

    IF NOT COALESCE((
        SELECT relation.relkind = 'r' AND relation.relpersistence = 'p'
          FROM pg_class AS relation
         WHERE relation.oid = item_relation
    ), FALSE) OR NOT COALESCE((
        SELECT relation.relkind = 'r' AND relation.relpersistence = 'p'
          FROM pg_class AS relation
         WHERE relation.oid = binding_relation
    ), FALSE) OR NOT COALESCE((
        SELECT relation.relkind = 'r' AND relation.relpersistence = 'p'
          FROM pg_class AS relation
         WHERE relation.oid = checkpoint_relation
    ), FALSE) THEN
        contract_valid := FALSE;
    END IF;

    IF EXISTS (
        WITH expected(relation_oid, column_name, data_type, is_not_null) AS (
            VALUES
                (item_relation, 'id', 'uuid', TRUE),
                (item_relation, 'session_id', 'uuid', TRUE),
                (item_relation, 'sequence_no', 'bigint', TRUE),
                (item_relation, 'item_type', 'text', TRUE),
                (item_relation, 'sender_kind', 'text', TRUE),
                (item_relation, 'visibility', 'text', TRUE),
                (item_relation, 'text', 'text', FALSE),
                (item_relation, 'safe_content', 'jsonb', TRUE),
                (item_relation, 'source_type', 'text', TRUE),
                (item_relation, 'source_id', 'text', TRUE),
                (item_relation, 'projection_variant', 'text', TRUE),
                (item_relation, 'canonical_order_key', 'text', TRUE),
                (item_relation, 'content_hash', 'text', TRUE),
                (item_relation, 'privacy_class', 'text', TRUE),
                (item_relation, 'retention_until', 'timestamp with time zone', TRUE),
                (item_relation, 'occurred_at', 'timestamp with time zone', TRUE),
                (item_relation, 'projected_at', 'timestamp with time zone', TRUE),
                (binding_relation, 'projector_name', 'text', TRUE),
                (binding_relation, 'projector_version', 'text', TRUE),
                (binding_relation, 'source_stream', 'text', TRUE),
                (binding_relation, 'source_type', 'text', TRUE),
                (binding_relation, 'source_id', 'text', TRUE),
                (binding_relation, 'projection_variant', 'text', TRUE),
                (binding_relation, 'session_id', 'uuid', TRUE),
                (binding_relation, 'item_id', 'uuid', TRUE),
                (binding_relation, 'source_hash', 'text', TRUE),
                (binding_relation, 'canonical_order_key', 'text', TRUE),
                (binding_relation, 'created_at', 'timestamp with time zone', TRUE),
                (binding_relation, 'last_seen_at', 'timestamp with time zone', TRUE),
                (checkpoint_relation, 'projector_name', 'text', TRUE),
                (checkpoint_relation, 'projector_version', 'text', TRUE),
                (checkpoint_relation, 'source_stream', 'text', TRUE),
                (checkpoint_relation, 'cursor_value', 'text', FALSE),
                (checkpoint_relation, 'last_source_occurred_at', 'timestamp with time zone', FALSE),
                (checkpoint_relation, 'last_batch_hash', 'text', FALSE),
                (checkpoint_relation, 'row_version', 'bigint', TRUE),
                (checkpoint_relation, 'updated_at', 'timestamp with time zone', TRUE)
        ), actual AS (
            SELECT attribute.attrelid AS relation_oid,
                   attribute.attname::text AS column_name,
                   format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
                   attribute.attnotnull AS is_not_null,
                   attribute.attidentity::text AS identity_kind,
                   attribute.attgenerated::text AS generated_kind
              FROM pg_attribute AS attribute
             WHERE attribute.attrelid IN (item_relation, binding_relation, checkpoint_relation)
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
                (item_relation, 'id', 'uuidv7()'),
                (item_relation, 'safe_content', '''{}''::jsonb'),
                (item_relation, 'projected_at', 'CURRENT_TIMESTAMP'),
                (binding_relation, 'created_at', 'CURRENT_TIMESTAMP'),
                (binding_relation, 'last_seen_at', 'CURRENT_TIMESTAMP'),
                (checkpoint_relation, 'row_version', '1'),
                (checkpoint_relation, 'updated_at', 'CURRENT_TIMESTAMP')
        ), actual AS (
            SELECT attribute.attrelid AS relation_oid,
                   attribute.attname::text AS column_name,
                   pg_get_expr(attribute_default.adbin, attribute_default.adrelid) AS default_expression
              FROM pg_attribute AS attribute
              JOIN pg_attrdef AS attribute_default
                ON attribute_default.adrelid = attribute.attrelid
               AND attribute_default.adnum = attribute.attnum
             WHERE attribute.attrelid IN (item_relation, binding_relation, checkpoint_relation)
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
           AND count(*) FILTER (WHERE constraint_record.contype = 'f') = 1
           AND count(*) FILTER (WHERE constraint_record.contype = 'c') = 12
          FROM pg_constraint AS constraint_record
         WHERE constraint_record.conrelid = item_relation
    ) OR NOT (
        SELECT count(*) FILTER (WHERE constraint_record.contype = 'p') = 1
           AND count(*) FILTER (WHERE constraint_record.contype = 'u') = 1
           AND count(*) FILTER (WHERE constraint_record.contype = 'f') = 2
           AND count(*) FILTER (WHERE constraint_record.contype = 'c') = 9
          FROM pg_constraint AS constraint_record
         WHERE constraint_record.conrelid = binding_relation
    ) OR NOT (
        SELECT count(*) FILTER (WHERE constraint_record.contype = 'p') = 1
           AND count(*) FILTER (WHERE constraint_record.contype = 'c') = 6
          FROM pg_constraint AS constraint_record
         WHERE constraint_record.conrelid = checkpoint_relation
    ) THEN
        contract_valid := FALSE;
    END IF;

    IF EXISTS (
        WITH expected(relation_oid, constraint_name, constraint_type, key_columns) AS (
            VALUES
                (item_relation, 'conversation_item_pkey', 'p', ARRAY['id']::name[]),
                (item_relation, 'conversation_item_id_session_unique', 'u', ARRAY['id', 'session_id']::name[]),
                (item_relation, 'conversation_item_session_sequence_unique', 'u', ARRAY['session_id', 'sequence_no']::name[]),
                (binding_relation, 'conversation_item_source_binding_pkey', 'p', ARRAY['item_id']::name[]),
                (binding_relation, 'conversation_item_source_binding_identity_unique', 'u', ARRAY[
                    'projector_name',
                    'source_stream',
                    'source_type',
                    'source_id',
                    'projection_variant',
                    'session_id'
                ]::name[]),
                (checkpoint_relation, 'conversation_projection_checkpoint_pkey', 'p', ARRAY['projector_name', 'source_stream']::name[])
        )
        SELECT 1
          FROM expected
          LEFT JOIN pg_constraint AS constraint_record
            ON constraint_record.conrelid = expected.relation_oid
           AND constraint_record.conname = expected.constraint_name
           AND constraint_record.contype::text = expected.constraint_type
          LEFT JOIN pg_index AS index_record
            ON index_record.indexrelid = constraint_record.conindid
          LEFT JOIN pg_class AS index_relation
            ON index_relation.oid = index_record.indexrelid
          LEFT JOIN pg_am AS index_method
            ON index_method.oid = index_relation.relam
         WHERE constraint_record.oid IS NULL
            OR NOT constraint_record.convalidated
            OR constraint_record.condeferrable
            OR constraint_record.condeferred
            OR index_method.amname IS DISTINCT FROM 'btree'
            OR NOT COALESCE(index_record.indisvalid, FALSE)
            OR NOT COALESCE(index_record.indisready, FALSE)
            OR NOT COALESCE(index_record.indislive, FALSE)
            OR NOT COALESCE(index_record.indimmediate, FALSE)
            OR NOT COALESCE(index_record.indisunique, FALSE)
            OR COALESCE(index_record.indnullsnotdistinct, FALSE)
            OR index_record.indpred IS NOT NULL
            OR index_record.indexprs IS NOT NULL
            OR index_record.indnatts IS DISTINCT FROM index_record.indnkeyatts
            OR index_record.indnkeyatts IS DISTINCT FROM array_length(expected.key_columns, 1)
            OR ARRAY(
                SELECT attribute.attname
                  FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, position)
                  JOIN pg_attribute AS attribute
                    ON attribute.attrelid = expected.relation_oid
                   AND attribute.attnum = key_column.attnum
                 ORDER BY key_column.position
            ) IS DISTINCT FROM expected.key_columns
    ) THEN
        contract_valid := FALSE;
    END IF;

    IF EXISTS (
        WITH expected(
            relation_oid,
            constraint_name,
            referenced_relation_oid,
            key_columns,
            referenced_columns,
            delete_action
        ) AS (
            VALUES
                (item_relation, 'conversation_item_session_fk', session_relation, ARRAY['session_id']::name[], ARRAY['id']::name[], 'c'),
                (binding_relation, 'conversation_item_source_binding_session_fk', session_relation, ARRAY['session_id']::name[], ARRAY['id']::name[], 'c'),
                (binding_relation, 'conversation_item_source_binding_item_session_fk', item_relation, ARRAY['item_id', 'session_id']::name[], ARRAY['id', 'session_id']::name[], 'c')
        )
        SELECT 1
          FROM expected
          LEFT JOIN pg_constraint AS constraint_record
            ON constraint_record.conrelid = expected.relation_oid
           AND constraint_record.conname = expected.constraint_name
           AND constraint_record.contype = 'f'
         WHERE constraint_record.oid IS NULL
            OR NOT constraint_record.convalidated
            OR constraint_record.condeferrable
            OR constraint_record.condeferred
            OR constraint_record.confrelid IS DISTINCT FROM expected.referenced_relation_oid
            OR constraint_record.confupdtype::text IS DISTINCT FROM 'a'
            OR constraint_record.confdeltype::text IS DISTINCT FROM expected.delete_action
            OR constraint_record.confmatchtype::text IS DISTINCT FROM 's'
            OR ARRAY(
                SELECT attribute.attname
                  FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, position)
                  JOIN pg_attribute AS attribute
                    ON attribute.attrelid = expected.relation_oid
                   AND attribute.attnum = key_column.attnum
                 ORDER BY key_column.position
            ) IS DISTINCT FROM expected.key_columns
            OR ARRAY(
                SELECT attribute.attname
                  FROM unnest(constraint_record.confkey) WITH ORDINALITY AS key_column(attnum, position)
                  JOIN pg_attribute AS attribute
                    ON attribute.attrelid = expected.referenced_relation_oid
                   AND attribute.attnum = key_column.attnum
                 ORDER BY key_column.position
            ) IS DISTINCT FROM expected.referenced_columns
    ) THEN
        contract_valid := FALSE;
    END IF;

    IF EXISTS (
        WITH expected(relation_oid, constraint_name, constraint_expression) AS (
            VALUES
                (item_relation, 'conversation_item_sequence_check', '(sequence_no >= 1)'),
                (item_relation, 'conversation_item_type_check', '(item_type = ANY (ARRAY[''USER_MESSAGE''::text, ''AI_MESSAGE''::text, ''AGENT_MESSAGE''::text, ''INTERNAL_NOTE''::text, ''SYSTEM_EVENT''::text, ''TICKET_EVENT''::text, ''DELIVERY_STATUS''::text, ''HANDOFF_EVENT''::text]))'),
                (item_relation, 'conversation_item_sender_kind_check', '(sender_kind = ANY (ARRAY[''USER''::text, ''AI''::text, ''AGENT''::text, ''SYSTEM''::text, ''TOOL''::text]))'),
                (item_relation, 'conversation_item_visibility_check', '(visibility = ANY (ARRAY[''EXTERNAL''::text, ''INTERNAL''::text, ''RESTRICTED''::text]))'),
                (item_relation, 'conversation_item_text_length_check', '((text IS NULL) OR (char_length(text) <= 20000))'),
                (item_relation, 'conversation_item_safe_content_check', '(jsonb_typeof(safe_content) = ''object''::text)'),
                (item_relation, 'conversation_item_source_type_check', '(source_type = ANY (ARRAY[''CHANNEL_MESSAGE''::text, ''COMMUNICATION_MESSAGE''::text, ''TICKET_EVENT''::text, ''DELIVERY''::text, ''HANDOFF_EVENT''::text]))'),
                (item_relation, 'conversation_item_source_id_length_check', '((char_length(source_id) >= 1) AND (char_length(source_id) <= 256))'),
                (item_relation, 'conversation_item_projection_variant_check', '(((char_length(projection_variant) >= 1) AND (char_length(projection_variant) <= 64)) AND (projection_variant ~ ''^[A-Z][A-Z0-9_]{0,63}$''::text))'),
                (item_relation, 'conversation_item_canonical_order_key_length_check', '((char_length(canonical_order_key) >= 1) AND (char_length(canonical_order_key) <= 1024))'),
                (item_relation, 'conversation_item_content_hash_check', '(content_hash ~ ''^[a-f0-9]{64}$''::text)'),
                (item_relation, 'conversation_item_privacy_class_check', '(privacy_class = ANY (ARRAY[''PUBLIC''::text, ''INTERNAL''::text, ''SENSITIVE_INTERNAL''::text, ''PERSONAL''::text, ''PATIENT_SENSITIVE''::text, ''SECRET''::text]))'),
                (binding_relation, 'conversation_item_source_binding_projector_name_length_check', '(((char_length(projector_name) >= 1) AND (char_length(projector_name) <= 128)) AND (projector_name ~ ''^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$''::text))'),
                (binding_relation, 'conversation_item_source_binding_projector_version_length_check', '(((char_length(projector_version) >= 1) AND (char_length(projector_version) <= 64)) AND (projector_version ~ ''^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$''::text))'),
                (binding_relation, 'conversation_item_source_binding_source_stream_length_check', '(((char_length(source_stream) >= 1) AND (char_length(source_stream) <= 128)) AND (source_stream ~ ''^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$''::text))'),
                (binding_relation, 'conversation_item_source_binding_source_type_check', '(source_type = ANY (ARRAY[''CHANNEL_MESSAGE''::text, ''COMMUNICATION_MESSAGE''::text, ''TICKET_EVENT''::text, ''DELIVERY''::text, ''HANDOFF_EVENT''::text]))'),
                (binding_relation, 'conversation_item_source_binding_source_id_length_check', '((char_length(source_id) >= 1) AND (char_length(source_id) <= 256))'),
                (binding_relation, 'conversation_item_source_binding_projection_variant_check', '(((char_length(projection_variant) >= 1) AND (char_length(projection_variant) <= 64)) AND (projection_variant ~ ''^[A-Z][A-Z0-9_]{0,63}$''::text))'),
                (binding_relation, 'conversation_item_source_binding_source_hash_check', '(source_hash ~ ''^[a-f0-9]{64}$''::text)'),
                (binding_relation, 'conversation_item_source_binding_order_key_length_check', '((char_length(canonical_order_key) >= 1) AND (char_length(canonical_order_key) <= 1024))'),
                (binding_relation, 'conversation_item_source_binding_seen_time_check', '(last_seen_at >= created_at)'),
                (checkpoint_relation, 'conversation_projection_checkpoint_projector_name_length_check', '(((char_length(projector_name) >= 1) AND (char_length(projector_name) <= 128)) AND (projector_name ~ ''^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$''::text))'),
                (checkpoint_relation, 'conversation_projection_checkpoint_version_length_check', '(((char_length(projector_version) >= 1) AND (char_length(projector_version) <= 64)) AND (projector_version ~ ''^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$''::text))'),
                (checkpoint_relation, 'conversation_projection_checkpoint_source_stream_length_check', '(((char_length(source_stream) >= 1) AND (char_length(source_stream) <= 128)) AND (source_stream ~ ''^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$''::text))'),
                (checkpoint_relation, 'conversation_projection_checkpoint_cursor_length_check', '((cursor_value IS NULL) OR ((char_length(cursor_value) >= 1) AND (char_length(cursor_value) <= 512)))'),
                (checkpoint_relation, 'conversation_projection_checkpoint_batch_hash_check', '((last_batch_hash IS NULL) OR (last_batch_hash ~ ''^[a-f0-9]{64}$''::text))'),
                (checkpoint_relation, 'conversation_projection_checkpoint_row_version_check', '(row_version >= 1)')
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
            MESSAGE = 'P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;
END
$p2_002_relation_contract$;

CREATE INDEX IF NOT EXISTS conversation_item_external_timeline_idx
    ON conversation.item (session_id, sequence_no)
    WHERE visibility = 'EXTERNAL';

CREATE INDEX IF NOT EXISTS conversation_item_retention_idx
    ON conversation.item (retention_until);

CREATE INDEX IF NOT EXISTS conversation_item_source_binding_session_order_idx
    ON conversation.item_source_binding (session_id, canonical_order_key);

DO $p2_002_index_contract$
DECLARE
    item_relation OID := to_regclass('conversation.item');
    binding_relation OID := to_regclass('conversation.item_source_binding');
    checkpoint_relation OID := to_regclass('conversation.projection_checkpoint');
    index_valid BOOLEAN := TRUE;
BEGIN
    IF NOT (
        SELECT count(*) = 5
          FROM pg_index AS index_record
         WHERE index_record.indrelid = item_relation
    ) OR NOT (
        SELECT count(*) = 3
          FROM pg_index AS index_record
         WHERE index_record.indrelid = binding_relation
    ) OR NOT (
        SELECT count(*) = 1
          FROM pg_index AS index_record
         WHERE index_record.indrelid = checkpoint_relation
    ) THEN
        index_valid := FALSE;
    END IF;

    IF EXISTS (
        WITH expected(
            relation_oid,
            index_name,
            is_unique,
            is_primary,
            key_columns,
            predicate_expression
        ) AS (
            VALUES
                (item_relation, 'conversation_item_pkey', TRUE, TRUE, ARRAY['id']::name[], NULL::text),
                (item_relation, 'conversation_item_id_session_unique', TRUE, FALSE, ARRAY['id', 'session_id']::name[], NULL::text),
                (item_relation, 'conversation_item_session_sequence_unique', TRUE, FALSE, ARRAY['session_id', 'sequence_no']::name[], NULL::text),
                (item_relation, 'conversation_item_external_timeline_idx', FALSE, FALSE, ARRAY['session_id', 'sequence_no']::name[], '(visibility=''EXTERNAL''::text)'),
                (item_relation, 'conversation_item_retention_idx', FALSE, FALSE, ARRAY['retention_until']::name[], NULL::text),
                (binding_relation, 'conversation_item_source_binding_pkey', TRUE, TRUE, ARRAY['item_id']::name[], NULL::text),
                (binding_relation, 'conversation_item_source_binding_identity_unique', TRUE, FALSE, ARRAY[
                    'projector_name',
                    'source_stream',
                    'source_type',
                    'source_id',
                    'projection_variant',
                    'session_id'
                ]::name[], NULL::text),
                (binding_relation, 'conversation_item_source_binding_session_order_idx', FALSE, FALSE, ARRAY['session_id', 'canonical_order_key']::name[], NULL::text),
                (checkpoint_relation, 'conversation_projection_checkpoint_pkey', TRUE, TRUE, ARRAY['projector_name', 'source_stream']::name[], NULL::text)
        )
        SELECT 1
          FROM expected
          LEFT JOIN pg_class AS index_relation
            ON index_relation.relname = expected.index_name
           AND index_relation.relnamespace = 'conversation'::regnamespace
          LEFT JOIN pg_index AS index_record
            ON index_record.indexrelid = index_relation.oid
           AND index_record.indrelid = expected.relation_oid
          LEFT JOIN pg_am AS index_method
            ON index_method.oid = index_relation.relam
         WHERE index_record.indexrelid IS NULL
            OR index_method.amname IS DISTINCT FROM 'btree'
            OR NOT index_record.indisvalid
            OR NOT index_record.indisready
            OR NOT index_record.indislive
            OR NOT index_record.indimmediate
            OR index_record.indisunique IS DISTINCT FROM expected.is_unique
            OR index_record.indisprimary IS DISTINCT FROM expected.is_primary
            OR index_record.indnullsnotdistinct
            OR index_record.indexprs IS NOT NULL
            OR index_record.indnatts IS DISTINCT FROM index_record.indnkeyatts
            OR index_record.indnkeyatts IS DISTINCT FROM array_length(expected.key_columns, 1)
            OR EXISTS (
                SELECT 1
                  FROM unnest(index_record.indoption::smallint[]) AS index_option(option_value)
                 WHERE index_option.option_value <> 0
            )
            OR ARRAY(
                SELECT attribute.attname
                  FROM unnest(index_record.indkey::smallint[]) WITH ORDINALITY AS key_column(attnum, position)
                  JOIN pg_attribute AS attribute
                    ON attribute.attrelid = expected.relation_oid
                   AND attribute.attnum = key_column.attnum
                 ORDER BY key_column.position
            ) IS DISTINCT FROM expected.key_columns
            OR (
                expected.predicate_expression IS NULL
                AND index_record.indpred IS NOT NULL
            )
            OR (
                expected.predicate_expression IS NOT NULL
                AND (
                    index_record.indpred IS NULL
                    OR regexp_replace(
                        pg_get_expr(index_record.indpred, index_record.indrelid),
                        '\s+',
                        '',
                        'g'
                    ) IS DISTINCT FROM expected.predicate_expression
                )
            )
    ) THEN
        index_valid := FALSE;
    END IF;

    IF NOT index_valid THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;
END
$p2_002_index_contract$;

COMMENT ON TABLE conversation.item IS
    'P2-002 rebuildable Session timeline read model. Source facts remain authoritative.';
COMMENT ON COLUMN conversation.item.safe_content IS
    'Safe normalized JSON object only; raw provider payloads and identifiers are prohibited.';
COMMENT ON COLUMN conversation.item.content_hash IS
    'Lowercase SHA-256 of canonical Item content; it excludes projection timestamps and generated UUIDs.';
COMMENT ON TABLE conversation.item_source_binding IS
    'P2-002 idempotency authority mapping one source identity and hash to one rebuildable Item.';
COMMENT ON COLUMN conversation.item_source_binding.source_hash IS
    'Lowercase SHA-256 of the normalized safe source record used for replay/conflict detection.';
COMMENT ON TABLE conversation.projection_checkpoint IS
    'P2-002 scan optimization by Projector and source stream; Binding remains the replay authority.';

COMMIT;
