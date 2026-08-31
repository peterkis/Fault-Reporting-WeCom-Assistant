BEGIN;

CREATE TABLE IF NOT EXISTS conversation.assignment (
    session_id UUID PRIMARY KEY,
    assignment_status TEXT NOT NULL DEFAULT 'UNASSIGNED',
    assigned_principal_id UUID,
    assigned_by_principal_id UUID,
    assignment_version BIGINT NOT NULL DEFAULT 1,
    assigned_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT conversation_assignment_session_fk FOREIGN KEY (session_id)
        REFERENCES conversation.session(id) ON DELETE RESTRICT,
    CONSTRAINT conversation_assignment_principal_fk FOREIGN KEY (assigned_principal_id)
        REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    CONSTRAINT conversation_assignment_by_principal_fk FOREIGN KEY (assigned_by_principal_id)
        REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    CONSTRAINT conversation_assignment_status_check CHECK (assignment_status IN ('UNASSIGNED', 'ASSIGNED')),
    CONSTRAINT conversation_assignment_version_check CHECK (assignment_version >= 1),
    CONSTRAINT conversation_assignment_consistency_check CHECK (
        (assignment_status = 'ASSIGNED' AND assigned_principal_id IS NOT NULL AND assigned_at IS NOT NULL AND released_at IS NULL)
        OR (assignment_status = 'UNASSIGNED' AND assigned_principal_id IS NULL AND assigned_at IS NULL)
    )
);

