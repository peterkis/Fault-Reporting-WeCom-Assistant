import { generateIncidentCandidate } from './p2-007-incident-candidate.mjs';
import { createP2012CandidateSourceAdapter } from './p2-012-candidate-source-adapter.mjs';
import { transaction, hash } from './p2-012-domain-contracts.mjs';
import { P2_015_ENGINE_VERSION } from './p2-015-decision-router.mjs';

const WINDOW_MS = 120000n;
const code = value => typeof value === 'string' && /^[A-Z][A-Z0-9_.]{0,63}$/u.test(value) ? value.replaceAll('.', '_') : null;
function faultFamily(known) {
  const service = code(known?.selected_service_code);
  const symptoms = known?.symptom_codes;
  if (!service || service === 'UNKNOWN' || !Array.isArray(symptoms) || !symptoms.length) return null;
  const families = new Set(symptoms.map(s => ['AVAILABILITY.UNAVAILABLE', 'STABILITY.CRASH', 'UI.BLANK'].includes(s)
    ? 'SERVICE_UNAVAILABLE' : code(s)));
  if (families.size !== 1 || families.has(null) || families.has('UNKNOWN')) return null;
  return { service_family: service, symptom_family: [...families][0] };
}

function primaryDepartment(row){
  const profile=row.profile_snapshot;
  if(row.profile_resolution_status!=='RESOLVED'||profile?.source!=='WECOM_DIRECTORY'
    ||typeof profile.version!=='string'||!profile.version||profile.version.length>256||!Array.isArray(profile.memberships))return null;
  const primary=profile.memberships.filter(m=>m?.role==='PRIMARY');
  const ref=primary[0]?.department_ref;
  return primary.length===1&&typeof ref==='string'&&ref.length>0&&ref.length<=256
    ?hash({bot:row.source_bot_id,department:ref}):null;
}
// Only immutable directory snapshots supply department authority. No monitoring,
// raw-text department inference or caller-supplied counts enter this reader.
// Latest original Decision is selected before eligibility; derived/overridden results never feed back.
export function createIncidentCorrelationWorker({ pool, enabled = false }) {
  const recorder = createP2012CandidateSourceAdapter({ pool, enabled });
  return Object.freeze({ async runOnce({ nowEpochMs = null } = {}) {
    if (!enabled) return { correlated: 0, correlation_overflow: false };
    return transaction(pool, async tx => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('p2-015-incident-correlation/1',0))");
      const clock = nowEpochMs ?? (await tx.query('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0].epoch;
      if (!/^\d{1,16}$/u.test(String(clock))) throw new Error('INVALID_CORRELATION_CLOCK');
      const now = BigInt(clock);
      const result = await tx.query(`SELECT d.*,j.reporter_identity_hash,i.source_bot_id,j.profile_snapshot,j.profile_resolution_status,
          anchor.received_epoch_ms::text AS fault_epoch_ms,anchor.received_at AS fault_at
        FROM intake.service_intake i
        JOIN intake.channel_leg l ON l.source_intake_id=i.id
        JOIN intake.contact_journey j ON j.id=l.journey_id
        JOIN LATERAL (SELECT x.* FROM intake.deterministic_decision x
          WHERE x.service_intake_id=i.id AND x.engine_version=$1
          ORDER BY x.decision_ordinal DESC LIMIT 1) d ON true
        JOIN intake.service_intake_message latest_rel ON latest_rel.intake_id=i.id
          AND latest_rel.sequence_no=d.source_window_end_sequence
        JOIN channel.message_inbox latest_message ON latest_message.id=latest_rel.channel_message_id
        JOIN LATERAL (SELECT m.received_epoch_ms,m.received_at
          FROM intake.deterministic_decision old
          JOIN intake.service_intake_message rel ON rel.intake_id=i.id AND rel.sequence_no=old.source_window_end_sequence
          JOIN channel.message_inbox m ON m.id=rel.channel_message_id
          WHERE old.service_intake_id=i.id AND old.engine_version=$1
            AND old.ticket_creation_recommended=true
            AND old.safe_result->'known_fields'->>'domain_intent'='INCIDENT_REPORT'
            AND old.safe_result->'known_fields'->>'selected_service_code'=d.safe_result->'known_fields'->>'selected_service_code'
            AND jsonb_array_length(COALESCE(old.safe_result->'known_fields'->'symptom_codes','[]'::jsonb))>0
          ORDER BY old.decision_ordinal LIMIT 1) anchor ON true
        WHERE j.status<>'ENDED' AND l.status='OPEN' AND i.status NOT IN ('COMPLETED','IGNORED','FAILED')
          AND NOT EXISTS (SELECT 1 FROM intake.service_intake pending
            LEFT JOIN LATERAL (SELECT x.source_window_end_sequence FROM intake.deterministic_decision x
              WHERE x.service_intake_id=pending.id AND x.engine_version=$1
              ORDER BY x.decision_ordinal DESC LIMIT 1) processed ON true
            WHERE pending.source_bot_id=i.source_bot_id AND pending.reporter_wecom_userid=i.reporter_wecom_userid
              AND pending.last_message_at>=latest_message.received_at
              AND COALESCE(processed.source_window_end_sequence,0)<pending.message_count)
          AND NOT EXISTS (SELECT 1 FROM intake.channel_leg sibling
            JOIN intake.service_intake sibling_intake ON sibling_intake.id=sibling.source_intake_id
            LEFT JOIN LATERAL (SELECT x.* FROM intake.deterministic_decision x
              WHERE x.service_intake_id=sibling_intake.id AND x.engine_version=$1
              ORDER BY x.decision_ordinal DESC LIMIT 1) sibling_decision ON true
            WHERE sibling.journey_id=j.id AND sibling.reporter_identity_hash=j.reporter_identity_hash
              AND (sibling_decision.id IS NULL OR sibling_decision.source_window_end_sequence<sibling_intake.message_count
                OR (sibling_decision.decision_ordinal>d.decision_ordinal
                  AND (sibling_decision.status='HUMAN_OVERRIDDEN'
                    OR sibling_decision.safe_result->'known_fields'->>'domain_intent'='RECOVERY_UPDATE'))))
          AND j.retention_until_epoch_ms>$2::bigint AND i.retention_until_epoch_ms>$2::bigint
          AND l.reporter_identity_hash=j.reporter_identity_hash AND d.journey_id=j.id AND d.channel_leg_id=l.id
          AND d.status<>'HUMAN_OVERRIDDEN' AND d.source_window_end_sequence=i.message_count
          AND i.pilot_ticket_id IS NOT NULL AND d.ticket_creation_recommended=true
          AND latest_message.received_epoch_ms<=$2::bigint
          AND anchor.received_epoch_ms BETWEEN $3::bigint AND $2::bigint
        ORDER BY anchor.received_epoch_ms,d.id LIMIT 101`, [P2_015_ENGINE_VERSION, String(now), String(now - WINDOW_MS)]);
      if (result.rows.length > 100) return { correlated: 0, correlation_overflow: true };
      const groups = new Map();
      for (const row of result.rows) {
        const safe = row.safe_result, family = faultFamily(safe.known_fields);
        if (!family || safe.known_fields.domain_intent !== 'INCIDENT_REPORT' || safe.conflicts?.length) continue;
        const facts = (safe.fact_provenance ?? []).filter(f => /^fact_[A-Za-z0-9_-]{8,96}$/u.test(f.fact_id ?? '')
          && f.source_ref === 'intake:' + row.service_intake_id && f.status === 'ACTIVE' && f.assertion === 'AFFIRMED'
          && ['REPORTER_EXPLICIT','REPORTER_CORRECTION','DETERMINISTIC_RULE'].includes(f.source_kind));
        if (!facts.some(f => f.field_path === 'fault.symptom_codes')) continue;
        const key = hash({ bot: row.source_bot_id, service: safe.known_fields.selected_service_code,
          catalog: row.catalog_version, rules: row.rule_set_version, ...family });
        if (!groups.has(key)) groups.set(key, { family, rows: [] });
        groups.get(key).rows.push({ row, facts });
      }
      let correlated = 0;
      for (const { family, rows } of [...groups.values()].slice(0, 20)) {
        const departments=new Map();
        for(const {row} of rows){
          if(!departments.has(row.reporter_identity_hash))departments.set(row.reporter_identity_hash,new Set());
          departments.get(row.reporter_identity_hash).add(primaryDepartment(row));
        }
        const severities = ['UNKNOWN', 'LOW', 'MODERATE', 'MEDIUM', 'HIGH', 'CRITICAL', 'CRITICAL_REVIEW_REQUIRED'];
        const clinicalSeverity = rows.map(({ row }) => row.safe_result.clinical_safety_risk)
          .filter(s => severities.includes(s)).sort((a,b) => severities.indexOf(b)-severities.indexOf(a))[0] ?? 'UNKNOWN';
        const candidate = generateIncidentCandidate({ ...family, clinical_severity_candidate: clinicalSeverity,
          reports: rows.map(({ row, facts }) => ({
          reporter_ref: row.reporter_identity_hash, observed_at: row.fault_at,
          ...(departments.get(row.reporter_identity_hash).size===1&&primaryDepartment(row)
            ?{department_ref:primaryDepartment(row)}:{}),
          evidence_fact_ids: facts.map(f => f.fact_id), ...family,
        })) });
        if (!candidate.is_candidate) continue;
        const ids = rows.map(({ row }) => row.id).sort();
        const recorded = await recorder.record({ sourceDecisionId: ids[0], candidate,
          reportDecisionIds: ids, transaction: tx });
        if (!recorded.replayed) correlated++;
      }
      return { correlated, correlation_overflow: false };
    });
  } });
}
