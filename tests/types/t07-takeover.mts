import type {P2016TakeoverCommand,P2016TakeoverAndStartResult,P2016TakeoverAcknowledgement} from '../../contracts/p2_016_takeover_contracts.js';
declare const body:P2016TakeoverCommand;
// @ts-expect-error -- Self is derived from authenticated authority, never an arbitrary browser target.
const target:P2016TakeoverCommand={...body,target_principal_id:'synthetic'};void target;
// @ts-expect-error -- Retaining communication cannot carry any selected Session.
const retained:P2016TakeoverCommand={...body,communication_choice:'RETAIN_CURRENT',sessions:[{session_id:'synthetic',expected_row_version:1}]};void retained;
// @ts-expect-error -- Selected communication must explicitly contain at least one Session.
const empty:P2016TakeoverCommand={...body,communication_choice:'TAKE_SELECTED',sessions:[]};void empty;
// @ts-expect-error -- Write versions are bounded numeric values, not query strings.
const version:P2016TakeoverCommand={...body,expected_version:'2'};void version;
declare const started:P2016TakeoverAndStartResult;
const first:string=started.handling_cycle.first_responsibility_event_id;void first;
declare const acknowledgement:P2016TakeoverAcknowledgement;
if(acknowledgement.state==='COMMITTED'){
 const committedVersion:number=acknowledgement.ticket_version;void committedVersion;
 // @ts-expect-error -- Safe readonly acknowledgement does not reveal Session identity or private results.
 const sessions=acknowledgement.conversations;void sessions;
}
