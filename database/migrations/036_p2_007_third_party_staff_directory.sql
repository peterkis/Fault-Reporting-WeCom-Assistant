BEGIN;

CREATE SCHEMA IF NOT EXISTS directory;

CREATE TABLE directory.sync_run (
    run_id UUID PRIMARY KEY DEFAULT uuidv7(),
    source_scope TEXT NOT NULL,
    root_ref_hash TEXT NOT NULL CHECK (root_ref_hash ~ '^[a-f0-9]{64}$'),
    status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
    snapshot_version TEXT CHECK (snapshot_version IS NULL OR snapshot_version ~ '^[a-f0-9]{64}$'),
    department_count INTEGER NOT NULL DEFAULT 0 CHECK (department_count >= 0),
    member_count INTEGER NOT NULL DEFAULT 0 CHECK (member_count >= 0),
    membership_count INTEGER NOT NULL DEFAULT 0 CHECK (membership_count >= 0),
    protocol_warnings JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(protocol_warnings) = 'array'),
    error_code TEXT CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
    started_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    completed_at TIMESTAMP WITHOUT TIME ZONE,
    CONSTRAINT directory_sync_run_completion_check CHECK (
      (status = 'RUNNING' AND completed_at IS NULL)
      OR (status IN ('SUCCEEDED', 'FAILED') AND completed_at IS NOT NULL)
    )
);

CREATE INDEX directory_sync_run_scope_idx
  ON directory.sync_run(source_scope, started_at DESC, run_id DESC);

CREATE TABLE directory.current_snapshot (
    source_scope TEXT PRIMARY KEY,
    snapshot_version TEXT NOT NULL CHECK (snapshot_version ~ '^[a-f0-9]{64}$'),
    root_ref_hash TEXT NOT NULL CHECK (root_ref_hash ~ '^[a-f0-9]{64}$'),
    department_count INTEGER NOT NULL CHECK (department_count >= 0),
    member_count INTEGER NOT NULL CHECK (member_count >= 0),
    membership_count INTEGER NOT NULL CHECK (membership_count >= 0),
    fetched_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    published_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now()
);

CREATE TABLE directory.department_current (
    source_scope TEXT NOT NULL,
    provider_department_id TEXT NOT NULL,
    parent_provider_department_id TEXT,
    name TEXT NOT NULL,
    provider_gid TEXT,
    provider_gid_type TEXT CHECK (provider_gid_type IS NULL OR provider_gid_type IN ('string', 'number')),
    depth INTEGER NOT NULL CHECK (depth >= 0),
    snapshot_version TEXT NOT NULL CHECK (snapshot_version ~ '^[a-f0-9]{64}$'),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    PRIMARY KEY (source_scope, provider_department_id)
);

CREATE INDEX directory_department_parent_idx
  ON directory.department_current(source_scope, parent_provider_department_id, provider_department_id);

CREATE TABLE directory.member_current (
    source_scope TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    nickname TEXT,
    phone TEXT,
    sex TEXT,
    avatar_url TEXT CHECK (avatar_url IS NULL OR avatar_url ~ '^https://'),
    provider_wecom_id TEXT,
    account_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (account_status IN ('ACTIVE', 'INACTIVE', 'UNKNOWN')),
    snapshot_version TEXT NOT NULL CHECK (snapshot_version ~ '^[a-f0-9]{64}$'),
    fetched_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    PRIMARY KEY (source_scope, provider_user_id)
);

CREATE INDEX directory_member_employee_idx
  ON directory.member_current(source_scope, employee_id);

CREATE TABLE directory.membership_current (
    source_scope TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    provider_department_id TEXT NOT NULL,
    snapshot_version TEXT NOT NULL CHECK (snapshot_version ~ '^[a-f0-9]{64}$'),
    PRIMARY KEY (source_scope, provider_user_id, provider_department_id),
    FOREIGN KEY (source_scope, provider_user_id)
      REFERENCES directory.member_current(source_scope, provider_user_id) ON DELETE CASCADE,
    FOREIGN KEY (source_scope, provider_department_id)
      REFERENCES directory.department_current(source_scope, provider_department_id) ON DELETE CASCADE
);

CREATE INDEX directory_membership_department_idx
  ON directory.membership_current(source_scope, provider_department_id, provider_user_id);

CREATE TABLE directory.identity_binding (
    source_scope TEXT NOT NULL,
    reporter_identity_hash TEXT NOT NULL CHECK (reporter_identity_hash ~ '^[a-f0-9]{64}$'),
    source_namespace TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    binding_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (binding_status IN ('ACTIVE', 'STALE', 'CONFLICT')),
    resolution_method TEXT NOT NULL CHECK (resolution_method ~ '^[A-Z][A-Z0-9_]{0,127}$'),
    bound_snapshot_version TEXT NOT NULL CHECK (bound_snapshot_version ~ '^[a-f0-9]{64}$'),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    last_verified_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    PRIMARY KEY (source_scope, reporter_identity_hash)
);

CREATE INDEX directory_identity_binding_member_idx
  ON directory.identity_binding(source_scope, provider_user_id, binding_status);

COMMIT;
