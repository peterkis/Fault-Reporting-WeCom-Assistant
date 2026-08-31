BEGIN;

DO $p2_003_prerequisite_contract$
DECLARE
    conversation_namespace OID := to_regnamespace('conversation');
    thread_relation OID := to_regclass('conversation.thread');
    session_relation OID := to_regclass('conversation.session');
    event_relation OID := to_regclass('conversation.realtime_event');
    state_relation OID := to_regclass('conversation.realtime_stream_state');
    visibility_index OID := to_regclass(
        'conversation.conversation_realtime_event_visibility_event_idx'
    );
    authorization_scope_index OID := to_regclass(
        'conversation.conversation_realtime_event_authorization_scope_event_idx'
    );
    expiry_index OID := to_regclass(
        'conversation.conversation_realtime_event_expiry_event_idx'
    );
BEGIN
    IF NOT (
        (
            event_relation IS NULL
            AND state_relation IS NULL
            AND visibility_index IS NULL
            AND authorization_scope_index IS NULL
            AND expiry_index IS NULL
        )
        OR (
            event_relation IS NOT NULL
            AND state_relation IS NOT NULL
            AND visibility_index IS NOT NULL
            AND authorization_scope_index IS NOT NULL
            AND expiry_index IS NOT NULL
        )
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'P2_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;

    IF conversation_namespace IS NULL
       OR thread_relation IS NULL
       OR session_relation IS NULL
       OR NOT COALESCE((
            SELECT relation.relkind = 'r' AND relation.relpersistence = 'p'
              FROM pg_class AS relation
             WHERE relation.oid = thread_relation
       ), FALSE)
       OR NOT COALESCE((
            SELECT relation.relkind = 'r' AND relation.relpersistence = 'p'
              FROM pg_class AS relation
             WHERE relation.oid = session_relation
       ), FALSE)
       OR EXISTS (
            WITH expected(relation_oid, column_name) AS (
                VALUES
                    (thread_relation, 'id'),
                    (session_relation, 'id')
            )
            SELECT 1
              FROM expected
              LEFT JOIN pg_attribute AS attribute
                ON attribute.attrelid = expected.relation_oid
               AND attribute.attname = expected.column_name
               AND attribute.attnum > 0
               AND NOT attribute.attisdropped
             WHERE attribute.attnum IS NULL
                OR format_type(attribute.atttypid, attribute.atttypmod) <> 'uuid'
                OR NOT attribute.attnotnull
       )
       OR EXISTS (
            WITH expected(relation_oid) AS (
                VALUES (thread_relation), (session_relation)
            )
            SELECT 1
              FROM expected
             WHERE NOT EXISTS (
                SELECT 1
                  FROM pg_constraint AS constraint_record
                  JOIN pg_index AS index_record
                    ON index_record.indexrelid = constraint_record.conindid
                  JOIN pg_class AS index_relation
                    ON index_relation.oid = index_record.indexrelid
                  JOIN pg_am AS index_method
                    ON index_method.oid = index_relation.relam
                 WHERE constraint_record.conrelid = expected.relation_oid
                   AND constraint_record.contype = 'p'
                   AND constraint_record.convalidated
                   AND NOT constraint_record.condeferrable
                   AND NOT constraint_record.condeferred
                   AND index_method.amname = 'btree'
                   AND index_record.indisvalid
                   AND index_record.indisready
                   AND index_record.indislive
                   AND index_record.indimmediate
                   AND ARRAY(
                       SELECT attribute.attname
                         FROM unnest(constraint_record.conkey)
                           WITH ORDINALITY AS key_column(attnum, position)
                         JOIN pg_attribute AS attribute
                           ON attribute.attrelid = expected.relation_oid
                          AND attribute.attnum = key_column.attnum
                        ORDER BY key_column.position
                   ) = ARRAY['id']::name[]
             )
       ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'P2_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;
END
$p2_003_prerequisite_contract$;

CREATE TABLE IF NOT EXISTS conversation.realtime_event (
    event_id BIGINT GENERATED ALWAYS AS IDENTITY,
    event_key TEXT NOT NULL,
    stream_name TEXT NOT NULL,
    publisher_name TEXT NOT NULL,
    publisher_version TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    event_variant TEXT NOT NULL,
    event_type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    aggregate_version BIGINT,
    authorization_scope_type TEXT NOT NULL,
    authorization_scope_id UUID,
    visibility_scope TEXT NOT NULL,
    payload JSONB NOT NULL,
    payload_hash TEXT NOT NULL,
    event_hash TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT conversation_realtime_event_pkey PRIMARY KEY (event_id),
    CONSTRAINT conversation_realtime_event_event_key_unique UNIQUE (event_key),
    CONSTRAINT conversation_realtime_event_event_key_check CHECK (
        event_key ~ '^rte_v1_[a-f0-9]{64}$'
    ),
    CONSTRAINT conversation_realtime_event_stream_name_check CHECK (
        stream_name = 'CONVERSATION_WORKBENCH'
    ),
    CONSTRAINT conversation_realtime_event_publisher_name_check CHECK (
        char_length(publisher_name) BETWEEN 1 AND 64
        AND publisher_name ~ '^[A-Z][A-Z0-9_.-]{0,63}$'
    ),
    CONSTRAINT conversation_realtime_event_publisher_version_check CHECK (
        char_length(publisher_version) BETWEEN 1 AND 64
        AND publisher_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'
    ),
    CONSTRAINT conversation_realtime_event_source_type_check CHECK (
        source_type IN (
            'CONVERSATION_SESSION',
            'CONVERSATION_ITEM',
            'TIMELINE_REBUILD',
            'COMMUNICATION_DELIVERY',
            'TICKET_EVENT',
            'HANDOFF_EVENT',
            'READ_CURSOR',
            'INCIDENT_EVENT',
            'GATEWAY_EVENT'
        )
    ),
    CONSTRAINT conversation_realtime_event_source_id_check CHECK (
        char_length(source_id) BETWEEN 1 AND 256
        AND source_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'
    ),
    CONSTRAINT conversation_realtime_event_variant_check CHECK (
        char_length(event_variant) BETWEEN 1 AND 64
        AND event_variant ~ '^[A-Z][A-Z0-9_]{0,63}$'
    ),
    CONSTRAINT conversation_realtime_event_type_format_check CHECK (
        char_length(event_type) BETWEEN 1 AND 128
        AND event_type ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'
    ),
    CONSTRAINT conversation_realtime_event_type_vocabulary_check CHECK (
        event_type IN (
            'conversation.session.created',
            'conversation.session.updated',
            'conversation.item.created',
            'conversation.timeline.rebuilt',
            'conversation.mode.changed',
            'conversation.assigned',
            'conversation.handoff.requested',
            'conversation.handoff.accepted',
            'conversation.read_cursor.changed',
            'communication.delivery.changed',
            'ticket.updated',
            'incident.updated',
            'gateway.connection.changed'
        )
    ),
    CONSTRAINT conversation_realtime_event_aggregate_type_check CHECK (
        aggregate_type IN (
            'CONVERSATION_SESSION',
            'CONVERSATION_ITEM',
            'CONVERSATION_TIMELINE',
            'COMMUNICATION_DELIVERY',
            'TICKET',
            'CONVERSATION_HANDOFF',
            'CONVERSATION_READ_CURSOR',
            'INCIDENT',
            'GATEWAY_CONNECTION'
        )
    ),
    CONSTRAINT conversation_realtime_event_aggregate_id_check CHECK (
        char_length(aggregate_id) BETWEEN 1 AND 256
        AND aggregate_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'
    ),
    CONSTRAINT conversation_realtime_event_aggregate_version_check CHECK (
        aggregate_version IS NULL OR aggregate_version >= 0
    ),
    CONSTRAINT conversation_realtime_event_authorization_scope_type_check CHECK (
        authorization_scope_type IN ('SESSION', 'THREAD', 'SYSTEM')
    ),
    CONSTRAINT conversation_realtime_event_scope_consistency_check CHECK (
        (
            authorization_scope_type IN ('SESSION', 'THREAD')
            AND authorization_scope_id IS NOT NULL
        )
        OR (
            authorization_scope_type = 'SYSTEM'
            AND authorization_scope_id IS NULL
        )
    ),
    CONSTRAINT conversation_realtime_event_visibility_scope_check CHECK (
        visibility_scope IN ('WORKBENCH', 'RESTRICTED_ADMIN')
    ),
    CONSTRAINT conversation_realtime_event_payload_object_check CHECK (
        jsonb_typeof(payload) = 'object'
    ),
    CONSTRAINT conversation_realtime_event_payload_hash_check CHECK (
        payload_hash ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT conversation_realtime_event_event_hash_check CHECK (
        event_hash ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT conversation_realtime_event_expiry_check CHECK (
        expires_at > occurred_at
    )
);

CREATE TABLE IF NOT EXISTS conversation.realtime_stream_state (
    stream_name TEXT NOT NULL,
    retention_floor_event_id BIGINT NOT NULL DEFAULT 0,
    row_version BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT conversation_realtime_stream_state_pkey PRIMARY KEY (stream_name),
    CONSTRAINT conversation_realtime_stream_state_stream_name_check CHECK (
        stream_name = 'CONVERSATION_WORKBENCH'
    ),
    CONSTRAINT conversation_realtime_stream_state_retention_floor_check CHECK (
        retention_floor_event_id >= 0
    ),
    CONSTRAINT conversation_realtime_stream_state_row_version_check CHECK (
        row_version >= 1
    )
);

DO $p2_003_relation_contract$
DECLARE
    event_relation OID := to_regclass('conversation.realtime_event');
    state_relation OID := to_regclass('conversation.realtime_stream_state');
    event_id_attribute_number SMALLINT;
    identity_sequence OID;
    contract_valid BOOLEAN := TRUE;
BEGIN
    IF event_relation IS NULL OR state_relation IS NULL THEN
        contract_valid := FALSE;
    END IF;

    IF NOT COALESCE((
        SELECT relation.relkind = 'r' AND relation.relpersistence = 'p'
          FROM pg_class AS relation
         WHERE relation.oid = event_relation
    ), FALSE) OR NOT COALESCE((
        SELECT relation.relkind = 'r' AND relation.relpersistence = 'p'
          FROM pg_class AS relation
         WHERE relation.oid = state_relation
    ), FALSE) THEN
        contract_valid := FALSE;
    END IF;

    IF EXISTS (
        WITH expected(
            relation_oid,
            ordinal_position,
            column_name,
            data_type,
            is_not_null,
            identity_kind,
            generated_kind
        ) AS (
            VALUES
                (event_relation, 1, 'event_id', 'bigint', TRUE, 'a', ''),
                (event_relation, 2, 'event_key', 'text', TRUE, '', ''),
                (event_relation, 3, 'stream_name', 'text', TRUE, '', ''),
                (event_relation, 4, 'publisher_name', 'text', TRUE, '', ''),
                (event_relation, 5, 'publisher_version', 'text', TRUE, '', ''),
                (event_relation, 6, 'source_type', 'text', TRUE, '', ''),
                (event_relation, 7, 'source_id', 'text', TRUE, '', ''),
                (event_relation, 8, 'event_variant', 'text', TRUE, '', ''),
                (event_relation, 9, 'event_type', 'text', TRUE, '', ''),
                (event_relation, 10, 'aggregate_type', 'text', TRUE, '', ''),
                (event_relation, 11, 'aggregate_id', 'text', TRUE, '', ''),
                (event_relation, 12, 'aggregate_version', 'bigint', FALSE, '', ''),
                (event_relation, 13, 'authorization_scope_type', 'text', TRUE, '', ''),
                (event_relation, 14, 'authorization_scope_id', 'uuid', FALSE, '', ''),
                (event_relation, 15, 'visibility_scope', 'text', TRUE, '', ''),
                (event_relation, 16, 'payload', 'jsonb', TRUE, '', ''),
                (event_relation, 17, 'payload_hash', 'text', TRUE, '', ''),
                (event_relation, 18, 'event_hash', 'text', TRUE, '', ''),
                (event_relation, 19, 'occurred_at', 'timestamp with time zone', TRUE, '', ''),
                (event_relation, 20, 'expires_at', 'timestamp with time zone', TRUE, '', ''),
                (event_relation, 21, 'created_at', 'timestamp with time zone', TRUE, '', ''),
                (state_relation, 1, 'stream_name', 'text', TRUE, '', ''),
                (state_relation, 2, 'retention_floor_event_id', 'bigint', TRUE, '', ''),
                (state_relation, 3, 'row_version', 'bigint', TRUE, '', ''),
                (state_relation, 4, 'updated_at', 'timestamp with time zone', TRUE, '', '')
        ), actual AS (
            SELECT attribute.attrelid AS relation_oid,
                   attribute.attnum::integer AS ordinal_position,
                   attribute.attname::text AS column_name,
                   format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
                   attribute.attnotnull AS is_not_null,
                   attribute.attidentity::text AS identity_kind,
                   attribute.attgenerated::text AS generated_kind
              FROM pg_attribute AS attribute
             WHERE attribute.attrelid IN (event_relation, state_relation)
               AND attribute.attnum > 0
               AND NOT attribute.attisdropped
        )
        SELECT 1
          FROM expected
          FULL JOIN actual USING (relation_oid, column_name)
         WHERE expected.column_name IS NULL
            OR actual.column_name IS NULL
            OR expected.ordinal_position IS DISTINCT FROM actual.ordinal_position
            OR expected.data_type IS DISTINCT FROM actual.data_type
            OR expected.is_not_null IS DISTINCT FROM actual.is_not_null
            OR expected.identity_kind IS DISTINCT FROM actual.identity_kind
            OR expected.generated_kind IS DISTINCT FROM actual.generated_kind
    ) THEN
        contract_valid := FALSE;
    END IF;

    IF EXISTS (
        WITH expected(relation_oid, column_name, default_expression) AS (
            VALUES
                (event_relation, 'created_at', 'CURRENT_TIMESTAMP'),
                (state_relation, 'retention_floor_event_id', '0'),
                (state_relation, 'row_version', '1'),
                (state_relation, 'updated_at', 'CURRENT_TIMESTAMP')
        ), actual AS (
            SELECT attribute.attrelid AS relation_oid,
                   attribute.attname::text AS column_name,
                   pg_get_expr(attribute_default.adbin, attribute_default.adrelid) AS default_expression
              FROM pg_attribute AS attribute
              JOIN pg_attrdef AS attribute_default
                ON attribute_default.adrelid = attribute.attrelid
               AND attribute_default.adnum = attribute.attnum
             WHERE attribute.attrelid IN (event_relation, state_relation)
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

    SELECT attribute.attnum
      INTO event_id_attribute_number
      FROM pg_attribute AS attribute
     WHERE attribute.attrelid = event_relation
       AND attribute.attname = 'event_id'
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped;

    IF event_id_attribute_number IS NOT NULL
       AND COALESCE((
            SELECT relation.relkind = 'r' AND relation.relpersistence = 'p'
              FROM pg_class AS relation
             WHERE relation.oid = event_relation
       ), FALSE) THEN
        identity_sequence := to_regclass(
            pg_get_serial_sequence('conversation.realtime_event', 'event_id')
        );
    END IF;

    IF identity_sequence IS NULL
       OR NOT COALESCE((
            SELECT sequence_relation.relkind = 'S'
               AND sequence_relation.relpersistence = 'p'
               AND sequence_relation.relnamespace = 'conversation'::regnamespace
              FROM pg_class AS sequence_relation
             WHERE sequence_relation.oid = identity_sequence
       ), FALSE)
       OR NOT COALESCE((
            SELECT sequence_record.seqtypid = 'bigint'::regtype
               AND sequence_record.seqstart = 1
               AND sequence_record.seqincrement = 1
               AND sequence_record.seqmax = 9223372036854775807
               AND sequence_record.seqmin = 1
               AND sequence_record.seqcache = 1
               AND NOT sequence_record.seqcycle
              FROM pg_sequence AS sequence_record
             WHERE sequence_record.seqrelid = identity_sequence
       ), FALSE)
       OR NOT COALESCE((
            SELECT count(*) = 1
              FROM pg_depend AS dependency_record
             WHERE dependency_record.classid = 'pg_class'::regclass
               AND dependency_record.objid = identity_sequence
               AND dependency_record.objsubid = 0
               AND dependency_record.refclassid = 'pg_class'::regclass
               AND dependency_record.refobjid = event_relation
               AND dependency_record.refobjsubid = event_id_attribute_number
               AND dependency_record.deptype = 'i'
       ), FALSE) THEN
        contract_valid := FALSE;
    END IF;

    IF NOT (
        SELECT count(*) FILTER (WHERE constraint_record.contype = 'p') = 1
           AND count(*) FILTER (WHERE constraint_record.contype = 'u') = 1
           AND count(*) FILTER (WHERE constraint_record.contype = 'f') = 0
           AND count(*) FILTER (WHERE constraint_record.contype = 'c') = 19
           AND count(*) FILTER (WHERE constraint_record.contype = 'x') = 0
          FROM pg_constraint AS constraint_record
         WHERE constraint_record.conrelid = event_relation
    ) OR NOT (
        SELECT count(*) FILTER (WHERE constraint_record.contype = 'p') = 1
           AND count(*) FILTER (WHERE constraint_record.contype = 'u') = 0
           AND count(*) FILTER (WHERE constraint_record.contype = 'f') = 0
           AND count(*) FILTER (WHERE constraint_record.contype = 'c') = 3
           AND count(*) FILTER (WHERE constraint_record.contype = 'x') = 0
          FROM pg_constraint AS constraint_record
         WHERE constraint_record.conrelid = state_relation
    ) THEN
        contract_valid := FALSE;
    END IF;

    IF EXISTS (
        WITH expected(
            relation_oid,
            constraint_name,
            constraint_type,
            is_primary,
            key_columns
        ) AS (
            VALUES
                (event_relation, 'conversation_realtime_event_pkey', 'p', TRUE, ARRAY['event_id']::name[]),
                (event_relation, 'conversation_realtime_event_event_key_unique', 'u', FALSE, ARRAY['event_key']::name[]),
                (state_relation, 'conversation_realtime_stream_state_pkey', 'p', TRUE, ARRAY['stream_name']::name[])
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
            OR index_relation.relkind IS DISTINCT FROM 'i'
            OR index_relation.relpersistence IS DISTINCT FROM 'p'
            OR index_method.amname IS DISTINCT FROM 'btree'
            OR NOT COALESCE(index_record.indisvalid, FALSE)
            OR NOT COALESCE(index_record.indisready, FALSE)
            OR NOT COALESCE(index_record.indislive, FALSE)
            OR NOT COALESCE(index_record.indimmediate, FALSE)
            OR NOT COALESCE(index_record.indisunique, FALSE)
            OR index_record.indisprimary IS DISTINCT FROM expected.is_primary
            OR COALESCE(index_record.indisexclusion, FALSE)
            OR COALESCE(index_record.indnullsnotdistinct, FALSE)
            OR index_record.indpred IS NOT NULL
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
                  FROM unnest(constraint_record.conkey)
                    WITH ORDINALITY AS key_column(attnum, position)
                  JOIN pg_attribute AS attribute
                    ON attribute.attrelid = expected.relation_oid
                   AND attribute.attnum = key_column.attnum
                 ORDER BY key_column.position
            ) IS DISTINCT FROM expected.key_columns
    ) THEN
        contract_valid := FALSE;
    END IF;

    IF EXISTS (
        WITH expected(relation_oid, constraint_name, constraint_expression) AS (
            VALUES
                (event_relation, 'conversation_realtime_event_event_key_check', '(event_key ~ ''^rte_v1_[a-f0-9]{64}$''::text)'),
                (event_relation, 'conversation_realtime_event_stream_name_check', '(stream_name = ''CONVERSATION_WORKBENCH''::text)'),
                (event_relation, 'conversation_realtime_event_publisher_name_check', '(((char_length(publisher_name) >= 1) AND (char_length(publisher_name) <= 64)) AND (publisher_name ~ ''^[A-Z][A-Z0-9_.-]{0,63}$''::text))'),
                (event_relation, 'conversation_realtime_event_publisher_version_check', '(((char_length(publisher_version) >= 1) AND (char_length(publisher_version) <= 64)) AND (publisher_version ~ ''^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$''::text))'),
                (event_relation, 'conversation_realtime_event_source_type_check', '(source_type = ANY (ARRAY[''CONVERSATION_SESSION''::text, ''CONVERSATION_ITEM''::text, ''TIMELINE_REBUILD''::text, ''COMMUNICATION_DELIVERY''::text, ''TICKET_EVENT''::text, ''HANDOFF_EVENT''::text, ''READ_CURSOR''::text, ''INCIDENT_EVENT''::text, ''GATEWAY_EVENT''::text]))'),
                (event_relation, 'conversation_realtime_event_source_id_check', '(((char_length(source_id) >= 1) AND (char_length(source_id) <= 256)) AND (source_id ~ ''^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$''::text))'),
                (event_relation, 'conversation_realtime_event_variant_check', '(((char_length(event_variant) >= 1) AND (char_length(event_variant) <= 64)) AND (event_variant ~ ''^[A-Z][A-Z0-9_]{0,63}$''::text))'),
                (event_relation, 'conversation_realtime_event_type_format_check', '(((char_length(event_type) >= 1) AND (char_length(event_type) <= 128)) AND (event_type ~ ''^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$''::text))'),
                (event_relation, 'conversation_realtime_event_type_vocabulary_check', '(event_type = ANY (ARRAY[''conversation.session.created''::text, ''conversation.session.updated''::text, ''conversation.item.created''::text, ''conversation.timeline.rebuilt''::text, ''conversation.mode.changed''::text, ''conversation.assigned''::text, ''conversation.handoff.requested''::text, ''conversation.handoff.accepted''::text, ''conversation.read_cursor.changed''::text, ''communication.delivery.changed''::text, ''ticket.updated''::text, ''incident.updated''::text, ''gateway.connection.changed''::text]))'),
                (event_relation, 'conversation_realtime_event_aggregate_type_check', '(aggregate_type = ANY (ARRAY[''CONVERSATION_SESSION''::text, ''CONVERSATION_ITEM''::text, ''CONVERSATION_TIMELINE''::text, ''COMMUNICATION_DELIVERY''::text, ''TICKET''::text, ''CONVERSATION_HANDOFF''::text, ''CONVERSATION_READ_CURSOR''::text, ''INCIDENT''::text, ''GATEWAY_CONNECTION''::text]))'),
                (event_relation, 'conversation_realtime_event_aggregate_id_check', '(((char_length(aggregate_id) >= 1) AND (char_length(aggregate_id) <= 256)) AND (aggregate_id ~ ''^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$''::text))'),
                (event_relation, 'conversation_realtime_event_aggregate_version_check', '((aggregate_version IS NULL) OR (aggregate_version >= 0))'),
                (event_relation, 'conversation_realtime_event_authorization_scope_type_check', '(authorization_scope_type = ANY (ARRAY[''SESSION''::text, ''THREAD''::text, ''SYSTEM''::text]))'),
                (event_relation, 'conversation_realtime_event_scope_consistency_check', '(((authorization_scope_type = ANY (ARRAY[''SESSION''::text, ''THREAD''::text])) AND (authorization_scope_id IS NOT NULL)) OR ((authorization_scope_type = ''SYSTEM''::text) AND (authorization_scope_id IS NULL)))'),
                (event_relation, 'conversation_realtime_event_visibility_scope_check', '(visibility_scope = ANY (ARRAY[''WORKBENCH''::text, ''RESTRICTED_ADMIN''::text]))'),
                (event_relation, 'conversation_realtime_event_payload_object_check', '(jsonb_typeof(payload) = ''object''::text)'),
                (event_relation, 'conversation_realtime_event_payload_hash_check', '(payload_hash ~ ''^[a-f0-9]{64}$''::text)'),
                (event_relation, 'conversation_realtime_event_event_hash_check', '(event_hash ~ ''^[a-f0-9]{64}$''::text)'),
                (event_relation, 'conversation_realtime_event_expiry_check', '(expires_at > occurred_at)'),
                (state_relation, 'conversation_realtime_stream_state_stream_name_check', '(stream_name = ''CONVERSATION_WORKBENCH''::text)'),
                (state_relation, 'conversation_realtime_stream_state_retention_floor_check', '(retention_floor_event_id >= 0)'),
                (state_relation, 'conversation_realtime_stream_state_row_version_check', '(row_version >= 1)')
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

    IF EXISTS (
        SELECT 1
          FROM pg_trigger AS trigger_record
         WHERE trigger_record.tgrelid IN (event_relation, state_relation)
           AND NOT trigger_record.tgisinternal
    ) THEN
        contract_valid := FALSE;
    END IF;

    IF NOT contract_valid THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'P2_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;
END
$p2_003_relation_contract$;

CREATE INDEX IF NOT EXISTS conversation_realtime_event_visibility_event_idx
    ON conversation.realtime_event (visibility_scope, event_id);

CREATE INDEX IF NOT EXISTS conversation_realtime_event_authorization_scope_event_idx
    ON conversation.realtime_event (
        authorization_scope_type,
        authorization_scope_id,
        event_id
    );

CREATE INDEX IF NOT EXISTS conversation_realtime_event_expiry_event_idx
    ON conversation.realtime_event (expires_at, event_id);

DO $p2_003_index_contract$
DECLARE
    event_relation OID := to_regclass('conversation.realtime_event');
    state_relation OID := to_regclass('conversation.realtime_stream_state');
    index_valid BOOLEAN := TRUE;
BEGIN
    IF NOT (
        SELECT count(*) = 5
          FROM pg_index AS index_record
         WHERE index_record.indrelid = event_relation
    ) OR NOT (
        SELECT count(*) = 1
          FROM pg_index AS index_record
         WHERE index_record.indrelid = state_relation
    ) THEN
        index_valid := FALSE;
    END IF;

    IF EXISTS (
        WITH expected(
            relation_oid,
            index_name,
            is_unique,
            is_primary,
            key_columns
        ) AS (
            VALUES
                (event_relation, 'conversation_realtime_event_pkey', TRUE, TRUE, ARRAY['event_id']::name[]),
                (event_relation, 'conversation_realtime_event_event_key_unique', TRUE, FALSE, ARRAY['event_key']::name[]),
                (event_relation, 'conversation_realtime_event_visibility_event_idx', FALSE, FALSE, ARRAY['visibility_scope', 'event_id']::name[]),
                (event_relation, 'conversation_realtime_event_authorization_scope_event_idx', FALSE, FALSE, ARRAY['authorization_scope_type', 'authorization_scope_id', 'event_id']::name[]),
                (event_relation, 'conversation_realtime_event_expiry_event_idx', FALSE, FALSE, ARRAY['expires_at', 'event_id']::name[]),
                (state_relation, 'conversation_realtime_stream_state_pkey', TRUE, TRUE, ARRAY['stream_name']::name[])
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
            OR index_relation.relkind IS DISTINCT FROM 'i'
            OR index_relation.relpersistence IS DISTINCT FROM 'p'
            OR index_method.amname IS DISTINCT FROM 'btree'
            OR NOT index_record.indisvalid
            OR NOT index_record.indisready
            OR NOT index_record.indislive
            OR NOT index_record.indimmediate
            OR index_record.indisunique IS DISTINCT FROM expected.is_unique
            OR index_record.indisprimary IS DISTINCT FROM expected.is_primary
            OR index_record.indisexclusion
            OR index_record.indnullsnotdistinct
            OR index_record.indexprs IS NOT NULL
            OR index_record.indpred IS NOT NULL
            OR index_record.indnatts IS DISTINCT FROM index_record.indnkeyatts
            OR index_record.indnkeyatts IS DISTINCT FROM array_length(expected.key_columns, 1)
            OR EXISTS (
                SELECT 1
                  FROM unnest(index_record.indoption::smallint[]) AS index_option(option_value)
                 WHERE index_option.option_value <> 0
            )
            OR ARRAY(
                SELECT attribute.attname
                  FROM unnest(index_record.indkey::smallint[])
                    WITH ORDINALITY AS key_column(attnum, position)
                  JOIN pg_attribute AS attribute
                    ON attribute.attrelid = expected.relation_oid
                   AND attribute.attnum = key_column.attnum
                 ORDER BY key_column.position
            ) IS DISTINCT FROM expected.key_columns
    ) THEN
        index_valid := FALSE;
    END IF;

    IF NOT index_valid THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'P2_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;
END
$p2_003_index_contract$;

COMMENT ON TABLE conversation.realtime_event IS
    'P2-003 durable replay projection for authorized SSE delivery. It is not a business fact source.';
COMMENT ON COLUMN conversation.realtime_event.event_id IS
    'Monotonic replay position with permitted identity gaps; consumers must not assume continuity.';
COMMENT ON COLUMN conversation.realtime_event.event_key IS
    'Opaque deterministic SHA-256 identity used for idempotent append and semantic conflict detection.';
COMMENT ON COLUMN conversation.realtime_event.payload IS
    'Bounded safe JSON object only; message bodies and raw external identifiers are prohibited.';
COMMENT ON COLUMN conversation.realtime_event.authorization_scope_id IS
    'Internal UUID authorization boundary; it is never included in the public event view.';
COMMENT ON TABLE conversation.realtime_stream_state IS
    'P2-003 replay retention state by stream. It is neither a client cursor nor a business fact.';
COMMENT ON COLUMN conversation.realtime_stream_state.retention_floor_event_id IS
    'All event IDs at or below this floor are no longer guaranteed replayable.';

COMMIT;
