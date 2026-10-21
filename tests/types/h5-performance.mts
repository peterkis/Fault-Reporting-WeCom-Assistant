import type {H5EntryInput,H5EntryResponse,H5EntryView,H5ReadSection} from '../../contracts/yxx_h5_entry_contracts.js';
import type {H5LifecycleReceipt} from '../../contracts/yxx_h5_v2_contracts.js';

/** Request/response discriminants prevent mixing page caches and command recovery. */
function pageData<V extends H5EntryView>(response:H5EntryResponse<V>){return response.data;}
declare const home:Extract<H5EntryResponse,{view:'home'}>;
declare const request:Extract<H5EntryResponse,{view:'request'}>;
pageData(home).recent_reports;
if(home.data.department_summary)home.data.department_summary.membership_revision;
// @ts-expect-error -- Home must explicitly report the authorized department summary or null.
const missingDepartmentSummary:typeof home.data={recent_reports:[]};
pageData(request).detail.supplements_cursor;
// @ts-expect-error -- Home preview is not the complete reports page and has no pagination cursor.
pageData(home).reports.next_cursor;
const valid:H5EntryInput={view:'request',request_ref:'H'.repeat(32)};
// @ts-expect-error -- A request entry must name the protected request reference.
const missingReference:H5EntryInput={view:'request'};
// @ts-expect-error -- Department entries cannot declare the Bot/Web owner-source filter.
const wrongFilter:H5EntryInput={view:'department',source:'BOT'};
declare const section:H5ReadSection<{items:readonly string[]}>;
if(section.status==='READY')section.data.items;
else {
 // @ts-expect-error -- An unavailable section has no invented successful data.
 section.data.items;
}
declare const receipt:H5LifecycleReceipt;
if(receipt.state==='COMMITTED')receipt.result.client_command_id;
else {
 // @ts-expect-error -- UNKNOWN cannot expose a committed command result.
 receipt.result;
}
void valid;void missingReference;void wrongFilter;void missingDepartmentSummary;
