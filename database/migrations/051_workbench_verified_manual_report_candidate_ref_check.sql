BEGIN;
-- Forward correction of the candidate_ref predicate only; all other 045 CHECK terms remain unchanged.
ALTER TABLE intake.service_intake DROP CONSTRAINT service_intake_manual_verification_check;
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
 AND char_length(manual_reporter_verification->'selection'->>'candidate_ref') BETWEEN 32 AND 256
 AND manual_reporter_verification->'selection'->>'candidate_ref'~'^[A-Za-z0-9_-]+$'
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
COMMIT;
