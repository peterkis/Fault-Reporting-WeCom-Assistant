/** T32 closed query contract. SOURCE proposal until mounted and actually verified. */
export type NotificationExceptionDomain = 'TICKET' | 'SESSION' | 'INCIDENT';
export type NotificationExceptionSource = 'TICKET_NOTIFICATION' | 'SESSION_MESSAGE' | 'INCIDENT_LIFECYCLE' | 'INCIDENT_PUBLIC_PROGRESS';
export type NotificationExceptionRoute = 'GROUP' | 'BOT_DIRECT' | 'YIXIAOXIU_APP';
export type NotificationExceptionStatus = 'DEAD_LETTER' | 'RECONCILIATION_REQUIRED' | 'CANCELLED';
export type NotificationExceptionAction = 'RETRY' | 'RECONCILE';
export interface NotificationExceptionQuery {
  domain?: NotificationExceptionDomain | 'ALL';
  route?: NotificationExceptionRoute | 'ALL';
  state?: 'FAILED' | 'UNKNOWN' | 'ALL';
  cursor?: string;
  limit?: number;
}
export interface NotificationExceptionAttempt {
  attempt_no: number;
  outcome: string;
  side_effect_state: 'NOT_ATTEMPTED' | 'ACKNOWLEDGED' | 'UNKNOWN';
  started_at: string;
  finished_at: string | null;
}
export interface NotificationExceptionItem {
  domain: NotificationExceptionDomain;
  parent_id: string;
  delivery_id: string;
  source_kind: NotificationExceptionSource;
  route_kind: NotificationExceptionRoute;
  destination_type: 'GROUP' | 'PERSON';
  status: NotificationExceptionStatus;
  side_effect_state: 'NOT_ATTEMPTED' | 'ACKNOWLEDGED' | 'UNKNOWN';
  attempt_count: number;
  last_attempt: NotificationExceptionAttempt | null;
  safe_summary: string;
  error_code: 'FAILURE_RECORDED' | 'RESULT_UNCONFIRMED' | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  allowed_actions: NotificationExceptionAction[];
  parent_link: string;
}
export interface NotificationExceptionPage {
  items: NotificationExceptionItem[];
  has_more: boolean;
  next_cursor: string | null;
}
export interface NotificationExceptionCapability { notification_exceptions_enabled: boolean }
export interface NotificationExceptionHostOptions { notificationExceptionsEnabled?: boolean }
