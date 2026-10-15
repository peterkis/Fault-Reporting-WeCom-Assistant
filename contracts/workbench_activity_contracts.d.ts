/** WBINT-T39 frozen public contract. Product mounting remains NOT_IMPLEMENTED until RED. */
export type WorkbenchActivityKind = 'ticket' | 'review' | 'intake';
export interface WorkbenchActivityTarget { kind: WorkbenchActivityKind; id: string }
export type WorkbenchActivityField = 'internal-note' | 'ticket-handling' | 'ticket-completion' | 'manual-review';
export type WorkbenchActivityMode = 'VIEWING' | 'EDITING';
export interface WorkbenchActivityLimits {
  lease_ttl_ms: 15000;
  heartbeat_ms: 5000;
  viewing_idle_ms: 60000;
  editing_idle_ms: 10000;
  max_objects_per_browser: 2;
  max_browsers_per_principal: 4;
  max_browsers: 64;
  max_leases: 128;
  max_leases_per_object: 16;
}
export interface WorkbenchActivityCapability {
  activity_enabled: boolean;
  activity_limits: WorkbenchActivityLimits;
}
export type WorkbenchActivityCommand = {
  schema_version: 1; browser_id: string; action: 'RENEW'; target: WorkbenchActivityTarget; visible: true; active: boolean;
} & ({mode: 'VIEWING'; field: null} | {mode: 'EDITING'; field: WorkbenchActivityField}) | {
  schema_version: 1; browser_id: string; action: 'RELEASE'; target: WorkbenchActivityTarget;
} | {schema_version: 1; browser_id: string; action: 'RELEASE_BROWSER'};
export interface WorkbenchActivityReceipt {
  schema_version: 1;
  accepted: true;
  expires_epoch_ms: string | null;
}
/** Current, mutually authorized colleagues only. No principal/browser/raw external identities. */
export interface WorkbenchActivityPerson {
  display_name: string;
  mode: WorkbenchActivityMode;
  expires_epoch_ms: string;
}
export interface WorkbenchActivityView { schema_version: 1; people: WorkbenchActivityPerson[] }
/** Ephemeral named SSE hint, no id field and no durable event/cursor allocation. */
export interface WorkbenchActivityHint { schema_version: 1 }
