BEGIN;
-- Existing Intake only: private mapped-identity observation, no second identity or Ticket fact source.
ALTER TABLE intake.service_intake ADD COLUMN manual_reporter_verification JSONB;
CREATE FUNCTION intake.manual_verified_departments_valid(value JSONB) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT CASE WHEN jsonb_typeof(value)='array' THEN
    jsonb_array_length(value)<=20
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value) AS item(v)
      WHERE jsonb_typeof(v)<>'string' OR char_length(v#>>'{}') NOT BETWEEN 1 AND 100 OR (v#>>'{}')~'[[:cntrl:]]')
    AND (SELECT count(DISTINCT v) FROM jsonb_array_elements(value) AS item(v))=jsonb_array_length(value)
  ELSE false END
$$;
ALTER TABLE intake.service_intake DROP CONSTRAINT service_intake_manual_source_check;
ALTER TABLE intake.service_intake ADD CONSTRAINT service_intake_manual_source_check CHECK ((((

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
) AND manual_reporter_verification IS NULL) OR (
 source_channel='MANUAL' AND source_provider='STAFF_MANUAL_REPORT'
 AND manual_actor_principal_id IS NOT NULL AND manual_command_receipt_id IS NOT NULL AND manual_reporter_verification IS NOT NULL
 AND jsonb_typeof(manual_report_snapshot)='object'
 AND manual_report_snapshot ?& ARRAY['source','description','location','reporter','identity_source','manual_contact_required','external_notification','notification_eligibility']::text[]
 AND manual_report_snapshot-ARRAY['source','description','location','reporter','identity_source','manual_contact_required','external_notification','notification_eligibility']::text[]='{}'::jsonb
 AND manual_report_snapshot->>'source' IN ('PHONE','ON_SITE') AND manual_report_snapshot->>'identity_source'='VERIFIED_DIRECTORY_SELECTION'
 AND jsonb_typeof(manual_report_snapshot->'description')='string' AND char_length(manual_report_snapshot->>'description') BETWEEN 1 AND 4000
 AND manual_report_snapshot->'external_notification'='false'::jsonb
 AND ((manual_report_snapshot->>'notification_eligibility'='ELIGIBLE' AND manual_report_snapshot->'manual_contact_required'='false'::jsonb)
   OR (manual_report_snapshot->>'notification_eligibility'='NOT_REACHABLE' AND manual_report_snapshot->'manual_contact_required'='true'::jsonb))
 AND jsonb_typeof(manual_report_snapshot->'location')='object'
 AND manual_report_snapshot->'location' ?& ARRAY['text','unknown']::text[]
 AND (manual_report_snapshot->'location')-ARRAY['text','unknown']::text[]='{}'::jsonb
 AND ((manual_report_snapshot->'location'->'unknown'='true'::jsonb AND manual_report_snapshot->'location'->'text'='null'::jsonb)
   OR (manual_report_snapshot->'location'->'unknown'='false'::jsonb AND jsonb_typeof(manual_report_snapshot->'location'->'text')='string'
     AND char_length(manual_report_snapshot->'location'->>'text') BETWEEN 1 AND 200))
 AND jsonb_typeof(manual_report_snapshot->'reporter')='object'
 AND manual_report_snapshot->'reporter' ?& ARRAY['verification','name','departments']::text[]
 AND (manual_report_snapshot->'reporter')-ARRAY['verification','name','departments']::text[]='{}'::jsonb
 AND manual_report_snapshot->'reporter'->>'verification'='VERIFIED'
 AND jsonb_typeof(manual_report_snapshot->'reporter'->'name')='string' AND char_length(manual_report_snapshot->'reporter'->>'name') BETWEEN 1 AND 100
 AND intake.manual_verified_departments_valid(manual_report_snapshot->'reporter'->'departments')
)) IS TRUE);
ALTER TABLE intake.service_intake ADD CONSTRAINT service_intake_manual_verification_check CHECK (manual_reporter_verification IS NULL OR (
 source_channel='MANUAL' AND source_provider='STAFF_MANUAL_REPORT'
 AND jsonb_typeof(manual_reporter_verification)='object'
 AND manual_reporter_verification ?& ARRAY['schema_version','purpose','selection','application','directory_source_scope','actor_principal_id','object_access','authorized_at','authorized_at_epoch_ms','valid_until','valid_until_epoch_ms','proof']::text[]
 AND manual_reporter_verification-ARRAY['schema_version','purpose','selection','application','directory_source_scope','actor_principal_id','object_access','authorized_at','authorized_at_epoch_ms','valid_until','valid_until_epoch_ms','proof']::text[]='{}'::jsonb
 AND manual_reporter_verification->'schema_version'='1'::jsonb AND manual_reporter_verification->>'purpose'='ADMISSION'
 AND manual_reporter_verification->>'object_access'='ALLOWED' AND manual_reporter_verification->>'actor_principal_id'=manual_actor_principal_id::text
 AND jsonb_typeof(manual_reporter_verification->'selection')='object'
 AND manual_reporter_verification->'selection' ?& ARRAY['verification','candidate_ref','candidate_version']::text[]
 AND (manual_reporter_verification->'selection')-ARRAY['verification','candidate_ref','candidate_version']::text[]='{}'::jsonb
 AND manual_reporter_verification->'selection'->>'verification'='VERIFIED_SELECTION'
 AND manual_reporter_verification->'selection'->>'candidate_ref'~'^[A-Za-z0-9_-]{32,256}$'
 AND manual_reporter_verification->'selection'->>'candidate_version'~'^[a-f0-9]{64}$'
 AND jsonb_typeof(manual_reporter_verification->'application')='object'
 AND manual_reporter_verification->'application' ?& ARRAY['sourceCorpScope','sourceAppScope']::text[]
 AND (manual_reporter_verification->'application')-ARRAY['sourceCorpScope','sourceAppScope']::text[]='{}'::jsonb
 AND jsonb_typeof(manual_reporter_verification->'proof')='object'
 AND manual_reporter_verification->'proof' ?& ARRAY['source','scope','mapping_config_hash','verification_method','profile_source','directory_source_scope','directory_snapshot_version','profile_at_report','binding_proof_ref','account_status','binding_state','proof_kind','reachability','verified_at','verified_at_epoch_ms','actor_principal_id']::text[]
 AND (manual_reporter_verification->'proof')-ARRAY['source','scope','mapping_config_hash','verification_method','profile_source','directory_source_scope','directory_snapshot_version','profile_at_report','binding_proof_ref','account_status','binding_state','proof_kind','reachability','verified_at','verified_at_epoch_ms','actor_principal_id']::text[]='{}'::jsonb
 AND manual_reporter_verification->'proof'->>'source'='VERIFIED_DIRECTORY_SELECTION'
 AND manual_reporter_verification->'proof'->>'verification_method'='VERIFIED_DELEGATED_MAPPING'
 AND manual_reporter_verification->'proof'->>'account_status'='ACTIVE' AND manual_reporter_verification->'proof'->>'binding_state'='VERIFIED'
 AND manual_reporter_verification->'proof'->>'proof_kind' IN ('LIVE','SYNTHETIC')
 AND manual_reporter_verification->'proof'->>'profile_source' IN ('WECOM_DIRECTORY','THIRD_PARTY_STAFF_DIRECTORY')
 AND manual_reporter_verification->'proof'->>'mapping_config_hash'~'^[a-f0-9]{64}$'
 AND manual_reporter_verification->'proof'->>'actor_principal_id'=manual_actor_principal_id::text
 AND manual_reporter_verification->'proof'->>'directory_source_scope'=manual_reporter_verification->>'directory_source_scope'
 AND jsonb_typeof(manual_reporter_verification->'proof'->'scope')='object'
 AND manual_reporter_verification->'proof'->'scope' ?& ARRAY['scopeHash','sourceCorpScope','sourceAppScope','proofRef']::text[]
 AND (manual_reporter_verification->'proof'->'scope')-ARRAY['scopeHash','sourceCorpScope','sourceAppScope','proofRef']::text[]='{}'::jsonb
 AND manual_reporter_verification->'proof'->'scope'->>'scopeHash'~'^[a-f0-9]{64}$'
 AND manual_reporter_verification->'proof'->'scope'->>'sourceCorpScope'=manual_reporter_verification->'application'->>'sourceCorpScope'
 AND manual_reporter_verification->'proof'->'scope'->>'sourceAppScope'=manual_reporter_verification->'application'->>'sourceAppScope'
 AND char_length(manual_reporter_verification->'proof'->'scope'->>'sourceCorpScope') BETWEEN 1 AND 128
 AND char_length(manual_reporter_verification->'proof'->'scope'->>'sourceAppScope') BETWEEN 1 AND 128
 AND manual_reporter_verification->'proof'->'scope'->>'proofRef'~'^[A-Za-z0-9][A-Za-z0-9_./-]{0,255}$'
 AND manual_reporter_verification->'proof'->>'binding_proof_ref'~'^[A-Za-z0-9][A-Za-z0-9_./-]{0,255}$'
 AND char_length(manual_reporter_verification->>'directory_source_scope') BETWEEN 1 AND 128
 AND char_length(manual_reporter_verification->'proof'->>'directory_snapshot_version') BETWEEN 1 AND 256
 AND jsonb_typeof(manual_reporter_verification->'proof'->'profile_at_report')='object'
 AND manual_reporter_verification->'proof'->'profile_at_report' ?& ARRAY['display_name','departments']::text[]
 AND (manual_reporter_verification->'proof'->'profile_at_report')-ARRAY['display_name','departments']::text[]='{}'::jsonb
 AND manual_reporter_verification->'proof'->'profile_at_report'->'display_name'=manual_report_snapshot->'reporter'->'name'
 AND manual_reporter_verification->'proof'->'profile_at_report'->'departments'=manual_report_snapshot->'reporter'->'departments'
 AND jsonb_typeof(manual_reporter_verification->'proof'->'reachability')='object'
 AND manual_reporter_verification->'proof'->'reachability' ?& ARRAY['status','target_scope_hash','checked_at','checked_at_epoch_ms','proof_ref']::text[]
 AND (manual_reporter_verification->'proof'->'reachability')-ARRAY['status','target_scope_hash','checked_at','checked_at_epoch_ms','proof_ref']::text[]='{}'::jsonb
 AND manual_reporter_verification->'proof'->'reachability'->>'target_scope_hash'=manual_reporter_verification->'proof'->'scope'->>'scopeHash'
 AND ((manual_reporter_verification->'proof'->'reachability'->>'status'='REACHABLE' AND manual_report_snapshot->>'notification_eligibility'='ELIGIBLE'
       AND manual_reporter_verification->'proof'->'reachability'->>'proof_ref'~'^[A-Za-z0-9][A-Za-z0-9_./-]{0,255}$')
   OR (manual_reporter_verification->'proof'->'reachability'->>'status' IN ('UNREACHABLE','UNKNOWN') AND manual_report_snapshot->>'notification_eligibility'='NOT_REACHABLE'
       AND (manual_reporter_verification->'proof'->'reachability'->'proof_ref'='null'::jsonb OR manual_reporter_verification->'proof'->'reachability'->>'proof_ref'~'^[A-Za-z0-9][A-Za-z0-9_./-]{0,255}$')))
 AND (manual_reporter_verification->>'authorized_at_epoch_ms')~'^[0-9]{1,16}$'
 AND (manual_reporter_verification->>'valid_until_epoch_ms')~'^[0-9]{1,16}$'
 AND (manual_reporter_verification->'proof'->>'verified_at_epoch_ms')=(manual_reporter_verification->>'authorized_at_epoch_ms')
 AND (manual_reporter_verification->'proof'->'reachability'->>'checked_at_epoch_ms')~'^[0-9]{1,16}$'
 AND manual_reporter_verification->>'authorized_at'=to_char(platform.local_from_epoch_ms((manual_reporter_verification->>'authorized_at_epoch_ms')::bigint),'YYYY-MM-DD HH24:MI:SS')
 AND manual_reporter_verification->>'valid_until'=to_char(platform.local_from_epoch_ms((manual_reporter_verification->>'valid_until_epoch_ms')::bigint),'YYYY-MM-DD HH24:MI:SS')
 AND manual_reporter_verification->'proof'->>'verified_at'=manual_reporter_verification->>'authorized_at'
 AND manual_reporter_verification->'proof'->'reachability'->>'checked_at'=to_char(platform.local_from_epoch_ms((manual_reporter_verification->'proof'->'reachability'->>'checked_at_epoch_ms')::bigint),'YYYY-MM-DD HH24:MI:SS')
 AND (manual_reporter_verification->>'valid_until_epoch_ms')::bigint-(manual_reporter_verification->>'authorized_at_epoch_ms')::bigint BETWEEN 1 AND 300000
 AND (manual_reporter_verification->>'authorized_at_epoch_ms')::bigint-(manual_reporter_verification->'proof'->'reachability'->>'checked_at_epoch_ms')::bigint BETWEEN 0 AND 300000
) IS TRUE);
COMMENT ON COLUMN intake.service_intake.manual_reporter_verification IS 'Private immutable report-time observation of configured mapped identity and Directory authority; never a Person/ownership registry or public DTO.';
COMMIT;
