import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {ReporterAccess} from './p2-016-reporter-access.mjs';
import {randomUUID} from 'node:crypto';
import {FIRST_HANDLING_EVENT_SQL,groupNotificationTargetKey} from './mvp-notification-policy.mjs';
import type {GroupNotificationTarget} from './mvp-notification-policy.mjs';
import {appendCommunication} from './p2-004-communication-core.mjs';
import {failP2016,transactionP2016,textHashP2016,localP2016,versionP2016,uuidP2016} from './p2-016-domain-contracts.mjs';
import {formatEpochMsToShanghaiLocal} from './platform/time-contract.mjs';
import type {TicketAppNotificationOptions} from '../contracts/workbench_app_notification_contracts.js';
import {normalizeAppNotificationOptions,resolveOriginalAppTarget} from './workbench-app-notification-target.mjs';
import {cancelUnattemptedDeliveryInTransaction} from './p2-004-communication-delivery-worker.mjs';

export const ROUND_NOTIFICATION_MIGRATION_ID='041_ticket_round_notifications';
export type RoundNotificationNode='FIRST_RESPONSIBILITY'|'FIRST_HANDLING'|'STAFF_COMPLETED';
export interface OriginalBotSource {bot_id:string;reporter_user_id:string;group_id:string|null;retention_epoch:string;journey_id:string|null}
interface Candidate {cycle_id:string;ticket_id:string;source_intake_id:string;event_id:string;node:RoundNotificationNode;cycle_no:number;ticket_no:string;event_status:'QUEUED'|'ACCEPTED'|'IN_PROGRESS'|'CLOSED';created_at:string;aggregate_version:number}
interface RoundOptions {mvpPolicy?:boolean;groupNotificationTargets?:readonly GroupNotificationTarget[];pool:PostgresPool;enabled?:boolean;botId:string;reporterAccess:Pick<ReporterAccess,'ensurePublicRefInTransaction'>;templateVersion?:string;personDestinationAuthorizer?:((input:{transaction:PostgresTransaction;bot_id:string;reporter_user_id:string})=>boolean|Promise<boolean>)|null;communicationAppend?:typeof appendCommunication|undefined;appNotifications?:TicketAppNotificationOptions|null}

