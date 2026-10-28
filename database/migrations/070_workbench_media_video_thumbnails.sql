BEGIN;

-- Forward-only: preserve existing registrations, original bytes and derived files.
ALTER TABLE intake.web_media_upload DROP CONSTRAINT web_media_thumbnail_state;
ALTER TABLE intake.web_media_upload ADD CONSTRAINT web_media_thumbnail_state CHECK(
 (thumbnail_status='READY' AND kind IN ('IMAGE','VIDEO') AND thumbnail_mime_type='image/jpeg'
  AND thumbnail_byte_size IS NOT NULL AND thumbnail_sha256 IS NOT NULL)
 OR (thumbnail_status<>'READY' AND thumbnail_mime_type IS NULL AND thumbnail_byte_size IS NULL AND thumbnail_sha256 IS NULL)
);
DROP INDEX intake.web_media_pending_thumbnail;
CREATE INDEX web_media_pending_thumbnail ON intake.web_media_upload(created_epoch_ms,media_ref)
 WHERE kind IN ('IMAGE','VIDEO') AND state IN ('READY','BOUND') AND thumbnail_status='PENDING';

COMMIT;
