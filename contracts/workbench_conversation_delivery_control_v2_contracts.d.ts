import type {ConversationDeliveryRetryCommandV1,ConversationDeliveryReconcileCommandV1} from './workbench_conversation_delivery_control_contracts.js';
/** Forward protocol: bind the exact count returned by the current Session delivery read. */
export interface ConversationDeliveryRetryCommandV2 extends ConversationDeliveryRetryCommandV1 {readonly expected_delivery_attempt_count:number}
export interface ConversationDeliveryReconcileCommandV2 extends ConversationDeliveryReconcileCommandV1 {readonly expected_delivery_attempt_count:number}