export async function roundNotificationSchemaReady(tx:PostgresTransaction){
  try{return (await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id IN ('031_p2_016_ticket_lifecycle_workbench_notifications','039_ticket_self_handling_cycles','040_ticket_staff_completion','041_ticket_round_notifications','052_ticket_group_round_notifications')")).rowCount===5;}catch{return false;}
}
// A missing group ID never proves a private source. Cross-check the persisted original Inbox and Journey.
export async function readOriginalBotSource(tx:PostgresTransaction,intakeId:string,botId:string):Promise<OriginalBotSource|null>{
  const q=await tx.query<OriginalBotSource>(`SELECT origin.source_bot_id AS bot_id,origin.reporter_wecom_userid AS reporter_user_id,origin.source_chat_id AS group_id,j.id::text AS journey_id,
    LEAST(i.retention_until_epoch_ms,origin.retention_until_epoch_ms,m.retention_until_epoch_ms,COALESCE(j.retention_until_epoch_ms,i.retention_until_epoch_ms))::text AS retention_epoch
    FROM intake.service_intake i LEFT JOIN intake.channel_leg l ON l.source_intake_id=i.id
    LEFT JOIN intake.contact_journey j ON j.id=l.journey_id AND j.reporter_identity_hash=l.reporter_identity_hash
    JOIN intake.service_intake origin ON origin.id=COALESCE(j.origin_intake_id,i.id)
    JOIN channel.message_inbox m ON m.id=origin.primary_message_id AND m.provider=origin.source_provider
      AND m.bot_id=origin.source_bot_id AND m.sender_user_id=origin.reporter_wecom_userid AND m.chat_type=origin.source_chat_type
    WHERE i.id=$1::uuid AND origin.source_bot_id=$2 AND origin.source_provider='WECOM_AIBOT'
      AND ((origin.source_channel='WECOM_DIRECT' AND origin.source_chat_type='single' AND origin.source_chat_id IS NULL AND m.chat_id IS NULL)
        OR (origin.source_channel='WECOM_GROUP' AND origin.source_chat_type='group' AND char_length(origin.source_chat_id)>0 AND m.chat_id=origin.source_chat_id))
      AND i.source_provider=origin.source_provider AND i.source_bot_id=origin.source_bot_id AND i.reporter_wecom_userid=origin.reporter_wecom_userid
      AND (l.id IS NULL OR (j.id IS NOT NULL AND j.origin_channel=origin.source_channel))
      AND LEAST(i.retention_until_epoch_ms,origin.retention_until_epoch_ms,m.retention_until_epoch_ms,COALESCE(j.retention_until_epoch_ms,i.retention_until_epoch_ms))>platform.physical_epoch_ms()`,[uuidP2016(intakeId),botId]);
  return q.rowCount===1?q.rows[0]??null:null;
}
export async function readOriginalSingleBotSource(tx:PostgresTransaction,intakeId:string,botId:string):Promise<OriginalBotSource|null>{
  const source=await readOriginalBotSource(tx,intakeId,botId);return source?.group_id===null?source:null;
}

export function createTicketRoundNotifications({pool,enabled=false,botId,reporterAccess,mvpPolicy=false,groupNotificationTargets=[],templateVersion=mvpPolicy?'mvp-round-notification/1':'wbint-round-notification/1',personDestinationAuthorizer=null,communicationAppend=appendCommunication,appNotifications=null}:RoundOptions){
  if(typeof enabled!=='boolean'||typeof botId!=='string'||!botId||botId.length>128||typeof templateVersion!=='string'||! /^[A-Za-z0-9_/-]{1,64}$/u.test(templateVersion)
    ||personDestinationAuthorizer!==null&&typeof personDestinationAuthorizer!=='function')failP2016('FLAG_INVALID',503);
  if(typeof mvpPolicy!=='boolean'||!Array.isArray(groupNotificationTargets)||groupNotificationTargets.length>32)failP2016('FLAG_INVALID',503);
  const groupTargets=new Set(groupNotificationTargets.map(v=>groupNotificationTargetKey(v.botId,v.groupId)));
  const app=normalizeAppNotificationOptions(appNotifications);
  let after:{cycleId:string;node:RoundNotificationNode}|null=null,busy=false;
  return Object.freeze({
    async runOnce(){
      if(!enabled||busy)return {scanned:0,created:0};
      busy=true;
      try{
        if(!await roundNotificationSchemaReady(pool))failP2016('ROUND_NOTIFICATIONS_UNAVAILABLE',503);
        // The cursor covers one bounded sweep only. Reset it at the end and on restart; it is never a checkpoint.
        // Use the immutable first-event status; an assigned QUEUED Ticket has not been accepted.
        if(mvpPolicy&&(await pool.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='063_mvp_notifications_app_members'")).rowCount!==1)failP2016('ROUND_NOTIFICATIONS_UNAVAILABLE',503);
        const firstEvent=mvpPolicy?FIRST_HANDLING_EVENT_SQL:'c.first_responsibility_event_id',firstNode=mvpPolicy?'FIRST_HANDLING':'FIRST_RESPONSIBILITY';
        const candidates=await pool.query<Candidate>(`SELECT c.id::text AS cycle_id,c.ticket_id::text,c.source_intake_id::text,c.cycle_no,t.ticket_no,
          e.event_id::text,n.node,e.new_status AS event_status,e.created_at,e.aggregate_version FROM pilot_ticket.ticket_handling_cycle c
          JOIN pilot_ticket.ticket t ON t.id=c.ticket_id AND t.source_intake_id=c.source_intake_id
          JOIN LATERAL (
            SELECT ${firstEvent} AS event_id,'${firstNode}' AS node
            UNION ALL
            SELECT p.ticket_event_id,'STAFF_COMPLETED' FROM pilot_ticket.staff_completion_notification_commitment p
              WHERE p.cycle_id=c.id AND p.ticket_id=c.ticket_id AND p.source_intake_id=c.source_intake_id AND p.ticket_event_id=c.staff_completion_event_id
          ) n ON true
          JOIN pilot_ticket.ticket_handling_cycle_event ce ON ce.ticket_id=c.ticket_id AND ce.cycle_id=c.id AND ce.ticket_event_id=n.event_id
          JOIN pilot_ticket.ticket_event e ON e.ticket_id=c.ticket_id AND e.event_id=n.event_id AND e.operator_type='PILOT_USER'
            AND ((n.node='FIRST_RESPONSIBILITY' AND (
                (e.event_type='ticket.accepted' AND e.new_status='ACCEPTED')
                OR (e.event_type='ticket.assignment_transferred' AND e.old_status='QUEUED' AND e.new_status='QUEUED' AND e.operator_id IS NOT NULL
                  AND e.assignment_metadata->>'old_assignee_id' IS NULL
                  AND lower(e.assignment_metadata->>'new_assignee_id')=c.first_responsibility_principal_id::text
                  AND e.assignment_metadata->>'new_team_id'=c.first_responsibility_team_id)))
              OR (n.node='FIRST_HANDLING' AND e.event_id=${FIRST_HANDLING_EVENT_SQL})
              OR (n.node='STAFF_COMPLETED' AND e.event_type='ticket.closed' AND e.old_status='IN_PROGRESS' AND e.new_status='CLOSED'
                AND e.reason_code='STAFF_COMPLETED' AND e.operator_id IS NOT NULL AND char_length(btrim(e.external_note)) BETWEEN 1 AND 500))
          WHERE ($1::uuid IS NULL OR (c.id,n.node)>($1::uuid,$2::text)) ORDER BY c.id,n.node LIMIT 20`,[after?.cycleId??null,after?.node??null]);
        let created=0;
        for(const candidate of candidates.rows){
          const changed=await transactionP2016(pool,async tx=>{
            // Follow command lock order: Ticket before cycle. The later public-ref FK must not invert it.
            await tx.query('SELECT 1 FROM pilot_ticket.ticket WHERE id=$1::uuid FOR KEY SHARE',[candidate.ticket_id]);
            const locked=await tx.query(`SELECT 1 FROM pilot_ticket.ticket_handling_cycle c WHERE c.id=$1::uuid AND c.ticket_id=$2::uuid
              AND (($4='FIRST_RESPONSIBILITY' AND c.first_responsibility_event_id=$3::uuid)
                OR ($4='FIRST_HANDLING' AND $3::uuid=${FIRST_HANDLING_EVENT_SQL})
                OR ($4='STAFF_COMPLETED' AND c.staff_completion_event_id=$3::uuid AND EXISTS(
                  SELECT 1 FROM pilot_ticket.staff_completion_notification_commitment p WHERE p.cycle_id=c.id AND p.ticket_id=c.ticket_id
                    AND p.source_intake_id=c.source_intake_id AND p.ticket_event_id=c.staff_completion_event_id))) FOR UPDATE`,[candidate.cycle_id,candidate.ticket_id,candidate.event_id,candidate.node]);
            if(locked.rowCount!==1)return false;
            if(mvpPolicy&&candidate.node==='FIRST_HANDLING'){
              // Terminal NOT_ATTEMPTED intents cannot be claimed by the Worker. Retire them through its cancellation audit.
              const obsolete=await tx.query<{id:string}>(`SELECT d.id::text FROM communication.ticket_round_notification_binding r
                JOIN communication.ticket_notification_binding b ON b.id=r.notification_binding_id JOIN communication.delivery d ON d.id=b.delivery_id
                WHERE r.cycle_id=$1::uuid AND r.node='FIRST_RESPONSIBILITY' AND r.destination_type='PERSON'
                  AND d.status='DEAD_LETTER' AND d.side_effect_state='NOT_ATTEMPTED' ORDER BY d.id LIMIT 20 FOR UPDATE OF d`,[candidate.cycle_id]);
              for(const row of obsolete.rows)await cancelUnattemptedDeliveryInTransaction({transaction:tx,deliveryId:row.id,expected:{status:'DEAD_LETTER'},reasonCode:'MVP_LEGACY_FIRST_NOTICE_RETIRED',occurredEpochMs:String(Date.now())});
              // SENT and unknown side effects remain promises, including an operator-cancelled UNKNOWN.
              if((await tx.query(`SELECT 1 FROM communication.ticket_round_notification_binding r
              JOIN communication.ticket_notification_binding b ON b.id=r.notification_binding_id JOIN communication.delivery d ON d.id=b.delivery_id
              WHERE r.cycle_id=$1::uuid AND r.node='FIRST_RESPONSIBILITY' AND r.destination_type='PERSON'
                AND NOT(d.status='CANCELLED' AND d.side_effect_state='NOT_ATTEMPTED')`,[candidate.cycle_id])).rowCount)return false;
            }
            const source=await readOriginalBotSource(tx,candidate.source_intake_id,botId);
            if(!source){
              if((await tx.query("SELECT 1 FROM communication.ticket_round_notification_binding WHERE cycle_id=$1::uuid AND node=$2 AND destination_type='PERSON'",[candidate.cycle_id,candidate.node])).rowCount)return false;
              const target=await resolveOriginalAppTarget(tx,candidate.source_intake_id,app);if(!target)return false;
              const binding=textHashP2016(JSON.stringify(['WECOM_APP',target.target.channel_account_id,target.source.scope.sourceCorpScope,target.source.scope.sourceAppScope,target.source.scope.scopeHash,target.target.target_id]));
              const notificationType=candidate.node!=='STAFF_COMPLETED'?'TICKET_ACCEPTED':'TICKET_CLOSED';
              const ref=await reporterAccess.ensurePublicRefInTransaction({transaction:tx,ticketId:candidate.ticket_id,reporterBindingHash:binding,journeyId:target.source.journey_id});
              const message=await communicationAppend({transaction:tx,actor:null,command:{session_id:null,sender_kind:'SYSTEM',sender_system_code:'TICKET_LIFECYCLE',purpose:'SYSTEM_NOTIFICATION',
                client_command_id:randomUUID(),message_type:'template_card',visibility:'EXTERNAL',destination_policy:'P2_016_ORIGINAL_APP_ROUND',privacy_class:'INTERNAL',
                content:{...(target.source.recipient?{recipient_namespace:target.source.recipient.namespace}:{}),transport:'WECOM_APP',public_ref:ref.public_ref,request_ref:target.source.request_ref,source_kind:target.source.source_kind,node:candidate.node,suffix:candidate.ticket_no.slice(-4),status:candidate.event_status,
                  occurred_at:localP2016(candidate.created_at),version:versionP2016(candidate.aggregate_version),notification_type:notificationType},
                retention_until:formatEpochMsToShanghaiLocal(target.source.retention_epoch),retention_until_epoch_ms:target.source.retention_epoch},resolvedDestinations:[target.target]});
              if(!message||!('message_id' in message)||!message.outbox_id||message.delivery_ids.length!==1)failP2016('NOTIFICATION_FAILED',503);
              const notificationId=(await tx.query<{id:string}>(`INSERT INTO communication.ticket_notification_binding(ticket_event_id,ticket_id,notification_type,recipient_binding_hash,destination_type,template_version,message_id,outbox_id,delivery_id)
                VALUES($1::uuid,$2::uuid,$3,$4,'PERSON',$5,$6::uuid,$7::uuid,$8::uuid) RETURNING id::text`,[candidate.event_id,candidate.ticket_id,notificationType,binding,templateVersion,message.message_id,message.outbox_id,message.delivery_ids[0]])).rows[0]?.id;
              if(!notificationId)failP2016('NOTIFICATION_FAILED',503);
              await tx.query(`INSERT INTO communication.ticket_round_notification_binding(ticket_id,cycle_id,node,recipient_binding_hash,destination_type,notification_binding_id)
                VALUES($1::uuid,$2::uuid,$3,$4,'PERSON',$5::uuid)`,[candidate.ticket_id,candidate.cycle_id,candidate.node,binding,notificationId]);
              return true;
            }
            let inserted=false;
            const pushGroup=source.group_id!==null&&(!mvpPolicy||candidate.node==='STAFF_COMPLETED'&&groupTargets.has(groupNotificationTargetKey(source.bot_id,source.group_id)));
            const routes:('GROUP'|'PERSON')[]=pushGroup?['GROUP','PERSON']:['PERSON'];
            for(const route of routes){
            if((await tx.query('SELECT 1 FROM communication.ticket_round_notification_binding WHERE cycle_id=$1::uuid AND node=$2 AND destination_type=$3',[candidate.cycle_id,candidate.node,route])).rowCount)continue;
            if(route==='PERSON'&&personDestinationAuthorizer&&await personDestinationAuthorizer({transaction:tx,bot_id:source.bot_id,reporter_user_id:source.reporter_user_id})!==true)continue;
            const binding=textHashP2016(JSON.stringify(route==='GROUP'?['WECOM_AIBOT',source.bot_id,source.group_id,source.reporter_user_id]:['WECOM_AIBOT',source.bot_id,source.reporter_user_id]));
            const notificationType=candidate.node!=='STAFF_COMPLETED'?'TICKET_ACCEPTED':'TICKET_CLOSED';
            // Adopt an already committed legacy notice for this exact basis, independent of template upgrades.
            let notificationId=(await tx.query<{id:string}>(`SELECT id::text FROM communication.ticket_notification_binding
              WHERE ticket_id=$1::uuid AND ticket_event_id=$2::uuid AND notification_type=$3 AND recipient_binding_hash=$4 AND destination_type=$5
                AND (${mvpPolicy?'true':'false'}=false OR EXISTS(SELECT 1 FROM communication.delivery d WHERE d.id=delivery_id AND d.status<>'CANCELLED'))
              ORDER BY created_at,id LIMIT 1`,[candidate.ticket_id,candidate.event_id,notificationType,binding,route])).rows[0]?.id;
            if(!notificationId){
              const ref=route==='PERSON'?await reporterAccess.ensurePublicRefInTransaction({transaction:tx,ticketId:candidate.ticket_id,reporterBindingHash:binding,...(source.journey_id?{journeyId:source.journey_id}:{})}):null;
              const message=await communicationAppend({transaction:tx,actor:null,command:{session_id:null,sender_kind:'SYSTEM',sender_system_code:'TICKET_LIFECYCLE',purpose:'SYSTEM_NOTIFICATION',
                client_command_id:randomUUID(),message_type:'template_card',visibility:'EXTERNAL',destination_policy:route==='GROUP'?'P2_016_ORIGIN_GROUP_ROUND':'P2_016_REPORTER',privacy_class:'INTERNAL',
                content:route==='GROUP'?{transport:'WECOM_MESSAGE_PUSH',node:candidate.node,suffix:candidate.ticket_no.slice(-4),status:candidate.event_status,occurred_at:localP2016(candidate.created_at)}:
                  {public_ref:ref?.public_ref??'',suffix:candidate.ticket_no.slice(-4),status:candidate.event_status,occurred_at:localP2016(candidate.created_at),version:versionP2016(candidate.aggregate_version),notification_type:notificationType,source:source.group_id?'GROUP':'DIRECT'},
                retention_until:formatEpochMsToShanghaiLocal(source.retention_epoch),retention_until_epoch_ms:source.retention_epoch},
                resolvedDestinations:[{provider:'WECOM_AIBOT',channel_account_id:source.bot_id,target_type:route,target_id:route==='GROUP'?source.group_id??'':source.reporter_user_id}]});
              if(!message||!('message_id' in message)||!message.outbox_id||message.delivery_ids.length!==1)failP2016('NOTIFICATION_FAILED',503);
              notificationId=(await tx.query<{id:string}>(`INSERT INTO communication.ticket_notification_binding(ticket_event_id,ticket_id,notification_type,recipient_binding_hash,destination_type,template_version,message_id,outbox_id,delivery_id)
                VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7::uuid,$8::uuid,$9::uuid) RETURNING id::text`,[candidate.event_id,candidate.ticket_id,notificationType,binding,route,templateVersion,message.message_id,message.outbox_id,message.delivery_ids[0]])).rows[0]?.id;
              if(!notificationId)failP2016('NOTIFICATION_FAILED',503);
            }
            await tx.query(`INSERT INTO communication.ticket_round_notification_binding(ticket_id,cycle_id,node,recipient_binding_hash,destination_type,notification_binding_id)
              VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::uuid)`,[candidate.ticket_id,candidate.cycle_id,candidate.node,binding,route,notificationId]);
            inserted=true;
            }
            return inserted;
          });
          if(changed)created++;after={cycleId:candidate.cycle_id,node:candidate.node};
        }
        if(candidates.rows.length<20)after=null;
        return {scanned:candidates.rows.length,created};
      }finally{busy=false;}
    },
  });
}
