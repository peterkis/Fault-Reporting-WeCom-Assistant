import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {useInfiniteQuery,useQueryClient} from '@tanstack/react-query';
import {api,statusLabels} from '../../api/client';
import type {Principal,WorkbenchCard,CompletionRange} from '../../api/client';
import {parseSearchRequest,searchCriteriaKey,searchParameters,SEARCH_STATUSES,SEARCH_SOURCES,hasSearchCriteria} from '../../../../../src/workbench-search-contracts.mjs';
import type {WorkbenchSearchCriteria} from '../../../../../contracts/workbench_search_contracts';
import './search.css';

const sourceLabels:Record<string,string>={WECOM_DIRECT:'Bot 私聊',WECOM_GROUP:'群聊报修',WEB_REQUEST:'医小修网页',MANUAL_PHONE:'电话代录',MANUAL_ON_SITE:'现场代录'};
export function criteriaFromUrl(params:URLSearchParams,range:CompletionRange,scope:'team'|'related'){
 if(params.has('cursor')||params.has('limit'))return {criteria:null,error:'搜索地址中的分页参数无效，请重新提交搜索条件。'};
 const input=new URLSearchParams(),navigation=new Set(['view','detail','search']);
 for(const [key,value]of params)if(!navigation.has(key))input.append(key,value);
 if(!input.has('column'))input.set('column','all');
 if(!input.has('range'))input.set('range',range);
 if(!input.has('scope'))input.set('scope',scope);
 try{return {criteria:parseSearchRequest(input).criteria,error:null};}
 catch{return {criteria:null,error:'搜索条件无效，请修改条件后重新查询。'};}
}
export function useWorkbenchSearch(principal:Principal,criteria:WorkbenchSearchCriteria|null,enabled:boolean){
 const client=useQueryClient(),key=criteria?searchCriteriaKey(criteria):'invalid';
 const roles=[...principal.roles].sort().join(','),queryKey=['board',principal.principal_id,'search',key,principal.authorization_revision,principal.expires_epoch_ms,roles] as const;
 const query=useInfiniteQuery({queryKey,initialPageParam:null as string|null,enabled:enabled&&criteria!==null,
   queryFn:({pageParam,signal})=>{if(!criteria)throw new TypeError('SEARCH_CRITERIA_REQUIRED');return api.search(criteria,pageParam,signal,principal.csrf_token);},
  getNextPageParam:page=>page.next_cursor??undefined,retry:false,gcTime:0,refetchOnWindowFocus:false,refetchOnReconnect:false,maxPages:5});
 useEffect(()=>{
  let current=true;
  if(!enabled)void client.cancelQueries({queryKey,exact:true},{revert:false}).then(()=>{if(current)client.removeQueries({queryKey,exact:true});});
  return()=>{current=false;if(enabled)void client.cancelQueries({queryKey,exact:true},{revert:false});};
 },[client,key,principal.principal_id,principal.authorization_revision,principal.expires_epoch_ms,roles,enabled]);
 return {...query,restart:()=>client.resetQueries({queryKey,exact:true},{cancelRefetch:true})};
}
interface Props {principal:Principal;criteria:WorkbenchSearchCriteria|null;blocked:boolean;active:boolean;loaded:WorkbenchCard[];
 onApply:(criteria:WorkbenchSearchCriteria)=>void;onLeave:()=>void}
