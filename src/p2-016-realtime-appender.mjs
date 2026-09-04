import { appendRealtimeEvent,computeRealtimeEventKey,normalizeRealtimeEventCommand,REALTIME_STREAM_NAME } from './p2-003-realtime-event-log.mjs';
import { hashP2016,failP2016 } from './p2-016-domain-contracts.mjs';
import { shanghaiLocalToEpochMs } from './platform/time-contract.mjs';

// P2-016 assembly seam: source facts retain their own time. The shared stream envelope uses publication time.
export async function appendP2016Realtime({transaction:tx,command:input}) {
  const command=normalizeRealtimeEventCommand(input),key=computeRealtimeEventKey(command);
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('P2_003_REALTIME_STREAM:CONVERSATION_WORKBENCH',0))");
  const found=await tx.query('SELECT * FROM conversation.realtime_event WHERE event_key=$1',[key]);
  if(found.rowCount){
    const old=found.rows[0],keys=Object.keys(command).filter(k=>!['schema_version','occurred_at','expires_at','expires_epoch_ms'].includes(k));
    if(hashP2016(Object.fromEntries(keys.map(k=>[k,old[k]])))!==hashP2016(Object.fromEntries(keys.map(k=>[k,command[k]]))))failP2016('REALTIME_SOURCE_CONFLICT',409);
    return Object.freeze({event_id:String(old.event_id),status:'REPLAYED',inserted_count:0,replayed_count:1,conflict_count:0});
  }
  const stamp=(await tx.query(`SELECT GREATEST(platform.local_now(),COALESCE(max(occurred_at),platform.local_now())) AS at
    FROM conversation.realtime_event WHERE stream_name=$1`,[REALTIME_STREAM_NAME])).rows[0].at;
  // No extension of source retention: an expired advisory event is omitted, while the source binding still commits.
  if(BigInt(command.expires_epoch_ms)<=BigInt(shanghaiLocalToEpochMs(stamp)))return Object.freeze({status:'EXPIRED_SOURCE',inserted_count:0,replayed_count:0,conflict_count:0});
  return appendRealtimeEvent({transaction:tx,command:{...command,occurred_at:stamp}});
}
