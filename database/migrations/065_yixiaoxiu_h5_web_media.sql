BEGIN;

-- Web-origin materials stay separate from Bot Message/attachment facts.
CREATE TABLE intake.web_media_upload (
 media_ref UUID PRIMARY KEY,
 scope_hash TEXT NOT NULL CHECK(scope_hash ~ '^[a-f0-9]{64}$'),
 source_corp_scope TEXT NOT NULL CHECK(char_length(source_corp_scope) BETWEEN 1 AND 128),
 source_app_scope TEXT NOT NULL CHECK(char_length(source_app_scope) BETWEEN 1 AND 128),
 client_command_id UUID NOT NULL,
 command_hash TEXT NOT NULL CHECK(command_hash ~ '^[a-f0-9]{64}$'),
 kind TEXT NOT NULL CHECK(kind IN ('VOICE','IMAGE','VIDEO')),
 mime_type TEXT NOT NULL CHECK(char_length(mime_type) BETWEEN 1 AND 64),
 expected_byte_size BIGINT CHECK(expected_byte_size BETWEEN 1 AND 20971520),
 byte_size BIGINT CHECK(byte_size BETWEEN 1 AND 20971520),
 sha256 TEXT CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 duration_ms INTEGER CHECK(duration_ms BETWEEN 1 AND 60000),
 state TEXT NOT NULL CHECK(state IN ('RESERVED','WRITING','READY','BOUND','CANCELLED')),
 write_lease UUID,
 write_started_epoch_ms BIGINT,
 transcode_lease UUID,
 transcode_started_epoch_ms BIGINT,
 playback_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(playback_status IN ('READY','PENDING','UNAVAILABLE')),
 playback_mime_type TEXT,
 playback_byte_size BIGINT CHECK(playback_byte_size BETWEEN 1 AND 20971520),
 playback_sha256 TEXT CHECK(playback_sha256 ~ '^[a-f0-9]{64}$'),
 created_epoch_ms BIGINT NOT NULL DEFAULT platform.physical_epoch_ms(),
 expires_epoch_ms BIGINT NOT NULL,
 intake_id UUID REFERENCES intake.web_request_binding(intake_id) ON DELETE RESTRICT,
 submission_id UUID,
 request_ref TEXT REFERENCES intake.web_request_binding(request_ref) ON DELETE RESTRICT,
 purged_epoch_ms BIGINT,
 CONSTRAINT web_media_submission_intake_fk FOREIGN KEY(submission_id,intake_id) REFERENCES intake.web_submission(id,intake_id) ON DELETE RESTRICT,
 CONSTRAINT web_media_idempotency UNIQUE(scope_hash,client_command_id),
 CONSTRAINT web_media_initial_retention CHECK(expires_epoch_ms>created_epoch_ms AND (state='BOUND' OR expires_epoch_ms<=created_epoch_ms+86400000)),
 CONSTRAINT web_media_bytes_per_kind CHECK(COALESCE(byte_size,expected_byte_size,1)<=CASE kind WHEN 'VOICE' THEN 5242880 WHEN 'IMAGE' THEN 10485760 ELSE 20971520 END),
 CONSTRAINT web_media_content_state CHECK(state NOT IN ('READY','BOUND') OR (byte_size IS NOT NULL AND sha256 IS NOT NULL)),
 CONSTRAINT web_media_binding_state CHECK((state='BOUND' AND intake_id IS NOT NULL AND submission_id IS NOT NULL AND request_ref IS NOT NULL) OR (state<>'BOUND' AND intake_id IS NULL AND submission_id IS NULL AND request_ref IS NULL)),
 CONSTRAINT web_media_write_state CHECK((state='WRITING')=(write_lease IS NOT NULL)),
 CONSTRAINT web_media_write_start CHECK((write_lease IS NULL)=(write_started_epoch_ms IS NULL)),
 CONSTRAINT web_media_transcode_start CHECK((transcode_lease IS NULL)=(transcode_started_epoch_ms IS NULL)),
 CONSTRAINT web_media_playback CHECK((playback_status='READY' AND playback_mime_type IS NOT NULL AND playback_byte_size IS NOT NULL AND playback_sha256 IS NOT NULL) OR (playback_status<>'READY' AND playback_mime_type IS NULL AND playback_byte_size IS NULL AND playback_sha256 IS NULL))
);
CREATE INDEX web_media_scope_unbound ON intake.web_media_upload(scope_hash,expires_epoch_ms) WHERE state IN ('RESERVED','WRITING','READY');
CREATE INDEX web_media_intake ON intake.web_media_upload(intake_id,created_epoch_ms,media_ref) WHERE state='BOUND';

CREATE FUNCTION intake.guard_web_media_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.media_ref,NEW.scope_hash,NEW.source_corp_scope,NEW.source_app_scope,NEW.client_command_id,NEW.command_hash,NEW.kind,NEW.expected_byte_size,NEW.created_epoch_ms)
 IS DISTINCT FROM ROW(OLD.media_ref,OLD.scope_hash,OLD.source_corp_scope,OLD.source_app_scope,OLD.client_command_id,OLD.command_hash,OLD.kind,OLD.expected_byte_size,OLD.created_epoch_ms)
 THEN RAISE EXCEPTION 'WEB_MEDIA_IDENTITY_IMMUTABLE'; END IF;
 IF TG_OP='UPDATE' AND OLD.state='BOUND' AND (NEW.state<>'BOUND' OR ROW(NEW.intake_id,NEW.submission_id,NEW.request_ref) IS DISTINCT FROM ROW(OLD.intake_id,OLD.submission_id,OLD.request_ref)) THEN RAISE EXCEPTION 'WEB_MEDIA_BINDING_IMMUTABLE'; END IF;
 IF NEW.state='BOUND' AND (TG_OP='INSERT' OR OLD.state<>'BOUND' OR NEW.expires_epoch_ms IS DISTINCT FROM OLD.expires_epoch_ms) AND NOT EXISTS(SELECT 1 FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id
   JOIN intake.web_submission s ON s.id=NEW.submission_id AND s.intake_id=b.intake_id
   WHERE b.intake_id=NEW.intake_id AND b.request_ref=NEW.request_ref AND b.canonical_reporter_binding=NEW.scope_hash
   AND b.source_corp_scope=NEW.source_corp_scope AND b.source_app_scope=NEW.source_app_scope
   AND b.revoked_at IS NULL AND NEW.expires_epoch_ms<=LEAST(b.retention_until_epoch_ms,s.retention_until_epoch_ms,i.retention_until_epoch_ms))
 THEN RAISE EXCEPTION 'WEB_MEDIA_BINDING_INVALID'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER web_media_identity_guard BEFORE INSERT OR UPDATE ON intake.web_media_upload FOR EACH ROW EXECUTE FUNCTION intake.guard_web_media_identity();

COMMIT;
