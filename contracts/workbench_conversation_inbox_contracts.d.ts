import type {ConversationWorkspaceEntry,ConversationWorkspaceItem,ConversationWorkspaceDelivery} from './workbench_conversation_workspace_contracts.js';

export type ConversationInboxState='open'|'mine'|'unassigned'|'waiting_human'|'waiting_user'|'failed_delivery'|'ended';
export type ConversationInboxSource='all'|'group'|'direct';
export interface ConversationSourceBadge {kind:'group'|'direct'|'unknown';label:string;ref:string|null}
export interface ConversationChatContext {
  contact_ref:string;topic_ref:string;department_label:string|null;
  original_source:ConversationSourceBadge;current_contact_channel:'group'|'direct';reply_channel_label:string;
}
export interface ConversationInboxEntry {
  contact_ref:string;participant_label:string;department_label:string|null;anchor_session_id:string;
  matching_topic_count:number;latest_activity_at:string;
  last_item_preview:{item_id:string;text:string|null;sender_kind:string;visibility:string}|null;
  unread_count:number;source_badges:ConversationSourceBadge[];additional_source_count:number;
  assignment_summary:{kind:'UNASSIGNED'|'MINE'|'SINGLE'|'MIXED';label:string};has_delivery_exception:boolean;
}
export interface ConversationInboxPage {items:ConversationInboxEntry[];next_cursor:string|null}
export type ConversationChatEntry=ConversationWorkspaceEntry&ConversationChatContext;
export interface ConversationRelatedPage {items:ConversationChatEntry[];next_cursor:string|null}
export interface ConversationChatItem extends ConversationWorkspaceItem {
  sender_label:string;sender_category:'USER'|'HUMAN'|'AUTOMATED_RULE'|'SYSTEM'|'INTERNAL_NOTE';
  communication_message_id:string|null;source_label:string;
  media_availability:'NOT_MEDIA'|'DOWNLOAD_AVAILABLE'|'UNAVAILABLE';
}
export interface ConversationChatItemPage {session_id:string;items:ConversationChatItem[];before_sequence:string|null;after_sequence:string|null;has_more:boolean}
export interface ConversationChatDeliveryPage {items:ConversationWorkspaceDelivery[];next_cursor:string|null}
