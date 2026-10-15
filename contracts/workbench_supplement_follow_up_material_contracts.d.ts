import type {SupplementFollowUpItem} from './workbench_supplement_follow_up_contracts.js';
/** Bounded authorized lookup of one immutable supplemental material, independent of page membership. */
export interface SupplementFollowUpMaterial {readonly ticket_id:string;readonly item:SupplementFollowUpItem}
