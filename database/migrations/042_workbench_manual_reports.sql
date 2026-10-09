BEGIN;

-- A real staff-recorded source inside the existing Intake and command ledger.
-- Neither a Channel Message nor a verified external/person identity is created.
ALTER TABLE intake.service_intake
  ADD COLUMN manual_report_snapshot JSONB,
  ADD COLUMN manual_actor_principal_id UUID REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
  ADD COLUMN manual_command_receipt_id UUID UNIQUE REFERENCES pilot_ticket.ticket_command_receipt(id) ON DELETE RESTRICT;

ALTER TABLE intake.service_intake DROP CONSTRAINT service_intake_web_source_check;
ALTER TABLE intake.service_intake ADD CONSTRAINT service_intake_web_source_check CHECK (
  (source_channel = 'PORTAL' AND source_provider = 'YIXIAOXIU_WEB'
    AND primary_web_submission_id IS NOT NULL
    AND source_app_scope IS NOT NULL AND canonical_reporter_binding IS NOT NULL
    AND source_bot_id IS NULL AND source_chat_type IS NULL AND source_chat_id IS NULL
    AND reporter_wecom_userid IS NULL AND primary_message_id IS NULL)
  OR
  (source_channel = 'MANUAL' AND source_provider = 'STAFF_MANUAL_REPORT'
    AND primary_web_submission_id IS NULL AND source_app_scope IS NULL AND canonical_reporter_binding IS NULL
    AND source_bot_id IS NULL AND source_chat_type IS NULL AND source_chat_id IS NULL
    AND reporter_wecom_userid IS NULL AND primary_message_id IS NULL)
  OR
  (NOT (source_channel = 'PORTAL' AND source_provider = 'YIXIAOXIU_WEB') AND source_channel <> 'MANUAL'
    AND primary_web_submission_id IS NULL
    AND source_app_scope IS NULL AND canonical_reporter_binding IS NULL
    AND source_bot_id IS NOT NULL AND source_chat_type IS NOT NULL
    AND reporter_wecom_userid IS NOT NULL AND primary_message_id IS NOT NULL)
);
ALTER TABLE intake.service_intake ADD CONSTRAINT service_intake_manual_source_check CHECK (
  (source_channel = 'MANUAL' AND manual_actor_principal_id IS NOT NULL AND manual_command_receipt_id IS NOT NULL
    AND manual_report_snapshot IS NOT NULL
    AND jsonb_typeof(manual_report_snapshot) = 'object'
    AND manual_report_snapshot ?& ARRAY['source','description','location','reporter','identity_source','manual_contact_required','external_notification']::text[]
    AND manual_report_snapshot - ARRAY['source','description','location','reporter','identity_source','manual_contact_required','external_notification']::text[] = '{}'::jsonb
    AND manual_report_snapshot->>'source' IN ('PHONE','ON_SITE')
    AND manual_report_snapshot->>'identity_source' = 'HAND_ENTERED'
    AND manual_report_snapshot->'manual_contact_required' = 'true'::jsonb
    AND manual_report_snapshot->'external_notification' = 'false'::jsonb
    AND char_length(manual_report_snapshot->>'description') BETWEEN 1 AND 4000
    AND jsonb_typeof(manual_report_snapshot->'description') = 'string'
    AND jsonb_typeof(manual_report_snapshot->'location') = 'object'
    AND manual_report_snapshot->'location' ?& ARRAY['text','unknown']::text[]
    AND (manual_report_snapshot->'location') - ARRAY['text','unknown']::text[] = '{}'::jsonb
    AND ((manual_report_snapshot->'location'->'unknown' = 'true'::jsonb AND manual_report_snapshot->'location'->'text' = 'null'::jsonb)
      OR (manual_report_snapshot->'location'->'unknown' = 'false'::jsonb AND jsonb_typeof(manual_report_snapshot->'location'->'text') = 'string'
        AND char_length(manual_report_snapshot->'location'->>'text') BETWEEN 1 AND 200))
    AND jsonb_typeof(manual_report_snapshot->'reporter') = 'object'
    AND manual_report_snapshot->'reporter' ?& ARRAY['verification','name','contact','department']::text[]
    AND (manual_report_snapshot->'reporter') - ARRAY['verification','name','contact','department']::text[] = '{}'::jsonb
    AND manual_report_snapshot->'reporter'->>'verification' = 'UNVERIFIED'
    AND jsonb_typeof(manual_report_snapshot->'reporter'->'name') = 'string'
    AND jsonb_typeof(manual_report_snapshot->'reporter'->'contact') = 'string'
    AND (manual_report_snapshot->'reporter'->'department' = 'null'::jsonb OR
      (jsonb_typeof(manual_report_snapshot->'reporter'->'department') = 'string' AND char_length(manual_report_snapshot->'reporter'->>'department') BETWEEN 1 AND 100))
    AND char_length(manual_report_snapshot->'reporter'->>'name') BETWEEN 1 AND 100
    AND char_length(manual_report_snapshot->'reporter'->>'contact') BETWEEN 1 AND 100)
  OR (source_channel <> 'MANUAL' AND manual_report_snapshot IS NULL AND manual_actor_principal_id IS NULL AND manual_command_receipt_id IS NULL)
);

