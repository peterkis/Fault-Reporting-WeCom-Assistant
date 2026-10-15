import type {BoardColumn,CompletionRange,WorkbenchCard} from './web01_workbench_contracts.js';
import type {SharedFollowUpActive} from './workbench_follow_up_schedule_contracts.js';
import type {WorkbenchFollowAttention} from './workbench_item_follow_contracts.js';

/** SOURCE_ONLY contract. No search route or query is mounted by this declaration. */
export type WorkbenchSearchColumn=BoardColumn|'all';
export type WorkbenchSearchResponsibility='any'|'handling'|'communication'|'following'|'unassigned';
export type WorkbenchSearchSource='WECOM_DIRECT'|'WECOM_GROUP'|'WEB_REQUEST'|'MANUAL_PHONE'|'MANUAL_ON_SITE';
export type WorkbenchSearchStatus='NEW'|'QUEUED'|'ACCEPTED'|'REOPENED'|'IN_PROGRESS'|'WAITING_REQUESTER'|'WAITING_VENDOR'|
 'RESOLVED'|'CLOSED'|'CANCELLED'|'DUPLICATE_LINKED'|'PENDING'|'RECEIVED'|'WAITING_DESCRIPTION'|'WAITING_TRIAGE'|'FAILED'|'COMPLETED'|'IGNORED';
export interface WorkbenchSearchCriteria {
 readonly q:string;readonly column:WorkbenchSearchColumn;readonly range:CompletionRange;readonly scope:'team'|'related';
 readonly responsibility:WorkbenchSearchResponsibility;readonly resolver_team_id:string|null;readonly assignee_id:string|null;
 readonly sources:ReadonlyArray<WorkbenchSearchSource>;readonly source_group_ref:string|null;
 readonly statuses:ReadonlyArray<WorkbenchSearchStatus>;readonly supplement:'any'|'pending'|'followed'|'none';
 readonly schedule:'any'|'active'|'due'|'none';
}
export interface WorkbenchSearchRequest {readonly criteria:WorkbenchSearchCriteria;readonly cursor:string|null;readonly limit:number}
export type WorkbenchSearchCard=WorkbenchCard&{
 readonly attention?:WorkbenchFollowAttention;
 readonly supplement_follow_up?:Readonly<{has_pending_supplements:boolean}>;
 readonly follow_up_schedule?:SharedFollowUpActive|null;
};
export interface WorkbenchSearchPage {
 readonly items:ReadonlyArray<WorkbenchSearchCard>;readonly next_cursor:string|null;
 readonly column:WorkbenchSearchColumn;
 readonly range:Readonly<{mode:CompletionRange;from:string;until:string;timezone:'Asia/Shanghai'}>;
 readonly criteria:WorkbenchSearchCriteria;
}
/** Planned HTTP error names; SEARCH_RATE_LIMITED is not registered in a running host yet. */
export type WorkbenchSearchErrorCode='WORKBENCH_UNAUTHENTICATED'|'WORKBENCH_AUTH_EXPIRED'|'WORKBENCH_FORBIDDEN'|
 'P2_016_FORBIDDEN'|'P2_016_INPUT_INVALID'|'P2_016_LIMIT_INVALID'|'P2_016_CURSOR_INVALID'|'P2_016_NOT_FOUND'|
 'P2_016_DISABLED'|'P2_016_ACTION_FAILED'|'P2_016_SEARCH_RATE_LIMITED';
