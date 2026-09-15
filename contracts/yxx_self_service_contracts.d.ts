export type YxxImpactScope = 'UNKNOWN'|'SELF'|'SINGLE_WORKSTATION'|'MULTIPLE_USERS'|'DEPARTMENT';
export type YxxDisplayStatus = 'RECEIVED_PROCESSING'|'WAITING_FOR_DETAILS'|'UNDER_REVIEW'|'TICKET_CREATED'|'NOT_SERVICE';
export interface YxxRequestInput { schema_version: 1; client_command_id: string; description: string; location: { text: string|null; unknown: boolean }; service_code: string|null; impact_scope: YxxImpactScope; reported_department_text: string|null; extension: string|null; }
export interface YxxSupplementInput { schema_version: 1; client_command_id: string; expected_input_revision: string; text: string; }
export interface YxxReceipt { client_command_id: string; status: 'ACCEPTED'; request_ref: string; intake_no: string; accepted_revision: string; accepted_at: string; }
export interface YxxSelfServiceBootstrap { authenticated: true; identity_mode: 'MEMBER_SELF_SERVICE'; read_only: false; can_submit: boolean; can_supplement: boolean; csrf_token: string; }
export interface YxxReportItem { kind: 'WEB_REQUEST'|'BOT_TICKET'; ref: string; display_status: string; created_at: string; ticket: Record<string, unknown>|null; }
export interface YxxReportPage { items: YxxReportItem[]; next_cursor: string|null; }
export interface YxxRequestDetail { request_ref: string; intake_no: string; source_kind: 'WEB_REQUEST'; input_revision: string; processed_revision: string; display_status: YxxDisplayStatus; needs_action: string|null; safe_description: string; safe_location: string|null; created_at: string; updated_at: string; ticket: Record<string, unknown>|null; safe_clarification: string|null; can_supplement: boolean; }