ALTER TABLE pilot_ticket.ticket_command_receipt DROP CONSTRAINT p2016_command_resource;
ALTER TABLE pilot_ticket.ticket_command_receipt ADD CONSTRAINT p2016_command_resource CHECK (
  ticket_id IS NOT NULL OR review_id IS NOT NULL OR
  (command_type = 'WORKBENCH_MANUAL_REPORT' AND ticket_id IS NULL AND review_id IS NULL AND conversation_session_id IS NULL)
);

ALTER TABLE intake.contact_journey DROP CONSTRAINT contact_journey_entry_mode_check;
ALTER TABLE intake.contact_journey DROP CONSTRAINT contact_journey_origin_channel_check;
ALTER TABLE intake.contact_journey DROP CONSTRAINT contact_journey_current_channel_check;
ALTER TABLE intake.contact_journey DROP CONSTRAINT contact_journey_entry_origin_check;
ALTER TABLE intake.contact_journey ADD CONSTRAINT contact_journey_entry_mode_check CHECK (entry_mode IN ('GROUP_MENTION_INLINE','GROUP_MENTION_TO_DIRECT_GUIDED','DIRECT_ORGANIC','APP_WEB_SELF_SERVICE','STAFF_MANUAL_REPORT')),
  ADD CONSTRAINT contact_journey_origin_channel_check CHECK (origin_channel IN ('WECOM_GROUP','WECOM_DIRECT','PORTAL','MANUAL')),
  ADD CONSTRAINT contact_journey_current_channel_check CHECK (current_channel IN ('WECOM_GROUP','WECOM_DIRECT','PORTAL','MANUAL')),
  ADD CONSTRAINT contact_journey_entry_origin_check CHECK (
    (entry_mode LIKE 'GROUP_%' AND origin_channel='WECOM_GROUP') OR (entry_mode='DIRECT_ORGANIC' AND origin_channel='WECOM_DIRECT')
    OR (entry_mode='APP_WEB_SELF_SERVICE' AND origin_channel='PORTAL')
    OR (entry_mode='STAFF_MANUAL_REPORT' AND origin_channel='MANUAL' AND current_channel='MANUAL' AND origin_session_id IS NULL AND current_session_id IS NULL)
  );
ALTER TABLE intake.channel_leg DROP CONSTRAINT channel_leg_type_check;
ALTER TABLE intake.channel_leg ADD CONSTRAINT channel_leg_type_check CHECK (leg_type IN ('GROUP_ORIGIN','DIRECT_GUIDED','DIRECT_ORGANIC','GROUP_CONTINUATION','WEB_FORM','MANUAL_REPORT')),
  ADD CONSTRAINT channel_leg_manual_source_check CHECK (leg_type <> 'MANUAL_REPORT' OR
    (conversation_thread_id IS NULL AND conversation_session_id IS NULL AND origin_channel_message_id IS NULL AND web_submission_id IS NULL));
ALTER TABLE intake.deterministic_decision DROP CONSTRAINT deterministic_decision_source_kind_check;
ALTER TABLE intake.deterministic_decision DROP CONSTRAINT deterministic_decision_web_source_check;
ALTER TABLE intake.deterministic_decision ADD CONSTRAINT deterministic_decision_source_kind_check CHECK (source_kind IN ('BOT','WEB','MANUAL')),
  ADD CONSTRAINT deterministic_decision_web_source_check CHECK (
    (source_kind='WEB' AND primary_web_submission_id IS NOT NULL AND basis_input_revision>=1)
    OR (source_kind IN ('BOT','MANUAL') AND primary_web_submission_id IS NULL AND basis_input_revision IS NULL)
  );
COMMENT ON COLUMN intake.service_intake.manual_report_snapshot IS 'Immutable hand-entered UNVERIFIED Reporter facts at report time; never a Person or WeCom binding.';
COMMENT ON COLUMN intake.service_intake.manual_actor_principal_id IS 'Authenticated staff who recorded this report; distinct from actual Reporter.';
COMMIT;
