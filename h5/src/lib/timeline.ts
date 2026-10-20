import type {YxxTimelineEvent} from '../../../contracts/yxx_self_service_contracts.js';
const eventLabels:Record<string,string>={REQUEST_ACCEPTED:'received',SUPPLEMENT_ACCEPTED:'eventSupplement',WAITING_FOR_DETAILS:'waiting',UNDER_REVIEW:'review',TICKET_CREATED:'eventCreated',TICKET_UPDATED:'eventUpdated',NOT_SERVICE:'notService',PROCESSING:'processing'};
/** Titles use known external event kinds; the external safe summary remains the narrative. */
export function timelinePresentation(event:YxxTimelineEvent):{titleKey:string|null;summary:string}{
 return {titleKey:eventLabels[event.event_type]??null,summary:event.summary};
}
export function latestFirst(events:readonly YxxTimelineEvent[]):YxxTimelineEvent[]{
 return [...events].sort((left,right)=>Number(right.occurred_epoch_ms)-Number(left.occurred_epoch_ms));
}
