import type {ReportItem,RequestDetail} from '../api/types';
export function reportState(item:Pick<ReportItem,'display_status'|'ticket'>&Pick<RequestDetail,'closure_text'>):'received'|'processing'|'queued'|'completed'|'waiting'|'waitingVendor'|'review'|'closed'|'notService'|'reopened' {
  const ticket=item.ticket?.status;
  if(ticket==='COMPLETED'||ticket==='RESOLVED')return 'completed';
  if(ticket==='DISMISSED')return 'closed';
  if(ticket==='WAITING_REQUESTER')return 'waiting';
  if(ticket==='WAITING_VENDOR')return 'waitingVendor';
  if(ticket==='REOPENED')return 'reopened';
  if(ticket==='IN_PROGRESS'||ticket==='ACCEPTED')return 'processing';
  if(ticket==='QUEUED'||ticket==='OPEN'||ticket==='NEW')return 'queued';
  if(item.display_status==='WAITING_FOR_DETAILS')return 'waiting';
  if(item.display_status==='UNDER_REVIEW')return 'review';
  if(item.display_status==='NOT_SERVICE')return !ticket&&item.closure_text?'closed':'notService';
  return 'received';
}
export function reportTone(state:ReturnType<typeof reportState>):'queued'|'processing'|'done'|'neutral'|'danger' {
  return state==='processing'||state==='queued'?state:state==='completed'?'done':state==='reopened'?'queued':state==='notService'?'danger':'neutral';
}
