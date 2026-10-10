import type {LocalDateTime,PhysicalEpochMs} from './time_contracts.js';
import type {CommunicationSenderRequest,CommunicationSenderResult} from './communication_contracts.js';

/** Frozen T26 internal contract only. No runtime adapter or REST mounting is asserted. */
export type WorkbenchGroupNotificationNode='FIRST_RESPONSIBILITY'|'STAFF_COMPLETED';

/** Read from exact persisted Inbox/Intake/Journey; never accepted from a browser. */
export interface WorkbenchOriginalGroupSource {
  readonly origin_intake_id:string;
  readonly journey_id:string|null;
  readonly provider:'WECOM_AIBOT';
  readonly bot_id:string;
  readonly group_id:string;
  readonly reporter_user_id:string;
  readonly retention_until_epoch_ms:PhysicalEpochMs;
}

/** Closed, fixed-template group content; no free report/completion text or raw identity. */
export type WorkbenchGroupStatusContent=Readonly<{
  transport:'WECOM_MESSAGE_PUSH';
  node:WorkbenchGroupNotificationNode;
  suffix:string;
  status:'QUEUED'|'ACCEPTED'|'CLOSED';
  occurred_at:LocalDateTime;
}>;

/** Uses the existing Worker/Sender interface, rejecting every unrelated request. */
export interface WeComMessagePushAdapter {
  send(request:CommunicationSenderRequest):Promise<CommunicationSenderResult>;
}