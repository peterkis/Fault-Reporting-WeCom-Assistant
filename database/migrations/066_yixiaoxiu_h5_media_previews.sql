BEGIN;

-- A bounded private derivative shares the original immutable identity and TTL.
ALTER TABLE intake.web_media_upload
 ADD COLUMN thumbnail_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(thumbnail_status IN ('PENDING','READY','UNAVAILABLE')),
 ADD COLUMN thumbnail_mime_type TEXT,
 ADD COLUMN thumbnail_byte_size BIGINT CHECK(thumbnail_byte_size BETWEEN 1 AND 163840),
 ADD COLUMN thumbnail_sha256 TEXT CHECK(thumbnail_sha256 ~ '^[a-f0-9]{64}$'),
 ADD CONSTRAINT web_media_thumbnail_state CHECK(
  (thumbnail_status='READY' AND kind='IMAGE' AND thumbnail_mime_type='image/jpeg' AND thumbnail_byte_size IS NOT NULL AND thumbnail_sha256 IS NOT NULL)
  OR (thumbnail_status<>'READY' AND thumbnail_mime_type IS NULL AND thumbnail_byte_size IS NULL AND thumbnail_sha256 IS NULL)
 );
CREATE INDEX web_media_pending_thumbnail ON intake.web_media_upload(created_epoch_ms,media_ref)
 WHERE kind='IMAGE' AND state IN ('READY','BOUND') AND thumbnail_status='PENDING';
CREATE INDEX web_media_pending_playback ON intake.web_media_upload(created_epoch_ms,media_ref)
 WHERE kind IN ('VOICE','VIDEO') AND state IN ('READY','BOUND') AND playback_status='PENDING';

COMMIT;
