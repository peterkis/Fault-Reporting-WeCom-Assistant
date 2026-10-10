export interface ConversationWorkspaceSession {session_id:string;status:string;control_mode:string;generation_version:number;row_version:number;last_activity_at:string}
export interface ConversationCanonicalItem {kind:'ticket'|'review'|'intake';id:string;number:string;title:string}
export interface ConversationWorkspaceEntry {
  session:ConversationWorkspaceSession;participant_label:string;topic:string;channel_label:string;canonical_item:ConversationCanonicalItem|null;
  assignment:{status:string;assigned_to_me:boolean;assigned_display_name:string|null};
  handoff:{handoff_id:string;status:string;row_version:number}|null;capabilities:readonly string[];
}
export interface ConversationWorkspacePage {items:ConversationWorkspaceEntry[];next_cursor:string|null}
export interface ConversationTextCommand {client_command_id:string;expected_row_version:number;text:string}
export type ConversationPurpose='messages'|'internal-notes';
export interface ConversationMessageResult {message_id:string;outbox_id:string|null;delivery_ids:readonly string[];command_status:'COMMITTED'|'REPLAYED';replayed:boolean;created_at:string}
export type ConversationCommandReceipt={session_id:string;client_command_id:string;state:'UNKNOWN'}|{session_id:string;client_command_id:string;state:'COMMITTED';result:ConversationMessageResult};
export interface ConversationWorkspaceItem {item_id:string;sequence_no:string;item_type:string;sender_kind:string;visibility:string;text:string|null;occurred_at:string}
export interface ConversationItemPage {session_id:string;items:ConversationWorkspaceItem[];before_sequence:string|null;after_sequence:string|null;has_more:boolean}
export interface ConversationWorkspaceDelivery {message_id:string;delivery_id:string;purpose:string;status:string;side_effect_state:string;channel:string;attempt_count:number;last_error_code:string|null;sent_at:string|null;created_at:string}
