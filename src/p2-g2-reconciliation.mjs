import { g2Hash, validateG2Manifest, failG2 } from './p2-g2-validation-config.mjs';
import { createP2012PersonDestinationAuthorizer } from './p2-012-live-reporter-scope.mjs';
import { g2SourceBinding } from './p2-g2-evidence-files.mjs';

export const G2_RECONCILIATION_SQL=Object.freeze({
  counts:`SELECT platform.physical_epoch_ms()::text AS physical_epoch_ms,
    (SELECT count(*)::integer FROM channel.message_inbox) AS inbox_count,
    (SELECT count(*)::integer FROM pilot_ticket.ticket) AS ticket_count,
    (SELECT count(*)::integer FROM incident.incident) AS incident_count,
    (SELECT count(*)::integer FROM communication.delivery WHERE status='RECONCILIATION_REQUIRED') AS unknown_pending,
    (SELECT count(*)::integer FROM communication.delivery WHERE status='DEAD_LETTER') AS dead_letters,
    (SELECT count(*)::integer FROM communication.delivery WHERE status IN ('PENDING','LEASED','SENDING')) AS communication_pending,
    (SELECT count(*)::integer FROM intake.safe_action_suggestion WHERE state='PROPOSED') AS safe_actions_pending,
    (SELECT count(*)::integer FROM communication.message m JOIN communication.outbox o ON o.message_id=m.id
      WHERE m.purpose='INTERNAL_NOTE' OR m.visibility<>'EXTERNAL') AS internal_note_leaks,
    (SELECT count(*)::integer FROM incident.incident_event WHERE event_type='incident.confirmed' AND actor_kind<>'HUMAN') AS automatic_incident_count,
    (SELECT count(*)::integer FROM communication.delivery d WHERE d.provider<>'WECOM_AIBOT' OR encode(sha256(convert_to(d.channel_account_id,'UTF8')),'hex')<>$1
      OR (d.target_type='GROUP' AND NOT(d.target_hash=ANY($2::text[])))) AS out_of_scope_deliveries,
    (SELECT count(*)::integer FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
      AND application_name IN ('p2_g1_app','p2_g1_worker','p2_g1_gateway','p2_g2_controller')) AS remaining_role_connections`,
  deliveries:`SELECT encode(sha256(convert_to(d.id::text,'UTF8')),'hex') AS delivery_ref_hash,d.outbox_id::text,m.id::text AS message_id,
    d.target_type AS audience,d.target_hash,d.status,d.attempt_count,d.side_effect_state,d.last_error_code,
    m.purpose,m.sender_kind,m.visibility,m.message_type,m.sender_system_code,m.client_command_id::text,
    CASE WHEN m.content->>'transport'='WECOM_GROUP_WEBHOOK' THEN 'WECOM_GROUP_WEBHOOK' ELSE 'WECOM_AIBOT_WSS' END AS transport,
    COALESCE(t.ticket_event_id::text,i.incident_event_id::text) AS source_event_ref,
    COALESCE(te.aggregate_version::text,ie.event_ordinal::text) AS source_version,
    CASE WHEN te.event_id IS NOT NULL THEN 'TICKET_AGGREGATE_VERSION' WHEN ie.id IS NOT NULL THEN 'INCIDENT_EVENT_ORDINAL' END AS source_version_kind,
    COALESCE(t.template_version,i.template_version) AS template_version,
    t.ticket_id::text AS ticket_id,t.notification_type,i.incident_id::text AS incident_id,i.template_code,
    i.audience_type AS incident_audience,subscription.representative_report_id::text AS incident_report_ref,
    COALESCE(te.event_type,ie.event_type) AS source_event_type,
    action.action_type AS source_action_type,action.state AS source_action_state,decision.result_code AS source_decision_result,
    (SELECT count(*)::integer FROM pilot_ticket.reporter_access_grant g WHERE g.delivery_id=d.id AND g.consumed_at IS NOT NULL) AS consumed_grants,
    (SELECT count(*)::integer FROM communication.ticket_notification_binding old WHERE old.ticket_id=t.ticket_id AND old.notification_type='TICKET_CREATED' AND old.destination_type='PERSON') AS old_private_created_artifacts,
    (SELECT count(*)::integer FROM intake.channel_leg direct WHERE direct.journey_id=sj.id AND direct.leg_type IN ('DIRECT_GUIDED','DIRECT_ORGANIC')) AS direct_leg_count,
    sj.origin_channel AS origin_channel,
    (SELECT count(*)::integer FROM intake.channel_leg direct WHERE direct.journey_id=sj.id AND direct.leg_type='DIRECT_GUIDED') AS direct_guided_leg_count,
    (SELECT COALESCE(sum(part.message_count),0)::integer FROM intake.channel_leg part_leg JOIN intake.service_intake part ON part.id=part_leg.source_intake_id WHERE part_leg.journey_id=sj.id) AS journey_message_count,
    COALESCE((SELECT j.entry_mode FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id
      WHERE l.conversation_session_id=m.session_id ORDER BY l.created_at,l.id LIMIT 1),sj.entry_mode) AS entry_mode,
    CASE WHEN sj.entry_mode='DIRECT_ORGANIC' THEN NOT EXISTS(SELECT 1 FROM intake.service_intake g
      WHERE g.source_bot_id=origin.source_bot_id AND g.reporter_wecom_userid=origin.reporter_wecom_userid
      AND g.source_chat_type='group' AND g.created_at<=origin.created_at) ELSE false END AS organic_without_prior_group
    FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id JOIN communication.message m ON m.id=o.message_id
    LEFT JOIN communication.ticket_notification_binding t ON t.delivery_id=d.id
    LEFT JOIN pilot_ticket.ticket_event te ON te.event_id=t.ticket_event_id
    LEFT JOIN pilot_ticket.ticket ticket ON ticket.id=t.ticket_id
    LEFT JOIN intake.service_intake origin ON origin.id=ticket.source_intake_id
    LEFT JOIN intake.channel_leg sl ON sl.source_intake_id=origin.id
    LEFT JOIN intake.contact_journey sj ON sj.id=sl.journey_id
    LEFT JOIN communication.incident_notification_binding i ON i.communication_message_id=m.id
    LEFT JOIN incident.reporter_subscription subscription ON subscription.id=i.reporter_subscription_id
    LEFT JOIN incident.incident_event ie ON ie.id=i.incident_event_id
    LEFT JOIN LATERAL (SELECT a.action_type,a.state,a.decision_id FROM intake.safe_action_suggestion a WHERE a.result_ref_type='COMMUNICATION' AND a.result_ref_id=m.id::text ORDER BY a.created_at,a.id LIMIT 1) action ON true
    LEFT JOIN intake.deterministic_decision decision ON decision.id=action.decision_id
    ORDER BY d.created_at,d.id LIMIT 1001`,
  attempts:`SELECT a.id::text AS attempt_ref,encode(sha256(convert_to(a.delivery_id::text,'UTF8')),'hex') AS delivery_ref_hash,
    a.attempt_no,a.outcome,a.side_effect_state,a.error_code,a.started_epoch_ms::text,a.completed_epoch_ms::text
    FROM communication.delivery_attempt a ORDER BY a.started_epoch_ms,a.id LIMIT 2001`,
  private_destinations:`SELECT d.id::text,d.provider,d.channel_account_id,d.target_id FROM communication.delivery d WHERE d.target_type='PERSON' ORDER BY d.id LIMIT 1001`,
  ticket_events:`SELECT event_id::text,ticket_id::text,aggregate_version::text,event_type,new_status FROM pilot_ticket.ticket_event ORDER BY ticket_id,aggregate_version,event_id LIMIT 6001`,
  incident_events:`SELECT id::text,incident_id::text,event_ordinal::text,event_type,actor_kind,safe_payload->>'report_id' AS report_id FROM incident.incident_event ORDER BY incident_id,event_ordinal,id LIMIT 6001`,
  reports:`SELECT id::text,incident_id::text,ticket_id::text,link_state,impact_state FROM incident.incident_report ORDER BY id LIMIT 1001`,
});
export const G2_RECONCILIATION_QUERY_HASH=g2Hash(JSON.stringify(G2_RECONCILIATION_SQL));

