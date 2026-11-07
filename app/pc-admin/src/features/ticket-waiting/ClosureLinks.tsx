import {ClosureSearchField} from '../../design/components/TicketCard/ClosureDialog';
import type {ClosureSearchItem} from '../../design/components/TicketCard/ClosureDialog';
import {externalTicketNumber} from '../../design/components/TicketCard/closure-presentation';
import {useClosureNavigationBlocked} from './ClosureActions';
import {useEffect,useRef,useState} from 'react';
import {useLocation,useNavigate} from 'react-router';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError,captureWorkbenchRead,errorMessage} from '../../api/client';
import type {Principal} from '../../api/client';
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

/** Card 29 K3: typing searches after 250ms through the existing visible-ticket search; the original's ticket number is submitted. */
export function ClosureTicketSearch({principal,subjectId,selected,disabled,onSelect}:{principal:Principal;subjectId:string;selected:string;disabled:boolean;onSelect:(number:string)=>void}){
 const [query,setQuery]=useState(''),[items,setItems]=useState<ClosureSearchItem[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[title,setTitle]=useState<{number:string;title:string}|null>(null),request=useRef<AbortController|null>(null);
 useEffect(()=>()=>request.current?.abort(),[]);
 useEffect(()=>{
  request.current?.abort();request.current=null;setBusy(false);setItems([]);setMessage('');
  const q=query.trim();if(!q||selected)return;
  const timer=window.setTimeout(()=>{
   const controller=new AbortController(),current=captureWorkbenchRead(controller.signal);request.current=controller;setBusy(true);
   void api.search(closureSearchCriteria(q),null,controller.signal,principal.csrf_token).then(result=>{current();
    const found=result.items.filter(item=>item.kind==='ticket'&&item.id!==subjectId&&externalTicketNumber(item.number)).map(item=>({id:item.id,number:item.number,title:item.title,service:item.service??null,column:item.column}));
    setItems(found);if(!found.length)setMessage('没有找到可关联的工单');
   }).catch((error:unknown)=>{if(!controller.signal.aborted)setMessage(errorMessage(error));}).finally(()=>{if(request.current===controller){request.current=null;setBusy(false);}});
  },250);
  return()=>window.clearTimeout(timer);
 },[query,selected,subjectId,principal.csrf_token]);
 return <ClosureSearchField query={query} selected={selected?{number:selected,title:title?.number===selected?title.title:null}:null} items={items} busy={busy} disabled={disabled} message={message}
  onQuery={setQuery} onSelect={item=>{request.current?.abort();request.current=null;setBusy(false);setItems([]);setMessage('');if(item){setTitle({number:item.number,title:item.title});onSelect(item.number);}else{setQuery('');onSelect('');}}}/>;
}
