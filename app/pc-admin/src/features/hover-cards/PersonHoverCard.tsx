import {useEffect,useMemo,type ReactElement,type ReactNode,type RefAttributes} from 'react';
import {WorkbenchLink as Link} from '../../app/WorkbenchLink';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {ApiError,api,type Principal,type WorkbenchCard,type WorkbenchDetail} from '../../api/client';
import {clearSessionAuthorization} from '../../app/authorization';
import {Avatar} from '../../design/components/Avatar/Avatar';
import {Button} from '../../design/components/Button/Button';
import {HoverCard,PersonHoverRendererContext,type PersonHoverRenderer,type PersonHoverTriggerProps} from '../../design/components/HoverCard/HoverCard';
import {presenceFieldLabels} from '../../design/components/PresenceTags/PresenceTags';
import {Skeleton} from '../../design/components/Skeleton/Skeleton';
import {useDelayedLoading} from '../../design/hooks/useDelayedLoading';
import {NumberRoll} from '../../design/motion/number-roll';
import {useOnlineColleagues,usePersonPresence} from '../activity/presence-store';
import {getHoverItemDeniedStatus,isDepartmentUnavailable,markDepartmentUnavailable,useDeniedItemsRevision} from './denied-items';
import {HoverCardsStoreProvider,findBoardItemInIndex,useHoverCardsActions,useHoverCardsState,type BoardHoverCardsIndex} from './hover-card-store';
import {computePersonStats} from './person-stats';
import {TicketHoverCard} from './TicketHoverCard';
import './hover-cards.css';

export interface PersonHoverCardProps {
  name:string;
  personId?:string|null;
  isSelf?:boolean;
  disabled?:boolean;
  children:ReactElement<Record<string,unknown>&RefAttributes<HTMLElement>>;
}

function findCachedItemNumber(
  client:ReturnType<typeof useQueryClient>,
  principalId:string,
  kind:WorkbenchCard['kind'],
  id:string,
):string|null{
  for(const query of client.getQueryCache().findAll({queryKey:['detail',principalId,kind,id]})){
    if(query.state.status!=='success'||query.state.error)continue;
    const data=query.state.data as WorkbenchDetail|undefined;
    const itemNumber=data?.item?.number?.trim();
    if(itemNumber)return itemNumber;
  }
  return null;
}

function PresenceLine({
  name,
  principal,
  boardIndex,
  onClose,
}: {
  name:string;
  principal:Principal;
  boardIndex:BoardHoverCardsIndex|null;
  onClose:()=>void;
}){
  const presence=usePersonPresence(name);
  const client=useQueryClient();
  useDeniedItemsRevision();

  if(!presence)return null;

  const fencedStatus=getHoverItemDeniedStatus(principal.principal_id,{kind:presence.kind,id:presence.id});
  const boardNumber=fencedStatus===null&&boardIndex
    ?findBoardItemInIndex(boardIndex,{kind:presence.kind,id:presence.id})?.number?.trim()||null
    :null;
  const itemNumber=fencedStatus!==null
    ?null
    :boardNumber??findCachedItemNumber(client,principal.principal_id,presence.kind,presence.id);

  if(!itemNumber){
    const text=presence.mode==='EDITING'
      ?presence.field?'正在编辑'+presenceFieldLabels[presence.field]:'正在编辑工单'
      :'正在查看工单';
    return <div className="ds-person-hover-presence"><span>{text}</span></div>;
  }

  const verb=presence.mode==='EDITING'?'正在编辑':'正在查看';
  const suffix=presence.mode==='EDITING'&&presence.field?' 的'+presenceFieldLabels[presence.field]:'';

  return <div className="ds-person-hover-presence">
    <span>{verb} </span>
    <TicketHoverCard itemKind={presence.kind} itemId={presence.id} number={itemNumber}>
      <Link className="ds-person-hover-presence-link" to={'/items/'+presence.kind+'/'+presence.id} onClick={()=>{onClose();}}>{itemNumber}</Link>
    </TicketHoverCard>
    {suffix?<span>{suffix}</span>:null}
  </div>;
}

