import {useCallback,useEffect,useLayoutEffect,useMemo,useState,type ReactElement,type RefAttributes} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {ApiError,api,statusLabels,type Principal,type WorkbenchCard,type WorkbenchDetail} from '../../api/client';
import {activityActorName} from '../../app/activity-actors.mjs';
import {clearSessionAuthorization} from '../../app/authorization';
import {Avatar} from '../../design/components/Avatar/Avatar';
import {HoverCard,type HoverCardState} from '../../design/components/HoverCard/HoverCard';
import {BlockSkeleton} from '../../design/components/Skeleton/Skeleton';
import {useDelayedLoading} from '../../design/hooks/useDelayedLoading';
import {StatusBadge} from '../../design/components/StatusBadge/StatusBadge';
import {TicketCategoryTile} from '../../design/components/TicketCard/TicketCard';
import {recordKind} from '../../design/components/Timeline/record-kind';
import {formatListTime,formatWaitingTime} from '../../design/format-time';
import {cardHeatStart} from '../../design/heat';
import {stagePresentation} from '../../design/status-map';
import {closureSearchCriteria} from '../ticket-waiting/ClosureLinks';
import {clearHoverItemDenied,getHoverItemDeniedStatus,useDeniedItemsRevision} from './denied-items';
import {findBoardItemInIndex,useHoverCardsActions,useHoverCardsState} from './hover-card-store';
import {useItemSummary} from './use-item-summary';
import {Kbd} from '../../design/components/Kbd/Kbd';
import {shortcutKeys} from '../efficiency/shortcuts';
import './hover-cards.css';

export interface TicketHoverCardProps {
  itemKind?:WorkbenchCard['kind'];
  itemId?:string;
  number?:string;
  children:ReactElement<Record<string,unknown>&RefAttributes<HTMLElement>>;
}

function recordSummaryText(records:WorkbenchDetail['records']|undefined):string|null{
  if(!records?.length)return null;
  let newest=records[0];
  for(const record of records){
    if(record&&(!newest||record.at>newest.at))newest=record;
  }
  if(!newest)return null;
  const actor=activityActorName(newest).trim();
  const kind=recordKind(newest);
  let action:string;
  if(kind==='report')action='提交报修';
  else if(kind==='note')action=newest.audience==='INTERNAL'?'添加内部备注':'对外说明';
  else if(kind==='status')action='更新状态为'+(statusLabels[newest.new_status??'']??'最新状态');
  else action=newest.text?.trim()||'记录处理';
  return '最近：'+(actor?actor+' ':'')+action;
}

