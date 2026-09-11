import { appendCommunication } from './p2-004-communication-core.mjs';
import {
  P2_015_ERROR_CODES,
  failP2015,
  freezePublic,
  safeHash,
  snapshotP2015Json,
} from './p2-015-domain-contracts.mjs';

const FIXED_TEXT = Object.freeze({
  REQUEST_ONE_DESCRIPTION: '请补充一个最关键的信息：具体看到了什么异常现象？请勿在群内提供患者或账号敏感信息。',
  SEND_FIXED_ACKNOWLEDGEMENT: '已收到，谢谢。',
  SEND_FIXED_SCOPE_NOTICE: '该内容暂不属于信息故障受理范围；如涉及系统异常，请描述可观察到的故障现象。',
  DIRECT_GUIDANCE: '为保护信息安全，请关注机器人单聊并在那里补充故障现象。',
});

export function createExistingTicketCommandPort({ ticketCore }) {
  if (!ticketCore || typeof ticketCore.createForIntakeInTransaction !== 'function') failP2015(P2_015_ERROR_CODES.inputInvalid);
  return Object.freeze({
    async createMinimalTicket({ transaction, intake_id: intakeId, occurred_at: occurredAt, trace_id: traceId }) {
      return ticketCore.createForIntakeInTransaction({ intakeId, transaction, occurredAt, traceId });
    },
  });
}

export function createP2004FixedCommunicationPort({ append = appendCommunication } = {}) {
  return Object.freeze({
    async appendFixed({ transaction, action, context }) {
      const text = context.fixed_text ?? FIXED_TEXT[action.action_type];
      if (!text || !context.destination) failP2015(P2_015_ERROR_CODES.actionFailed);
      const result = await append({
        transaction,
        command: {
          session_id: context.session_id ?? null,
          sender_kind: 'SYSTEM',
          sender_system_code: 'RULE_FIRST_ORCHESTRATOR',
          purpose: 'SYSTEM_NOTIFICATION',
          message_type: context.message_type ?? 'text',
          visibility: 'EXTERNAL',
          client_command_id: action.id,
          content: { text },
          destination_policy: 'P2_015_FIXED_TEMPLATE',
          privacy_class: context.privacy_class,
          retention_until: context.retention_until,
          retention_until_epoch_ms: context.retention_until_epoch_ms,
        },
        actor: null,
        resolvedDestinations: [context.destination],
      });
      if (result?.error) failP2015(P2_015_ERROR_CODES.actionFailed);
      return result;
    },
  });
}

