/** ADR-0035. V2 is explicitly negotiated; existing V1 DTOs remain unchanged. */
export type H5Intent = 'FAULT' | 'CONTACT_REQUEST';
export type H5MediaKind = 'VOICE' | 'IMAGE' | 'VIDEO';
export interface H5RequestInput {
  schema_version: 2;
  client_command_id: string;
  intent: H5Intent;
  description: string | null;
  location: { text: string | null; unknown: boolean };
  media_refs: string[];
}
export interface H5Profile { name: string | null; department: string | null; phone: string | null; avatar_url: string | null }
/** ADR-0039. Current member display metadata never grants department READ. */
export interface H5DisplayProfile {schema_version:1;recovery_scope:string;profile:Pick<H5Profile,'name'|'department'>}
export interface H5Media { media_ref: string; kind: H5MediaKind; mime_type: string; byte_size: number; duration_ms: number | null; url: string; playback_status: 'PENDING' | 'READY' | 'UNAVAILABLE'; playback_mime_type: string | null }
export interface H5Handler { name: string | null; team_name: string | null; phone: string | null; avatar_url: string | null; chat_url: string | null }
export interface H5PublicProgress { summary: string; estimated_at: string | null; estimated_epoch_ms: string | null; version: number; updated_at: string; updated_epoch_ms: string }
export interface H5UrgeSummary { active: boolean; count: number; last_urged_at: string | null; last_urged_epoch_ms: string | null; next_allowed_at: string | null; next_allowed_epoch_ms: string | null; can_urge: boolean }
export interface H5EvaluationContext {
  can_evaluate: boolean;
  completed_round_ref: string | null;
  completed_round_no: number | null;
  ticket_version: number | null;
  rating: number | null;
  comment: string | null;
  evaluated_at: string | null;
  evaluated_epoch_ms: string | null;
}
export interface H5RequestExtension { ticket_version: number | null; media: H5Media[]; handler: H5Handler | null; public_progress: H5PublicProgress | null; urge: H5UrgeSummary; evaluation: H5EvaluationContext; intent: H5Intent }
export interface H5Limits { voice_count: 1; voice_duration_seconds: 60; voice_bytes: number; image_count: 6; image_bytes: number; video_count: 1; video_duration_seconds: 60; video_bytes: number; total_bytes: number }
export interface H5BootstrapExtension {
  profile: H5Profile;
  can_upload: boolean;
  can_urge: boolean;
  can_evaluate: boolean;
  can_view_department: boolean;
  sdk: { enabled: boolean; corp_id: string | null; agent_id: string | null };
  support: { emergency_phone: '18117887318'; service_phone: '61318500' };
  limits: H5Limits;
}
export interface H5UrgeInput { schema_version: 1; client_command_id: string; expected_ticket_version: number }
export interface H5EvaluationInput { schema_version: 1; client_command_id: string; expected_ticket_version: number; completed_round_ref: string; rating: number; comment: string | null }
export interface H5LifecycleResult { ok: true; replayed: boolean; client_command_id: string; request_ref: string; purpose: 'URGE' | 'EVALUATION'; accepted_at: string; accepted_epoch_ms: string }
export type H5LifecycleReceipt = { client_command_id: string; request_ref: string; purpose: 'URGE' | 'EVALUATION'; state: 'UNKNOWN' } | { client_command_id: string; request_ref: string; purpose: 'URGE' | 'EVALUATION'; state: 'COMMITTED'; result: H5LifecycleResult };
export interface H5PublicProgressInput { client_command_id: string; expected_version: number; summary: string; estimated_at: string | null }
export interface H5PublicProgressResult { ok: true; replayed: boolean; client_command_id: string; ticket_id: string; ticket_version: number; public_progress: H5PublicProgress }
export type H5PublicProgressReceipt = { state: 'UNKNOWN'; client_command_id: string; ticket_id: string } | { state: 'COMMITTED'; client_command_id: string; ticket_id: string; result: H5PublicProgressResult };
export interface H5DepartmentReport { ticket_no: string; service_category: string | null; status: string; public_progress: H5PublicProgress | null; created_at: string }
export interface H5DepartmentPage { items: H5DepartmentReport[]; next_cursor: string | null; total: number; active_count: number }
export interface H5ReportFilters { search?: string | null; status?: 'OPEN' | 'ACTIVE' | 'COMPLETED' | null }
