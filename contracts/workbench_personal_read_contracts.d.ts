import type {CanonicalItem} from './workbench_review_contracts.js';
export type PersonalReadSourceKind='BOT'|'WEB'|'MANUAL';
export interface PersonalReadCommand {client_command_id:string;source_ref:string;revision:string}
export interface PersonalReadPosition {source_key:string;source_kind:PersonalReadSourceKind;last_read_position:string;latest_position:string;row_version:string;has_unread_material:boolean}
export interface PersonalReadPage {canonical_item:CanonicalItem;sources:PersonalReadPosition[];next_cursor:string|null}
export interface PersonalReadAcknowledgement {ok:true;client_command_id:string;source_key:string;source_kind:PersonalReadSourceKind;last_read_position:string;row_version:string;replayed:boolean}
export type PersonalReadReceipt={client_command_id:string;state:'UNKNOWN'}|{client_command_id:string;state:'COMMITTED';result:PersonalReadAcknowledgement};
