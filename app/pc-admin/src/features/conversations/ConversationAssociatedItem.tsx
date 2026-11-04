import {useEffect,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {X,ArrowUpRight} from 'lucide-react';
import {api,ApiError,errorMessage,statusLabels} from '../../api/client';
import type {Principal} from '../../api/client';
import {clearItemAuthorization} from '../../app/authorization';
import {WorkbenchLink as Link} from '../../app/WorkbenchLink';
import {TicketCard,TicketCardBody,TicketCategoryTile} from '../../design/components/TicketCard/TicketCard';
import {StageGlyph} from '../../design/components/StageGlyph/StageGlyph';
import {Tag} from '../../design/components/Tag/Tag';
import {heatOf} from '../../design/heat';
import {Drawer} from '../../design/components/Drawer/Drawer';
import {Button} from '../../design/components/Button/Button';
import {Section} from '../../design/components/Section/Section';
import {StatusBadge} from '../../design/components/StatusBadge/StatusBadge';
import {statusTones,stagePresentation} from '../../design/status-map';
import type {ConversationChatEntry} from './inbox-client';

export function AssociatedItem({entry,principal,blocked}:{entry:ConversationChatEntry;principal:Principal;blocked:boolean}){
  const item=entry.canonical_item,client=useQueryClient(),[open,setOpen]=useState(false);
  const detail=useQuery({queryKey:['detail',principal.principal_id,item?.kind,item?.id,'summary'],queryFn:({signal})=>{if(!item)throw Error('NO_CANONICAL_ITEM');return api.detail(item.kind,item.id,null,signal);},enabled:Boolean(item)});
  const denied=detail.error instanceof ApiError&&[403,404].includes(detail.error.status);
  useEffect(()=>{if(item&&detail.error instanceof ApiError&&[403,404].includes(detail.error.status)){setOpen(false);void clearItemAuthorization(client,principal.principal_id,item.kind,item.id,detail.error);}},[client,principal.principal_id,item,denied,detail.error]);
  const current=denied?undefined:detail.data?.item;
  const heatStart=current?.column==='pending'?current.created_at:current?.column==='active'?current.stage_entered_at:null,heat=heatOf(heatStart?heatStart.replace(' ','T')+'+08:00':null,Date.now());
  const full=item?'/items/'+item.kind+'/'+item.id+'?detail=page':'/';
  return <section className="inbox-associated" aria-label="关联事项"><h3>关联事项</h3>{item&&!denied?<>
    <TicketCard className="inbox-mini-ticket"><Link className="card-open" to={full} aria-label={'查看关联事项 '+item.number} onClick={event=>{event.preventDefault();if(!blocked)setOpen(true);}}>
      <TicketCardBody number={item.number} title={item.title} category={<TicketCategoryTile service={current?.service}/>} heat={heat} heatStart={heatStart??null} metadata={current?<Tag className="inbox-mini-stage" tone={stagePresentation[current.column].tone} title={'当前状态 · '+(statusLabels[current.status]??current.status)}><StageGlyph stage={current.column}/>{stagePresentation[current.column].label}<span className="sr-only"> · 当前状态 · {statusLabels[current.status]??current.status}</span></Tag>:<span className="inbox-meta">{detail.isError?'事项摘要暂不可用':'正在加载事项摘要…'}</span>} tags={[]} owner={null} activity={null}/>
    </Link></TicketCard>
  </>:<p>暂无可展示的关联事项</p>}
    <section className="inbox-reporter"><h3>报修人</h3><p>{entry.participant_label}</p>{entry.department_label?<p>{entry.department_label}</p>:null}</section>
    <div className="inbox-origin"><h3>来源</h3><p>原始来源：{entry.original_source.label}</p><p>当前来源：{entry.current_contact_channel==='group'?'群内原始沟通':'Bot 私聊'}</p><p className="inbox-reply-target">{entry.reply_channel_label}</p></div>
    {open&&item&&!denied?<Drawer dismissBlocked={false} onClose={()=>setOpen(false)}><div className="detail-navigation"><div className="detail-breadcrumb">关联事项 / {item.number}</div><Button tone="ghost" isIconOnly aria-label="关闭详情" onPress={()=>setOpen(false)}><X/></Button></div><div className="detail-body inbox-associated-detail">
      <h2 id="detail-title">{item.title}</h2>{current?<><StatusBadge tone={statusTones[current.status]??'neutral'}>{statusLabels[current.status]??current.status}</StatusBadge><Section title="事项信息"><dl className="properties"><dt>处理人</dt><dd>{current.assignee_name??'待安排'}</dd>{current.location?<><dt>位置</dt><dd>{current.location}</dd></>:null}{current.reporter_name?<><dt>报修人</dt><dd>{current.reporter_name}</dd></>:null}</dl></Section>{detail.data?.description?<Section title="报修描述"><p>{detail.data.description}</p></Section>:null}</>:<p role={detail.isError?'alert':'status'}>{detail.isError?errorMessage(detail.error):'正在加载事项摘要…'}</p>}
      <Link className="inbox-full-item" to={full} onClick={event=>{if(blocked)event.preventDefault();}}>打开完整事项 <ArrowUpRight size={16}/></Link>
    </div></Drawer>:null}
  </section>;
}
