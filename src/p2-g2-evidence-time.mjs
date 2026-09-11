import {assertEpochMsString,assertLocalDateTime,formatEpochMsToShanghaiLocal} from './platform/time-contract.mjs';

export function g2EvidenceTime(epoch=String(Date.now())){
  assertEpochMsString(epoch);
  return {event_time:formatEpochMsToShanghaiLocal(epoch),event_epoch_ms:epoch};
}
export function assertG2EvidenceTime(value){
  assertEpochMsString(value?.event_epoch_ms);assertLocalDateTime(value?.event_time);
  if(value.event_time!==formatEpochMsToShanghaiLocal(value.event_epoch_ms))throw Error('EVIDENCE_TIME_MISMATCH');
  if(value.recorded_at!==undefined){assertLocalDateTime(value.recorded_at);if(value.recorded_at!==value.event_time)throw Error('EVIDENCE_TIME_MISMATCH');}
}
