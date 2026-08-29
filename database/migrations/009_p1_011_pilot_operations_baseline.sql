BEGIN;

CREATE SCHEMA IF NOT EXISTS operations;

CREATE OR REPLACE FUNCTION operations.audit_metadata_is_safe(payload JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $p1_011_audit_metadata$
DECLARE
    metadata_key TEXT;
    metadata_type TEXT;
    metadata_value TEXT;
BEGIN
    IF jsonb_typeof(payload) <> 'object' THEN
        RETURN FALSE;
    END IF;

    FOR metadata_key IN SELECT jsonb_object_keys(payload)
    LOOP
        IF metadata_key NOT IN (
            'backup_id', 'checksum_sha256', 'size_bytes', 'encryption_key_id',
            'retention_until', 'restore_id', 'verified_object_count', 'query_limit',
            'result', 'failure_code', 'dependency', 'redaction_code'
        ) THEN
            RETURN FALSE;
        END IF;
        metadata_type := jsonb_typeof(payload -> metadata_key);
        metadata_value := payload ->> metadata_key;
        CASE metadata_key
            WHEN 'backup_id' THEN
                IF metadata_type <> 'string'
                    OR metadata_value !~ '^backup-[A-Za-z0-9-]{1,120}$' THEN
                    RETURN FALSE;
                END IF;
            WHEN 'checksum_sha256' THEN
                IF metadata_type <> 'string'
                    OR metadata_value !~ '^[a-f0-9]{64}$' THEN
                    RETURN FALSE;
                END IF;
            WHEN 'size_bytes' THEN
                IF metadata_type <> 'number'
                    OR metadata_value !~ '^[1-9][0-9]{0,15}$' THEN
                    RETURN FALSE;
                END IF;
            WHEN 'encryption_key_id' THEN
                IF metadata_type <> 'string'
                    OR metadata_value !~ '^[A-Za-z0-9_.:-]{1,128}$' THEN
                    RETURN FALSE;
                END IF;
            WHEN 'retention_until' THEN
                IF metadata_type <> 'string'
                    OR metadata_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
                    RETURN FALSE;
                END IF;
            WHEN 'restore_id' THEN
                IF metadata_type <> 'string'
                    OR metadata_value !~ '^restore-[A-Za-z0-9-]{1,120}$' THEN
                    RETURN FALSE;
                END IF;
            WHEN 'verified_object_count', 'query_limit' THEN
                IF metadata_type <> 'number'
                    OR metadata_value !~ '^(0|[1-9][0-9]{0,9})$' THEN
                    RETURN FALSE;
                END IF;
            WHEN 'result' THEN
                IF metadata_type <> 'string'
                    OR metadata_value NOT IN ('SUCCEEDED', 'FAILED', 'DEGRADED', 'READY') THEN
                    RETURN FALSE;
                END IF;
            WHEN 'failure_code' THEN
                IF metadata_type <> 'string'
                    OR metadata_value !~ '^[A-Z][A-Z0-9_]{1,127}$' THEN
                    RETURN FALSE;
                END IF;
            WHEN 'dependency' THEN
                IF metadata_type <> 'string'
                    OR metadata_value NOT IN ('postgres', 'intake', 'outbox', 'redis', 'ai', 'ocr', 'object_storage') THEN
                    RETURN FALSE;
                END IF;
            WHEN 'redaction_code' THEN
                IF metadata_type <> 'string'
                    OR metadata_value NOT IN ('SECRET_FIELD', 'PATIENT_SENSITIVE_FIELD', 'MEDIA_REFERENCE_FIELD') THEN
                    RETURN FALSE;
                END IF;
        END CASE;
    END LOOP;
    RETURN TRUE;
END
$p1_011_audit_metadata$;

CREATE TABLE IF NOT EXISTS operations.audit_event (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    event_key TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    actor_principal_id UUID REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    trace_id TEXT,
    subject_hash TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT operations_audit_event_key_check CHECK (char_length(event_key) BETWEEN 1 AND 256),
    CONSTRAINT operations_audit_event_key_format_check CHECK (
        event_key ~ '^[a-z][a-z0-9:._-]{1,255}$'
    ),
    CONSTRAINT operations_audit_event_type_check CHECK (
        event_type IN (
            'security.log_redacted', 'security.secret_scan_failed',
            'backup.completed', 'backup.restore_drill_completed',
            'backup.restore_drill_failed', 'audit.accessed',
            'readiness.core_failed', 'readiness.degraded'
        )
    ),
    CONSTRAINT operations_audit_event_trace_check CHECK (
        trace_id IS NULL OR trace_id ~ '^[A-Za-z0-9_.:-]{1,128}$'
    ),
    CONSTRAINT operations_audit_event_subject_hash_check CHECK (
        subject_hash IS NULL OR subject_hash ~ '^sha256:[a-f0-9]{24}$'
    ),
    CONSTRAINT operations_audit_event_metadata_safe CHECK (operations.audit_metadata_is_safe(metadata))
);

CREATE INDEX IF NOT EXISTS operations_audit_event_occurred_idx
    ON operations.audit_event (occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS operations_audit_event_actor_idx
    ON operations.audit_event (actor_principal_id, occurred_at DESC)
    WHERE actor_principal_id IS NOT NULL;

ALTER TABLE operations.audit_event
    DROP CONSTRAINT IF EXISTS operations_audit_event_key_format_check;
ALTER TABLE operations.audit_event
    ADD CONSTRAINT operations_audit_event_key_format_check
    CHECK (event_key ~ '^[a-z][a-z0-9:._-]{1,255}$');

ALTER TABLE operations.audit_event
    DROP CONSTRAINT IF EXISTS audit_event_actor_principal_id_fkey;
ALTER TABLE operations.audit_event
    ADD CONSTRAINT audit_event_actor_principal_id_fkey
    FOREIGN KEY (actor_principal_id)
    REFERENCES pilot_ticket.pilot_principal(id)
    ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS operations.backup_checkpoint (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    backup_id TEXT NOT NULL UNIQUE,
    checksum_sha256 TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    encryption_key_id TEXT NOT NULL,
    retention_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT operations_backup_checkpoint_id_check CHECK (
        backup_id ~ '^backup-[A-Za-z0-9-]{1,120}$'
    ),
    CONSTRAINT operations_backup_checkpoint_checksum_check CHECK (
        checksum_sha256 ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT operations_backup_checkpoint_size_check CHECK (size_bytes > 0),
    CONSTRAINT operations_backup_checkpoint_key_id_check CHECK (
        encryption_key_id ~ '^[A-Za-z0-9_.:-]{1,128}$'
    ),
    CONSTRAINT operations_backup_checkpoint_retention_check CHECK (retention_until > created_at)
);

CREATE INDEX IF NOT EXISTS operations_backup_checkpoint_retention_idx
    ON operations.backup_checkpoint (retention_until, created_at DESC);

CREATE TABLE IF NOT EXISTS operations.restore_drill (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    restore_id TEXT NOT NULL UNIQUE,
    backup_checkpoint_id UUID NOT NULL REFERENCES operations.backup_checkpoint(id) ON DELETE RESTRICT,
    status TEXT NOT NULL,
    verified_object_count BIGINT NOT NULL,
    failure_code TEXT,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT operations_restore_drill_id_check CHECK (
        restore_id ~ '^restore-[A-Za-z0-9-]{1,120}$'
    ),
    CONSTRAINT operations_restore_drill_status_check CHECK (status IN ('SUCCEEDED', 'FAILED')),
    CONSTRAINT operations_restore_drill_count_check CHECK (verified_object_count >= 0),
    CONSTRAINT operations_restore_drill_failure_check CHECK (
        (status = 'SUCCEEDED' AND verified_object_count > 0 AND failure_code IS NULL)
        OR (status = 'FAILED' AND verified_object_count = 0
            AND failure_code ~ '^[A-Z][A-Z0-9_]{1,127}$')
    )
);

CREATE INDEX IF NOT EXISTS operations_restore_drill_backup_idx
    ON operations.restore_drill (backup_checkpoint_id, completed_at DESC);

CREATE OR REPLACE FUNCTION operations.prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $p1_011_audit_immutable$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'P1_011_AUDIT_IMMUTABLE';
END
$p1_011_audit_immutable$;

DROP TRIGGER IF EXISTS operations_audit_event_immutable ON operations.audit_event;
CREATE TRIGGER operations_audit_event_immutable
BEFORE UPDATE OR DELETE ON operations.audit_event
FOR EACH ROW
EXECUTE FUNCTION operations.prevent_audit_event_mutation();

COMMENT ON TABLE operations.audit_event IS
    'P1-011 append-only operational audit. Metadata is allowlisted and must contain no user text, media references, or secrets.';
COMMENT ON TABLE operations.backup_checkpoint IS
    'P1-011 logical-backup checkpoint metadata only; it stores no path, URL, credential, or backup payload.';
COMMENT ON TABLE operations.restore_drill IS
    'P1-011 isolated restore-drill result with stable failure codes only.';

COMMIT;
