
import type {LocalDateTime} from './time_contracts.js';
import type {CanonicalItem} from './workbench_review_contracts.js';

/** T40 finite SOURCE contract. Endpoint/controller/UI are not mounted by this preparation. */
export type WorkbenchReminderReason =
  | 'AUTHORIZED_TEAM_NEW_REPORT'
  | 'RELATED_NEW_MATERIAL'
  | 'RELATED_REOPEN'
  | 'RELATED_FOLLOW_UP_DUE';
export interface WorkbenchReminderQuery {
  readonly after_event_id:string|null;
  readonly baseline_token:string|null;
  readonly cursor:string|null;
  readonly limit:number;
}
export interface WorkbenchReminderItem {
  readonly reminder_id:string;
  readonly event_id:string;
  readonly reason:WorkbenchReminderReason;
  readonly canonical_item:CanonicalItem;
  readonly source_key:string;
  readonly source_revision:string;
  readonly occurred_at:LocalDateTime;
}
export interface WorkbenchReminderPage {
  readonly schema_version:1;
  readonly items:readonly WorkbenchReminderItem[];
  readonly as_of_event_id:string;
  readonly baseline_token:string;
  readonly next_cursor:string|null;
  readonly reset_required:boolean;
}
export interface WorkbenchReminderPreferences {
  readonly schema_version:1;
  readonly sound_enabled:boolean;
  readonly desktop_enabled:boolean;
}
export type WorkbenchReminderCapability =
  | Readonly<{workbench_reminders_enabled:false;reminders_endpoint:null}>
  | Readonly<{workbench_reminders_enabled:true;reminders_endpoint:'/api/workbench/reminders'}>;
export type WorkbenchReminderCoordination = Readonly<{schema_version:1;authority_scope:string}> & (
  | Readonly<{kind:'RESET';reminder_id:null}>
  | Readonly<{kind:'SEEN';reminder_id:string}>
);