function PersonHoverCardBody({
  titleId,
  name,
  personId,
  self,
  principal,
  onClose,
}: {
  titleId:string;
  name:string;
  personId?:string|null|undefined;
  self:boolean;
  principal:Principal;
  onClose:()=>void;
}){
  const storeState=useHoverCardsState();
  const client=useQueryClient();
  const online=useOnlineColleagues();
  const trimmedName=name.trim();

  const deptThrottled=isDepartmentUnavailable(principal.principal_id,principal.authorization_revision,trimmedName);
  const profileEnabled=Boolean(principal.current_profile_available===true&&trimmedName.length>0&&!deptThrottled);
  const profileQuery=useQuery({
    queryKey:['people-profile',principal.principal_id,principal.authorization_revision,trimmedName],
    queryFn:async({signal})=>{
      try{
        return await api.peopleProfile(trimmedName,principal.csrf_token,signal);
      }catch(error){
        if(!signal.aborted&&!(error instanceof ApiError&&(error.status===401||error.status===403))){
          markDepartmentUnavailable(principal.principal_id,principal.authorization_revision,trimmedName);
        }
        throw error;
      }
    },
    enabled:profileEnabled,
    staleTime:5*60*1000,
    gcTime:5*60*1000,
    retry:false,
    refetchInterval:false,
    refetchOnWindowFocus:false,
  });

  useEffect(()=>{
    if(!(profileQuery.error instanceof ApiError))return;
    if(profileQuery.error.status===401||profileQuery.error.status===403){
      void clearSessionAuthorization(client,principal.principal_id,profileQuery.error.status as 401|403,'revoked');
    }
  },[client,principal.principal_id,profileQuery.error]);

  const deptLoading=useDelayedLoading(profileEnabled&&profileQuery.isPending&&!profileQuery.isError);
  const department=profileEnabled&&!profileQuery.isError?profileQuery.data?.department?.trim()||null:null;

  const onlineState:'online'|'offline'|null=self
    ?'online'
    :online===null
      ?null
      :online.people.some(person=>person.display_name.trim()===trimmedName)
        ?'online'
        :'offline';

  const board=storeState?.board;
  const stats=useMemo(()=>{
    if(!board?.hasBoard)return null;
    return computePersonStats({
      items:board.items,
      displayName:trimmedName,
      range:board.range,
      handledDates:board.handledDates,
      nowMs:board.now,
    });
  },[board,trimmedName]);

  const canFilter=Boolean(board?.hasBoard&&!board.searchMode&&board.onFilterByPerson);
  const canTransfer=Boolean(!self&&storeState?.transfer?.canTransfer);

  return <div className="ds-person-hover-card">
    <div className="ds-person-hover-head">
      <Avatar name={trimmedName} personId={personId??undefined} size={36} aria-hidden="true"/>
      <div className="ds-person-hover-identity">
        <span id={titleId} className="ds-person-hover-name">{trimmedName}</span>
        {deptLoading.visible&&!department?<span className="ds-person-hover-dept"><Skeleton w="6em" h="var(--lh-xs)"/></span>:department?<span className="ds-person-hover-dept" title={department}>{department}</span>:null}
      </div>
      {onlineState?<span className="ds-person-hover-online" data-person-online={onlineState}><span className="ds-person-hover-online-dot" aria-hidden="true"/>{onlineState==='online'?'在线':'离线'}</span>:null}
    </div>

    <PresenceLine name={trimmedName} principal={principal} boardIndex={board?.index??null} onClose={onClose}/>

    {stats?<div className="ds-person-hover-stats" data-cols={stats.doneToday===null?'2':'3'}>
      <div className="ds-person-hover-stat" data-person-stat="active">
        <span className="ds-person-hover-stat-value"><NumberRoll value={stats.active} animate={false}/></span>
        <span className="ds-person-hover-stat-label">处理中</span>
      </div>
      <div className="ds-person-hover-stat" data-person-stat="waiting">
        <span className="ds-person-hover-stat-value"><NumberRoll value={stats.waiting} animate={false}/></span>
        <span className="ds-person-hover-stat-label">等待中</span>
      </div>
      {stats.doneToday!==null?<div className="ds-person-hover-stat" data-person-stat="done-today">
        <span className="ds-person-hover-stat-value"><NumberRoll value={stats.doneToday} animate={false}/></span>
        <span className="ds-person-hover-stat-label">今日完成</span>
      </div>:null}
    </div>:null}

    {canFilter||canTransfer?<div className="ds-person-hover-actions">
      {canFilter?<Button size="sm" tone="secondary" className="ds-person-hover-action" data-action="filter-person-tickets" onPress={()=>{board?.onFilterByPerson?.(trimmedName);onClose();}}>{self?'只看我的工单':'只看他的工单'}</Button>:null}
      {canTransfer?<Button size="sm" tone="secondary" className="ds-person-hover-action" data-action="transfer-to-person" onPress={()=>{onClose();storeState?.transfer?.openForPerson(trimmedName);}}>转交给他…</Button>:null}
    </div>:null}
  </div>;
}

export function PersonHoverCard({name,personId,isSelf,disabled,children}:PersonHoverCardProps){
  const actions=useHoverCardsActions();
  const trimmed=name.trim();
  if(!actions||!trimmed)return children;

  const self=isSelf??(personId?personId===actions.principal.principal_id:trimmed===actions.principal.display_name.trim());

  return <HoverCard
    kind="person"
    width={300}
    state="ready"
    {...(disabled!==undefined?{disabled}:{})}
    renderContent={({titleId,close})=><PersonHoverCardBody
      titleId={titleId}
      name={trimmed}
      personId={personId}
      self={self}
      principal={actions.principal}
      onClose={close}
    />}
  >
    {children}
  </HoverCard>;
}

const renderPersonBridge:PersonHoverRenderer=({name,personId,isSelf,disabled,children}:PersonHoverTriggerProps)=>(
  <PersonHoverCard name={name} {...(personId!==undefined?{personId}:{}) } {...(isSelf!==undefined?{isSelf}:{})} {...(disabled!==undefined?{disabled}:{})}>
    {children}
  </PersonHoverCard>
);

export function HoverCardsProvider({principal,children}:{principal:Principal;children:ReactNode}){
  return <HoverCardsStoreProvider principal={principal}>
    <PersonHoverRendererContext.Provider value={renderPersonBridge}>
      {children}
    </PersonHoverRendererContext.Provider>
  </HoverCardsStoreProvider>;
}
