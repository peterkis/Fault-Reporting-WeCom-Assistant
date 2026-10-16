import type {IncidentDeliveryRetryCommand,IncidentDeliveryReconcileCommand,IncidentDeliveryCapability} from './workbench_incident_delivery_control_contracts.js';
/** Forward v2 contract. Parent expected_row_version keeps its Incident meaning. */
export interface IncidentDeliveryRetryCommandV2 extends IncidentDeliveryRetryCommand {
  expected_delivery_attempt_count:number;
}
export interface IncidentDeliveryReconcileCommandV2 extends IncidentDeliveryReconcileCommand {
  expected_delivery_attempt_count:number;
}
export interface IncidentDeliveryCapabilityV2 extends IncidentDeliveryCapability {
  attempt_count:number;
}
