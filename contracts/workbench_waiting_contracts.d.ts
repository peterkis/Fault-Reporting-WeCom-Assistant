import type {P2016WaitingActionCommand,P2016RequestInformationResult} from './p2_016_contracts.js';
export type WaitingAction='request-information'|'wait-vendor'|'resume'|'cancel';
export type WaitingCommand=P2016WaitingActionCommand;
export type WaitingResult=P2016RequestInformationResult;
export interface WaitingCapability {ticket_waiting_actions_enabled:boolean;ticket_waiting_action_draft_recovery_enabled:boolean}
export type WaitingAcknowledgement=Readonly<{state:'UNKNOWN'}>|Readonly<{state:'COMMITTED';ticket_id:string;ticket_version:number;ticket_event_id:string}>|Readonly<{state:'FAILED';error:Readonly<{code:string;retryable:false}>}>;
