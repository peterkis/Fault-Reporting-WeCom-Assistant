import type {PostgresTransaction} from './platform/postgres-pool.mjs';
/** Internal SQL fragment: the first actual handling action, never an assignment. */
export const FIRST_HANDLING_EVENT_SQL=`(SELECT he.event_id FROM pilot_ticket.ticket_handling_cycle_event hc
  JOIN pilot_ticket.ticket_event he ON he.ticket_id=hc.ticket_id AND he.event_id=hc.ticket_event_id
  WHERE hc.cycle_id=c.id AND hc.ticket_id=c.ticket_id AND he.operator_type='PILOT_USER'
    AND ((he.event_type='ticket.accepted' AND he.new_status='ACCEPTED')
      OR (he.event_type='ticket.started' AND he.new_status='IN_PROGRESS'))
  ORDER BY he.aggregate_version,he.event_id LIMIT 1)`;

export interface GroupNotificationTarget {readonly botId:string;readonly groupId:string}
export function groupNotificationTargetKey(botId:string,groupId:string){return JSON.stringify([botId,groupId]);}

export async function mvpNotificationSchemaReady(tx:PostgresTransaction){
 const q=await tx.query<{ready:boolean}>(`SELECT EXISTS(SELECT 1 FROM platform.schema_migration WHERE migration_id=$1)
   AND (SELECT count(*)=4 FROM information_schema.columns WHERE table_schema='intake' AND table_name='web_request_binding'
     AND is_nullable='YES' AND ((column_name IN ('notify_recipient_id','notify_identity_namespace','notify_proof_ref') AND data_type='text')
       OR (column_name='notify_verified_epoch_ms' AND data_type='bigint')))
   AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='intake.web_request_binding'::regclass AND conname='web_binding_notification_recipient_check' AND convalidated)
   AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='intake.web_request_binding'::regclass AND tgname='web_notification_recipient_immutable' AND tgenabled='O')
   AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('communication.guard_ticket_round_notification_binding()')
     AND pg_get_functiondef(oid) LIKE '%FIRST_HANDLING%')
   AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='communication.ticket_round_notification_binding'::regclass
     AND conname='ticket_round_notification_binding_node_check' AND convalidated AND pg_get_constraintdef(oid) LIKE '%FIRST_HANDLING%') AS ready`,['063_mvp_notifications_app_members']);
 return q.rows[0]?.ready===true;
}
