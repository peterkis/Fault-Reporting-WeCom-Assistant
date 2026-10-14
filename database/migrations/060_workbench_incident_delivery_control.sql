BEGIN;
-- T33 extends only the original Incident principal-bound receipt.
ALTER TABLE incident.command_receipt ADD COLUMN delivery_id UUID REFERENCES communication.delivery(id) ON DELETE RESTRICT;
ALTER TABLE incident.command_receipt ADD COLUMN delivery_control_reason TEXT;
ALTER TABLE incident.command_receipt ADD COLUMN delivery_control_resolution TEXT;
ALTER TABLE incident.command_receipt ADD COLUMN expected_delivery_status TEXT;
ALTER TABLE incident.command_receipt ADD COLUMN expected_delivery_side_effect_state TEXT;
ALTER TABLE incident.command_receipt ADD COLUMN delivery_control_result JSONB;
ALTER TABLE incident.command_receipt DROP CONSTRAINT command_receipt_command_type_check;
ALTER TABLE incident.command_receipt ADD CONSTRAINT command_receipt_command_type_check CHECK (command_type IN ('START_REVIEW','REJECT_CANDIDATE','EXPIRE_CANDIDATE','CONFIRM_INCIDENT','START_INVESTIGATING','CORRECT_SCOPE','SET_PRIMARY_TICKET','LINK_REPORT','UNLINK_REPORT','MARK_REPORTER_RECOVERED','PAUSE_SUBSCRIPTION','RESUME_SUBSCRIPTION','RESOLVE_INCIDENT','CLOSE_INCIDENT','ADD_INTERNAL_NOTE','PUBLISH_PUBLIC_PROGRESS','TRANSFER_OWNER','DELIVERY_RETRY','DELIVERY_RECONCILE'));
ALTER TABLE incident.command_receipt ADD CONSTRAINT p2012_delivery_control_identity CHECK (
 (command_type IN ('DELIVERY_RETRY','DELIVERY_RECONCILE') AND delivery_id IS NOT NULL AND incident_id IS NOT NULL AND candidate_review_id IS NULL AND actor_principal_id IS NOT NULL AND delivery_control_reason IS NOT NULL AND expected_delivery_status IS NOT NULL AND expected_delivery_side_effect_state IS NOT NULL AND delivery_control_reason ~ '^[A-Z0-9_]{1,128}$'
 AND ((command_type='DELIVERY_RETRY' AND delivery_control_resolution IS NULL AND expected_delivery_status IN ('PENDING','DEAD_LETTER') AND expected_delivery_side_effect_state='NOT_ATTEMPTED')
 OR (command_type='DELIVERY_RECONCILE' AND delivery_control_resolution IS NOT NULL AND delivery_control_resolution IN ('CONFIRMED_SENT','CONFIRMED_NOT_SENT_REQUEUE','CANCEL') AND expected_delivery_status='RECONCILIATION_REQUIRED' AND expected_delivery_side_effect_state='UNKNOWN')))
 OR (command_type NOT IN ('DELIVERY_RETRY','DELIVERY_RECONCILE') AND delivery_id IS NULL AND delivery_control_reason IS NULL AND delivery_control_resolution IS NULL AND expected_delivery_status IS NULL AND expected_delivery_side_effect_state IS NULL AND delivery_control_result IS NULL));
ALTER TABLE incident.command_receipt DROP CONSTRAINT p2012_command_result;
ALTER TABLE incident.command_receipt ADD CONSTRAINT p2012_command_result CHECK (
 (state='STARTED' AND completed_at IS NULL AND result_ref_id IS NULL AND error_code IS NULL AND delivery_control_result IS NULL)
 OR (state='COMMITTED' AND completed_at IS NOT NULL AND result_ref_type IS NOT NULL AND result_ref_id IS NOT NULL AND result_row_version IS NOT NULL AND error_code IS NULL
  AND ((command_type NOT IN ('DELIVERY_RETRY','DELIVERY_RECONCILE') AND result_event_id IS NOT NULL AND delivery_control_result IS NULL)
   OR (command_type IN ('DELIVERY_RETRY','DELIVERY_RECONCILE') AND result_ref_type='INCIDENT' AND result_ref_id=incident_id AND result_event_id IS NULL AND delivery_control_result IS NOT NULL AND jsonb_typeof(delivery_control_result)='object'
    AND delivery_control_result ?& ARRAY['ok','incident_id','delivery_id','client_command_id','status','side_effect_state','attempt_count','replayed']
    AND delivery_control_result - ARRAY['ok','incident_id','delivery_id','client_command_id','status','side_effect_state','attempt_count','replayed']='{}'::jsonb
    AND delivery_control_result->'ok'='true'::jsonb AND delivery_control_result->'replayed'='false'::jsonb
    AND jsonb_typeof(delivery_control_result->'incident_id')='string' AND jsonb_typeof(delivery_control_result->'delivery_id')='string' AND jsonb_typeof(delivery_control_result->'client_command_id')='string' AND jsonb_typeof(delivery_control_result->'status')='string' AND jsonb_typeof(delivery_control_result->'side_effect_state')='string' AND delivery_control_result->>'incident_id'=incident_id::text AND delivery_control_result->>'delivery_id'=delivery_id::text AND delivery_control_result->>'client_command_id'=client_command_id::text
    AND delivery_control_result->>'status' IN ('PENDING','LEASED','SENDING','SENT','RECONCILIATION_REQUIRED','DEAD_LETTER','CANCELLED')
    AND delivery_control_result->>'side_effect_state' IN ('NOT_ATTEMPTED','ACKNOWLEDGED','UNKNOWN')
    AND jsonb_typeof(delivery_control_result->'attempt_count')='number' AND (delivery_control_result->>'attempt_count') ~ '^(0|[1-9][0-9]{0,9})$' AND (delivery_control_result->>'attempt_count')::bigint<=2147483647)))
 OR (state='FAILED' AND completed_at IS NOT NULL AND result_ref_id IS NULL AND error_code IS NOT NULL AND retryable IS NOT NULL AND delivery_control_result IS NULL));
COMMIT;
