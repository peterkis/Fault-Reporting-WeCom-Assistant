BEGIN;

ALTER TABLE conversation.realtime_event DROP CONSTRAINT conversation_realtime_event_source_type_check;
ALTER TABLE conversation.realtime_event ADD CONSTRAINT conversation_realtime_event_source_type_check CHECK (source_type IN (
 'CONVERSATION_SESSION','CONVERSATION_ITEM','TIMELINE_REBUILD','COMMUNICATION_DELIVERY','TICKET_EVENT','HANDOFF_EVENT','READ_CURSOR','INCIDENT_EVENT','GATEWAY_EVENT','MANUAL_REVIEW','WEB_REPORT_URGE'));

ALTER TABLE intake.web_command_receipt DROP CONSTRAINT web_command_receipt_schema_check;
ALTER TABLE intake.web_command_receipt ADD CONSTRAINT web_command_receipt_schema_check CHECK (schema_version IN (1,2));
ALTER TABLE intake.web_command_receipt DROP CONSTRAINT web_command_receipt_kind_check;
ALTER TABLE intake.web_command_receipt ADD CONSTRAINT web_command_receipt_kind_check CHECK (command_kind IN ('SUBMIT','SUPPLEMENT','FEEDBACK','URGE','EVALUATION'));
ALTER TABLE intake.web_command_receipt ADD COLUMN h5_result JSONB;
ALTER TABLE intake.web_command_receipt ADD CONSTRAINT web_h5_result_purpose CHECK (
 (command_kind IN ('URGE','EVALUATION') AND h5_result IS NOT NULL AND jsonb_typeof(h5_result)='object') OR
 (command_kind NOT IN ('URGE','EVALUATION') AND h5_result IS NULL));

CREATE TABLE intake.web_report_urge (
 id UUID PRIMARY KEY DEFAULT uuidv7(),
 sequence_no BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
 ticket_id UUID NOT NULL REFERENCES pilot_ticket.ticket(id),
 cycle_id UUID REFERENCES pilot_ticket.ticket_handling_cycle(id),
 source_intake_id UUID NOT NULL REFERENCES intake.service_intake(id),
 scope_hash TEXT NOT NULL CHECK(scope_hash ~ '^[a-f0-9]{64}$'),
 client_command_id UUID NOT NULL,
 occurred_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
 occurred_epoch_ms BIGINT NOT NULL,
 retention_until_epoch_ms BIGINT NOT NULL,
 UNIQUE(scope_hash,client_command_id),
 CHECK(occurred_at=platform.local_from_epoch_ms(occurred_epoch_ms)),
 CHECK(retention_until_epoch_ms>occurred_epoch_ms)
);
CREATE INDEX web_report_urge_current_idx ON intake.web_report_urge(ticket_id,cycle_id,occurred_epoch_ms DESC);

CREATE TABLE intake.web_report_evaluation (
 id UUID PRIMARY KEY DEFAULT uuidv7(),
 ticket_id UUID NOT NULL REFERENCES pilot_ticket.ticket(id),
 completed_cycle_id UUID NOT NULL REFERENCES pilot_ticket.ticket_handling_cycle(id),
 completion_event_id UUID NOT NULL REFERENCES pilot_ticket.ticket_event(event_id),
 source_intake_id UUID NOT NULL REFERENCES intake.service_intake(id),
 scope_hash TEXT NOT NULL CHECK(scope_hash ~ '^[a-f0-9]{64}$'),
 client_command_id UUID NOT NULL,
 rating SMALLINT NOT NULL CHECK(rating BETWEEN 1 AND 5),
 comment TEXT CHECK(comment IS NULL OR char_length(comment) BETWEEN 1 AND 200),
 occurred_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
 occurred_epoch_ms BIGINT NOT NULL,
 retention_until_epoch_ms BIGINT NOT NULL,
 UNIQUE(completed_cycle_id),
 UNIQUE(scope_hash,client_command_id),
 CHECK(occurred_at=platform.local_from_epoch_ms(occurred_epoch_ms)),
 CHECK(retention_until_epoch_ms>occurred_epoch_ms)
);

CREATE TABLE pilot_ticket.ticket_public_progress (
 id UUID PRIMARY KEY DEFAULT uuidv7(),
 ticket_id UUID NOT NULL REFERENCES pilot_ticket.ticket(id),
 ticket_version INTEGER NOT NULL CHECK(ticket_version>0),
 ticket_event_id UUID NOT NULL REFERENCES pilot_ticket.ticket_event(event_id),
 actor_principal_id UUID NOT NULL REFERENCES pilot_ticket.pilot_principal(id),
 client_command_id UUID NOT NULL,
 command_hash TEXT NOT NULL CHECK(command_hash ~ '^[a-f0-9]{64}$'),
 summary TEXT NOT NULL CHECK(char_length(summary) BETWEEN 1 AND 500),
 estimated_at TIMESTAMP WITHOUT TIME ZONE,
 estimated_epoch_ms BIGINT,
 occurred_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
 occurred_epoch_ms BIGINT NOT NULL,
 result_snapshot JSONB NOT NULL CHECK(jsonb_typeof(result_snapshot)='object'),
 UNIQUE(actor_principal_id,client_command_id),
 UNIQUE(ticket_id,ticket_version),
 CHECK((estimated_at IS NULL AND estimated_epoch_ms IS NULL) OR (estimated_at IS NOT NULL AND estimated_epoch_ms IS NOT NULL AND estimated_at=platform.local_from_epoch_ms(estimated_epoch_ms))),
 CHECK(occurred_at=platform.local_from_epoch_ms(occurred_epoch_ms))
);
CREATE INDEX ticket_public_progress_latest_idx ON pilot_ticket.ticket_public_progress(ticket_id,ticket_version DESC);

COMMIT;
