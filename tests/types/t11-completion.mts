import {normalizeCompletionCommand} from '../../src/workbench-ticket-completion.mjs';
import type {createTicketStaffCompletionService} from '../../src/workbench-ticket-completion.mjs';
import type {P2016CompletionCommand,P2016CompletionResult} from '../../contracts/p2_016_contracts.js';
declare const external:unknown;
const normalized=normalizeCompletionCommand(external);
const version:number=normalized.expected_version;
const action:'complete'=normalized.action;
const basis:'STAFF_COMPLETED'=normalized.reason_code;
const confirmed:true=normalized.external_summary_confirmed;
void version;void action;void basis;void confirmed;
const body={client_command_id:'synthetic',expected_version:1,reason_code:'STAFF_COMPLETED' as const,handling_cycle_id:'synthetic',internal_process:'private',external_summary:'safe',external_summary_confirmed:true as const};
// @ts-expect-error -- Completion authority comes from the authenticated current handler.
const actor:P2016CompletionCommand={...body,actor:'REPORTER'};
// @ts-expect-error -- The original source is a durable cycle fact, never supplied by the browser.
const source:P2016CompletionCommand={...body,source_intake_id:'synthetic'};
// @ts-expect-error -- T11 cannot select another handler or silently perform a takeover.
const target:P2016CompletionCommand={...body,target_principal_id:'synthetic'};
// @ts-expect-error -- Ticket versions remain bounded numbers at the public boundary.
const stringVersion:P2016CompletionCommand={...body,expected_version:'1'};
// @ts-expect-error -- External summary requires explicit true confirmation.
const unchecked:P2016CompletionCommand={...body,external_summary_confirmed:false};
// @ts-expect-error -- Staff completion cannot forge a Reporter-confirmed closure basis.
const reporter:P2016CompletionCommand={...body,reason_code:'REQUESTER_CONFIRMED'};
void actor;void source;void target;void stringVersion;void unchecked;void reporter;
declare const service:ReturnType<typeof createTicketStaffCompletionService>;
const result=await service.perform({authContext:external,command:external});
if(result.ok&&!result.replayed){const cycle:string=result.completion.cycle_id;const node:'STAFF_COMPLETED'=result.completion.basis;void cycle;void node;}
else if(result.ok&&result.replayed){
  // @ts-expect-error -- Ledger JSON replay must be decoded before accessing completion facts.
  const cycle:{cycle_id:string}=result.completion;void cycle;
}
declare const publicResult:P2016CompletionResult;
const originalCycle:string=publicResult.completion.cycle_id;void originalCycle;
