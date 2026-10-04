import type { PostgresTransaction, PostgresPool } from './platform/postgres-pool.mjs';
import type { RuleResult, CorroborationAnchor } from './p2-007-rule-engine.mjs';
import type { FactProvenance } from './p2-007-fact-provenance.mjs';
import type { GroupCorroborationSafety } from './p2-015-decision-router.mjs';
export interface CorroborationIntake { id: string; source_provider: string; source_bot_id: string; source_chat_type: string; source_chat_id: string | null; reporter_wecom_userid: string; privacy_class: string }
export interface CorroborationWindow { text: string; rows: { received_epoch_ms: string; message_id: string }[] }
// Internal DB reader uses only these canonical fields, never raw anchor text.
interface AnchorRow { id: string; safe_result: { known_fields: { domain_intent?: string; selected_service_code?: string | null; symptom_codes?: string[] }; fact_provenance?: Pick<FactProvenance, 'status' | 'assertion' | 'sensitivity' | 'source_kind' | 'field_path' | 'normalized_value' | 'fact_id'>[]; corroboration_anchor?: unknown; group_corroboration_safety?: GroupCorroborationSafety; conflicts?: unknown[]; clinical_safety_risk: string }; catalog_version: string; rule_set_version: string; result_hash: string; reporter_identity_hash: string; root_epoch: string }
import { safeHash } from './p2-015-domain-contracts.mjs';
import { P2_015_ENGINE_VERSION } from './p2-015-decision-router.mjs';
import { loadServiceCatalog } from './p2-007-service-catalog.mjs';

const catalog=loadServiceCatalog(),symptoms=new Set(catalog.raw.taxonomies.symptom_codes.map(s=>s.code));
const sensitiveContext=/患者|病人|姓名|身份证|手机|电话|账号|密码|病历|住院号|门诊号|密钥|保密|秘密|token|secret|password|\b\d{6,}\b|(?:\d{1,3}\.){3}\d{1,3}/iu;
export function assessGroupCorroborationSafety({intake,window,output}: { intake: CorroborationIntake; window: CorroborationWindow; output: RuleResult }): GroupCorroborationSafety{
  const flags=[...(output.privacy_flags??[])];if(sensitiveContext.test(window.text))flags.push('POSSIBLE_SENSITIVE_CONTEXT');
  const clinical=output.clinical_impact??'UNKNOWN';
  return {policy_version:'canonical-same-group/1',assessment:'CANONICAL_FIELDS_ONLY_NOT_MESSAGE_DECLASSIFICATION',
    source_privacy_class:intake.privacy_class,privacy_flags:[...new Set(flags)].sort(),clinical_risk:clinical,
    catalog_hash:catalog.catalog_hash,eligible:intake.source_chat_type==='group'&&intake.privacy_class!=='SECRET'
      &&!output.corroboration_anchor&&flags.length===0&&!['HIGH','CRITICAL','CRITICAL_REVIEW_REQUIRED'].includes(clinical)
      &&catalog.lookupService(output.selected_service_code)?.enabled===true&&output.symptom_codes.length>0
      &&output.symptom_codes.every(s=>symptoms.has(s)&&!s.startsWith('DATA.'))};
}

export const isGroupCorroboration = (text: string) => ['同上','+1','加一','我的也是','俺也一样','+10086'].includes(text);

