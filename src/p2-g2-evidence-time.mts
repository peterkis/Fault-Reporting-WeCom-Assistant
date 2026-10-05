import type { LocalDateTime, PhysicalEpochMs } from '../contracts/time_contracts.js';
export interface G2EvidenceTime {event_time:LocalDateTime;event_epoch_ms:PhysicalEpochMs;recorded_at?:LocalDateTime}
import {assertEpochMsString,assertLocalDateTime,formatEpochMsToShanghaiLocal} from './platform/time-contract.mjs';

export function g2EvidenceTime(epoch=String(Date.now())){
  assertEpochMsString(epoch);
  return {event_time:formatEpochMsToShanghaiLocal(epoch),event_epoch_ms:epoch};
}
export function assertG2EvidenceTime(value: unknown): asserts value is G2EvidenceTime{
  assertEpochMsString((value as Partial<G2EvidenceTime> | null)?.event_epoch_ms);assertLocalDateTime((value as Partial<G2EvidenceTime> | null)?.event_time);
  if((value as G2EvidenceTime).event_time!==formatEpochMsToShanghaiLocal((value as G2EvidenceTime).event_epoch_ms))throw Error('EVIDENCE_TIME_MISMATCH');
  if((value as G2EvidenceTime).recorded_at!==undefined){assertLocalDateTime((value as G2EvidenceTime).recorded_at);if((value as G2EvidenceTime).recorded_at!==(value as G2EvidenceTime).event_time)throw Error('EVIDENCE_TIME_MISMATCH');}
}