CREATE TABLE IF NOT EXISTS conversation.handoff (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    session_id UUID NOT NULL,
    status TEXT NOT NULL,
    requested_by_kind TEXT NOT NULL,
    requested_by_principal_id UUID,
    reason_code TEXT NOT NULL,
    from_mode TEXT NOT NULL,
    to_mode TEXT NOT NULL,
    assigned_principal_id UUID,
    request_command_id UUID NOT NULL UNIQUE,
    request_hash TEXT NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 1,
    requested_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT conversation_handoff_session_fk FOREIGN KEY (session_id)
        REFERENCES conversation.session(id) ON DELETE RESTRICT,
    CONSTRAINT conversation_handoff_requested_principal_fk FOREIGN KEY (requested_by_principal_id)
        REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    CONSTRAINT conversation_handoff_assigned_principal_fk FOREIGN KEY (assigned_principal_id)
        REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    CONSTRAINT conversation_handoff_status_check CHECK (status IN ('REQUESTED', 'ACCEPTED', 'RELEASED', 'CANCELLED')),
    CONSTRAINT conversation_handoff_requested_by_kind_check CHECK (requested_by_kind IN ('USER', 'AI', 'RULE', 'AGENT', 'ADMIN')),
    CONSTRAINT conversation_handoff_actor_check CHECK (requested_by_kind NOT IN ('AGENT', 'ADMIN') OR requested_by_principal_id IS NOT NULL),
    CONSTRAINT conversation_handoff_reason_check CHECK (char_length(reason_code) BETWEEN 1 AND 64 AND reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    CONSTRAINT conversation_handoff_mode_check CHECK (from_mode IN ('HUMAN','COPILOT','AUTO') AND to_mode IN ('HUMAN','COPILOT','AUTO')),
    CONSTRAINT conversation_handoff_hash_check CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT conversation_handoff_version_check CHECK (row_version >= 1),
    CONSTRAINT conversation_handoff_lifecycle_check CHECK (
        (status = 'REQUESTED' AND accepted_at IS NULL AND released_at IS NULL AND cancelled_at IS NULL AND assigned_principal_id IS NULL)
        OR (status = 'ACCEPTED' AND accepted_at IS NOT NULL AND released_at IS NULL AND cancelled_at IS NULL AND assigned_principal_id IS NOT NULL)
        OR (status = 'RELEASED' AND accepted_at IS NOT NULL AND released_at IS NOT NULL AND cancelled_at IS NULL AND assigned_principal_id IS NOT NULL)
        OR (status = 'CANCELLED' AND accepted_at IS NULL AND released_at IS NULL AND cancelled_at IS NOT NULL AND assigned_principal_id IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_handoff_one_active_per_session_idx
    ON conversation.handoff USING btree (session_id)
    WHERE status IN ('REQUESTED', 'ACCEPTED');

CREATE INDEX IF NOT EXISTS conversation_handoff_session_history_idx
    ON conversation.handoff USING btree (session_id, requested_at, id);

CREATE TABLE IF NOT EXISTS conversation.read_cursor (
    principal_id UUID NOT NULL,
    session_id UUID NOT NULL,
    last_read_sequence BIGINT NOT NULL DEFAULT 0,
    row_version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT conversation_read_cursor_pkey PRIMARY KEY (principal_id, session_id),
    CONSTRAINT conversation_read_cursor_principal_fk FOREIGN KEY (principal_id)
        REFERENCES pilot_ticket.pilot_principal(id) ON DELETE CASCADE,
    CONSTRAINT conversation_read_cursor_session_fk FOREIGN KEY (session_id)
        REFERENCES conversation.session(id) ON DELETE CASCADE,
    CONSTRAINT conversation_read_cursor_sequence_check CHECK (last_read_sequence >= 0),
    CONSTRAINT conversation_read_cursor_version_check CHECK (row_version >= 1)
);

CREATE INDEX IF NOT EXISTS conversation_read_cursor_session_idx
    ON conversation.read_cursor USING btree (session_id, principal_id);

CREATE TABLE IF NOT EXISTS conversation.control_event (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    session_id UUID NOT NULL,
    event_ordinal BIGINT NOT NULL,
    event_type TEXT NOT NULL,
    idempotency_scope TEXT NOT NULL,
    client_command_id UUID NOT NULL,
    command_hash TEXT NOT NULL,
    actor_principal_id UUID,
    target_principal_id UUID,
    handoff_id UUID,
    old_assignment_status TEXT,
    new_assignment_status TEXT,
    old_control_mode TEXT,
    new_control_mode TEXT,
    old_read_sequence BIGINT,
    new_read_sequence BIGINT,
    generation_version_after BIGINT NOT NULL,
    session_row_version_after BIGINT NOT NULL,
    reason_code TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT conversation_control_event_session_fk FOREIGN KEY (session_id)
        REFERENCES conversation.session(id) ON DELETE RESTRICT,
    CONSTRAINT conversation_control_event_actor_fk FOREIGN KEY (actor_principal_id)
        REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    CONSTRAINT conversation_control_event_target_fk FOREIGN KEY (target_principal_id)
        REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    CONSTRAINT conversation_control_event_handoff_fk FOREIGN KEY (handoff_id)
        REFERENCES conversation.handoff(id) ON DELETE RESTRICT,
    CONSTRAINT conversation_control_event_command_unique UNIQUE (idempotency_scope, client_command_id),
    CONSTRAINT conversation_control_event_ordinal_unique UNIQUE (session_id, event_ordinal),
    CONSTRAINT conversation_control_event_ordinal_check CHECK (event_ordinal >= 1),
    CONSTRAINT conversation_control_event_type_check CHECK (event_type IN (
        'HANDOFF_REQUESTED','HANDOFF_ACCEPTED','HANDOFF_RELEASED','HANDOFF_CANCELLED',
        'ASSIGNMENT_ASSIGNED','ASSIGNMENT_TRANSFERRED','ASSIGNMENT_RELEASED',
        'GENERATION_INVALIDATED','READ_CURSOR_ADVANCED'
    )),
    CONSTRAINT conversation_control_event_scope_check CHECK (char_length(idempotency_scope) BETWEEN 1 AND 128 AND idempotency_scope ~ '^[A-Z0-9][A-Z0-9_.:-]{0,127}$'),
    CONSTRAINT conversation_control_event_hash_check CHECK (command_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT conversation_control_event_assignment_check CHECK (
        (old_assignment_status IS NULL OR old_assignment_status IN ('UNASSIGNED','ASSIGNED'))
        AND (new_assignment_status IS NULL OR new_assignment_status IN ('UNASSIGNED','ASSIGNED'))
    ),
    CONSTRAINT conversation_control_event_mode_check CHECK (
        (old_control_mode IS NULL OR old_control_mode IN ('HUMAN','COPILOT','AUTO'))
        AND (new_control_mode IS NULL OR new_control_mode IN ('HUMAN','COPILOT','AUTO'))
    ),
    CONSTRAINT conversation_control_event_sequence_check CHECK (
        (old_read_sequence IS NULL OR old_read_sequence >= 0)
        AND (new_read_sequence IS NULL OR new_read_sequence >= 0)
    ),
    CONSTRAINT conversation_control_event_version_check CHECK (generation_version_after >= 1 AND session_row_version_after >= 1),
    CONSTRAINT conversation_control_event_reason_check CHECK (char_length(reason_code) BETWEEN 1 AND 64 AND reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$')
);

DO $p2_005_contract$
DECLARE
    contract_valid BOOLEAN := TRUE;
BEGIN
    IF EXISTS (
        WITH expected(table_name, column_name, data_type, is_nullable) AS (VALUES
          ('assignment','session_id','uuid','NO'),('assignment','assignment_status','text','NO'),('assignment','assigned_principal_id','uuid','YES'),('assignment','assigned_by_principal_id','uuid','YES'),('assignment','assignment_version','bigint','NO'),('assignment','assigned_at','timestamp with time zone','YES'),('assignment','released_at','timestamp with time zone','YES'),('assignment','updated_at','timestamp with time zone','NO'),
          ('handoff','id','uuid','NO'),('handoff','session_id','uuid','NO'),('handoff','status','text','NO'),('handoff','requested_by_kind','text','NO'),('handoff','requested_by_principal_id','uuid','YES'),('handoff','reason_code','text','NO'),('handoff','from_mode','text','NO'),('handoff','to_mode','text','NO'),('handoff','assigned_principal_id','uuid','YES'),('handoff','request_command_id','uuid','NO'),('handoff','request_hash','text','NO'),('handoff','row_version','bigint','NO'),('handoff','requested_at','timestamp with time zone','NO'),('handoff','accepted_at','timestamp with time zone','YES'),('handoff','released_at','timestamp with time zone','YES'),('handoff','cancelled_at','timestamp with time zone','YES'),('handoff','updated_at','timestamp with time zone','NO'),
          ('read_cursor','principal_id','uuid','NO'),('read_cursor','session_id','uuid','NO'),('read_cursor','last_read_sequence','bigint','NO'),('read_cursor','row_version','bigint','NO'),('read_cursor','created_at','timestamp with time zone','NO'),('read_cursor','updated_at','timestamp with time zone','NO'),
          ('control_event','id','uuid','NO'),('control_event','session_id','uuid','NO'),('control_event','event_ordinal','bigint','NO'),('control_event','event_type','text','NO'),('control_event','idempotency_scope','text','NO'),('control_event','client_command_id','uuid','NO'),('control_event','command_hash','text','NO'),('control_event','actor_principal_id','uuid','YES'),('control_event','target_principal_id','uuid','YES'),('control_event','handoff_id','uuid','YES'),('control_event','old_assignment_status','text','YES'),('control_event','new_assignment_status','text','YES'),('control_event','old_control_mode','text','YES'),('control_event','new_control_mode','text','YES'),('control_event','old_read_sequence','bigint','YES'),('control_event','new_read_sequence','bigint','YES'),('control_event','generation_version_after','bigint','NO'),('control_event','session_row_version_after','bigint','NO'),('control_event','reason_code','text','NO'),('control_event','occurred_at','timestamp with time zone','NO')
        ), actual AS (
          SELECT table_name::text,column_name::text,data_type::text,is_nullable::text
          FROM information_schema.columns WHERE table_schema='conversation' AND table_name IN ('assignment','handoff','read_cursor','control_event')
        )
        (SELECT * FROM expected EXCEPT SELECT * FROM actual)
        UNION ALL
        (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    ) THEN contract_valid := FALSE; END IF;

    IF NOT COALESCE((SELECT array_agg(a.attname ORDER BY k.ordinality) = ARRAY['session_id']::name[]
      FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
      WHERE i.indexrelid=to_regclass('conversation.conversation_handoff_one_active_per_session_idx')
        AND i.indisunique AND i.indpred IS NOT NULL AND pg_get_expr(i.indpred,i.indrelid) = '(status = ANY (ARRAY[''REQUESTED''::text, ''ACCEPTED''::text]))'), FALSE)
    THEN contract_valid := FALSE; END IF;

    IF NOT COALESCE((SELECT am.amname='btree' FROM pg_class c JOIN pg_am am ON am.oid=c.relam
      WHERE c.oid=to_regclass('conversation.conversation_handoff_one_active_per_session_idx')), FALSE)
    THEN contract_valid := FALSE; END IF;

    IF EXISTS (
      SELECT 1 FROM (VALUES
        ('conversation_assignment_status_check'),('conversation_assignment_version_check'),('conversation_assignment_consistency_check'),
        ('conversation_handoff_status_check'),('conversation_handoff_requested_by_kind_check'),('conversation_handoff_actor_check'),('conversation_handoff_reason_check'),('conversation_handoff_mode_check'),('conversation_handoff_hash_check'),('conversation_handoff_version_check'),('conversation_handoff_lifecycle_check'),
        ('conversation_read_cursor_sequence_check'),('conversation_read_cursor_version_check'),
        ('conversation_control_event_command_unique'),('conversation_control_event_ordinal_unique'),('conversation_control_event_type_check'),('conversation_control_event_hash_check'),('conversation_control_event_version_check')
      ) expected(name) WHERE NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname=expected.name)
    ) THEN contract_valid := FALSE; END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conname IN (
         'conversation_assignment_status_check','conversation_assignment_version_check','conversation_assignment_consistency_check',
         'conversation_handoff_status_check','conversation_handoff_requested_by_kind_check','conversation_handoff_actor_check',
         'conversation_handoff_reason_check','conversation_handoff_mode_check','conversation_handoff_hash_check',
         'conversation_handoff_version_check','conversation_handoff_lifecycle_check',
         'conversation_read_cursor_sequence_check','conversation_read_cursor_version_check',
         'conversation_control_event_type_check','conversation_control_event_hash_check','conversation_control_event_version_check'
       ) AND regexp_replace(pg_get_constraintdef(c.oid), '\s+', ' ', 'g') = 'CHECK (true)'
    ) THEN contract_valid := FALSE; END IF;

    IF NOT COALESCE((
      SELECT array_agg(a.attname ORDER BY keys.ordinality) = ARRAY['idempotency_scope','client_command_id']::name[]
        FROM pg_constraint c
        CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY keys(attnum, ordinality)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=keys.attnum
       WHERE c.conrelid=to_regclass('conversation.control_event')
         AND c.conname='conversation_control_event_command_unique' AND c.contype='u'
    ), FALSE) THEN contract_valid := FALSE; END IF;

    IF NOT COALESCE((
      SELECT array_agg(a.attname ORDER BY keys.ordinality) = ARRAY['session_id','event_ordinal']::name[]
        FROM pg_constraint c
        CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY keys(attnum, ordinality)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=keys.attnum
       WHERE c.conrelid=to_regclass('conversation.control_event')
         AND c.conname='conversation_control_event_ordinal_unique' AND c.contype='u'
    ), FALSE) THEN contract_valid := FALSE; END IF;

    IF NOT contract_valid THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='P2_005_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;
END
$p2_005_contract$;

COMMENT ON TABLE conversation.assignment IS 'P2-005 current assignment state; no external identity or display data.';
COMMENT ON TABLE conversation.handoff IS 'P2-005 independent handoff lifecycle.';
COMMENT ON TABLE conversation.read_cursor IS 'P2-005 per-principal per-session monotonic read cursor.';
COMMENT ON TABLE conversation.control_event IS 'P2-005 append-only control audit and command idempotency fact.';

COMMIT;
