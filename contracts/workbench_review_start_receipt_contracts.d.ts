/** Current original-purpose authorization precedes this read-only ledger projection. */
export type ReviewStartReceipt =
  | {readonly client_command_id:string;readonly review_id:string;readonly state:'UNKNOWN'}
  | {readonly client_command_id:string;readonly review_id:string;readonly state:'FAILED';readonly error:{readonly code:string;readonly retryable:false}}
  | {readonly client_command_id:string;readonly review_id:string;readonly state:'COMMITTED';readonly ticket_id:string;readonly ticket_version:number;readonly ticket_event_id:string};