function TicketHoverCardBody({
  titleId,
  itemKind,
  itemId,
  number,
  principal,
  onStateChange,
}: {
  titleId:string;
  itemKind?:WorkbenchCard['kind']|undefined;
  itemId?:string|undefined;
  number?:string|undefined;
  principal:Principal;
  onStateChange:(state:HoverCardState)=>void;
}){
  const client=useQueryClient();
  const state=useHoverCardsState();
  useDeniedItemsRevision();
  const fencedStatus=getHoverItemDeniedStatus(principal.principal_id,{kind:itemKind,id:itemId,number});
  const loadedItem=useMemo(()=>{
    if(fencedStatus!==null||!state)return null;
    return findBoardItemInIndex(state.board.index,{kind:itemKind,id:itemId,number});
  },[fencedStatus,itemId,itemKind,number,state]);
  const useSummary=!loadedItem&&Boolean(itemKind&&itemId);
  const useSearch=!loadedItem&&!useSummary&&Boolean(number);

  const {query:summaryQuery,denied:summaryDenied}=useItemSummary({
    principalId:principal.principal_id,
    item:useSummary&&itemKind&&itemId?{kind:itemKind,id:itemId}:null,
    enabled:useSummary,
  });

  const searchQuery=useQuery({
    queryKey:['ticket-hover-search',principal.principal_id,principal.authorization_revision,number],
    queryFn:async({signal})=>{
      const result=await api.search(closureSearchCriteria(number??''),null,signal,principal.csrf_token);
      if(number){
        const matched=result.items.find(item=>item.kind==='ticket'&&item.number===number);
        if(matched)clearHoverItemDenied(principal.principal_id,matched.kind,matched.id,matched.number);
      }
      return result;
    },
    enabled:useSearch,
    staleTime:60_000,
    retry:false,
  });

  useEffect(()=>{
    if(!useSearch||!(searchQuery.error instanceof ApiError))return;
    if(searchQuery.error.status===401||searchQuery.error.status===403){
      void clearSessionAuthorization(client,principal.principal_id,searchQuery.error.status as 401|403,'revoked');
    }
  },[client,principal.principal_id,searchQuery.error,useSearch]);

  const searchedCard=useMemo(()=>{
    if(fencedStatus!==null||!useSearch||!searchQuery.data||!number)return null;
    return searchQuery.data.items.find(item=>item.kind==='ticket'&&item.number===number)??null;
  },[fencedStatus,number,searchQuery.data,useSearch]);

  const card:WorkbenchCard|null=fencedStatus!==null?null:loadedItem??(useSummary&&!summaryDenied?summaryQuery.data?.item??null:searchedCard);
  const detail:WorkbenchDetail|null=fencedStatus===null&&useSummary&&!summaryDenied?summaryQuery.data??null:null;

  const isPending=(useSummary&&summaryQuery.isPending)||(useSearch&&searchQuery.isPending);
  const delayed=useDelayedLoading(isPending&&!card&&fencedStatus===null);

  const summaryStatus=summaryQuery.error instanceof ApiError?summaryQuery.error.status:null;
  const searchStatus=searchQuery.error instanceof ApiError?searchQuery.error.status:null;
  const isDenied=(useSummary&&summaryStatus===403)||(useSearch&&searchStatus===403)||(fencedStatus===403&&!(useSearch&&searchQuery.isSuccess&&!searchedCard));
  const isMissing=(useSummary&&summaryStatus===404)||(useSearch&&searchQuery.isSuccess&&!searchedCard)||(useSearch&&searchStatus===404)||(fencedStatus===404);
  const hasOtherError=Boolean((useSummary&&summaryQuery.isError&&!isDenied&&!isMissing)||(useSearch&&searchQuery.isError&&!isDenied&&!isMissing));

  const nextState:HoverCardState=card?'ready':isDenied?'denied':isMissing||hasOtherError?'missing':'loading';
  const now=state?.board.now??Date.now();

  useLayoutEffect(()=>{
    onStateChange(nextState);
  },[nextState,onStateChange]);

  useEffect(()=>()=>{onStateChange('loading');},[onStateChange]);

  const displayNumber=card?.number??number??'工单';

  if(isDenied){
    return <div className="ds-ticket-hover-denied">
      <span id={titleId} className="ds-ticket-hover-denied-number">{displayNumber}</span>
      <span className="ds-ticket-hover-denied-text">这张工单你没有查看权限</span>
    </div>;
  }

  if(isMissing){
    return <div className="ds-ticket-hover-denied">
      <span id={titleId} className="ds-ticket-hover-denied-number">{displayNumber}</span>
      <span className="ds-ticket-hover-denied-text">{useSearch?'这张工单当前不可见或已不存在':'这张工单已不存在'}</span>
    </div>;
  }

  if(hasOtherError){
    return <div className="ds-ticket-hover-denied">
      <span id={titleId} className="ds-ticket-hover-denied-number">{displayNumber}</span>
      <span className="ds-ticket-hover-error">工单信息暂不可用</span>
    </div>;
  }

  if(!card){
    return <div className="ds-ticket-hover-card">
      <div className="ds-ticket-hover-head">
        <span id={titleId} className="ds-ticket-hover-number">{displayNumber}</span>
      </div>
      {delayed.visible?<BlockSkeleton label="正在加载工单…" slow={delayed.slow}/>:null}
    </div>;
  }

  const stage=stagePresentation[card.column];
  const wait=card.column==='pending'||card.column==='active'?formatWaitingTime(cardHeatStart(card),now):null;
  const endedLabel=card.column==='handled'
    ?card.closure?.kind==='DISMISSED'
      ?card.closure.ended_at?formatListTime(card.closure.ended_at,now)+' 关闭':null
      :card.completed_at?formatListTime(card.completed_at,now)+' 完成':null
    :null;
  const recent=detail?recordSummaryText(detail.records):null;
  const metaParts=[card.reporter_department?.trim()||null,card.location?.trim()||null,recent].filter((part):part is string=>Boolean(part));

  return <div className="ds-ticket-hover-card">
    <div className="ds-ticket-hover-head">
      <TicketCategoryTile service={card.service}/>
      <div className="ds-ticket-hover-heading">
        <span id={titleId} className="ds-ticket-hover-number">{card.number}</span>
        <span className="ds-ticket-hover-title" title={card.title}>{card.title}</span>
      </div>
    </div>
    <div className="ds-ticket-hover-status-row">
      <StatusBadge tone={stage.tone} className="ds-ticket-hover-stage">{stage.label}</StatusBadge>
      <span className="ds-ticket-hover-assignee">
        {card.assignee_name?<><Avatar name={card.assignee_name} size={18} aria-hidden="true"/><span>{card.assignee_name}</span></>:<span className="ds-ticket-hover-unassigned">等待领取</span>}
      </span>
      {wait?<span className="ds-ticket-hover-time" data-tone={wait.tone}>{wait.label==='刚刚'?'刚刚':'等待 '+wait.label}</span>:endedLabel?<span className="ds-ticket-hover-time">{endedLabel}</span>:null}
    </div>
    {metaParts.length?<div className="ds-ticket-hover-meta">{metaParts.join(' · ')}</div>:null}
    <div className="ds-ticket-hover-footer">
      <span>点击打开详情</span>
      <Kbd keys={shortcutKeys('open-close-detail').slice(0, 1)} className="ds-hover-card-keycap" />
    </div>
  </div>;
}

export function TicketHoverCard({itemKind,itemId,number,children}:TicketHoverCardProps){
  const actions=useHoverCardsActions();
  const [cardState,setCardState]=useState<HoverCardState>('loading');

  const handleStateChange=useCallback((next:HoverCardState)=>{
    setCardState(current=>current===next?current:next);
  },[]);

  if(!actions||(!itemKind&&!itemId&&!number))return children;

  return <HoverCard
    kind="ticket"
    width={320}
    state={cardState}
    renderContent={({titleId})=><TicketHoverCardBody
      titleId={titleId}
      itemKind={itemKind}
      itemId={itemId}
      number={number}
      principal={actions.principal}
      onStateChange={handleStateChange}
    />}
  >
    {children}
  </HoverCard>;
}
