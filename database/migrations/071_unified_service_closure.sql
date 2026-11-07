BEGIN;

-- No legacy backfill. Each new dismissal has its own current-state snapshot.
CREATE TABLE pilot_ticket.closure_record (
 id UUID PRIMARY KEY DEFAULT uuidv7(),
 subject_type TEXT NOT NULL CHECK(subject_type IN ('TICKET','INTAKE')),
 ticket_id UUID REFERENCES pilot_ticket.ticket(id) ON DELETE CASCADE,
 intake_id UUID REFERENCES intake.service_intake(id) ON DELETE CASCADE,
 reason_code TEXT NOT NULL CHECK(reason_code IN ('FALSE_REPORT_OR_TEST','DUPLICATE','NOT_IT_SCOPE','REPORTER_WITHDREW','REPORTER_UNREACHABLE','OTHER')),
 secondary_reason_code TEXT CHECK(secondary_reason_code IN ('HUMAN_CONFIRMED','INFORMATION_INSUFFICIENT','BUSINESS_CONSULTATION_CONFIRMED','ACKNOWLEDGED','OUT_OF_SCOPE_CONFIRMED','SERVICE_REQUEST_CONFIRMED','INCIDENT_REVIEW_PENDING','STALE_REVIEW_CANCELLED')),
 note TEXT CHECK(note IS NULL OR (char_length(note) BETWEEN 1 AND 2000 AND note ~ '[^[:space:]]')),
 duplicate_of_ref TEXT CHECK(duplicate_of_ref IS NULL OR char_length(duplicate_of_ref) BETWEEN 1 AND 128),
 notify_reporter BOOLEAN NOT NULL,
 before_status TEXT NOT NULL,
 before_assignee_id UUID,
 before_team_id TEXT,
 before_version INTEGER NOT NULL CHECK(before_version>=1),
 before_cycle_id UUID,
 before_snapshot JSONB NOT NULL CHECK(jsonb_typeof(before_snapshot)='object'),
 closed_by TEXT,
 source TEXT NOT NULL CHECK(source IN ('MANUAL','SYSTEM')),
 closed_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT date_trunc('second',clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),
 closure_ticket_event_id UUID REFERENCES pilot_ticket.ticket_event(event_id) ON DELETE CASCADE,
 closure_intake_event_id UUID REFERENCES intake.service_intake_event(event_id) ON DELETE CASCADE,
 aborted_cycle_event_id UUID REFERENCES pilot_ticket.ticket_event(event_id) ON DELETE CASCADE,
 notification_message_id UUID,
 notification_processed_at TIMESTAMP(0) WITHOUT TIME ZONE,
 restored_at TIMESTAMP(0) WITHOUT TIME ZONE,
 restored_by UUID,
 restoration_event_id UUID,
 restoration_notification_message_id UUID,
 restoration_notification_processed_at TIMESTAMP(0) WITHOUT TIME ZONE,
 CONSTRAINT closure_subject CHECK((subject_type='TICKET' AND ticket_id IS NOT NULL AND intake_id IS NULL AND closure_ticket_event_id IS NOT NULL AND closure_intake_event_id IS NULL)
   OR (subject_type='INTAKE' AND intake_id IS NOT NULL AND ticket_id IS NULL AND closure_intake_event_id IS NOT NULL AND closure_ticket_event_id IS NULL)),
 CONSTRAINT closure_reason_details CHECK((reason_code='NOT_IT_SCOPE')=(secondary_reason_code IS NOT NULL)
   AND (reason_code<>'OTHER' OR note IS NOT NULL) AND (duplicate_of_ref IS NULL OR reason_code='DUPLICATE')),
 CONSTRAINT closure_notify_matrix CHECK((reason_code='OTHER') OR (notify_reporter=(reason_code<>'FALSE_REPORT_OR_TEST'))),
 CONSTRAINT closure_source_actor CHECK((source='SYSTEM' AND closed_by IS NULL) OR (source='MANUAL' AND closed_by IS NOT NULL)),
 CONSTRAINT closure_restore_actor CHECK((restored_at IS NULL AND restored_by IS NULL AND restoration_event_id IS NULL)
   OR (restored_at IS NOT NULL AND restored_by IS NOT NULL AND restoration_event_id IS NOT NULL AND restored_at>=closed_at))
);
CREATE UNIQUE INDEX closure_ticket_current_idx ON pilot_ticket.closure_record(ticket_id) WHERE ticket_id IS NOT NULL AND restored_at IS NULL;
CREATE UNIQUE INDEX closure_intake_current_idx ON pilot_ticket.closure_record(intake_id) WHERE intake_id IS NOT NULL AND restored_at IS NULL;
CREATE INDEX closure_ticket_version_idx ON pilot_ticket.closure_record(ticket_id,before_version) WHERE ticket_id IS NOT NULL;
CREATE INDEX closure_intake_version_idx ON pilot_ticket.closure_record(intake_id,before_version) WHERE intake_id IS NOT NULL;
CREATE INDEX closure_pending_notification_idx ON pilot_ticket.closure_record(closed_at,id) WHERE notification_processed_at IS NULL;
CREATE INDEX closure_pending_restore_notification_idx ON pilot_ticket.closure_record(restored_at,id) WHERE restored_at IS NOT NULL AND restoration_notification_processed_at IS NULL;

