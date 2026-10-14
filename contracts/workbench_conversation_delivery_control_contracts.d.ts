import type {CommunicationDeliveryStatus,ProviderSideEffectState} from './communication_contracts.js';
/** The original public Cookie HTTP UUID controls a real Session, including one without a Ticket. */
export interface ConversationDeliveryAcknowledgement {
 readonly ok:true; readonly session_id:string; readonly delivery_id:string; readonly client_command_id:string;
 readonly status:CommunicationDeliveryStatus; readonly side_effect_state:ProviderSideEffectState;
 readonly attempt_count:number; readonly replayed:boolean;
}
export interface ConversationDeliveryRetryCommandV1 {readonly client_command_id:string;readonly reason_code?:string}
export interface ConversationDeliveryReconcileCommandV1 {readonly client_command_id:string;readonly reason_code:string;readonly resolution:'CONFIRMED_SENT'|'CONFIRMED_NOT_SENT_REQUEUE'|'CANCEL'}
