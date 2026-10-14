BEGIN;
-- One append-only Incident event and the existing principal-bound command receipt.
ALTER TABLE incident.command_receipt DROP CONSTRAINT command_receipt_command_type_check;
ALTER TABLE incident.command_receipt ADD CONSTRAINT command_receipt_command_type_check CHECK (command_type IN ('START_REVIEW','REJECT_CANDIDATE','EXPIRE_CANDIDATE','CONFIRM_INCIDENT','START_INVESTIGATING','CORRECT_SCOPE','SET_PRIMARY_TICKET','LINK_REPORT','UNLINK_REPORT','MARK_REPORTER_RECOVERED','PAUSE_SUBSCRIPTION','RESUME_SUBSCRIPTION','RESOLVE_INCIDENT','CLOSE_INCIDENT','ADD_INTERNAL_NOTE'));
ALTER TABLE incident.incident_event DROP CONSTRAINT incident_event_event_type_check;
ALTER TABLE incident.incident_event ADD CONSTRAINT incident_event_event_type_check CHECK (event_type IN ('candidate.review_started','candidate.rejected','candidate.expired','candidate.confirmed','incident.confirmed','incident.investigating','incident.resolved','incident.closed','incident.primary_ticket_changed','incident.report.linked','incident.report.unlinked','incident.report.recovered','incident.subscription.created','incident.subscription.activated','incident.subscription.paused','incident.subscription.ended','incident.scope.corrected','incident.internal_note_added'));
ALTER TABLE incident.incident_event ADD COLUMN internal_note_text TEXT;
ALTER TABLE incident.incident_event ADD COLUMN internal_note_incident_version BIGINT;
ALTER TABLE incident.incident_event ADD CONSTRAINT p2012_internal_note_shape CHECK (
  (event_type='incident.internal_note_added' AND incident_id IS NOT NULL AND candidate_review_id IS NULL
   AND actor_kind='HUMAN' AND actor_principal_id IS NOT NULL
   AND internal_note_text IS NOT NULL AND char_length(internal_note_text) BETWEEN 1 AND 2000
   AND octet_length(internal_note_text)<=8192 AND internal_note_text ~ '[^[:space:]]'
   AND internal_note_text !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
   AND internal_note_incident_version IS NOT NULL AND internal_note_incident_version>=2
   AND safe_payload='{}'::jsonb AND old_status IS NULL AND new_status IS NULL AND old_scope IS NULL AND new_scope IS NULL)
  OR (event_type<>'incident.internal_note_added' AND internal_note_text IS NULL AND internal_note_incident_version IS NULL)
);
CREATE INDEX p2012_internal_note_page_idx ON incident.incident_event(incident_id,event_ordinal,id)
  WHERE event_type='incident.internal_note_added';
COMMIT;
