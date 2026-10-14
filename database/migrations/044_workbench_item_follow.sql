BEGIN;
CREATE TABLE pilot_ticket.workbench_item_follow (
    principal_id UUID NOT NULL REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    source_intake_id UUID NOT NULL REFERENCES intake.service_intake(id) ON DELETE RESTRICT,
    following BOOLEAN NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 1 CHECK (row_version >= 1),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    PRIMARY KEY (principal_id, source_intake_id)
);
CREATE INDEX workbench_item_follow_active_idx ON pilot_ticket.workbench_item_follow(principal_id,source_intake_id) WHERE following;
COMMIT;
