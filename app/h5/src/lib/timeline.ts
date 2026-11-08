import type {YxxTimelineEvent} from '../../../../contracts/yxx_self_service_contracts.js';
const eventLabels:Record<string,string>={REQUEST_ACCEPTED:'received',SUPPLEMENT_ACCEPTED:'eventSupplement',WAITING_FOR_DETAILS:'waiting',UNDER_REVIEW:'review',TICKET_CREATED:'eventCreated',TICKET_UPDATED:'eventUpdated',NOT_SERVICE:'notService',PROCESSING:'processing'};
const tiedStageOrder:ReadonlyMap<string,number>=new Map([['REQUEST_ACCEPTED',0],['TICKET_CREATED',1],['PROCESSING',2]]);
const closedOut:ReadonlySet<string>=new Set(['DISMISSED']);
const terminal:ReadonlySet<string>=new Set(['COMPLETED','RESOLVED','DISMISSED']);
export type TimelinePresentation={titleKey:string|null;summary:string;summaryKey?:string};
/** Titles use known external event kinds; the external safe summary remains the narrative. */
export function timelinePresentation(event:YxxTimelineEvent):TimelinePresentation{
 return {titleKey:eventLabels[event.event_type]??null,summary:event.summary};
}
/** Reporter-visible closure explanation. False report / test closures carry only the
 * generic status text, which the status badge already shows. Internal notes never reach H5. */
export function reporterClosureNote(text:string|null|undefined):string|null{
 return text&&text!=='已关闭'?text:null;
}
function closesReport(event:YxxTimelineEvent){return event.event_type==='TICKET_UPDATED'&&closedOut.has(event.ticket?.status??'');}
/**
 * Presentation for latest-first loaded events. A Ticket update into a closed-out status
 * reads as "report closed". The current reporter-visible note is bound only when the whole
 * history is loaded and the newest closure is the newest Ticket fact; otherwise, and for
 * every older closure, the neutral default is shown. A Ticket update leaving that status for an active
 * one directly after it, within the loaded facts, reads as "accepted again". Facts are not
 * reordered or invented; unloaded pages keep the generic presentation.
 */
export function timelinePresentations(events:readonly YxxTimelineEvent[],closureNote:string|null=null,complete=false):TimelinePresentation[]{
 const views=events.map(timelinePresentation),newestTicket=events.findIndex(event=>event.event_type.startsWith('TICKET_')),newest=complete&&newestTicket>=0&&closesReport(events[newestTicket] as YxxTimelineEvent)?newestTicket:-1;
 let previousClosed=false;
 for(let index=events.length-1;index>=0;index--){
  const event=events[index];if(!event)continue;
  if(closesReport(event)){views[index]=index===newest&&closureNote?{titleKey:'eventClosed',summary:closureNote}:{titleKey:'eventClosed',summary:'',summaryKey:'eventClosedDefault'};previousClosed=true;continue;}
  if(previousClosed&&event.event_type==='TICKET_UPDATED'&&event.ticket&&!terminal.has(event.ticket.status))views[index]={titleKey:'eventRestored',summary:''};
  previousClosed=false;
 }
 return views;
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
