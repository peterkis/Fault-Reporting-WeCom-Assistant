/** Formal React transport capability; events are hints, never domain facts. */
export interface WorkbenchRealtimeCapability {
  realtime_sse_enabled: boolean;
  realtime_sse_available: boolean;
  sse_endpoint: '/api/realtime/events?scope=workbench' | null;
  polling_interval_ms: number;
  expires_epoch_ms: string;
  authorization_revision:string|null;
}
export type WorkbenchRealtimeStatus = 'disabled' | 'connecting' | 'live' | 'reconnecting' | 'polling' | 'offline' | 'auth-blocked';
