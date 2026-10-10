/** WBINT-T21 SOURCE contract; candidate routes await post-RED runtime validation. */
import type {YxxFeedbackInput,YxxFeedbackContext} from './yxx_self_service_feedback_contracts.js';
export type BotReporterFeedbackInput = YxxFeedbackInput;
export type BotReporterFeedbackContext = YxxFeedbackContext;
export interface BotReporterFeedbackBootstrap {
  schema_version: 1;
  write_enabled: boolean;
  csrf_token: string | null;
}
export interface BotReporterFeedbackResult {
  ok: true;
  replayed: boolean;
  public_ref: string;
  completed_round_ref: string;
  reopened_round_no: number;
  ticket: {ticket_no: string; status: 'REOPENED'; version: number};
}
export type BotReporterFeedbackReceipt = {
  client_command_id: string;
  public_ref: string;
  state: 'UNKNOWN';
} | {
  client_command_id: string;
  public_ref: string;
  state: 'COMMITTED';
  result: BotReporterFeedbackResult & {replayed: true};
};
