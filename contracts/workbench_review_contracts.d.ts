import type {P2016ManualReviewDetail,P2016ManualReviewResolution} from './p2_016_contracts.js';
export interface CanonicalItem {kind:'ticket'|'review'|'intake';id:string}
export interface ReviewReference {id:string;status:'PENDING'|'RESOLVED'|'CANCELLED';row_version:string}
export interface ReviewMaterialBasis {
  source_kind:'BOT'|'WEB'|'MANUAL';original_revision:string;current_revision:string;
  original_hash:string;current_hash:string;stale:boolean;reason:'CURRENT'|'SOURCE_CHANGED'|'NEW_CHANNEL_LEG';
}
export interface ReviewMaterial {source_ref:string;revision:string;text:string|null;in_original_basis:boolean}
export interface ReviewMaterialProjection {material_basis:ReviewMaterialBasis;materials:ReviewMaterial[];materials_truncated:boolean}
export type ReviewWorkspace=P2016ManualReviewDetail & ReviewMaterialProjection & {canonical_item:CanonicalItem};
export type ReviewCommand=P2016ManualReviewResolution & {readonly expected_material_basis?:string};
export interface ReviewCommandResult {
  readonly ok:true;readonly review_id:string;readonly status:'RESOLVED'|'CANCELLED';
  readonly resolution_decision_id:string;readonly action_count:number;readonly replayed:boolean;
}
export type ReviewReceipt={readonly client_command_id:string;readonly review_id:string}&(
  {readonly state:'UNKNOWN'}|{readonly state:'FAILED';readonly error:{readonly code:string;readonly retryable:false}}|
  {readonly state:'COMMITTED';readonly result:ReviewCommandResult&{readonly replayed:true}});
