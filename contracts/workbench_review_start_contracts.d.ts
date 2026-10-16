import type {CanonicalItem} from './workbench_review_contracts.js';

/** The actor explicitly confirms a fault against the material actually read. */
export interface ReviewResolveAndStartCommand {
  readonly client_command_id:string;
  readonly expected_row_version:string;
  readonly expected_material_basis:string;
  readonly resolution_code:'CONFIRM_TICKET_ELIGIBLE';
  readonly resolution_reason_code:string;
  readonly expected_ticket:{readonly ticket_id:string;readonly expected_version:number}|null;
  readonly resolver_team_id:string;
  readonly communication_choice:'TAKE_SELECTED'|'RETAIN_CURRENT';
  readonly sessions:readonly {readonly session_id:string;readonly expected_row_version:number}[];
}

export interface ReviewResolveAndStartResult {
  readonly ok:true;
  readonly review_id:string;
  readonly status:'RESOLVED';
  readonly resolution_decision_id:string;
  readonly action_count:number;
  readonly ticket_id:string;
  readonly ticket_version:number;
  readonly ticket_event_id:string;
  readonly handling_cycle:{readonly id:string;readonly cycle_no:number;readonly first_responsibility_event_id:string};
  readonly communication_choice:'TAKE_SELECTED'|'RETAIN_CURRENT';
  readonly conversations:readonly {readonly session_id:string;readonly session_row_version:number;readonly control_event_id:string|null;readonly changed:boolean}[];
  readonly canonical_item:CanonicalItem & {readonly kind:'ticket'};
  readonly replayed:boolean;
}
