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
/**
 * Current, mutually authorized colleagues only. No principal/browser/raw external identities.
 * ADR-0057: `field` is the most recently edited field while `mode` is EDITING, otherwise null.
 * People are ordered editors first, then by display name.
 */
export interface WorkbenchActivityPerson {
  display_name: string;
  mode: WorkbenchActivityMode;
  field: WorkbenchActivityField | null;
  expires_epoch_ms: string;
}
export interface WorkbenchActivityView { schema_version: 1; people: WorkbenchActivityPerson[] }
/** ADR-0057 read-only batch request: 1..100 targets, duplicates collapse. */
export interface WorkbenchActivityBatchViewRequest { schema_version: 1; targets: WorkbenchActivityTarget[] }
export interface WorkbenchActivityBatchViewItem extends WorkbenchActivityTarget { people: WorkbenchActivityPerson[] }
/** Only targets with at least one mutually authorized colleague appear; unauthorized targets are omitted. */
export interface WorkbenchActivityBatchView { schema_version: 1; items: WorkbenchActivityBatchViewItem[] }
/** Ephemeral named SSE hint, no id field and no durable event/cursor allocation. */
export interface WorkbenchActivityHint { schema_version: 1 }
/** Card 31: same-team colleagues with an open workbench stream (15 s grace), never the requester; at most 50 people, `total` counts all. */
export type WorkbenchOnlineStatus = 'EDITING' | 'VIEWING' | 'ONLINE';
export interface WorkbenchOnlinePerson { display_name: string; status: WorkbenchOnlineStatus }
export interface WorkbenchOnlineView { schema_version: 1; people: WorkbenchOnlinePerson[]; total: number }
