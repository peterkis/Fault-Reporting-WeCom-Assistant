import type { YxxSelfServiceBootstrap, YxxRequestDetail, YxxReportItem, YxxReportPage, YxxTimeline, YxxReceipt, YxxSupplementInput } from '../../../contracts/yxx_self_service_contracts.js';
import type { H5BootstrapExtension, H5RequestExtension, H5Handler, H5PublicProgress, H5Media, H5RequestInput, H5UrgeInput, H5EvaluationInput, H5LifecycleResult, H5LifecycleReceipt, H5DepartmentPage } from '../../../contracts/yxx_h5_v2_contracts.js';
export type { H5Media, H5RequestInput, H5UrgeInput, H5EvaluationInput, H5LifecycleResult, H5LifecycleReceipt, H5DepartmentPage, H5BootstrapExtension, YxxTimeline, YxxReceipt, YxxSupplementInput };
export type Bootstrap = YxxSelfServiceBootstrap & {h5:H5BootstrapExtension};
export type RequestDetail = YxxRequestDetail & {h5:H5RequestExtension};
export type ReportItem = YxxReportItem & {service_category?:string|null; h5?: {handler?:H5Handler|null; public_progress?:H5PublicProgress|null; media_count?:number; intent?:'FAULT'|'CONTACT_REQUEST'}; detail_url?:string|null};
export type ReportPage = Omit<YxxReportPage,'items'> & {items:ReportItem[]};
export interface ReportsFilter {q:string;status:string;source:string}
export interface UploadInput {schema_version:1;client_command_id:string;kind:'VOICE'|'IMAGE'|'VIDEO';mime_type:string;byte_size:number|null;duration_ms:number|null}
export interface UploadReceipt {media_ref:string;kind:'VOICE'|'IMAGE'|'VIDEO';state?:string;playback_status?:'READY'|'PENDING'|'UNAVAILABLE'}
export interface CommandResult {state?:'UNKNOWN'|'COMMITTED'|'FAILED';status?:string;receipt?:YxxReceipt;result?:YxxReceipt;request_ref?:string}
export type FeedbackInput = import('../../../contracts/yxx_self_service_feedback_contracts.js').YxxFeedbackInput;
