import type { YxxSelfServiceBootstrap, YxxRequestDetail, YxxReportItem, YxxReportPage, YxxTimeline, YxxReceipt, YxxSupplementInput } from '../../../contracts/yxx_self_service_contracts.js';
import type { H5BootstrapExtension, H5RequestExtension, H5Handler, H5PublicProgress, H5Media, H5RequestInput, H5UrgeInput, H5EvaluationInput, H5LifecycleResult, H5LifecycleReceipt, H5DepartmentPage } from '../../../contracts/yxx_h5_v2_contracts.js';
import type {H5EntryResponse,H5EntryInput,H5EntryView,H5EntryDetail,H5Thumbnail,H5SupplementPage,H5DepartmentSummary} from '../../../contracts/yxx_h5_entry_contracts.js';
export type { H5Media, H5RequestInput, H5UrgeInput, H5EvaluationInput, H5LifecycleResult, H5LifecycleReceipt, H5DepartmentPage, H5BootstrapExtension, YxxTimeline, YxxReceipt, YxxSupplementInput };
export type {H5EntryResponse,H5EntryInput,H5EntryView,H5EntryDetail,H5Thumbnail,H5SupplementPage,H5DepartmentSummary};
export type Bootstrap = YxxSelfServiceBootstrap & {h5:H5BootstrapExtension};
/** Legacy reads omit the cursor and thumbnail; new entry reads always provide them. */
export type RequestDetail = YxxRequestDetail & {supplements_cursor?:string|null;h5:Omit<H5RequestExtension,'media'>&{media:(H5Media&{thumbnail?:H5Thumbnail|null})[]}};
export type ReportItem = YxxReportItem & {service_category?:string|null; h5?: {handler?:H5Handler|null; public_progress?:H5PublicProgress|null; media_count?:number; intent?:'FAULT'|'CONTACT_REQUEST'}; detail_url?:string|null};
export type ReportPage = Omit<YxxReportPage,'items'> & {items:ReportItem[]};
export interface ReportsFilter {q:string;status:''|'OPEN'|'ACTIVE'|'COMPLETED';source:''|'WEB'|'BOT'}
export interface UploadInput {schema_version:1;client_command_id:string;kind:'VOICE'|'IMAGE'|'VIDEO';mime_type:string;byte_size:number|null;duration_ms:number|null}
export interface UploadReceipt {media_ref:string;kind:'VOICE'|'IMAGE'|'VIDEO';state?:string;playback_status?:'READY'|'PENDING'|'UNAVAILABLE'}
export type CommandResult=YxxReceipt|{state:'UNKNOWN';client_command_id:string;request_ref?:string}|{state:'COMMITTED';client_command_id:string;result:YxxReceipt};
export type FeedbackInput = import('../../../contracts/yxx_self_service_feedback_contracts.js').YxxFeedbackInput;
export type FeedbackResult=import('../../../contracts/yxx_self_service_feedback_contracts.js').YxxFeedbackResult;
export type FeedbackReceipt=import('../../../contracts/yxx_self_service_feedback_contracts.js').YxxFeedbackReceipt;
/** Closed response map: every transport decoder must match its endpoint's response. */
export interface EndpointResponseMap {
 bootstrap:Bootstrap;reports:ReportPage;detail:RequestDetail;timeline:YxxTimeline;supplements:H5SupplementPage;
 department:H5DepartmentPage;departmentSummary:H5DepartmentSummary;receipt:YxxReceipt;command:CommandResult;
 lifecycle:H5LifecycleResult;lifecycleReceipt:H5LifecycleReceipt;feedback:FeedbackResult;feedbackReceipt:FeedbackReceipt;
 upload:UploadReceipt;entry:H5EntryResponse;signature:{timestamp:number;nonceStr:string;signature:string};
}