// The caller owns a read-only repeatable-read transaction. No arbitrary SQL or
// raw content is accepted. Dedicated run scope is checked before connecting.
export async function collectG2Reconciliation({transaction,manifest}){
  const m=validateG2Manifest(manifest);
  const counts=(await transaction.query(G2_RECONCILIATION_SQL.counts,[m.scope.bot_hash,m.scope.group_hashes])).rows[0];
  const deliveries=(await transaction.query(G2_RECONCILIATION_SQL.deliveries)).rows;
  const attempts=(await transaction.query(G2_RECONCILIATION_SQL.attempts)).rows;
  const privateDestinations=(await transaction.query(G2_RECONCILIATION_SQL.private_destinations)).rows;
  const ticket_events=(await transaction.query(G2_RECONCILIATION_SQL.ticket_events)).rows;
  const incident_events=(await transaction.query(G2_RECONCILIATION_SQL.incident_events)).rows;
  const reports=(await transaction.query(G2_RECONCILIATION_SQL.reports)).rows;
  if(deliveries.length>1000||attempts.length>2000||privateDestinations.length>1000||ticket_events.length>6000||incident_events.length>6000||reports.length>1000)failG2('RECONCILIATION_LIMIT');
  const cache=new Map();
  for(const d of privateDestinations){
    if(d.provider!=='WECOM_AIBOT'||g2Hash(d.channel_account_id)!==m.scope.bot_hash)continue;
    const key=g2Hash(JSON.stringify([d.channel_account_id,d.target_id]));
    if(!cache.has(key)){
      const authorize=createP2012PersonDestinationAuthorizer({pool:transaction,botId:d.channel_account_id,personHashes:m.scope.person_hashes,
        groupHashes:m.scope.group_hashes,testLabel:m.scope.test_prefix,labelSource:'raw'});
      cache.set(key,await authorize({transaction,bot_id:d.channel_account_id,reporter_user_id:d.target_id}));
    }
    const eligible=cache.get(key);if(!eligible)counts.out_of_scope_deliveries++;
    const row=deliveries.find(row=>row.delivery_ref_hash===g2Hash(d.id));if(row)row.destination_eligible_at_reconciliation=eligible;
  }
  // Error text never enters evidence, even if a legacy caller stored an unsafe value.
  for(const row of [...deliveries,...attempts])for(const key of ['last_error_code','error_code'])
    if(Object.hasOwn(row,key)&&row[key]!==null&&!/^[A-Z][A-Z0-9_]{1,127}$/u.test(row[key]))row[key]='UNSAFE_ERROR_CODE_REDACTED';
  return {schema_version:1,kind:'G2_RECONCILIATION_PACKET',...g2SourceBinding(m),
    database_identity_hash:m.scope.database_identity_hash,query_sha256:G2_RECONCILIATION_QUERY_HASH,
    physical_epoch_ms:counts.physical_epoch_ms,counts,deliveries,attempts,ticket_events,incident_events,reports};
}
