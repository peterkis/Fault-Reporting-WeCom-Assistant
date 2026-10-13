BEGIN;
-- Append to the complete accepted 055 + 058 catalogs, never replace either purpose.
ALTER TABLE incident.command_receipt DROP CONSTRAINT command_receipt_command_type_check;
ALTER TABLE incident.command_receipt ADD CONSTRAINT command_receipt_command_type_check CHECK (command_type IN ('START_REVIEW','REJECT_CANDIDATE','EXPIRE_CANDIDATE','CONFIRM_INCIDENT','START_INVESTIGATING','CORRECT_SCOPE','SET_PRIMARY_TICKET','LINK_REPORT','UNLINK_REPORT','MARK_REPORTER_RECOVERED','PAUSE_SUBSCRIPTION','RESUME_SUBSCRIPTION','RESOLVE_INCIDENT','CLOSE_INCIDENT','ADD_INTERNAL_NOTE','PUBLISH_PUBLIC_PROGRESS','TRANSFER_OWNER'));
ALTER TABLE incident.incident_event DROP CONSTRAINT incident_event_event_type_check;
ALTER TABLE incident.incident_event ADD CONSTRAINT incident_event_event_type_check CHECK (event_type IN ('candidate.review_started','candidate.rejected','candidate.expired','candidate.confirmed','incident.confirmed','incident.investigating','incident.resolved','incident.closed','incident.primary_ticket_changed','incident.report.linked','incident.report.unlinked','incident.report.recovered','incident.subscription.created','incident.subscription.activated','incident.subscription.paused','incident.subscription.ended','incident.scope.corrected','incident.internal_note_added','incident.public_progress_published','incident.owner.transferred'));
ALTER TABLE incident.incident_event ADD CONSTRAINT p2012_owner_transfer_shape CHECK (
 COALESCE((event_type='incident.owner.transferred' AND incident_id IS NOT NULL AND candidate_review_id IS NULL
  AND actor_kind='HUMAN' AND actor_principal_id IS NOT NULL
  AND old_status IS NULL AND new_status IS NULL AND old_scope IS NULL AND new_scope IS NULL
  AND safe_payload ?& ARRAY['reason_code','owner_transfer'] AND safe_payload-ARRAY['reason_code','owner_transfer']='{}'::jsonb
  AND safe_payload->>'reason_code' IN ('OPERATOR_REVIEWED','CONFIRMED_SHARED_FAULT','INCORRECT_ASSOCIATION','RECOVERY_CONFIRMED','SUBSCRIPTION_REQUEST','SCOPE_CORRECTION','MAINTENANCE_EXPIRED','WORKBENCH_CONFIRMED')
  AND jsonb_typeof(safe_payload->'owner_transfer')='object'
  AND safe_payload->'owner_transfer' ?& ARRAY['previous','next']
  AND (safe_payload->'owner_transfer')-ARRAY['previous','next']='{}'::jsonb
  AND jsonb_typeof(safe_payload#>'{owner_transfer,previous}')='object'
  AND (safe_payload#>'{owner_transfer,previous}') ?& ARRAY['owner_principal_id','owner_team_id']
  AND (safe_payload#>'{owner_transfer,previous}')-ARRAY['owner_principal_id','owner_team_id']='{}'::jsonb
  AND (safe_payload#>>'{owner_transfer,previous,owner_principal_id}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND (jsonb_typeof(safe_payload#>'{owner_transfer,previous,owner_team_id}')='null' OR (safe_payload#>>'{owner_transfer,previous,owner_team_id}') ~ '^[A-Z][A-Z0-9_]{0,63}$')
  AND jsonb_typeof(safe_payload#>'{owner_transfer,next}')='object'
  AND (safe_payload#>'{owner_transfer,next}') ?& ARRAY['owner_principal_id','owner_team_id']
  AND (safe_payload#>'{owner_transfer,next}')-ARRAY['owner_principal_id','owner_team_id']='{}'::jsonb
  AND (safe_payload#>>'{owner_transfer,next,owner_principal_id}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND (jsonb_typeof(safe_payload#>'{owner_transfer,next,owner_team_id}')='null' OR (safe_payload#>>'{owner_transfer,next,owner_team_id}') ~ '^[A-Z][A-Z0-9_]{0,63}$')),false)
 OR (event_type<>'incident.owner.transferred' AND NOT (safe_payload ? 'owner_transfer'))
);
COMMIT;
