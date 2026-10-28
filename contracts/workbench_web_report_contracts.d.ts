import type {H5MediaStaffMetadata} from './yxx_h5_media_contracts.js';
/** ADR-0035. Staff reads retain the existing canonical item and current READ authority. */
export interface WorkbenchWebUrge {active:boolean;count:number;last_urged_at:string|null}
export interface WorkbenchMemberProgress {summary:string;estimated_at:string|null;estimated_epoch_ms:string|null;version:number;updated_at:string;updated_epoch_ms:string}
export interface WorkbenchMemberProgressInput {client_command_id:string;expected_version:number;summary:string;estimated_at:string|null}
export interface WorkbenchMemberProgressResult {ok:true;replayed:boolean;client_command_id:string;ticket_id:string;ticket_version:number;public_progress:WorkbenchMemberProgress}
export type WorkbenchMemberProgressReceipt =
 | {state:'UNKNOWN';client_command_id:string;ticket_id:string}
 | {state:'COMMITTED';client_command_id:string;ticket_id:string;result:WorkbenchMemberProgressResult};
export interface WorkbenchWebEvaluation {rating:number;comment:string|null;evaluated_at:string}
export interface WorkbenchWebMedia extends H5MediaStaffMetadata {}
export interface WorkbenchWebReportView {
 schema_version:1;applicable:boolean;item:{kind:'ticket'|'review'|'intake';id:string};
 ticket_id:string|null;ticket_version:number|null;contact_requested:boolean;
 can_publish_progress:boolean;public_progress:WorkbenchMemberProgress|null;
 urge:WorkbenchWebUrge;evaluation:WorkbenchWebEvaluation|null;
 media_available:boolean;media:readonly WorkbenchWebMedia[];
}
