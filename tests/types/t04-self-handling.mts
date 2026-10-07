import {normalizeSelfHandlingCommand} from '../../src/workbench-ticket-self-handling.mjs';
import type {createTicketSelfHandlingService} from '../../src/workbench-ticket-self-handling.mjs';
import type {P2016SelfHandlingCommand,P2016SelfHandlingResult} from '../../contracts/p2_016_contracts.js';
declare const external:unknown;
const normalized=normalizeSelfHandlingCommand(external);
const version:number=normalized.expected_version;
const action:'take-and-start'|'accept-for-later'=normalized.action;
void version;void action;
const body={client_command_id:'synthetic',expected_version:1,reason_code:'TEST',resolver_team_id:'PILOT_IT'};
// @ts-expect-error -- The public body cannot specify a target owner.
const target:P2016SelfHandlingCommand={...body,target_principal_id:'synthetic'};
// @ts-expect-error -- No fake Session or conversation selection is accepted by Ticket-only commands.
const session:P2016SelfHandlingCommand={...body,session_id:'synthetic'};
// @ts-expect-error -- Ticket versions remain numbers rather than BIGINT strings.
const stringVersion:P2016SelfHandlingCommand={...body,expected_version:'1'};
void target;void session;void stringVersion;
declare const service:ReturnType<typeof createTicketSelfHandlingService>;
const result=await service.perform({authContext:external,command:external});
if(result.ok&&!result.replayed){const basis:string=result.handling_cycle.first_responsibility_event_id;void basis;}
else if(result.ok&&result.replayed){
  // @ts-expect-error -- Ledger DB JSON replay fields must be decoded at the consumer boundary.
  const cycle:{id:string}=result.handling_cycle;void cycle;
}
declare const receipt:P2016SelfHandlingResult;
const acceptedBasis:string=receipt.handling_cycle.first_responsibility_event_id;void acceptedBasis;
