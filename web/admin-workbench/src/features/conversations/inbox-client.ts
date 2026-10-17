import {ApiError,readWorkbench} from '../../api/client';
import {UUID,decodeConversation} from './client';
import type {ConversationInboxPage,ConversationInboxEntry,ConversationChatEntry,ConversationRelatedPage,ConversationChatItemPage,ConversationSourceBadge,ConversationChatDeliveryPage} from '../../../../../contracts/workbench_conversation_inbox_contracts';
export type {ConversationInboxEntry,ConversationChatEntry,ConversationChatItem,ConversationSourceBadge} from '../../../../../contracts/workbench_conversation_inbox_contracts';
function bad():never{throw new ApiError(502,'INVALID_RESPONSE');}
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))bad();return v as Record<string,unknown>;}
function exact(v:unknown,keys:readonly string[]){const o=object(v);if(Object.keys(o).length!==keys.length||Object.keys(o).some(k=>!keys.includes(k)))bad();return o;}
function text(v:unknown,max=20480):string{if(typeof v!=='string'||v.length>max)bad();return v;}
function nullable(v:unknown,max=20480){return v===null?null:text(v,max);}
function uuid(v:unknown){const s=text(v,36);if(!UUID.test(s))bad();return s;}
function integer(v:unknown){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)bad();return v;}
function bool(v:unknown){if(typeof v!=='boolean')bad();return v;}
function array<T>(v:unknown,decode:(x:unknown)=>T,max=100):T[]{if(!Array.isArray(v)||v.length>max)bad();return v.map(decode);}
function enumeration<T extends string>(v:unknown,values:readonly T[]):T{if(typeof v!=='string'||!values.includes(v as T))bad();return v as T;}
function time(v:unknown){const s=text(v,19);if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(s))bad();return s;}
function sequence(v:unknown){const s=text(v,19);if(!/^[1-9][0-9]{0,18}$/u.test(s)||BigInt(s)>9223372036854775807n)bad();return s;}
function ref(v:unknown,kind:'cci'|'ctp'){const s=text(v,71);if(!new RegExp('^'+kind+'_v1_[a-f0-9]{64}$','u').test(s))bad();return s;}
function source(v:unknown):ConversationSourceBadge{const o=exact(v,['kind','label','ref']),r=nullable(o.ref,64);if(r!==null&&!/^[a-f0-9]{64}$/u.test(r))bad();return {kind:enumeration(o.kind,['group','direct','unknown']),label:text(o.label,256),ref:r};}
export function decodeInboxEntry(v:unknown):ConversationInboxEntry{
  const o=exact(v,['contact_ref','participant_label','department_label','anchor_session_id','matching_topic_count','latest_activity_at','last_item_preview','unread_count','source_badges','additional_source_count','assignment_summary','has_delivery_exception']);
  const a=exact(o.assignment_summary,['kind','label']),last=o.last_item_preview===null?null:exact(o.last_item_preview,['item_id','text','sender_kind','visibility']);
  return {contact_ref:ref(o.contact_ref,'cci'),participant_label:text(o.participant_label,128),department_label:nullable(o.department_label,128),anchor_session_id:uuid(o.anchor_session_id),matching_topic_count:integer(o.matching_topic_count),latest_activity_at:time(o.latest_activity_at),
    last_item_preview:last?{item_id:uuid(last.item_id),text:nullable(last.text,256),sender_kind:text(last.sender_kind,32),visibility:enumeration(last.visibility,['EXTERNAL','INTERNAL','RESTRICTED'])}:null,
    unread_count:integer(o.unread_count),source_badges:array(o.source_badges,source,8),additional_source_count:integer(o.additional_source_count),assignment_summary:{kind:enumeration(a.kind,['UNASSIGNED','MINE','SINGLE','MIXED']),label:text(a.label,256)},has_delivery_exception:bool(o.has_delivery_exception)};
}
export function decodeChatEntry(v:unknown):ConversationChatEntry{
  const o=exact(v,['session','participant_label','topic','channel_label','canonical_item','assignment','handoff','capabilities','contact_ref','topic_ref','department_label','original_source','current_contact_channel','reply_channel_label']);
  return {...decodeConversation(o),contact_ref:ref(o.contact_ref,'cci'),topic_ref:ref(o.topic_ref,'ctp'),department_label:nullable(o.department_label,128),original_source:source(o.original_source),current_contact_channel:enumeration(o.current_contact_channel,['group','direct']),reply_channel_label:text(o.reply_channel_label,128)};
}
const base=(id:string)=>'/api/workbench/conversations/'+encodeURIComponent(id);
export const conversationInbox={
  list:(filters:{state:string;source:string;q:string;source_group_ref?:string},cursor:string|null,signal:AbortSignal):Promise<ConversationInboxPage>=>readWorkbench('/api/workbench/conversation-inbox?'+new URLSearchParams({...filters,limit:'30',...(cursor?{cursor}:{})}),signal,v=>{const o=exact(v,['items','next_cursor']);return {items:array(o.items,decodeInboxEntry),next_cursor:nullable(o.next_cursor,2048)};}),
  detail:(id:string,signal:AbortSignal)=>readWorkbench(base(id)+'?view=chat',signal,v=>{const entry=decodeChatEntry(v);if(entry.session.session_id!==id)bad();return entry;}),
  related:(id:string,cursor:string|null,signal:AbortSignal):Promise<ConversationRelatedPage>=>readWorkbench(base(id)+'/related-sessions?'+new URLSearchParams({limit:'50',...(cursor?{cursor}:{})}),signal,v=>{const o=exact(v,['items','next_cursor']);return {items:array(o.items,decodeChatEntry),next_cursor:nullable(o.next_cursor,2048)};}),
  items:(id:string,signal:AbortSignal,before?:string):Promise<ConversationChatItemPage>=>readWorkbench(base(id)+'/items?'+new URLSearchParams({view:'chat',limit:'50',...(before?{before_sequence:before}:{})}),signal,v=>{
    const o=exact(v,['session_id','items','before_sequence','after_sequence','has_more']);if(uuid(o.session_id)!==id)bad();
    return {session_id:id,items:array(o.items,v=>{const i=exact(v,['item_id','sequence_no','item_type','sender_kind','visibility','text','occurred_at','sender_label','sender_category','communication_message_id','source_label','media_availability']);
      return {item_id:uuid(i.item_id),sequence_no:sequence(i.sequence_no),item_type:text(i.item_type,64),sender_kind:text(i.sender_kind,32),visibility:enumeration(i.visibility,['EXTERNAL','INTERNAL','RESTRICTED']),text:nullable(i.text),occurred_at:time(i.occurred_at),sender_label:text(i.sender_label,256),sender_category:enumeration(i.sender_category,['USER','HUMAN','AUTOMATED_RULE','SYSTEM','INTERNAL_NOTE']),communication_message_id:i.communication_message_id===null?null:uuid(i.communication_message_id),source_label:text(i.source_label,256),media_availability:enumeration(i.media_availability,['NOT_MEDIA','DOWNLOAD_AVAILABLE','UNAVAILABLE'])};},200),before_sequence:o.before_sequence===null?null:sequence(o.before_sequence),after_sequence:o.after_sequence===null?null:sequence(o.after_sequence),has_more:bool(o.has_more)};
  }),
  deliveries:(id:string,messageIds:readonly string[],cursor:string|null,signal:AbortSignal):Promise<ConversationChatDeliveryPage>=>readWorkbench(base(id)+'/deliveries?'+new URLSearchParams({view:'chat',message_ids:messageIds.join(','),...(cursor?{cursor}:{})}),signal,v=>{
    const o=exact(v,['items','next_cursor']);return {items:array(o.items,v=>{const d=exact(v,['message_id','purpose','delivery_id','status','side_effect_state','channel','attempt_count','last_error_code','sent_at','created_at']);
      return {message_id:uuid(d.message_id),purpose:text(d.purpose,64),delivery_id:uuid(d.delivery_id),status:text(d.status,64),side_effect_state:text(d.side_effect_state,64),channel:text(d.channel,64),attempt_count:integer(d.attempt_count),last_error_code:nullable(d.last_error_code,128),sent_at:d.sent_at===null?null:time(d.sent_at),created_at:time(d.created_at)};}),next_cursor:nullable(o.next_cursor,2048)};
  }),
};
