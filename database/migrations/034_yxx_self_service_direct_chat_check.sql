BEGIN;

-- YXX-SS-004 corrective migration. Migration 033 is immutable; this forward
-- constraint keeps the existing Bot single/group source invariant while the
-- Web branch remains the only source allowed to null chat fields.
ALTER TABLE intake.service_intake
  DROP CONSTRAINT IF EXISTS service_intake_web_source_check;

ALTER TABLE intake.service_intake
  ADD CONSTRAINT service_intake_web_source_check CHECK (
    (source_channel = 'PORTAL' AND source_provider = 'YIXIAOXIU_WEB'
      AND primary_web_submission_id IS NOT NULL
      AND source_app_scope IS NOT NULL AND canonical_reporter_binding IS NOT NULL
      AND source_bot_id IS NULL AND source_chat_type IS NULL AND source_chat_id IS NULL
      AND reporter_wecom_userid IS NULL AND primary_message_id IS NULL)
    OR
    (NOT (source_channel = 'PORTAL' AND source_provider = 'YIXIAOXIU_WEB')
      AND primary_web_submission_id IS NULL
      AND source_app_scope IS NULL AND canonical_reporter_binding IS NULL
      AND source_bot_id IS NOT NULL AND source_chat_type IS NOT NULL
      AND reporter_wecom_userid IS NOT NULL AND primary_message_id IS NOT NULL
      AND ((source_chat_type = 'single' AND source_chat_id IS NULL)
        OR (source_chat_type = 'group' AND char_length(source_chat_id) BETWEEN 1 AND 256)))
  );

COMMIT;