export function createSafeActionExecutor({ intakeDecisionPort, ticketCommandPort,
  communicationPort, manualReviewStore, decisionStore } = {}) {
  if (!intakeDecisionPort || !ticketCommandPort || !manualReviewStore || !decisionStore) failP2015(P2_015_ERROR_CODES.inputInvalid);
  return Object.freeze({
    async execute({ transaction, decision, context }) {
      const safeDecision = snapshotP2015Json(decision);
      const safeContext = snapshotP2015Json(context);
      const results = [];
      for (const action of safeDecision.actions) {
        if (action.state !== 'PROPOSED') { results.push({ action_id: action.id, replayed: true }); continue; }
        const commandHash = safeHash({ action_key: action.action_key, payload_hash: action.payload_hash });
        let result;
        let refType;
        let refId;
        try {
          switch (action.action_type) {
            case 'APPLY_INTAKE_CLASSIFICATION':
              result = await intakeDecisionPort.apply({ transaction, input: {
                intake_id: safeDecision.service_intake_id, decision_id: safeDecision.id,
                result_code: safeDecision.result_code === 'INCIDENT_REVIEW_CANDIDATE'
                  || (safeDecision.result_code === 'MANUAL_REVIEW_REQUIRED' && safeDecision.ticket_creation_recommended)
                  ? 'TICKET_ELIGIBLE' : safeDecision.result_code,
                catalog_version: safeDecision.catalog_version, rule_set_version: safeDecision.rule_set_version,
                occurred_at: safeDecision.observed_at, trace_id: safeContext.trace_id,
              } });
              refType = 'INTAKE'; refId = safeDecision.service_intake_id;
              break;
            case 'CREATE_MINIMAL_TICKET':
            case 'ROUTE_SERVICE_REQUEST':
              result = await ticketCommandPort.createMinimalTicket({ transaction,
                intake_id: safeDecision.service_intake_id, occurred_at: safeDecision.observed_at,
                trace_id: safeContext.trace_id });
              if (result?.error) failP2015(P2_015_ERROR_CODES.actionFailed);
              refType = 'TICKET'; refId = result.ticket?.id ?? result.ticket_id ?? result.id;
              if (!refId) failP2015(P2_015_ERROR_CODES.actionFailed);
              await transaction.query(
                `UPDATE intake.contact_journey SET linked_ticket_id=$2::uuid,status='TICKET_LINKED',
                   row_version=row_version+1,updated_at=GREATEST(created_at,platform.local_now()) WHERE id=$1::uuid`,
                [safeDecision.journey_id, refId],
              );
              await transaction.query('UPDATE intake.deterministic_decision SET linked_ticket_id=$2::uuid WHERE id=$1::uuid', [safeDecision.id, refId]);
              break;
            case 'ENQUEUE_MANUAL_REVIEW':
            case 'ENQUEUE_INCIDENT_REVIEW':
            case 'QUERY_AUTHORIZED_STATUS':
            case 'ROUTE_BUSINESS_CONSULTATION':
              result = await manualReviewStore.enqueue({ transaction, input: {
                journey_id: safeDecision.journey_id, decision_id: safeDecision.id,
                service_intake_id: safeDecision.service_intake_id,
                linked_ticket_id: safeDecision.linked_ticket_id ?? null,
                review_reason_code: action.action_type === 'ENQUEUE_INCIDENT_REVIEW'
                  ? 'INCIDENT_CANDIDATE_HUMAN_CONFIRMATION' : safeDecision.reason_code,
                priority: safeDecision.safe_result.clinical_safety_risk === 'CRITICAL_REVIEW_REQUIRED' ? 'URGENT' : 'NORMAL',
              } });
              refType = 'MANUAL_REVIEW'; refId = result.id;
              await transaction.query(
                `UPDATE intake.contact_journey SET status='WAITING_REVIEW',row_version=row_version+1,
                   updated_at=GREATEST(created_at,platform.local_now()) WHERE id=$1::uuid`,
                [safeDecision.journey_id],
              );
              break;
            case 'REQUEST_ONE_DESCRIPTION':
            case 'SEND_FIXED_ACKNOWLEDGEMENT':
            case 'SEND_FIXED_SCOPE_NOTICE':
              if (!communicationPort) failP2015(P2_015_ERROR_CODES.actionFailed);
              result = await communicationPort.appendFixed({ transaction, action, context: safeContext });
              refType = 'COMMUNICATION'; refId = result.message_id;
              if (action.action_type === 'REQUEST_ONE_DESCRIPTION') {
                await transaction.query(
                  `UPDATE intake.contact_journey SET status='WAITING_DESCRIPTION',row_version=row_version+1,
                     updated_at=GREATEST(created_at,platform.local_now()) WHERE id=$1::uuid`,
                  [safeDecision.journey_id],
                );
              }
              break;
            case 'APPEND_RELATED_FOLLOW_UP':
              refType = 'JOURNEY'; refId = safeDecision.journey_id; result = { appended: true };
              break;
            default:
              failP2015(P2_015_ERROR_CODES.inputInvalid);
          }
          await decisionStore.markAction({ transaction, action_id: action.id, state: result?.replayed ? 'REPLAYED' : 'EXECUTED',
            command_id: action.id, command_hash: commandHash, result_ref_type: refType,
            result_ref_id: String(refId), executed_at: safeDecision.observed_at });
          results.push({ action_id: action.id, action_type: action.action_type, result_ref_type: refType, result_ref_id: String(refId), replayed: result?.replayed === true });
        } catch (error) {
          if (['REQUEST_ONE_DESCRIPTION','SEND_FIXED_ACKNOWLEDGEMENT','SEND_FIXED_SCOPE_NOTICE'].includes(action.action_type)) {
            await decisionStore.markAction({ transaction, action_id: action.id, state: 'FAILED', command_id: action.id,
              command_hash: commandHash, error_code: 'COMMUNICATION_PORT_FAILED', retryable: true,
              executed_at: safeDecision.observed_at });
            const review = await manualReviewStore.enqueue({ transaction, input: {
              journey_id: safeDecision.journey_id, decision_id: safeDecision.id,
              service_intake_id: safeDecision.service_intake_id,
              linked_ticket_id: safeDecision.linked_ticket_id ?? null,
              review_reason_code: 'COMMUNICATION_PORT_FAILED', priority: 'HIGH',
            } });
            results.push({ action_id: action.id, failed_safe: true, review_id: review.id });
            continue;
          }
          throw error;
        }
      }
      return freezePublic(results);
    },
  });
}
