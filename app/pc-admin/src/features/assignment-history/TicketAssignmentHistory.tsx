import {useEffect,useMemo} from 'react';
import {useInfiniteQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError} from '../../api/client';
import type {Principal} from '../../api/client';
import type {P2016AssignmentHistoryItem,P2016AssignmentHistoryName} from '../../../../../contracts/p2_016_assignment_history_contracts';
import {clearSessionAuthorization,clearTicketAuthorization} from '../../app/authorization';
const label=(name:P2016AssignmentHistoryName)=>name.state==='KNOWN'?name.name:name.state==='NONE'?'无人':'记录不足';

/**
 * Card 34B: the take-over and hand-over chain is no longer a card of its own. Its facts enrich the matching events of the
 * 「处理记录」 timeline (same ticket event id), so a take-over reads 「陈悦 接单」 and a hand-over 「陈悦 转交给 周宁」. The chain is read
 * oldest first in keyset pages of 20 while the timeline is newest first, so its pages are read in the background up to the same
 * bound as before (ten pages, 200 facts); none is dropped, and an event beyond that bound stays a plain event row.
 */
const MAX_PAGES=10;
export function useAssignmentHistory(ticketId:string,principal:Principal,enabled:boolean){
 const client=useQueryClient(),key=['ticket-assignment-history',principal.principal_id,ticketId,principal.authorization_revision??[...principal.roles].sort().join('|'),principal.expires_epoch_ms] as const;
 // Only this read's own denial clears the ticket's authorization: it is handled where the response arrives. Clearing writes the
 // same error into every query of the ticket, this one included; reacting to that copied error would clear again and cancel the
 // detail's next read in a loop.
 const query=useInfiniteQuery({queryKey:key,initialPageParam:null as string|null,queryFn:async({signal,pageParam})=>{
  try{return await api.assignmentHistory(ticketId,pageParam,signal);}
  catch(error){if(error instanceof ApiError&&[401,403,404].includes(error.status)){if(error.status===401)void clearSessionAuthorization(client,principal.principal_id,401,'revoked');else void clearTicketAuthorization(client,principal.principal_id,ticketId,error);}throw error;}
 },getNextPageParam:page=>page.next_cursor??undefined,gcTime:0,enabled,
  // A denied read is final for this authorization; retrying it would clear the ticket's authorization again and again.
  retry:(count,error)=>!(error instanceof ApiError&&[401,403,404].includes(error.status))&&count<3});
 const pages=query.data?.pages.length??0,{hasNextPage,isFetching,isError,fetchNextPage}=query;
 useEffect(()=>{if(enabled&&hasNextPage&&!isFetching&&!isError&&pages<MAX_PAGES)void fetchNextPage({cancelRefetch:false});},[enabled,hasNextPage,isFetching,isError,pages,fetchNextPage]);
 const byEvent=useMemo(()=>new Map((query.isError?[]:query.data?.pages.flatMap(page=>page.items)??[]).map(item=>[item.ticket_event_id,item] as const)),[query.data,query.isError]);
 return {byEvent,failed:enabled&&query.isError,retry:()=>{void query.refetch();}};
}

const same=(a:P2016AssignmentHistoryName,b:P2016AssignmentHistoryName)=>a.state==='KNOWN'&&b.state==='KNOWN'&&a.name===b.name;
/**
 * The action of a take-over or hand-over event, from the timeline record's own event type (Codex review): a dispatcher's first
 * assignment is 「派给 周宁」 (the round's first responsibility is not the dispatcher's own acceptance), a later one 「转交给 周宁」;
 * the assignee accepting is 「接单」, taking it from a colleague 「接手」; `ticket.unassigned` is 「撤销派工」 and
 * `ticket.returned_to_dispatch` (stopping work already started) 「退回待安排」.
 */
export function assignmentAction(item:P2016AssignmentHistoryItem,eventType:string):string{
 const next=item.next.person,previous=item.previous.person,self=same(item.actor,next),takenFromColleague=previous.state==='KNOWN'&&!same(previous,item.actor);
 if(eventType==='ticket.returned_to_dispatch')return '退回待安排';
 if(eventType==='ticket.unassigned')return '撤销派工';
 if(eventType==='ticket.accepted')return takenFromColleague?'接手':'接单';
 if(eventType==='ticket.assignment_transferred'){
  if(self)return takenFromColleague?'接手':'接单';
  return (item.kind==='FIRST_RESPONSIBILITY'?'派给 ':'转交给 ')+label(next);
 }
 // Any other assignment event type: the facts alone.
 if(next.state==='NONE')return '撤销派工';
 if(self)return item.kind==='FIRST_RESPONSIBILITY'?'接单':'接手';
 return (item.kind==='FIRST_RESPONSIBILITY'?'派给 ':'转交给 ')+label(next);
}

/** The hand-overs of conversations that came with the event, as plain secondary lines of the same row. */
export function AssignmentCommunication({item}:{item:P2016AssignmentHistoryItem}){
 return item.communication.length?<span className="record-assignment-communication" aria-label="沟通交接">{item.communication.map(control=><span key={control.control_event_id}>沟通交接：{label(control.previous)} → {label(control.next)}</span>)}</span>:null;
}
