export type WorkbenchAuthMethod = 'COOKIE' | 'BEARER';
export interface WorkbenchAuthContext { principal_id: string; auth_method: WorkbenchAuthMethod; expires_at: string; csrf_token?: string }
export interface WorkbenchAuthenticationPort { authenticate(request: unknown): Promise<WorkbenchAuthContext | null> }
export type WorkbenchConversationState = 'open' | 'waiting_human' | 'mine' | 'unassigned' | 'waiting_user' | 'failed_delivery' | 'ended';
export interface WorkbenchOpaqueCursor { readonly value: string }
export interface WorkbenchSafePrincipal { principal_id: string; display_name: string; capabilities: readonly string[] }
export interface WorkbenchBootstrap { authenticated: true; principal: WorkbenchSafePrincipal; expires_at: string; csrf_token?: string; capabilities: readonly string[]; polling_interval_ms: number; sse_endpoint: string }
export interface WorkbenchConversationPage { items: readonly unknown[]; next_cursor: string | null }
export interface WorkbenchConversationDetail { session: unknown; assignment: unknown; handoff: unknown | null; read_cursor: unknown; unread_count: number; ticket: unknown | null; incident: { available: false; reason: 'INCIDENT_NOT_IMPLEMENTED' }; attachments: { available: false; reason: 'ATTACHMENT_NOT_IMPLEMENTED' }; capabilities: readonly string[]; etag: string }
export type WorkbenchReconciliationResolution = 'CONFIRMED_SENT' | 'CONFIRMED_NOT_SENT_REQUEUE' | 'CANCEL';
export interface WorkbenchPublicError { error: { code: string; retryable: boolean } }
