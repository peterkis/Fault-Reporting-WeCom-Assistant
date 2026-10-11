BEGIN;

CREATE TABLE pilot_ticket.personal_material_read_position (
    principal_id UUID NOT NULL REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('BOT','WEB','MANUAL')),
    source_intake_id UUID NOT NULL REFERENCES intake.service_intake(id) ON DELETE RESTRICT,
    last_read_position BIGINT NOT NULL CHECK (last_read_position >= 1),
    row_version BIGINT NOT NULL DEFAULT 1 CHECK (row_version >= 1),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    PRIMARY KEY (principal_id,source_kind,source_intake_id)
);
ALTER TABLE pilot_ticket.ticket_command_receipt ADD COLUMN source_intake_id UUID
    REFERENCES intake.service_intake(id) ON DELETE RESTRICT;
ALTER TABLE pilot_ticket.ticket_command_receipt DROP CONSTRAINT p2016_command_resource;
ALTER TABLE pilot_ticket.ticket_command_receipt ADD CONSTRAINT p2016_command_resource
    CHECK (ticket_id IS NOT NULL OR review_id IS NOT NULL OR source_intake_id IS NOT NULL OR
      (command_type = 'WORKBENCH_MANUAL_REPORT' AND ticket_id IS NULL AND review_id IS NULL AND conversation_session_id IS NULL));

COMMIT;
