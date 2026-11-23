import {BlockSkeleton,LoadingStatus,Skeleton} from '../../design/components/Skeleton/Skeleton';
import {useDelayedLoading} from '../../design/hooks/useDelayedLoading';
import {useCallback,useState} from 'react';
import {X,ArrowUpRight} from 'lucide-react';
import {ApiError,errorMessage,statusLabels} from '../../api/client';
import type {Principal} from '../../api/client';
import {WorkbenchLink as Link} from '../../app/WorkbenchLink';
import {TicketCard,TicketCardBody,TicketCategoryTile} from '../../design/components/TicketCard/TicketCard';
import {StageGlyph} from '../../design/components/StageGlyph/StageGlyph';
import {Tag} from '../../design/components/Tag/Tag';
import {cardHeat,cardHeatStart} from '../../design/heat';
import {Drawer} from '../../design/components/Drawer/Drawer';
import {Button} from '../../design/components/Button/Button';
import {Avatar} from '../../design/components/Avatar/Avatar';
import type {MouseEvent} from 'react';
import {Section} from '../../design/components/Section/Section';
import {StatusBadge} from '../../design/components/StatusBadge/StatusBadge';
import {statusTones,stagePresentation} from '../../design/status-map';
import {useItemSummary} from '../hover-cards/use-item-summary';
import type {ConversationChatEntry} from './inbox-client';
import {publicChannelLabel,sourceLabel} from './client';

export function AssociatedItem({entry,principal,blocked}:{entry:ConversationChatEntry;principal:Principal;blocked:boolean}){
  const item=entry.canonical_item,[open,setOpen]=useState(false);
  const closeDrawer=useCallback(()=>setOpen(false),[]);
  const {query:detail,denied}=useItemSummary({principalId:principal.principal_id,item,onRevoked:closeDrawer});
  const loading=useDelayedLoading(detail.isPending&&Boolean(item));
  const current=denied?undefined:detail.data?.item;
  const heatStart=current?cardHeatStart(current):null,heat=current?cardHeat(current,Date.now()):null;
  const openSummary=(event:MouseEvent<HTMLAnchorElement>)=>{event.preventDefault();if(!blocked)setOpen(true);};
  const full=item?'/items/'+item.kind+'/'+item.id+'?detail=page':'/';
  return <section className="inbox-associated" aria-label="关联事项"><h3>关联事项</h3>{item&&!denied?<>
    <TicketCard className="inbox-mini-ticket"><Link className="card-open" to={full} aria-label={'查看关联事项 '+item.number} onClick={openSummary}>
      <TicketCardBody number={item.number} title={item.title} category={<TicketCategoryTile service={current?.service}/>} heat={heat} heatStart={heatStart??null} metadata={current?<Tag className="inbox-mini-stage" tone={stagePresentation[current.column].tone} title={'当前状态 · '+(statusLabels[current.status]??current.status)}><StageGlyph stage={current.column}/>{stagePresentation[current.column].label}<span className="sr-only"> · 当前状态 · {statusLabels[current.status]??current.status}</span></Tag>:detail.isError?<span className="inbox-meta">事项摘要暂不可用</span>:loading.visible?<LoadingStatus label="正在加载事项摘要…" slow={loading.slow}><Skeleton w="4em" h="var(--lh-sm)"/></LoadingStatus>:null} tags={[]} owner={null} activity={null}/>
    </Link></TicketCard><Link className="inbox-open-summary" to={full} onClick={openSummary}>在抽屉中打开<ArrowUpRight aria-hidden="true"/></Link>
  </>:<p>暂无可展示的关联事项</p>}
    <section className="inbox-reporter"><h3>报修人</h3><div className="inbox-reporter-person"><Avatar name={entry.participant_label} size={32}/><div><strong>{entry.participant_label}</strong>{entry.department_label?<p title={entry.department_label}>{entry.department_label}</p>:null}</div></div></section>
    <div className="inbox-origin"><h3>来源</h3><p><span>原始来源：</span><span>{sourceLabel(entry.original_source)}</span></p><p><span>当前沟通：</span><span>{entry.current_contact_channel==='group'?'群内原始沟通':'医小修私聊'}</span></p><p className="inbox-reply-target"><span>回复方式：</span><span>{publicChannelLabel(entry.reply_channel_label)}</span></p></div>
    {item&&!denied?<Drawer isOpen={open} dismissBlocked={false} onClose={()=>setOpen(false)}><div className="detail-navigation" data-toast-avoid="top"><div className="detail-breadcrumb">关联事项 / {item.number}</div><Button tone="ghost" isIconOnly aria-label="关闭详情" onPress={()=>setOpen(false)}><X/></Button></div><div className="detail-body inbox-associated-detail">
      <h2 id="detail-title">{item.title}</h2>{current?<><StatusBadge tone={statusTones[current.status]??'neutral'}>{statusLabels[current.status]??current.status}</StatusBadge><Section title="事项信息"><dl className="properties"><dt>处理人</dt><dd>{current.assignee_name??'待安排'}</dd>{current.location?<><dt>位置</dt><dd>{current.location}</dd></>:null}{current.reporter_name?<><dt>报修人</dt><dd>{current.reporter_name}</dd></>:null}</dl></Section>{detail.data?.description?<Section title="报修描述"><p>{detail.data.description}</p></Section>:null}</>:detail.isError?<p role="alert">{errorMessage(detail.error)}</p>:loading.visible?<BlockSkeleton label="正在加载事项摘要…" slow={loading.slow}/>:null}
      <Link className="inbox-full-item" to={full} onClick={event=>{if(blocked)event.preventDefault();}}>打开完整事项 <ArrowUpRight size={16}/></Link>
    </div></Drawer>:null}
  </section>;
}
