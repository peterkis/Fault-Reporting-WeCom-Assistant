import type {ManualReportCommand,ManualReportResult} from './workbench_manual_report_contracts.js';

/** Proposed WBINT-T19 contracts. No production handler is installed by this declaration. */
export type ManualReportSelfHandlingCommand=ManualReportCommand&{readonly resolver_team_id:string};
export interface ManualReportSelfHandlingContext {
  readonly can_take_and_start:boolean;
  readonly resolver_teams:ReadonlyArray<{readonly id:string;readonly name:string}>;
  readonly manual_contact_required:true;
  readonly external_notification:false;
  readonly draft_recovery_enabled:boolean;
}
export type ManualReportSelfHandlingResult=Omit<ManualReportResult,'ticket'|'review'|'result_code'>&{
  readonly result_code:'TICKET_ELIGIBLE'|'SERVICE_REQUEST';
  readonly ticket:{readonly id:string;readonly number:string;readonly status:'IN_PROGRESS'};
  readonly review:null;
};
