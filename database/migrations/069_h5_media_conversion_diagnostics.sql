BEGIN;
ALTER TABLE intake.web_media_upload
  ADD COLUMN conversion_error_code TEXT CHECK(conversion_error_code IS NULL OR conversion_error_code ~ '^YXX_MEDIA_[A-Z_]{1,80}$'),
  ADD COLUMN conversion_attempted_epoch_ms BIGINT CHECK(conversion_attempted_epoch_ms IS NULL OR conversion_attempted_epoch_ms>=0),
  ADD COLUMN conversion_error_stage TEXT CHECK(conversion_error_stage IS NULL OR conversion_error_stage IN ('PLAYABLE','THUMBNAIL')),
  ADD CONSTRAINT web_media_conversion_diagnostic_shape CHECK (
    (conversion_error_code IS NULL AND conversion_attempted_epoch_ms IS NULL AND conversion_error_stage IS NULL)
    OR (conversion_error_code IS NOT NULL AND conversion_attempted_epoch_ms IS NOT NULL AND conversion_error_stage IS NOT NULL)
  );
COMMIT;
