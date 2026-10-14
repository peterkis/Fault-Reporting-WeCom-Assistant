BEGIN;
-- One public publication on the original Incident event/receipt and Outbox.
ALTER TABLE incident.command_receipt DROP CONSTRAINT command_receipt_command_type_check;
ALTER TABLE incident.command_receipt ADD CONSTRAINT command_receipt_command_type_check CHECK (command_type IN ('START_REVIEW','REJECT_CANDIDATE','EXPIRE_CANDIDATE','CONFIRM_INCIDENT','START_INVESTIGATING','CORRECT_SCOPE','SET_PRIMARY_TICKET','LINK_REPORT','UNLINK_REPORT','MARK_REPORTER_RECOVERED','PAUSE_SUBSCRIPTION','RESUME_SUBSCRIPTION','RESOLVE_INCIDENT','CLOSE_INCIDENT','ADD_INTERNAL_NOTE','PUBLISH_PUBLIC_PROGRESS'));
ALTER TABLE incident.incident_event DROP CONSTRAINT incident_event_event_type_check;
ALTER TABLE incident.incident_event ADD CONSTRAINT incident_event_event_type_check CHECK (event_type IN ('candidate.review_started','candidate.rejected','candidate.expired','candidate.confirmed','incident.confirmed','incident.investigating','incident.resolved','incident.closed','incident.primary_ticket_changed','incident.report.linked','incident.report.unlinked','incident.report.recovered','incident.subscription.created','incident.subscription.activated','incident.subscription.paused','incident.subscription.ended','incident.scope.corrected','incident.internal_note_added','incident.public_progress_published'));
ALTER TABLE incident.incident_event ADD COLUMN public_progress_summary TEXT;
ALTER TABLE incident.incident_event ADD COLUMN public_progress_incident_version BIGINT;
ALTER TABLE incident.incident_event ADD CONSTRAINT p2012_public_progress_shape CHECK (
 (event_type='incident.public_progress_published' AND incident_id IS NOT NULL AND candidate_review_id IS NULL
  AND actor_kind='HUMAN' AND actor_principal_id IS NOT NULL AND public_progress_summary IS NOT NULL
  AND char_length(public_progress_summary) BETWEEN 1 AND 1000 AND octet_length(public_progress_summary)<=4096
  AND public_progress_summary ~ '[^[:space:]]' AND public_progress_summary !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
  AND public_progress_incident_version IS NOT NULL AND public_progress_incident_version>=2
  AND safe_payload='{}'::jsonb AND old_status IS NULL AND new_status IS NULL AND old_scope IS NULL AND new_scope IS NULL)
 OR (event_type<>'incident.public_progress_published' AND public_progress_summary IS NULL AND public_progress_incident_version IS NULL)
);
CREATE INDEX p2012_public_progress_page_idx ON incident.incident_event(incident_id,event_ordinal,id) WHERE event_type='incident.public_progress_published';
ALTER TABLE communication.incident_notification_binding DROP CONSTRAINT incident_notification_binding_template_code_check;
ALTER TABLE communication.incident_notification_binding ADD CONSTRAINT incident_notification_binding_template_code_check CHECK (template_code IN ('INCIDENT_CONFIRMED_GROUP','INCIDENT_CONFIRMED_DIRECT','INCIDENT_INVESTIGATING_DIRECT','INCIDENT_RESOLVED_GROUP','INCIDENT_RESOLVED_DIRECT','INCIDENT_CLOSED_DIRECT','INCIDENT_PUBLIC_PROGRESS_DIRECT'));
ALTER TABLE communication.incident_notification_binding ADD COLUMN direct_channel_leg_id UUID;
ALTER TABLE communication.incident_notification_binding ADD CONSTRAINT p2012_public_progress_direct_leg_fk FOREIGN KEY (direct_channel_leg_id) REFERENCES intake.channel_leg(id) ON DELETE RESTRICT;
ALTER TABLE communication.incident_notification_binding ADD CONSTRAINT p2012_public_progress_binding_shape CHECK (
 (template_code='INCIDENT_PUBLIC_PROGRESS_DIRECT' AND audience_type='REPORTER_DIRECT' AND reporter_subscription_id IS NOT NULL AND origin_channel_leg_id IS NULL AND direct_channel_leg_id IS NOT NULL)
 OR (template_code<>'INCIDENT_PUBLIC_PROGRESS_DIRECT' AND direct_channel_leg_id IS NULL)
);
CREATE INDEX p2012_public_progress_delivery_page_idx ON communication.incident_notification_binding(incident_id,incident_event_id,created_at,id) WHERE template_code='INCIDENT_PUBLIC_PROGRESS_DIRECT';
COMMIT;
