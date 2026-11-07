import {ClosureSearchField} from '../../design/components/TicketCard/ClosureDialog';
import {useClosureNavigationBlocked} from './ClosureActions';
import {useEffect,useRef,useState} from 'react';
import {useLocation,useNavigate} from 'react-router';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError,captureWorkbenchRead,errorMessage} from '../../api/client';
import type {Principal,WorkbenchCard} from '../../api/client';
import type {WorkbenchSearchCriteria} from '../../../../../contracts/workbench_search_contracts';
import {Button} from '../../design/components/Button/Button';
import {clearSessionAuthorization} from '../../app/authorization';
import {itemLink} from '../../app/WorkbenchItemPresentation';

export const closureSearchCriteria=(q:string):WorkbenchSearchCriteria=>({q,column:'all',range:'all',scope:'team',responsibility:'any',resolver_team_id:null,assignee_id:null,sources:[],source_group_ref:null,statuses:[],supplement:'any',schedule:'any'});
export function ClosureOriginalLink({number}:{number:string}){
 const navigate=useNavigate(),location=useLocation(),client=useQueryClient(),request=useRef<AbortController|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),blocked=useClosureNavigationBlocked();
 useEffect(()=>()=>request.current?.abort(),[]);
 const open=async()=>{
  if(request.current||blocked)return;const controller=new AbortController(),current=captureWorkbenchRead(controller.signal);request.current=controller;setBusy(true);setMessage('');
  try{const session=await api.bootstrap(controller.signal);current();const cached=client.getQueryData<Principal>(['session']);if(cached&&cached.principal_id!==session.principal_id)throw new ApiError(401,'WORKBENCH_UNAUTHENTICATED');
   const result=await api.search(closureSearchCriteria(number),null,controller.signal,session.csrf_token);current();const item=result.items.find(item=>item.kind==='ticket'&&item.number===number);
   if(!item){setMessage('原单当前不可见或未找到。');return;}void navigate(itemLink(item,location.search),{state:{fromBoard:true}});
  }catch(error){if(controller.signal.aborted)return;if(error instanceof ApiError&&error.status===401)void clearSessionAuthorization(client,client.getQueryData<Principal>(['session'])?.principal_id,401,'revoked');else setMessage(errorMessage(error));}
  finally{if(request.current===controller){request.current=null;setBusy(false);}}
 };
 return <><Button tone="ghost" className="ds-closure-original" data-action="open-closure-original" isDisabled={busy||blocked} aria-label={'打开原单 '+number} onPress={()=>{void open();}}>{number}</Button>{message?<span role="status">{message}</span>:null}</>;
}

export function ClosureTicketSearch({principal,subjectId,selected,disabled,onSelect}:{principal:Principal;subjectId:string;selected:string;disabled:boolean;onSelect:(number:string)=>void}){
 const [query,setQuery]=useState(selected),[items,setItems]=useState<WorkbenchCard[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),request=useRef<AbortController|null>(null);
 useEffect(()=>{if(selected)setQuery(selected);setItems([]);},[selected]);
 useEffect(()=>()=>request.current?.abort(),[]);
 const search=async()=>{
  request.current?.abort();const controller=new AbortController(),current=captureWorkbenchRead(controller.signal);request.current=controller;setItems([]);setBusy(true);setMessage('');
  try{const result=await api.search(closureSearchCriteria(query.trim()),null,controller.signal,principal.csrf_token);current();const found=result.items.filter(item=>item.kind==='ticket'&&item.id!==subjectId);setItems([...found]);if(!found.length)setMessage('未找到可见工单，请核对编号。');}
  catch(error){if(!controller.signal.aborted)setMessage(errorMessage(error));}finally{if(request.current===controller){request.current=null;setBusy(false);}}
 };
 return <ClosureSearchField query={query} selected={selected} items={items} busy={busy} disabled={disabled} message={message} onQuery={query=>{request.current?.abort();request.current=null;setBusy(false);setQuery(query);setItems([]);if(selected)onSelect('');}} onSearch={()=>{void search();}} onSelect={number=>{request.current?.abort();request.current=null;setBusy(false);onSelect(number);setQuery(number);}}/>;
}