-- Material survives; only its old pending-follow-up obligation is terminated.
CREATE TABLE pilot_ticket.closure_supplement_termination (
 closure_id UUID NOT NULL REFERENCES pilot_ticket.closure_record(id) ON DELETE CASCADE,
 ticket_id UUID NOT NULL REFERENCES pilot_ticket.ticket(id) ON DELETE CASCADE,
 source_intake_id UUID NOT NULL REFERENCES intake.service_intake(id) ON DELETE CASCADE,
 source_ref TEXT NOT NULL,
 revision BIGINT NOT NULL CHECK(revision>=1),
 PRIMARY KEY(closure_id,source_intake_id,source_ref,revision)
);
CREATE INDEX closure_supplement_target_idx ON pilot_ticket.closure_supplement_termination(ticket_id,source_intake_id,source_ref,revision);

ALTER TABLE pilot_ticket.ticket_command_receipt ADD COLUMN closure_intake_id UUID REFERENCES intake.service_intake(id) ON DELETE RESTRICT;

DO $migration$
DECLARE old_check TEXT;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO old_check FROM pg_constraint WHERE conrelid='pilot_ticket.ticket_command_receipt'::regclass AND conname='p2016_command_resource';
 IF old_check IS NULL THEN RAISE EXCEPTION 'CLOSURE_COMMAND_RESOURCE_CHECK_REQUIRED'; END IF;
 IF position('closure_intake_id' IN old_check)=0 THEN
  ALTER TABLE pilot_ticket.ticket_command_receipt DROP CONSTRAINT p2016_command_resource;
  EXECUTE 'ALTER TABLE pilot_ticket.ticket_command_receipt ADD CONSTRAINT p2016_command_resource CHECK ('||substring(old_check FROM 7)||' OR closure_intake_id IS NOT NULL)';
 END IF;
 SELECT pg_get_constraintdef(oid) INTO old_check FROM pg_constraint WHERE conrelid='pilot_ticket.ticket_event'::regclass AND conname='ticket_event_type_check';
 IF old_check IS NULL THEN RAISE EXCEPTION 'CLOSURE_TICKET_EVENT_CHECK_REQUIRED'; END IF;
 ALTER TABLE pilot_ticket.ticket_event DROP CONSTRAINT ticket_event_type_check;
 EXECUTE 'ALTER TABLE pilot_ticket.ticket_event ADD CONSTRAINT ticket_event_type_check CHECK ('||substring(old_check FROM 7)||' OR event_type IN (''ticket.restored'',''ticket.handling_aborted''))';
 SELECT pg_get_constraintdef(oid) INTO old_check FROM pg_constraint WHERE conrelid='intake.service_intake_event'::regclass AND conname='service_intake_event_type_check';
 IF old_check IS NULL THEN RAISE EXCEPTION 'CLOSURE_INTAKE_EVENT_CHECK_REQUIRED'; END IF;
 ALTER TABLE intake.service_intake_event DROP CONSTRAINT service_intake_event_type_check;
 EXECUTE 'ALTER TABLE intake.service_intake_event ADD CONSTRAINT service_intake_event_type_check CHECK ('||substring(old_check FROM 7)||' OR event_type IN (''intake.closed'',''intake.restored''))';
END;
$migration$;

COMMIT;
