import type {YxxTimelineEvent} from '../../../contracts/yxx_self_service_contracts.js';
const eventLabels:Record<string,string>={REQUEST_ACCEPTED:'received',SUPPLEMENT_ACCEPTED:'eventSupplement',WAITING_FOR_DETAILS:'waiting',UNDER_REVIEW:'review',TICKET_CREATED:'eventCreated',TICKET_UPDATED:'eventUpdated',NOT_SERVICE:'notService',PROCESSING:'processing'};
const tiedStageOrder:ReadonlyMap<string,number>=new Map([['REQUEST_ACCEPTED',0],['TICKET_CREATED',1],['PROCESSING',2]]);
/** Titles use known external event kinds; the external safe summary remains the narrative. */
export function timelinePresentation(event:YxxTimelineEvent):{titleKey:string|null;summary:string}{
 return {titleKey:eventLabels[event.event_type]??null,summary:event.summary};
}
export function latestFirst(events:readonly YxxTimelineEvent[]):YxxTimelineEvent[]{
 const ordered=[...events].sort((left,right)=>Number(right.occurred_epoch_ms)-Number(left.occurred_epoch_ms));
 const stagesByTime=new Map<string,{index:number;event:YxxTimelineEvent;rank:number}[]>();
 for(const [index,event] of ordered.entries()){
  const rank=tiedStageOrder.get(event.event_type);if(rank===undefined)continue;
  const stages=stagesByTime.get(event.occurred_epoch_ms)??[];
  stages.push({index,event,rank});stagesByTime.set(event.occurred_epoch_ms,stages);
 }
 // API tie order serves the cursor, not these three display stages. Reorder only
 // their existing tied slots; other event kinds and equal-stage facts stay stable.
 for(const stages of stagesByTime.values()){
  const positions=stages.map(stage=>stage.index);
  stages.sort((left,right)=>right.rank-left.rank);
  for(const [index,stage] of stages.entries()){
   const position=positions[index];if(position!==undefined)ordered[position]=stage.event;
  }
 }
 return ordered;
}
