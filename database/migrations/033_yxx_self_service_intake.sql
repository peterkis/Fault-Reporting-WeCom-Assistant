BEGIN;

-- YXX-SS-003: the Web branch is an additive source extension. Migrations
-- 001-032 remain immutable and Unified Ticket Core remains the only Ticket
-- authority.

CREATE SCHEMA IF NOT EXISTS intake;

ALTER TABLE intake.service_intake
  ADD COLUMN IF NOT EXISTS primary_web_submission_id UUID,
  ADD COLUMN IF NOT EXISTS source_app_scope TEXT,
  ADD COLUMN IF NOT EXISTS canonical_reporter_binding TEXT;
ALTER TABLE intake.service_intake
  ALTER COLUMN source_bot_id DROP NOT NULL,
  ALTER COLUMN source_chat_type DROP NOT NULL,
  ALTER COLUMN reporter_wecom_userid DROP NOT NULL,
  ALTER COLUMN primary_message_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS intake.web_command_receipt (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  scope_hash TEXT NOT NULL,
  client_command_id UUID NOT NULL,
  command_kind TEXT NOT NULL,
  command_hash TEXT NOT NULL,
  schema_version SMALLINT NOT NULL DEFAULT 1,
  result_intake_id UUID,
  result_request_ref TEXT,
  accepted_revision BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACCEPTED',
  accepted_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
  accepted_epoch_ms BIGINT NOT NULL DEFAULT platform.physical_epoch_ms(),
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
  CONSTRAINT web_command_receipt_scope_check CHECK (scope_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT web_command_receipt_kind_check CHECK (command_kind IN ('SUBMIT', 'SUPPLEMENT')),
  CONSTRAINT web_command_receipt_hash_check CHECK (command_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT web_command_receipt_schema_check CHECK (schema_version = 1),
  CONSTRAINT web_command_receipt_ref_check CHECK (result_request_ref IS NULL OR result_request_ref ~ '^[A-Za-z0-9_-]{32}$'),
  CONSTRAINT web_command_receipt_revision_check CHECK (accepted_revision >= 1),
  CONSTRAINT web_command_receipt_status_check CHECK (status = 'ACCEPTED'),
  CONSTRAINT web_command_receipt_time_pair_check CHECK (accepted_epoch_ms >= 0 AND accepted_at = platform.local_from_epoch_ms(accepted_epoch_ms)),
  CONSTRAINT web_command_receipt_created_pair_check CHECK (created_at = platform.local_from_epoch_ms(accepted_epoch_ms)),
  CONSTRAINT web_command_receipt_idempotency_unique UNIQUE (scope_hash, client_command_id)
);

CREATE TABLE IF NOT EXISTS intake.web_submission (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  intake_id UUID NOT NULL REFERENCES intake.service_intake(id) ON DELETE RESTRICT,
  command_receipt_id UUID NOT NULL REFERENCES intake.web_command_receipt(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  input_revision BIGINT NOT NULL,
  sequence_no BIGINT NOT NULL,
  safe_content JSONB NOT NULL,
  canonical_content_hash TEXT NOT NULL,
  canonical_reporter_binding TEXT NOT NULL,
  received_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
  received_epoch_ms BIGINT NOT NULL DEFAULT platform.physical_epoch_ms(),
  retention_until TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  retention_until_epoch_ms BIGINT NOT NULL,
  CONSTRAINT web_submission_kind_check CHECK (kind IN ('SUBMIT', 'SUPPLEMENT')),
  CONSTRAINT web_submission_revision_check CHECK (input_revision >= 1 AND sequence_no >= 1),
  CONSTRAINT web_submission_content_check CHECK (jsonb_typeof(safe_content) = 'object'),
  CONSTRAINT web_submission_hash_check CHECK (canonical_content_hash ~ '^[a-f0-9]{64}$' AND canonical_reporter_binding ~ '^[a-f0-9]{64}$'),
  CONSTRAINT web_submission_received_pair_check CHECK (received_epoch_ms >= 0 AND received_at = platform.local_from_epoch_ms(received_epoch_ms)),
  CONSTRAINT web_submission_retention_pair_check CHECK (retention_until_epoch_ms > received_epoch_ms AND retention_until = platform.local_from_epoch_ms(retention_until_epoch_ms)),
  CONSTRAINT web_submission_intake_revision_unique UNIQUE (intake_id, input_revision),
  CONSTRAINT web_submission_intake_sequence_unique UNIQUE (intake_id, sequence_no),
  CONSTRAINT web_submission_id_intake_unique UNIQUE (id, intake_id)
);

CREATE TABLE IF NOT EXISTS intake.web_request_binding (
  intake_id UUID PRIMARY KEY REFERENCES intake.service_intake(id) ON DELETE RESTRICT,
  request_ref TEXT NOT NULL UNIQUE,
  source_corp_scope TEXT NOT NULL,
  source_app_scope TEXT NOT NULL,
  canonical_reporter_binding TEXT NOT NULL,
  binding_version INTEGER NOT NULL DEFAULT 1,
  proof_ref TEXT,
  input_revision BIGINT NOT NULL DEFAULT 0,
  processed_revision BIGINT NOT NULL DEFAULT 0,
  next_attempt_epoch_ms BIGINT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_safe_error_code TEXT,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
  retention_until TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  retention_until_epoch_ms BIGINT NOT NULL,
  revoked_at TIMESTAMP WITHOUT TIME ZONE,
  CONSTRAINT web_binding_ref_check CHECK (request_ref ~ '^[A-Za-z0-9_-]{32}$'),
  CONSTRAINT web_binding_scope_check CHECK (char_length(source_corp_scope) BETWEEN 1 AND 128 AND char_length(source_app_scope) BETWEEN 1 AND 128),
  CONSTRAINT web_binding_reporter_check CHECK (canonical_reporter_binding ~ '^[a-f0-9]{64}$'),
  CONSTRAINT web_binding_version_check CHECK (binding_version >= 1),
  CONSTRAINT web_binding_revision_check CHECK (input_revision >= 0 AND processed_revision >= 0 AND processed_revision <= input_revision),
  CONSTRAINT web_binding_retry_check CHECK (retry_count >= 0 AND retry_count <= 1000),
  CONSTRAINT web_binding_error_check CHECK (last_safe_error_code IS NULL OR last_safe_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT web_binding_retention_pair_check CHECK (retention_until_epoch_ms >= 0 AND retention_until = platform.local_from_epoch_ms(retention_until_epoch_ms)),
  CONSTRAINT web_binding_time_check CHECK (updated_at >= created_at)
);

ALTER TABLE intake.web_request_binding
  ADD CONSTRAINT web_binding_intake_reporter_unique UNIQUE (intake_id, canonical_reporter_binding);

ALTER TABLE intake.web_command_receipt
  ADD CONSTRAINT web_command_receipt_result_intake_fk
    FOREIGN KEY (result_intake_id) REFERENCES intake.service_intake(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE intake.web_submission
  ADD CONSTRAINT web_submission_intake_reporter_fk
    FOREIGN KEY (intake_id, canonical_reporter_binding)
    REFERENCES intake.web_request_binding(intake_id, canonical_reporter_binding) ON DELETE RESTRICT;

ALTER TABLE intake.service_intake
  ADD CONSTRAINT service_intake_primary_web_submission_fk
    FOREIGN KEY (primary_web_submission_id, id)
    REFERENCES intake.web_submission(id, intake_id) DEFERRABLE INITIALLY DEFERRED;

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
      AND reporter_wecom_userid IS NOT NULL AND primary_message_id IS NOT NULL)
  );
ALTER TABLE intake.service_intake
  ADD CONSTRAINT service_intake_web_scope_check CHECK (
    (source_app_scope IS NULL OR char_length(source_app_scope) BETWEEN 1 AND 128)
    AND (canonical_reporter_binding IS NULL OR canonical_reporter_binding ~ '^[a-f0-9]{64}$')
  );

ALTER TABLE intake.contact_journey
  ADD COLUMN IF NOT EXISTS source_app_scope TEXT;
ALTER TABLE intake.contact_journey DROP CONSTRAINT IF EXISTS contact_journey_entry_mode_check;
ALTER TABLE intake.contact_journey DROP CONSTRAINT IF EXISTS contact_journey_origin_channel_check;
ALTER TABLE intake.contact_journey DROP CONSTRAINT IF EXISTS contact_journey_current_channel_check;
ALTER TABLE intake.contact_journey DROP CONSTRAINT IF EXISTS contact_journey_entry_origin_check;
ALTER TABLE intake.contact_journey
  ADD CONSTRAINT contact_journey_entry_mode_check CHECK (entry_mode IN ('GROUP_MENTION_INLINE','GROUP_MENTION_TO_DIRECT_GUIDED','DIRECT_ORGANIC','APP_WEB_SELF_SERVICE')),
  ADD CONSTRAINT contact_journey_origin_channel_check CHECK (origin_channel IN ('WECOM_GROUP','WECOM_DIRECT','PORTAL')),
  ADD CONSTRAINT contact_journey_current_channel_check CHECK (current_channel IN ('WECOM_GROUP','WECOM_DIRECT','PORTAL')),
  ADD CONSTRAINT contact_journey_entry_origin_check CHECK (
    (entry_mode LIKE 'GROUP_%' AND origin_channel = 'WECOM_GROUP')
    OR (entry_mode = 'DIRECT_ORGANIC' AND origin_channel = 'WECOM_DIRECT')
    OR (entry_mode = 'APP_WEB_SELF_SERVICE' AND origin_channel = 'PORTAL')
  ),
  ADD CONSTRAINT contact_journey_web_scope_check CHECK (
    (entry_mode = 'APP_WEB_SELF_SERVICE' AND source_app_scope IS NOT NULL)
    OR (entry_mode <> 'APP_WEB_SELF_SERVICE' AND source_app_scope IS NULL)
  );

ALTER TABLE intake.channel_leg
  ADD COLUMN IF NOT EXISTS web_submission_id UUID;
ALTER TABLE intake.channel_leg DROP CONSTRAINT IF EXISTS channel_leg_type_check;
ALTER TABLE intake.channel_leg
  ADD CONSTRAINT channel_leg_type_check CHECK (leg_type IN ('GROUP_ORIGIN','DIRECT_GUIDED','DIRECT_ORGANIC','GROUP_CONTINUATION','WEB_FORM')),
  ADD CONSTRAINT channel_leg_web_source_check CHECK (
    (leg_type = 'WEB_FORM' AND web_submission_id IS NOT NULL AND conversation_thread_id IS NULL AND conversation_session_id IS NULL AND origin_channel_message_id IS NULL)
    OR (leg_type <> 'WEB_FORM' AND web_submission_id IS NULL)
  );
ALTER TABLE intake.channel_leg
  ADD CONSTRAINT channel_leg_web_identity_unique UNIQUE (id, source_intake_id, web_submission_id),
  ADD CONSTRAINT channel_leg_web_submission_fk
    FOREIGN KEY (web_submission_id, source_intake_id)
    REFERENCES intake.web_submission(id, intake_id) ON DELETE RESTRICT;

ALTER TABLE intake.deterministic_decision
  ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'BOT',
  ADD COLUMN IF NOT EXISTS primary_web_submission_id UUID,
  ADD COLUMN IF NOT EXISTS basis_input_revision BIGINT;
ALTER TABLE intake.deterministic_decision
  ADD CONSTRAINT deterministic_decision_source_kind_check CHECK (source_kind IN ('BOT','WEB')),
  ADD CONSTRAINT deterministic_decision_web_source_check CHECK (
    (source_kind = 'WEB' AND primary_web_submission_id IS NOT NULL AND basis_input_revision >= 1)
    OR (source_kind = 'BOT' AND primary_web_submission_id IS NULL AND basis_input_revision IS NULL)
  ),
  ADD CONSTRAINT deterministic_decision_web_submission_fk
    FOREIGN KEY (primary_web_submission_id) REFERENCES intake.web_submission(id) ON DELETE RESTRICT,
  ADD CONSTRAINT deterministic_decision_web_leg_fk
    FOREIGN KEY (channel_leg_id, service_intake_id, primary_web_submission_id)
    REFERENCES intake.channel_leg(id, source_intake_id, web_submission_id) ON DELETE RESTRICT;

ALTER TABLE intake.manual_review_item
  ADD COLUMN IF NOT EXISTS basis_input_revision BIGINT,
  ADD CONSTRAINT manual_review_basis_revision_check CHECK (basis_input_revision IS NULL OR basis_input_revision >= 1);

ALTER TABLE intake.service_intake_event DROP CONSTRAINT IF EXISTS service_intake_event_type_check;
ALTER TABLE intake.service_intake_event
  ADD CONSTRAINT service_intake_event_type_check CHECK (event_type IN (
    'intake.received','intake.needs_clarification','intake.message_added','intake.clarification_added',
    'intake.ticket_created','intake.rule_decision_applied','intake.manual_review_required','intake.description_requested',
    'intake.web_received','intake.web_supplement_added'
  ));

CREATE INDEX IF NOT EXISTS web_binding_member_created_idx
  ON intake.web_request_binding (canonical_reporter_binding, created_at DESC, intake_id DESC);
CREATE INDEX IF NOT EXISTS web_binding_pending_idx
  ON intake.web_request_binding (next_attempt_epoch_ms, intake_id)
  WHERE processed_revision < input_revision AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS web_submission_intake_received_idx
  ON intake.web_submission (intake_id, input_revision, received_at);
CREATE INDEX IF NOT EXISTS web_receipt_result_idx
  ON intake.web_command_receipt (result_intake_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS decision_web_submission_idx
  ON intake.deterministic_decision (primary_web_submission_id, basis_input_revision)
  WHERE source_kind = 'WEB';

COMMENT ON TABLE intake.web_request_binding IS 'YXX Web Request locator, owner binding and durable processing cursor; no Ticket lifecycle authority.';
COMMENT ON TABLE intake.web_submission IS 'YXX Web SUBMIT/SUPPLEMENT source facts; append-only content revisions.';
COMMENT ON TABLE intake.web_command_receipt IS 'YXX durable acceptance/idempotency receipt; not a Message or Outbox.';

COMMIT;
