BEGIN;

CREATE SCHEMA IF NOT EXISTS workbench;
CREATE TABLE workbench.source_group_name (
    ref TEXT PRIMARY KEY CHECK (ref ~ '^[a-f0-9]{64}$'),
    display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 128 AND display_name = btrim(display_name)),
    row_version BIGINT NOT NULL CHECK (row_version > 0),
    updated_by UUID NOT NULL REFERENCES pilot_ticket.pilot_principal(id),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now()
);
CREATE TABLE workbench.source_group_name_change (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    group_ref TEXT NOT NULL REFERENCES workbench.source_group_name(ref),
    row_version BIGINT NOT NULL CHECK (row_version > 0),
    old_name TEXT,
    new_name TEXT NOT NULL,
    actor_principal_id UUID NOT NULL REFERENCES pilot_ticket.pilot_principal(id),
    client_command_id UUID NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    UNIQUE (group_ref, row_version)
);
CREATE TABLE workbench.source_group_name_receipt (
    actor_principal_id UUID NOT NULL REFERENCES pilot_ticket.pilot_principal(id),
    client_command_id UUID NOT NULL,
    command_hash TEXT NOT NULL CHECK (command_hash ~ '^[a-f0-9]{64}$'),
    result_snapshot JSONB NOT NULL CHECK (jsonb_typeof(result_snapshot) = 'object'),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    PRIMARY KEY (actor_principal_id, client_command_id)
);

COMMIT;
