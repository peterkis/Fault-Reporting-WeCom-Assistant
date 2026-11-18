import type {CSSProperties,HTMLAttributes,ReactNode} from 'react';
import {Fragment} from 'react';
import {Button} from '../Button/Button';
import {BoardColumn,BoardGroup} from '../BoardColumn/BoardColumn';
import {COLUMN_GROUPS,boardGroupProps,groupPreferenceKey,loadingSlots,readGroupExpanded} from '../BoardColumn/column-groups';
import {TicketCard} from '../TicketCard/TicketCard';
import type {BoardColumn as Column} from '../../../api/client';
import './skeleton.css';

type Props=HTMLAttributes<HTMLSpanElement>&{w?:string;h?:string;r?:string};
export function Skeleton({w='100%',h='var(--lh-xs)',r='var(--radius-skeleton)',className='',style,...props}:Props){
  return <span {...props} aria-hidden="true" data-skeleton className={'ds-skeleton '+className} style={{...style,'--skeleton-w':w,'--skeleton-h':h,'--radius-skeleton-block':r} as CSSProperties}/>;
}
export function LoadingStatus({children,label='正在读取…',slow=false,onRetry,className=''}:{children:ReactNode;label?:string;slow?:boolean;onRetry?:()=>void;className?:string}){
  return <div role="status" aria-busy="true" aria-label={label} className={'ds-loading-status '+className} data-loading-status><span className="sr-only">{label}</span>{children}{slow?<div className="ds-loading-slow"><span>比平时慢，仍在读取…</span>{onRetry?<Button tone="ghost" size="sm" onPress={onRetry}>重试</Button>:null}</div>:null}</div>;
}
export function TicketCardSkeleton(){
  return <TicketCard className="ds-ticket-skeleton" aria-hidden="true"><div className="card-open"><div className="ds-ticket-body has-category"><div className="card-top"><Skeleton w="55%"/><Skeleton className="ds-ticket-category" w="calc(var(--space-6) + var(--space-1))" h="calc(var(--space-6) + var(--space-1))"/></div><h3><Skeleton w="90%" h="var(--lh-md)"/></h3><div className="ds-ticket-metadata"><Skeleton w="75%"/></div><footer className="card-footer"><div className="card-tags"><Skeleton w="var(--space-12)" h="var(--space-5)"/><Skeleton w="var(--space-10)" h="var(--space-5)"/></div><Skeleton w="var(--avatar-sm)" h="var(--avatar-sm)" r="var(--radius-full)"/></footer></div></div></TicketCard>;
}
export function BoardColumnSkeleton({column='active',label='处理中',bodyOnly=false,slow=false,onRetry,principalId}:{column?:Column;label?:string;bodyOnly?:boolean;slow?:boolean;onRetry?:()=>void;principalId?:string}){
  const groups=COLUMN_GROUPS[column],expanded=groups.filter(group=>readGroupExpanded(group.defaultExpanded,groupPreferenceKey(group,principalId,'board')));
  const cards=(count:number)=>Array.from({length:count},(_,index)=><TicketCardSkeleton key={index}/>);
  const body=<LoadingStatus label={'正在读取'+label} slow={slow} {...(onRetry?{onRetry}:{})}><div className={'column-cards'+(!groups.length?' ds-skeleton-cards':'')}>{groups.length?groups.map(group=>{
    const children=<BoardGroup {...boardGroupProps(group,principalId)} count="…" loading>{cards(loadingSlots(3,expanded.indexOf(group),expanded.length))}</BoardGroup>;
    return group.key==='completed'?<div className="ds-completed-drop-zone" key={group.key} data-skeleton-group={group.key}>{children}</div>:<Fragment key={group.key}>{children}</Fragment>;
  }):cards(3)}</div></LoadingStatus>;
  return bodyOnly?body:<BoardColumn column={column} label={label} count="…">{body}</BoardColumn>;
}
export function DetailSkeleton({title,slow=false,onRetry}:{title?:string;slow?:boolean;onRetry?:()=>void}){
  return <LoadingStatus className="ds-detail-skeleton detail-body" label="正在读取事项详情…" slow={slow} {...(onRetry?{onRetry}:{})}><header className="detail-heading ds-detail-hero"><Skeleton w="var(--state-icon)" h="var(--state-icon)"/><div>{title?<h2 id="detail-title">{title}</h2>:<Skeleton h="var(--lh-lg)"/>}<Skeleton w="60%"/></div></header><Skeleton h="var(--space-16)" r="var(--radius-lg)"/><div className="ds-skeleton-properties">{Array.from({length:8},(_,index)=><div key={index}><Skeleton w="30%"/><Skeleton w="55%"/></div>)}</div><div className="ds-skeleton-timeline">{[0,1].map(index=><div key={index}><Skeleton w="var(--avatar-sm)" h="var(--avatar-sm)" r="var(--radius-full)"/><div><Skeleton w="40%"/><Skeleton w="75%"/></div></div>)}</div></LoadingStatus>;
}
export function BlockSkeleton({label='正在读取…',slow=false,onRetry}:{label?:string;slow?:boolean;onRetry?:()=>void}){
  return <LoadingStatus label={label} slow={slow} {...(onRetry?{onRetry}:{})}><div className="ds-block-skeleton"><Skeleton w="65%"/><Skeleton w="85%"/></div></LoadingStatus>;
}
