BEGIN;

CREATE SCHEMA IF NOT EXISTS communication;

CREATE TABLE IF NOT EXISTS communication.message (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    session_id UUID,
    sender_kind TEXT NOT NULL,
    sender_principal_id UUID,
    sender_system_code TEXT,
    purpose TEXT NOT NULL,
    message_type TEXT NOT NULL,
    visibility TEXT NOT NULL,
    idempotency_scope TEXT NOT NULL,
    client_command_id UUID NOT NULL,
    command_hash TEXT NOT NULL,
    content JSONB NOT NULL,
    content_hash TEXT NOT NULL,
    reply_to_conversation_item_id UUID,
    privacy_class TEXT NOT NULL,
    retention_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT communication_message_session_fk FOREIGN KEY (session_id)
        REFERENCES conversation.session(id) ON DELETE RESTRICT,
    CONSTRAINT communication_message_reply_item_fk FOREIGN KEY (reply_to_conversation_item_id)
        REFERENCES conversation.item(id) ON DELETE RESTRICT,
    CONSTRAINT communication_message_command_unique UNIQUE (idempotency_scope, client_command_id),
    CONSTRAINT communication_message_sender_kind_check CHECK (sender_kind IN ('AGENT', 'AI', 'SYSTEM')),
    CONSTRAINT communication_message_purpose_check CHECK (purpose IN ('HUMAN_REPLY', 'AI_REPLY', 'SYSTEM_NOTIFICATION', 'INTERNAL_NOTE')),
    CONSTRAINT communication_message_type_check CHECK (message_type IN ('text', 'markdown', 'image', 'file', 'mixed', 'template_card')),
    CONSTRAINT communication_message_visibility_check CHECK (visibility IN ('EXTERNAL', 'INTERNAL', 'RESTRICTED')),
    CONSTRAINT communication_message_scope_length_check CHECK (char_length(idempotency_scope) BETWEEN 1 AND 64),
    CONSTRAINT communication_message_command_hash_check CHECK (command_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT communication_message_content_hash_check CHECK (content_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT communication_message_content_object_check CHECK (jsonb_typeof(content) = 'object'),
    CONSTRAINT communication_message_privacy_check CHECK (privacy_class IN ('PUBLIC', 'INTERNAL', 'SENSITIVE_INTERNAL', 'PERSONAL', 'PATIENT_SENSITIVE', 'SECRET')),
    CONSTRAINT communication_message_retention_check CHECK (retention_until > created_at),
    CONSTRAINT communication_message_sender_identity_check CHECK (
        (sender_kind = 'AGENT' AND sender_principal_id IS NOT NULL AND sender_system_code IS NULL)
        OR (sender_kind IN ('AI', 'SYSTEM') AND sender_principal_id IS NULL
            AND sender_system_code IS NOT NULL AND char_length(sender_system_code) BETWEEN 1 AND 64)
    ),
    CONSTRAINT communication_message_session_requirement_check CHECK (
        sender_kind = 'SYSTEM' OR session_id IS NOT NULL
    ),
    CONSTRAINT communication_message_purpose_sender_check CHECK (
        (sender_kind = 'AGENT' AND purpose IN ('HUMAN_REPLY', 'INTERNAL_NOTE'))
        OR (sender_kind = 'AI' AND purpose = 'AI_REPLY')
        OR (sender_kind = 'SYSTEM' AND purpose IN ('SYSTEM_NOTIFICATION', 'INTERNAL_NOTE'))
    ),
    CONSTRAINT communication_message_visibility_purpose_check CHECK (
        (purpose = 'INTERNAL_NOTE' AND visibility IN ('INTERNAL', 'RESTRICTED'))
        OR (purpose <> 'INTERNAL_NOTE' AND visibility <> 'INTERNAL')
    )
);

CREATE TABLE IF NOT EXISTS communication.outbox (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    message_id UUID NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL UNIQUE,
    route_policy TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT communication_outbox_message_fk FOREIGN KEY (message_id)
        REFERENCES communication.message(id) ON DELETE RESTRICT,
    CONSTRAINT communication_outbox_key_length_check CHECK (char_length(idempotency_key) BETWEEN 16 AND 256),
    CONSTRAINT communication_outbox_route_length_check CHECK (char_length(route_policy) BETWEEN 1 AND 64),
    CONSTRAINT communication_outbox_priority_check CHECK (priority BETWEEN 0 AND 1000)
);

CREATE TABLE IF NOT EXISTS communication.delivery (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    outbox_id UUID NOT NULL,
    provider TEXT NOT NULL,
    channel_account_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_hash TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    priority INTEGER NOT NULL DEFAULT 100,
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_token UUID,
    lease_expires_at TIMESTAMPTZ,
    send_started_at TIMESTAMPTZ,
    side_effect_state TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED',
    last_error_code TEXT,
    provider_message_id TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT communication_delivery_outbox_fk FOREIGN KEY (outbox_id)
        REFERENCES communication.outbox(id) ON DELETE RESTRICT,
    CONSTRAINT communication_delivery_target_unique UNIQUE (outbox_id, provider, channel_account_id, target_type, target_hash),
    CONSTRAINT communication_delivery_provider_length_check CHECK (char_length(provider) BETWEEN 1 AND 64),
    CONSTRAINT communication_delivery_channel_length_check CHECK (char_length(channel_account_id) BETWEEN 1 AND 256),
    CONSTRAINT communication_delivery_target_type_check CHECK (target_type IN ('PERSON', 'GROUP')),
    CONSTRAINT communication_delivery_target_length_check CHECK (char_length(target_id) BETWEEN 1 AND 512),
    CONSTRAINT communication_delivery_target_hash_check CHECK (target_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT communication_delivery_key_length_check CHECK (char_length(idempotency_key) BETWEEN 16 AND 256),
    CONSTRAINT communication_delivery_priority_check CHECK (priority BETWEEN 0 AND 1000),
    CONSTRAINT communication_delivery_status_check CHECK (status IN ('PENDING', 'LEASED', 'SENDING', 'SENT', 'RECONCILIATION_REQUIRED', 'DEAD_LETTER', 'CANCELLED')),
    CONSTRAINT communication_delivery_attempt_count_check CHECK (attempt_count >= 0),
    CONSTRAINT communication_delivery_side_effect_check CHECK (side_effect_state IN ('NOT_ATTEMPTED', 'ACKNOWLEDGED', 'UNKNOWN')),
    CONSTRAINT communication_delivery_error_length_check CHECK (last_error_code IS NULL OR char_length(last_error_code) BETWEEN 1 AND 128),
    CONSTRAINT communication_delivery_provider_message_length_check CHECK (provider_message_id IS NULL OR char_length(provider_message_id) BETWEEN 1 AND 256),
    CONSTRAINT communication_delivery_state_shape_check CHECK (
        (status = 'PENDING' AND lease_token IS NULL AND lease_expires_at IS NULL AND send_started_at IS NULL AND sent_at IS NULL AND side_effect_state = 'NOT_ATTEMPTED')
        OR (status = 'LEASED' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND send_started_at IS NULL AND sent_at IS NULL AND side_effect_state = 'NOT_ATTEMPTED')
        OR (status = 'SENDING' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND send_started_at IS NOT NULL AND sent_at IS NULL AND side_effect_state = 'NOT_ATTEMPTED')
        OR (status = 'SENT' AND lease_token IS NULL AND lease_expires_at IS NULL AND send_started_at IS NOT NULL AND sent_at IS NOT NULL AND side_effect_state = 'ACKNOWLEDGED')
        OR (status = 'RECONCILIATION_REQUIRED' AND lease_token IS NULL AND lease_expires_at IS NULL AND send_started_at IS NOT NULL AND sent_at IS NULL AND side_effect_state = 'UNKNOWN')
        OR (status IN ('DEAD_LETTER', 'CANCELLED') AND lease_token IS NULL AND lease_expires_at IS NULL AND sent_at IS NULL)
    )
);

CREATE TABLE IF NOT EXISTS communication.delivery_attempt (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    delivery_id UUID NOT NULL,
    attempt_no INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    side_effect_state TEXT NOT NULL,
    lease_token UUID,
    request_id TEXT,
    error_code TEXT,
    provider_message_id TEXT,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    CONSTRAINT communication_delivery_attempt_delivery_fk FOREIGN KEY (delivery_id)
        REFERENCES communication.delivery(id) ON DELETE CASCADE,
    CONSTRAINT communication_delivery_attempt_number_unique UNIQUE (delivery_id, attempt_no),
    CONSTRAINT communication_delivery_attempt_number_check CHECK (attempt_no >= 1),
    CONSTRAINT communication_delivery_attempt_outcome_check CHECK (outcome IN ('STARTED', 'SENT', 'RETRY_SCHEDULED', 'RECONCILIATION_REQUIRED', 'DEAD_LETTER', 'CANCELLED')),
    CONSTRAINT communication_delivery_attempt_side_effect_check CHECK (side_effect_state IN ('NOT_ATTEMPTED', 'ACKNOWLEDGED', 'UNKNOWN')),
    CONSTRAINT communication_delivery_attempt_request_length_check CHECK (request_id IS NULL OR char_length(request_id) BETWEEN 1 AND 128),
    CONSTRAINT communication_delivery_attempt_error_length_check CHECK (error_code IS NULL OR char_length(error_code) BETWEEN 1 AND 128),
    CONSTRAINT communication_delivery_attempt_provider_message_length_check CHECK (provider_message_id IS NULL OR char_length(provider_message_id) BETWEEN 1 AND 256),
    CONSTRAINT communication_delivery_attempt_shape_check CHECK (
        (outcome = 'STARTED' AND completed_at IS NULL AND lease_token IS NOT NULL AND side_effect_state = 'NOT_ATTEMPTED')
        OR (outcome = 'SENT' AND completed_at IS NOT NULL AND side_effect_state = 'ACKNOWLEDGED')
        OR (outcome = 'RECONCILIATION_REQUIRED' AND completed_at IS NOT NULL AND side_effect_state = 'UNKNOWN')
        OR (outcome IN ('RETRY_SCHEDULED', 'DEAD_LETTER', 'CANCELLED') AND completed_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS communication_message_session_timeline_idx
    ON communication.message USING btree (session_id, created_at, id);
CREATE INDEX IF NOT EXISTS communication_message_retention_idx
    ON communication.message USING btree (retention_until, id);
CREATE INDEX IF NOT EXISTS communication_delivery_claim_idx
    ON communication.delivery USING btree (next_attempt_at, priority, created_at, id)
    WHERE status IN ('PENDING', 'LEASED');
CREATE INDEX IF NOT EXISTS communication_delivery_lease_expiry_idx
    ON communication.delivery USING btree (lease_expires_at, id)
    WHERE status IN ('LEASED', 'SENDING');
CREATE INDEX IF NOT EXISTS communication_delivery_reconciliation_idx
    ON communication.delivery USING btree (updated_at, id)
    WHERE status = 'RECONCILIATION_REQUIRED';
CREATE INDEX IF NOT EXISTS communication_delivery_target_rate_idx
    ON communication.delivery USING btree (provider, target_hash, sent_at, id)
    WHERE status IN ('SENDING', 'SENT');
CREATE INDEX IF NOT EXISTS communication_delivery_attempt_order_idx
    ON communication.delivery_attempt USING btree (delivery_id, attempt_no);

DO $p2_004_drift$
DECLARE
    actual_tables TEXT[];
    actual_columns TEXT[];
    actual_constraints TEXT[];
BEGIN
    SELECT array_agg(table_name ORDER BY table_name) INTO actual_tables
      FROM information_schema.tables
     WHERE table_schema = 'communication' AND table_type = 'BASE TABLE';
    IF actual_tables IS DISTINCT FROM ARRAY['delivery', 'delivery_attempt', 'message', 'outbox']::TEXT[] THEN
        RAISE EXCEPTION USING MESSAGE = 'P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;

    SELECT array_agg(column_name ORDER BY ordinal_position) INTO actual_columns
      FROM information_schema.columns WHERE table_schema = 'communication' AND table_name = 'message';
    IF actual_columns IS DISTINCT FROM ARRAY['id','session_id','sender_kind','sender_principal_id','sender_system_code','purpose','message_type','visibility','idempotency_scope','client_command_id','command_hash','content','content_hash','reply_to_conversation_item_id','privacy_class','retention_until','created_at']::TEXT[] THEN
        RAISE EXCEPTION USING MESSAGE = 'P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;
    SELECT array_agg(column_name ORDER BY ordinal_position) INTO actual_columns
      FROM information_schema.columns WHERE table_schema = 'communication' AND table_name = 'outbox';
    IF actual_columns IS DISTINCT FROM ARRAY['id','message_id','idempotency_key','route_policy','priority','created_at']::TEXT[] THEN
        RAISE EXCEPTION USING MESSAGE = 'P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;
    SELECT array_agg(column_name ORDER BY ordinal_position) INTO actual_columns
      FROM information_schema.columns WHERE table_schema = 'communication' AND table_name = 'delivery';
    IF actual_columns IS DISTINCT FROM ARRAY['id','outbox_id','provider','channel_account_id','target_type','target_id','target_hash','idempotency_key','priority','status','attempt_count','next_attempt_at','lease_token','lease_expires_at','send_started_at','side_effect_state','last_error_code','provider_message_id','sent_at','created_at','updated_at']::TEXT[] THEN
        RAISE EXCEPTION USING MESSAGE = 'P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;
    SELECT array_agg(column_name ORDER BY ordinal_position) INTO actual_columns
      FROM information_schema.columns WHERE table_schema = 'communication' AND table_name = 'delivery_attempt';
    IF actual_columns IS DISTINCT FROM ARRAY['id','delivery_id','attempt_no','outcome','side_effect_state','lease_token','request_id','error_code','provider_message_id','started_at','completed_at']::TEXT[] THEN
        RAISE EXCEPTION USING MESSAGE = 'P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'communication'
           AND ((column_name IN ('id','session_id','sender_principal_id','client_command_id','reply_to_conversation_item_id','message_id','outbox_id','lease_token','delivery_id') AND data_type <> 'uuid')
             OR (column_name IN ('content') AND data_type <> 'jsonb')
             OR (column_name IN ('retention_until','created_at','next_attempt_at','lease_expires_at','send_started_at','sent_at','updated_at','started_at','completed_at') AND data_type <> 'timestamp with time zone'))
    ) THEN
        RAISE EXCEPTION USING MESSAGE = 'P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;

    SELECT array_agg(conname ORDER BY conname) INTO actual_constraints
      FROM pg_constraint WHERE conrelid = 'communication.message'::regclass AND contype <> 'n';
    IF actual_constraints IS DISTINCT FROM ARRAY[
      'communication_message_command_hash_check','communication_message_command_unique','communication_message_content_hash_check','communication_message_content_object_check','communication_message_privacy_check','communication_message_purpose_check','communication_message_purpose_sender_check','communication_message_reply_item_fk','communication_message_retention_check','communication_message_scope_length_check','communication_message_sender_identity_check','communication_message_sender_kind_check','communication_message_session_fk','communication_message_session_requirement_check','communication_message_type_check','communication_message_visibility_check','communication_message_visibility_purpose_check','message_pkey'
    ]::TEXT[] THEN RAISE EXCEPTION USING MESSAGE = 'P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED'; END IF;

    IF (SELECT pg_get_constraintdef(oid, true) FROM pg_constraint WHERE conrelid = 'communication.message'::regclass AND conname = 'communication_message_command_unique') <> 'UNIQUE (idempotency_scope, client_command_id)'
       OR position('''^[a-f0-9]{64}$''' IN (SELECT pg_get_constraintdef(oid, true) FROM pg_constraint WHERE conrelid = 'communication.message'::regclass AND conname = 'communication_message_command_hash_check')) = 0
       OR (SELECT pg_get_constraintdef(oid, true) FROM pg_constraint WHERE conrelid = 'communication.delivery'::regclass AND conname = 'communication_delivery_target_unique') <> 'UNIQUE (outbox_id, provider, channel_account_id, target_type, target_hash)'
       OR (SELECT pg_get_constraintdef(oid, true) FROM pg_constraint WHERE conrelid = 'communication.delivery_attempt'::regclass AND conname = 'communication_delivery_attempt_number_unique') <> 'UNIQUE (delivery_id, attempt_no)'
    THEN
      RAISE EXCEPTION USING MESSAGE = 'P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;

    IF EXISTS (
      SELECT 1 FROM (VALUES
        ('communication_message_session_timeline_idx','session_id, created_at, id',NULL),
        ('communication_message_retention_idx','retention_until, id',NULL),
        ('communication_delivery_claim_idx','next_attempt_at, priority, created_at, id','status = ANY'),
        ('communication_delivery_lease_expiry_idx','lease_expires_at, id','status = ANY'),
        ('communication_delivery_reconciliation_idx','updated_at, id','status ='),
        ('communication_delivery_target_rate_idx','provider, target_hash, sent_at, id','status = ANY'),
        ('communication_delivery_attempt_order_idx','delivery_id, attempt_no',NULL)
      ) AS expected(index_name, ordered_columns, predicate_marker)
      LEFT JOIN pg_class index_class ON index_class.relname = expected.index_name
      LEFT JOIN pg_index index_record ON index_record.indexrelid = index_class.oid
      LEFT JOIN pg_am access_method ON access_method.oid = index_class.relam
      WHERE index_record.indexrelid IS NULL
         OR access_method.amname <> 'btree'
         OR position(expected.ordered_columns IN pg_get_indexdef(index_record.indexrelid)) = 0
         OR (expected.predicate_marker IS NULL AND index_record.indpred IS NOT NULL)
         OR (expected.predicate_marker IS NOT NULL AND (index_record.indpred IS NULL OR position(expected.predicate_marker IN pg_get_expr(index_record.indpred, index_record.indrelid)) = 0))
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_trigger trigger_record
       JOIN pg_class relation_record ON relation_record.oid = trigger_record.tgrelid
       JOIN pg_namespace namespace_record ON namespace_record.oid = relation_record.relnamespace
      WHERE namespace_record.nspname = 'communication' AND NOT trigger_record.tgisinternal
    ) OR EXISTS (
      SELECT 1 FROM pg_proc procedure_record
       JOIN pg_namespace namespace_record ON namespace_record.oid = procedure_record.pronamespace
      WHERE namespace_record.nspname = 'communication'
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    END IF;
END
$p2_004_drift$;

COMMIT;