// Internal application reader. No raw anchor text or cross-channel context leaves this seam.
export async function readGroupCorroboration({transaction,intake,window,reporterHash,catalogVersion,ruleVersion}: { transaction: PostgresTransaction; intake: CorroborationIntake; window: CorroborationWindow; reporterHash: string; catalogVersion: string; ruleVersion: string }): Promise<CorroborationAnchor | null | undefined> {
  if(intake.source_chat_type!=='group'||!isGroupCorroboration(window.text.trim()))return null;
  const stamp=(window.rows.at(-1) as CorroborationWindow['rows'][number]).received_epoch_ms;
  const result=await transaction.query<AnchorRow>(`SELECT d.id::text,d.safe_result,d.catalog_version,d.rule_set_version,d.result_hash,
      j.reporter_identity_hash,anchor.received_epoch_ms::text AS root_epoch
    FROM intake.service_intake peer
    JOIN intake.channel_leg l ON l.source_intake_id=peer.id
    JOIN intake.contact_journey j ON j.id=l.journey_id
    JOIN LATERAL(SELECT x.* FROM intake.deterministic_decision x WHERE x.service_intake_id=peer.id
      AND x.engine_version=$1 ORDER BY x.decision_ordinal DESC LIMIT 1)d ON true
    JOIN intake.service_intake_message last_rel ON last_rel.intake_id=peer.id AND last_rel.sequence_no=d.source_window_end_sequence
    JOIN channel.message_inbox last_message ON last_message.id=last_rel.channel_message_id
    JOIN LATERAL(SELECT m.received_epoch_ms,m.retention_until_epoch_ms FROM intake.deterministic_decision old
      JOIN intake.service_intake_message rel ON rel.intake_id=peer.id AND rel.sequence_no=old.source_window_end_sequence
      JOIN channel.message_inbox m ON m.id=rel.channel_message_id
      WHERE old.service_intake_id=peer.id AND old.engine_version=$1 AND old.ticket_creation_recommended
        AND old.safe_result->'known_fields'->>'domain_intent'='INCIDENT_REPORT'
        AND old.safe_result->'known_fields'->>'selected_service_code'=d.safe_result->'known_fields'->>'selected_service_code'
        AND NOT(old.safe_result ? 'corroboration_anchor')
      ORDER BY old.decision_ordinal LIMIT 1)anchor ON true
    WHERE peer.source_provider=$2 AND peer.source_bot_id=$3 AND peer.source_chat_type='group' AND peer.source_chat_id=$4
      AND peer.id<>$5::uuid AND j.reporter_identity_hash<>$6 AND peer.reporter_wecom_userid<>$10
      AND peer.status NOT IN ('COMPLETED','IGNORED','FAILED') AND j.status<>'ENDED' AND l.status='OPEN'
      AND l.reporter_identity_hash=j.reporter_identity_hash AND d.journey_id=j.id AND d.channel_leg_id=l.id
      AND d.source_window_end_sequence=peer.message_count AND d.status<>'HUMAN_OVERRIDDEN'
      AND d.ticket_creation_recommended AND peer.pilot_ticket_id IS NOT NULL
      AND d.catalog_version=$8 AND d.rule_set_version=$9
      AND peer.retention_until_epoch_ms>platform.physical_epoch_ms() AND j.retention_until_epoch_ms>platform.physical_epoch_ms()
      AND anchor.retention_until_epoch_ms>platform.physical_epoch_ms()
      AND anchor.received_epoch_ms BETWEEN $7::bigint-600000 AND $7::bigint
      AND last_message.received_epoch_ms<=$7::bigint AND last_message.received_epoch_ms<=platform.physical_epoch_ms()
      AND NOT EXISTS(SELECT 1 FROM intake.service_intake_message rel JOIN channel.message_inbox m ON m.id=rel.channel_message_id
        WHERE rel.intake_id=peer.id AND (m.provider<>$2 OR m.bot_id<>$3 OR m.chat_type<>'group' OR m.chat_id IS DISTINCT FROM $4
          OR m.sender_user_id<>peer.reporter_wecom_userid OR m.retention_until_epoch_ms<=platform.physical_epoch_ms()
          OR m.privacy_class='SECRET'))
    ORDER BY anchor.received_epoch_ms DESC,d.id LIMIT 101`,[P2_015_ENGINE_VERSION,intake.source_provider,intake.source_bot_id,
      intake.source_chat_id,intake.id,reporterHash,stamp,catalogVersion,ruleVersion,intake.reporter_wecom_userid]);
  if(!result.rows.length||result.rows.length>100)return null;
  const anchors: CorroborationAnchor[]=[];
  for(const row of result.rows){
    const safe=row.safe_result,k=safe.known_fields,fs=safe.fact_provenance??[];
    if(safe.corroboration_anchor||fs.some(f=>f.source_kind==='CONTEXT_INHERITANCE'))continue;
    if(k?.domain_intent!=='INCIDENT_REPORT')continue;
    const safety=safe.group_corroboration_safety;
    if(safety?.policy_version!=='canonical-same-group/1'||safety.eligible!==true||safety.catalog_hash!==catalog.catalog_hash
      ||safety.privacy_flags?.length!==0)return null;
    if(!k.selected_service_code||!k.symptom_codes?.length||k.symptom_codes.some(s=>s.startsWith('DATA.'))
      ||safe.conflicts?.length||['HIGH','CRITICAL','CRITICAL_REVIEW_REQUIRED'].includes(safe.clinical_safety_risk))return null;
    const facts=fs.filter(f=>f.status==='ACTIVE'&&f.assertion==='AFFIRMED'&&f.sensitivity==='INTERNAL'
      &&['REPORTER_EXPLICIT','DETERMINISTIC_RULE'].includes(f.source_kind)
      &&['service.selected_service_code','fault.symptom_codes'].includes(f.field_path));
    if(!facts.some(f=>f.field_path==='service.selected_service_code'&&f.normalized_value===k.selected_service_code)
      ||!k.symptom_codes.every(s=>facts.some(f=>f.field_path==='fault.symptom_codes'&&f.normalized_value===s)))return null;
    anchors.push({source_decision_id:row.id,source_result_hash:row.result_hash,source_reporter_hash:row.reporter_identity_hash,
      source_fact_ids:facts.map(f=>f.fact_id).sort(),service_code:k.selected_service_code,symptom_codes:[...k.symptom_codes].sort(),
      catalog_version:row.catalog_version,rule_set_version:row.rule_set_version,root_received_epoch_ms:row.root_epoch,
      source_privacy_class:safety.source_privacy_class,safety_policy_version:safety.policy_version,
      reply_received_epoch_ms:stamp,reply_message_ref:'channel:'+(window.rows.at(-1) as CorroborationWindow['rows'][number]).message_id,reply_reporter_hash:reporterHash});
  }
  if(!anchors.length||new Set(anchors.map(a=>safeHash({service:a.service_code,symptoms:a.symptom_codes}))).size!==1)return null;
  return anchors[0];
}
