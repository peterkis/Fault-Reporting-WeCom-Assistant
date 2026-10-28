BEGIN;

-- Necessary Ticket contact records outlive the source message's retention window.
-- No raw reporter ID, message body, phone, media, token or Ticket state is copied.
CREATE TABLE intake.ticket_reporter_profile (
 ticket_id UUID PRIMARY KEY REFERENCES pilot_ticket.ticket(id) ON DELETE RESTRICT,
 source_intake_id UUID NOT NULL REFERENCES intake.service_intake(id) ON DELETE RESTRICT,
 source_provider TEXT NOT NULL CHECK(source_provider IN ('WECOM_AIBOT','YIXIAOXIU_WEB','STAFF_MANUAL_REPORT')),
 source_channel TEXT NOT NULL CHECK(source_channel IN ('WECOM_DIRECT','WECOM_GROUP','PORTAL','MANUAL')),
 source_label TEXT NOT NULL CHECK(char_length(source_label) BETWEEN 1 AND 256),
 source_bot_id TEXT CHECK(char_length(source_bot_id) BETWEEN 1 AND 128),
 reporter_identity_hash TEXT NOT NULL CHECK(reporter_identity_hash ~ '^[a-f0-9]{64}$'),
 state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','PARTIAL','RESOLVED','UNAVAILABLE')),
 reporter_name TEXT CHECK(char_length(reporter_name) BETWEEN 1 AND 256),
 reporter_department TEXT CHECK(char_length(reporter_department) BETWEEN 1 AND 4096),
 profile_source TEXT CHECK(profile_source IN ('REPORT_SNAPSHOT','LATER_LOOKUP')),
 captured_epoch_ms BIGINT CHECK(captured_epoch_ms>=0),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 8),
 next_attempt_epoch_ms BIGINT CHECK(next_attempt_epoch_ms>=0),
 lease_token UUID,
 lease_until_epoch_ms BIGINT CHECK(lease_until_epoch_ms>=0),
 created_epoch_ms BIGINT NOT NULL CHECK(created_epoch_ms>=0),
 updated_epoch_ms BIGINT NOT NULL CHECK(updated_epoch_ms>=created_epoch_ms),
 CONSTRAINT ticket_reporter_profile_source_kind CHECK(
  (source_provider='WECOM_AIBOT' AND source_channel IN ('WECOM_DIRECT','WECOM_GROUP') AND source_bot_id IS NOT NULL)
  OR (source_provider='YIXIAOXIU_WEB' AND source_channel='PORTAL')
  OR (source_provider='STAFF_MANUAL_REPORT' AND source_channel='MANUAL')),
 CONSTRAINT ticket_reporter_profile_material CHECK(
  (reporter_name IS NULL AND reporter_department IS NULL AND profile_source IS NULL AND captured_epoch_ms IS NULL)
  OR ((reporter_name IS NOT NULL OR reporter_department IS NOT NULL) AND profile_source IS NOT NULL AND captured_epoch_ms IS NOT NULL)),
 CONSTRAINT ticket_reporter_profile_state CHECK(
  (state='RESOLVED' AND reporter_name IS NOT NULL AND reporter_department IS NOT NULL AND next_attempt_epoch_ms IS NULL)
  OR (state='UNAVAILABLE' AND next_attempt_epoch_ms IS NULL)
  OR (state IN ('PENDING','PARTIAL') AND next_attempt_epoch_ms IS NOT NULL)),
 CONSTRAINT ticket_reporter_profile_lease CHECK((lease_token IS NULL)=(lease_until_epoch_ms IS NULL))
);
CREATE INDEX ticket_reporter_profile_due ON intake.ticket_reporter_profile(next_attempt_epoch_ms,ticket_id)
 WHERE state IN ('PENDING','PARTIAL');

CREATE FUNCTION intake.guard_ticket_reporter_profile_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.ticket_id,NEW.source_intake_id,NEW.source_provider,NEW.source_channel,NEW.source_label,NEW.source_bot_id,NEW.reporter_identity_hash,NEW.created_epoch_ms)
    IS DISTINCT FROM ROW(OLD.ticket_id,OLD.source_intake_id,OLD.source_provider,OLD.source_channel,OLD.source_label,OLD.source_bot_id,OLD.reporter_identity_hash,OLD.created_epoch_ms)
 THEN RAISE EXCEPTION 'TICKET_REPORTER_PROFILE_SOURCE_IMMUTABLE'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ticket_reporter_profile_source_immutable BEFORE UPDATE ON intake.ticket_reporter_profile
 FOR EACH ROW EXECUTE FUNCTION intake.guard_ticket_reporter_profile_source();

COMMIT;
