import type {H5UrgeFact} from './yxx-h5-v2-lifecycle.mjs';
import {appendP2016Realtime} from './p2-016-realtime-appender.mjs';
import {formatEpochMsToShanghaiLocal} from './platform/time-contract.mjs';

/** A reporter urge is its own durable fact, not a fabricated Ticket state event. */
export async function projectYxxH5Urge(fact:H5UrgeFact):Promise<void>{
 await appendP2016Realtime({transaction:fact.transaction,command:{
  schema_version:1,publisher_name:'YXX_H5_URGE',publisher_version:'1',source_type:'WEB_REPORT_URGE',source_id:fact.urgeId,
  event_variant:'URGED',event_type:'ticket.updated',aggregate_type:'TICKET',aggregate_id:fact.ticketId,
  aggregate_version:String(fact.ticketVersion),authorization_scope_type:'SYSTEM',authorization_scope_id:null,
  visibility_scope:'WORKBENCH',payload:{ticket_id:fact.ticketId,version:String(fact.ticketVersion)},
  occurred_at:fact.occurredAt,expires_at:formatEpochMsToShanghaiLocal(fact.retentionUntilEpochMs),
 }});
}
