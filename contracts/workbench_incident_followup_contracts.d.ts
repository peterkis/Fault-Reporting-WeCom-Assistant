import type {AuthContext,IncidentCommandResult} from './p2_012_contracts.js';

/** Safe original-ledger observation; no command payload or replay authority. */
export type IncidentFollowupReceipt = {readonly incident_id:string;readonly client_command_id:string} & (
  {readonly state:'UNKNOWN'} |
  {readonly state:'FAILED';readonly error:{readonly code:string;readonly retryable:false}} |
  {readonly state:'COMMITTED';readonly result:IncidentCommandResult & {readonly result_ref_type:'INCIDENT';readonly replayed:true}}
);
export interface IncidentFollowupQueryPort {
  incidentCommandReceipt(input:{authContext:AuthContext;id:string;commandId:string}):Promise<IncidentFollowupReceipt>;
}