export function SearchControls({principal,criteria,blocked,active,loaded,onApply,onLeave}:Props){
 const fallback=parseSearchRequest(new URLSearchParams()).criteria,key=criteria?searchCriteriaKey(criteria):'invalid';
 const [draft,setDraft]=useState(()=>searchParameters(criteria??fallback)),[error,setError]=useState<string|null>(null);
 const previous=useRef(criteria);
 useEffect(()=>{
  if(criteria){
   const before=previous.current,onlyScope=before!==null&&searchCriteriaKey({...before,range:'all',scope:'team'})===searchCriteriaKey({...criteria,range:'all',scope:'team'});
   setDraft(current=>{if(!onlyScope)return searchParameters(criteria);const next=new URLSearchParams(current);next.set('range',criteria.range);next.set('scope',criteria.scope);return next;});
   setError(null);
  }
  previous.current=criteria;
 },[key]);
 const set=(name:string,value:string)=>setDraft(current=>{const next=new URLSearchParams(current);if(value==='')next.delete(name);else next.set(name,value);return next;});
 const submit=(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();
  try{const next=parseSearchRequest(draft).criteria;setError(null);onApply(next);}catch{setError('条件格式不正确；搜索文字最多128个字符，细分状态最多8项。');}
 };
 const groups=[...new Map(loaded.flatMap(item=>item.source_group?[[item.source_group.ref,item.source_group] as const]:[])).values()];
 return <form className="workbench-search" aria-label="搜索全部获权事项" onSubmit={submit}>
  <fieldset disabled={blocked}><div className="search-main"><label>编号、描述、报修时资料或位置
   <input name="q" value={draft.get('q')??''} maxLength={256} onChange={event=>set('q',event.target.value)} placeholder="搜索全部当前可读事项" autoComplete="off"/></label>
   <button type="submit">搜索全部</button>{active?<button type="button" onClick={onLeave}>结束搜索</button>:null}</div>
   <details><summary>组合筛选</summary><div className="search-filters">
    <label>事项阶段<select name="column" value={draft.get('column')??'all'} onChange={event=>set('column',event.target.value)}>
     <option value="all">全部阶段</option><option value="pending">待受理</option><option value="active">处理中</option><option value="closed">已关闭</option></select></label>
    <label>责任关系<select name="responsibility" value={draft.get('responsibility')??'any'} onChange={event=>set('responsibility',event.target.value)}>
     <option value="any">不限</option><option value="handling">由我处理</option><option value="communication">由我沟通</option>
     <option value="following" disabled={!principal.workbench_follow_enabled}>我已关注</option><option value="unassigned">尚无处理人</option></select></label>
    <label>处理组标识<input name="resolver_team_id" value={draft.get('resolver_team_id')??''} onChange={event=>set('resolver_team_id',event.target.value)} placeholder="已知处理组标识" autoComplete="off"/></label>
    <label>处理人标识<input name="assignee_id" value={draft.get('assignee_id')??''} onChange={event=>set('assignee_id',event.target.value)} placeholder="已知处理人标识" autoComplete="off"/></label>
    <label>来源<select name="sources" multiple value={(draft.get('sources')??'').split(',').filter(Boolean)} onChange={event=>set('sources',Array.from(event.target.selectedOptions,option=>option.value).join(','))}>
     {SEARCH_SOURCES.map(source=><option key={source} value={source} disabled={source.startsWith('MANUAL_')&&!principal.manual_reports_enabled}>{sourceLabels[source]}</option>)}</select></label>
    <label>来源群<input name="source_group_ref" list="search-known-groups" value={draft.get('source_group_ref')??''} disabled={!principal.source_group_directory_enabled} onChange={event=>set('source_group_ref',event.target.value)} placeholder="选择已加载群或填写已知群标识" autoComplete="off"/>
     <datalist id="search-known-groups">{groups.map(group=><option key={group.ref} value={group.ref}>{(group.display_name??'群名称未登记')+' · '+group.ref.slice(0,8)}</option>)}</datalist></label>
    <label>细分状态<select name="statuses" multiple value={(draft.get('statuses')??'').split(',').filter(Boolean)} onChange={event=>set('statuses',Array.from(event.target.selectedOptions,option=>option.value).join(','))}>
     {SEARCH_STATUSES.map(status=><option key={status} value={status}>{statusLabels[status]??status}</option>)}</select></label>
    <label>补充跟进<select name="supplement" disabled={!principal.supplement_follow_up_enabled} value={draft.get('supplement')??'any'} onChange={event=>set('supplement',event.target.value)}>
     <option value="any">不限</option><option value="pending">仍待跟进</option><option value="followed">均已跟进</option><option value="none">没有可读补充</option></select></label>
    <label>共享跟进时间<select name="schedule" disabled={!principal.follow_up_schedules_enabled} value={draft.get('schedule')??'any'} onChange={event=>set('schedule',event.target.value)}>
     <option value="any">不限</option><option value="active">已有安排</option><option value="due">当前已到期</option><option value="none">没有活动安排</option></select></label>
   </div></details>
  </fieldset>
  {error?<p role="alert">{error}</p>:<p className="search-caption">{active?'当前显示全部获权范围中的匹配分页；已加载条数不是总数。':'提交条件后检索全部当前可读事项；空条件可查询全部。搜索不改变报修或回复草稿。'}</p>}
 </form>;
}
export function searchEmptyMessage(criteria:WorkbenchSearchCriteria|null){
 return criteria&&hasSearchCriteria(criteria)?'当前授权范围内没有匹配这些条件的事项。':'当前授权范围内暂无事项。';
}
