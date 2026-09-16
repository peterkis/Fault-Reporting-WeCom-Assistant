export type YxxImpactScope = 'UNKNOWN'|'SELF'|'SINGLE_WORKSTATION'|'MULTIPLE_USERS'|'DEPARTMENT';
export type YxxDisplayStatus = 'RECEIVED_PROCESSING'|'WAITING_FOR_DETAILS'|'UNDER_REVIEW'|'TICKET_CREATED'|'NOT_SERVICE';
export type LocalDateTime = string & { readonly __localDateTime: unique symbol };
export type EpochMs = string & { readonly __epochMs: unique symbol };
export interface YxxRequestInput { schema_version: 1; client_command_id: string; description: string; location: { text: string|null; unknown: boolean }; service_code: string|null; impact_scope: YxxImpactScope; reported_department_text: string|null; extension: string|null; }
export interface YxxSupplementInput { schema_version: 1; client_command_id: string; expected_input_revision: string; text: string; }
export interface YxxReceipt { client_command_id: string; status: 'ACCEPTED'; request_ref: string; intake_no: string; accepted_revision: string; accepted_at: LocalDateTime; accepted_epoch_ms: EpochMs; }
export interface YxxSelfServiceBootstrap { authenticated: true; identity_mode: 'MEMBER_SELF_SERVICE'; read_only: false; can_submit: boolean; can_supplement: boolean; csrf_token: string; }
export interface YxxSelfServiceProfile { profile: 'OAUTH_ONLY'|'MEMBER_TICKET_READONLY'|'MEMBER_SELF_SERVICE'|'FULL_SERVICE_LOOP'; oauth: 'WECom_MEMBER'; business_read: boolean; web_write: boolean; processor: 'NONE'|'APP_BOUNDED_PUMP'|'EXISTING_WORKER'; external_delivery: 'NONE_FOR_WEB'; write_flag: boolean; YIXIAOXIU_SELF_SERVICE_ENABLED: boolean; YIXIAOXIU_MY_REPORTS_ENABLED: boolean; 'x-readonly-write-denied': true; }
export interface YxxSafeTicket { ticket_no: string; status: string; updated_at?: LocalDateTime; }
export interface YxxReportItem { kind: 'WEB_REQUEST'|'BOT_TICKET'; ref: string; display_status: string; created_at: LocalDateTime; created_epoch_ms: EpochMs; ticket: YxxSafeTicket|null; }
export interface YxxReportPage { items: YxxReportItem[]; next_cursor: string|null; }
export interface YxxTimelineEvent { event_type: string; occurred_at: LocalDateTime; occurred_epoch_ms: EpochMs; summary: string; ticket: YxxSafeTicket|null; }
export interface YxxTimeline { items: YxxTimelineEvent[]; next_cursor: string|null; }
export interface YxxRequestDetail { request_ref: string; intake_no: string; source_kind: 'WEB_REQUEST'; input_revision: string; processed_revision: string; display_status: YxxDisplayStatus; needs_action: string|null; safe_description: string; safe_location: string|null; created_at: LocalDateTime; created_epoch_ms: EpochMs; updated_at: LocalDateTime; updated_epoch_ms: EpochMs; ticket: YxxSafeTicket|null; safe_clarification: string|null; can_supplement: boolean; }
