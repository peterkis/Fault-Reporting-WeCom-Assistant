import type {IncidentDeliveryCapabilityV2} from '../contracts/workbench_incident_delivery_control_v2_contracts.js';
export const INCIDENT_DELIVERY_AUTHORITY_HEADERS=Object.freeze({retry:'x-incident-delivery-retry-authorized',reconcile:'x-incident-delivery-reconcile-authorized'});
export interface IncidentDeliveryAuthority {retry_authorized:boolean;reconcile_authorized:boolean}
export function decodeIncidentDeliveryAuthority(headers:{get:(name:string)=>string|null},capability:Pick<IncidentDeliveryCapabilityV2,'retry'|'reconcile'|'receipt_read'>):IncidentDeliveryAuthority{
 const read=(name:string)=>{const value=headers.get(name);if(value!=='0'&&value!=='1')throw new TypeError('INCIDENT_DELIVERY_INVALID_AUTHORITY');return value==='1';};
 const retry_authorized=read(INCIDENT_DELIVERY_AUTHORITY_HEADERS.retry),reconcile_authorized=read(INCIDENT_DELIVERY_AUTHORITY_HEADERS.reconcile);
 if(capability.receipt_read!==(retry_authorized||reconcile_authorized)||capability.retry&&!retry_authorized||capability.reconcile&&!reconcile_authorized)throw new TypeError('INCIDENT_DELIVERY_INVALID_AUTHORITY');
 return Object.freeze({retry_authorized,reconcile_authorized});
}
