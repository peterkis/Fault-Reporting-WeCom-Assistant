import {SlidersHorizontal} from 'lucide-react';
import {Button as HButton} from '../../design/components/Button/Button';
import {Fieldset as HFieldset,Form as HForm,Input as HInput,Label as HLabel,ListBox,ComboBox} from "@heroui/react";
import {WorkbenchDisclosure} from "../../app/WorkbenchDisclosure";
import {WorkbenchSelect} from "../../app/WorkbenchSelect";
import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {useInfiniteQuery,useQueryClient} from '@tanstack/react-query';
import {api,statusLabels} from '../../api/client';
import type {Principal,WorkbenchCard,BoardCompletionRange} from '../../api/client';
import {parseSearchRequest,searchCriteriaKey,searchParameters,SEARCH_STATUSES,SEARCH_SOURCES,hasSearchCriteria} from '../../../../../shared/workbench-search-contracts.mjs';
import type {WorkbenchSearchCriteria} from '../../../../../contracts/workbench_search_contracts';
import './search.css';

const viewKeys=['range','scope','closed_from','closed_to','closure_kind'] as const;
const conditionsKey=(criteria:WorkbenchSearchCriteria)=>{const params=searchParameters(criteria);for(const key of viewKeys)params.delete(key);return params.toString();};
const sourceLabels:Record<string,string>={WECOM_DIRECT:'Bot 私聊',WECOM_GROUP:'群聊报修',WEB_REQUEST:'医小修网页',MANUAL_PHONE:'电话代录',MANUAL_ON_SITE:'现场代录'};
export function criteriaFromUrl(params:URLSearchParams,range:BoardCompletionRange,scope:'team'|'related'){
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
interface Props {principal:Principal;criteria:WorkbenchSearchCriteria|null;blocked:boolean;busy?:boolean;active:boolean;loaded:WorkbenchCard[];
 onApply:(criteria:WorkbenchSearchCriteria)=>void;onLeave:()=>void}
export function SearchControls({principal,criteria,blocked,busy=false,active,loaded,onApply,onLeave}:Props){
 const fallback=parseSearchRequest(new URLSearchParams()).criteria,key=criteria?searchCriteriaKey(criteria):'invalid';
 const [draft,setDraft]=useState(()=>searchParameters(criteria??fallback)),[error,setError]=useState<string|null>(null);
 const previous=useRef(criteria);
 useEffect(()=>{
  if(criteria){
   const before=previous.current,onlyView=before!==null&&conditionsKey(before)===conditionsKey(criteria);
   setDraft(current=>{if(!onlyView)return searchParameters(criteria);const next=new URLSearchParams(current),committed=searchParameters(criteria);for(const key of viewKeys){const value=committed.get(key);if(value===null)next.delete(key);else next.set(key,value);}return next;});
   setError(null);
  }
  previous.current=criteria;
 },[key]);
 const set=(name:string,value:string)=>setDraft(current=>{const next=new URLSearchParams(current);if(value==='')next.delete(name);else next.set(name,value);return next;});
 const submit=(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(busy)return;
  try{const next=parseSearchRequest(draft).criteria;setError(null);onApply(next);}catch{setError('条件格式不正确；搜索文字最多128个字符，细分状态最多8项。');}
 };
 const groups=[...new Map(loaded.flatMap(item=>item.source_group?[[item.source_group.ref,item.source_group] as const]:[])).values()];
 return <HForm className="workbench-search" aria-label="搜索全部获权事项" aria-busy={busy} onSubmit={submit}><HFieldset disabled={blocked}><div className="search-main"><HLabel>编号、描述、报修时资料或位置
   <HInput name="q" value={draft.get('q')??''} maxLength={256} onChange={event=>set('q',event.target.value)} placeholder="搜索工单号、标题、报修人" autoComplete="off"/></HLabel>
   <HButton type="submit" isDisabled={busy} tone="secondary">搜索全部</HButton>{active?<HButton type="button" isDisabled={busy} onClick={onLeave} tone="secondary">结束搜索</HButton>:null}</div><WorkbenchDisclosure title={<span className="ds-search-options" title="搜索选项" ref={node=>{const trigger=node?.closest('button');trigger?.setAttribute('aria-label','搜索选项');trigger?.setAttribute('title','搜索选项');}}><SlidersHorizontal aria-hidden="true"/><span className="sr-only">搜索选项</span></span>}><div className="search-filters">
    <WorkbenchSelect label={<>事项阶段</>} name="column" value={draft.get('column')??'all'} onChange={event=>set('column',event)} isDisabled={(blocked)}><ListBox.Item id="all" textValue={"全部阶段"}>全部阶段<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="pending" textValue={"待受理"}>待受理<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="active" textValue={"处理中"}>处理中<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="closed" textValue={"已处理"}>已处理<ListBox.ItemIndicator/></ListBox.Item></WorkbenchSelect>
    <WorkbenchSelect label={<>责任关系</>} name="responsibility" value={draft.get('responsibility')??'any'} onChange={event=>set('responsibility',event)} isDisabled={(blocked)}><ListBox.Item id="any" textValue={"不限"}>不限<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="handling" textValue={"由我处理"}>由我处理<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="communication" textValue={"由我沟通"}>由我沟通<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="following" isDisabled={!principal.workbench_follow_enabled} textValue={"我已关注"}>我已关注<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="unassigned" textValue={"尚无处理人"}>尚无处理人<ListBox.ItemIndicator/></ListBox.Item></WorkbenchSelect>
    <HLabel>处理组标识<HInput name="resolver_team_id" value={draft.get('resolver_team_id')??''} onChange={event=>set('resolver_team_id',event.target.value)} placeholder="已知处理组标识" autoComplete="off"/></HLabel>
    <HLabel>处理人标识<HInput name="assignee_id" value={draft.get('assignee_id')??''} onChange={event=>set('assignee_id',event.target.value)} placeholder="已知处理人标识" autoComplete="off"/></HLabel>
    <WorkbenchSelect label={<>来源</>} name="sources" multiple value={(draft.get('sources')??'').split(',').filter(Boolean)} onChange={event=>set('sources',event.join(','))} isDisabled={(blocked)}>{SEARCH_SOURCES.map(source=><ListBox.Item key={source} id={source} isDisabled={source.startsWith('MANUAL_')&&!principal.manual_reports_enabled} textValue={String(sourceLabels[source])}>{sourceLabels[source]}<ListBox.ItemIndicator/></ListBox.Item>)}</WorkbenchSelect>
    <ComboBox className="workbench-source-group" name="source_group_ref" allowsCustomValue isDisabled={blocked||!principal.source_group_directory_enabled} inputValue={draft.get('source_group_ref')??''} onInputChange={value=>set('source_group_ref',value)} value={groups.some(group=>group.ref===draft.get('source_group_ref'))?draft.get('source_group_ref')??null:null} onChange={value=>{if(typeof value==='string')set('source_group_ref',value);}} defaultFilter={(ref,input)=>(ref+' '+(groups.find(group=>group.ref===ref)?.display_name??'')).toLocaleLowerCase().includes(input.toLocaleLowerCase())}>
      <HLabel>来源群</HLabel><ComboBox.InputGroup><HInput placeholder="选择已加载群或填写已知群标识" autoComplete="off"/><ComboBox.Trigger/></ComboBox.InputGroup><ComboBox.Popover className="workbench-select-popover"><ListBox>{groups.map(group=><ListBox.Item key={group.ref} id={group.ref} textValue={group.ref}>{(group.display_name??'群名称未登记')+' · '+group.ref.slice(0,8)}<ListBox.ItemIndicator/></ListBox.Item>)}</ListBox></ComboBox.Popover>
    </ComboBox>
    <WorkbenchSelect label={<>细分状态</>} name="statuses" multiple value={(draft.get('statuses')??'').split(',').filter(Boolean)} onChange={event=>set('statuses',event.join(','))} isDisabled={(blocked)}>{SEARCH_STATUSES.map(status=><ListBox.Item key={status} id={status} textValue={String(statusLabels[status]??status)}>{statusLabels[status]??status}<ListBox.ItemIndicator/></ListBox.Item>)}</WorkbenchSelect>
    <WorkbenchSelect label={<>补充跟进</>} name="supplement" isDisabled={blocked||!principal.supplement_follow_up_enabled} value={draft.get('supplement')??'any'} onChange={event=>set('supplement',event)}><ListBox.Item id="any" textValue={"不限"}>不限<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="pending" textValue={"仍待跟进"}>仍待跟进<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="followed" textValue={"均已跟进"}>均已跟进<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="none" textValue={"没有可读补充"}>没有可读补充<ListBox.ItemIndicator/></ListBox.Item></WorkbenchSelect>
    <WorkbenchSelect label={<>共享跟进时间</>} name="schedule" isDisabled={blocked||!principal.follow_up_schedules_enabled} value={draft.get('schedule')??'any'} onChange={event=>set('schedule',event)}><ListBox.Item id="any" textValue={"不限"}>不限<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="active" textValue={"已有安排"}>已有安排<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="due" textValue={"当前已到期"}>当前已到期<ListBox.ItemIndicator/></ListBox.Item><ListBox.Item id="none" textValue={"没有活动安排"}>没有活动安排<ListBox.ItemIndicator/></ListBox.Item></WorkbenchSelect>
   </div></WorkbenchDisclosure></HFieldset>{error?<p role="alert">{error}</p>:<p className="search-caption">{active?'当前显示可见事项中符合条件的分页结果；已加载条数不是总数。':'提交条件后检索全部当前可读事项；空条件可查询全部。搜索不改变报修或回复草稿。'}</p>}</HForm>;
}
export function searchEmptyMessage(criteria:WorkbenchSearchCriteria|null){
 return criteria&&hasSearchCriteria(criteria)?'当前没有符合这些条件的可见事项。':'当前没有可见的事项。';
}
