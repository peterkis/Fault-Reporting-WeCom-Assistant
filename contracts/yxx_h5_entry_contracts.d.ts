/** ADR-0036. Closed page-entry read DTOs; legacy V1/V2 bodies are unchanged. */
import type {YxxSelfServiceBootstrap,YxxReportItem,YxxReportPage,YxxRequestDetail,YxxTimeline} from './yxx_self_service_contracts.js';
import type {H5BootstrapExtension,H5RequestExtension,H5Media,H5DepartmentPage,H5ReportFilters} from './yxx_h5_v2_contracts.js';

export type H5EntryBootstrap=YxxSelfServiceBootstrap & {h5:H5BootstrapExtension};
export type H5EntryView='home'|'report'|'reports'|'request'|'department';
export type H5EntryInput=
 | {view:'home'|'report'}
 | ({view:'reports';source?:'WEB'|'BOT'|null}&H5ReportFilters)
 | {view:'request';request_ref:string}
 | ({view:'department'}&H5ReportFilters);
export type H5ReadSection<T>={status:'READY';data:T}|{status:'UNAVAILABLE';code:'YXX_UNAVAILABLE'};
export interface H5Thumbnail {status:'PENDING'|'READY'|'UNAVAILABLE';url:string|null;mime_type:string|null;byte_size:number|null}
export interface H5EntryMedia extends H5Media {thumbnail:H5Thumbnail|null}
export interface H5SupplementItem {input_revision:string;text:string|null}
export interface H5SupplementPage {items:H5SupplementItem[];next_cursor:string|null}
export type H5EntryDetail=Omit<YxxRequestDetail,'supplements'> & {
 supplements:H5SupplementItem[];
 supplements_cursor:string|null;
 h5:Omit<H5RequestExtension,'media'>&{media:H5EntryMedia[]};
};
export interface H5EntryDataMap {
 home:{recent_reports:YxxReportItem[];department_summary:H5DepartmentSummary|null};
 report:null;
 reports:{reports:YxxReportPage};
 request:{detail:H5EntryDetail;timeline:H5ReadSection<YxxTimeline>};
 department:{department:H5DepartmentPage};
}
export type H5EntryResponse<V extends H5EntryView=H5EntryView>={
 [K in V]:{schema_version:1;view:K;bootstrap:H5EntryBootstrap;membership_revision:string;data:H5EntryDataMap[K]}
}[V];
export interface H5DepartmentSummary {total:number;active_count:number;membership_revision:string}
