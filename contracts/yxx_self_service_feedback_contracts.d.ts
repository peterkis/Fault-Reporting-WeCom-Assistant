/** WBINT-T20 frozen candidate contract. HTTP/product implementation is pending its public RED. */
export interface YxxFeedbackInput {
  schema_version: 1;
  client_command_id: string;
  feedback: 'STILL_UNRESOLVED';
  completed_round_ref: string;
  expected_ticket_version: number;
}
export type YxxFeedbackContext = {
  schema_version: 1;
  can_feedback: true;
  completed_round_ref: string;
  completed_round_no: number;
  ticket_version: number;
  rejection: null;
} | {
  schema_version: 1;
  can_feedback: false;
  completed_round_ref: null;
  completed_round_no: null;
  ticket_version: null;
  rejection: 'WRITE_DISABLED'|'TICKET_NOT_CREATED'|'ROUND_NOT_COMPLETED'|'ROUND_ALREADY_REOPENED';
};
export interface YxxFeedbackResult {
  ok: true;
  replayed: boolean;
  request_ref: string;
  completed_round_ref: string;
  reopened_round_no: number;
  ticket: {ticket_no: string; status: 'REOPENED'; version: number};
}
export type YxxFeedbackReceipt = {
  client_command_id: string;
  request_ref: string;
  state: 'UNKNOWN';
} | {
  client_command_id: string;
  request_ref: string;
  state: 'COMMITTED';
  result: YxxFeedbackResult & {replayed: true};
};
