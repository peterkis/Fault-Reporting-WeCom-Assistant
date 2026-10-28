import {WorkbenchButton as HButton} from '../../app/WorkbenchButton';
import {useEffect,useMemo} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {RefreshCw} from 'lucide-react';
import {api,ApiError,captureWorkbenchRead,errorMessage} from '../../api/client';
import type {P2016TicketNotification} from '../../api/client';
import {clearItemAuthorization,clearSessionAuthorization,clearTicketAuthorization} from '../../app/authorization';
import {DetailLoading} from '../../app/DetailLoading';

const nodeLabels={FIRST_RESPONSIBILITY:'首次责任通知',FIRST_HANDLING:'接单通知',STAFF_COMPLETED:'完工通知'};
const deliveryLabels:Record<P2016TicketNotification['status'],string>={PENDING:'待发送',LEASED:'已领取待发送',SENDING:'发送中',SENT:'已发送',DEAD_LETTER:'发送失败',RECONCILIATION_REQUIRED:'待核对',CANCELLED:'已取消'};
const effectLabels:Record<P2016TicketNotification['side_effect_state'],string>={NOT_ATTEMPTED:'尚未尝试',ACKNOWLEDGED:'发送已确认',UNKNOWN:'结果未知'};
type NodeKind=keyof typeof nodeLabels;
interface Node {kind:NodeKind;deliveries:P2016TicketNotification[]}
interface Round {cycle:number|null;nodes:Node[]}

export function TicketRoundNotifications({ticketId,principalId,readReady=true,requested}:{ticketId:string;principalId:string;readReady?:boolean;requested?:{kind:'ticket'|'review'|'intake';id:string}}){
  const client=useQueryClient();
  const result=useQuery({queryKey:['ticket-round-notifications',principalId,ticketId],enabled:readReady,retry:false,gcTime:0,queryFn:async({signal})=>{const current=captureWorkbenchRead(signal),response=await api.ticketNotifications(ticketId,signal);current();return response;}});
  useEffect(()=>{const error=result.error;if(!(error instanceof ApiError)||![401,403,404].includes(error.status))return;if(error.status===401)void clearSessionAuthorization(client,principalId,401,'revoked');else{void clearTicketAuthorization(client,principalId,ticketId,error);if(requested&&(requested.kind!=='ticket'||requested.id!==ticketId))void clearItemAuthorization(client,principalId,requested.kind,requested.id,error);}},[result.error,client,principalId,ticketId,requested?.kind,requested?.id]);
  const rounds=useMemo(()=>{
    const groups=new Map<number|null,Round>();
    const order=(item:P2016TicketNotification)=>item.node==='STAFF_COMPLETED'?2:item.node==='FIRST_HANDLING'?1:0;
    for(const item of [...(result.data?.items??[])].sort((a,b)=>a.created_at.localeCompare(b.created_at)||order(a)-order(b)||a.delivery_id.localeCompare(b.delivery_id))){
      if(item.node!=='FIRST_RESPONSIBILITY'&&item.node!=='FIRST_HANDLING'&&item.node!=='STAFF_COMPLETED')continue;
      const cycle=item.cycle_no??null;const round:Round=groups.get(cycle)??{cycle,nodes:[]};
      let node=round.nodes.find(value=>value.kind===item.node);if(!node){node={kind:item.node,deliveries:[]};round.nodes.push(node);}node.deliveries.push(item);groups.set(cycle,round);
    }
    return [...groups.values()].sort((a,b)=>(b.cycle??-1)-(a.cycle??-1));
  },[result.data]);
  return <section className="ticket-round-notifications" role="region" aria-label="报修人通知">
    <header className="detail-section-heading"><h3>报修人通知</h3><HButton type="button" className="icon-button notification-refresh" aria-label="刷新通知状态" title="刷新通知状态" isDisabled={result.isFetching||!readReady} onClick={()=>{void result.refetch();}} variant="secondary"><RefreshCw size={15}/></HButton></header>
    {result.isPending&&!result.data?<DetailLoading label="正在加载通知状态…"/>:null}
    {result.isError?<p role="status">{result.data?'通知状态暂未更新，保留最近已确认内容。':errorMessage(result.error)}</p>:null}
    {result.isSuccess&&!rounds.length?<p className="notification-empty">暂无轮次通知记录。</p>:null}
    {rounds.map(round=><div className="notification-round" key={round.cycle??'unassigned'}>
      <h4>{round.cycle===null?'未标注轮次':'处理轮次 '+round.cycle}</h4>
      <div className="notification-timeline-scroll" tabIndex={0} aria-label={(round.cycle===null?'历史':'第'+round.cycle+'轮')+'通知时间线'}><ol className="notification-timeline">{round.nodes.map(node=><li className="notification-node" key={node.kind} data-notification-node={node.kind}>
        <strong>{nodeLabels[node.kind]}</strong>
        {node.deliveries.map(item=><div className="notification-delivery" key={item.delivery_id}>
          <p><span>{item.route_kind==='YIXIAOXIU_APP'?'医小修应用':item.destination_type==='PERSON'?'原报修人单聊':'群聊'}</span><span className={'notification-state state-'+item.status}>{deliveryLabels[item.status]}</span></p>
          <small>{item.attempt_count} 次尝试 · {effectLabels[item.side_effect_state]}</small>
          <time dateTime={(item.sent_at??item.created_at).replace(' ','T')+'+08:00'} title="北京时间">{item.sent_at?'发送于 ':'产生于 '}{item.sent_at??item.created_at}</time>
        </div>)}
      </li>)}</ol></div>
    </div>)}
    {result.data?.items.length===100?<small>显示最近 100 条通知记录。</small>:null}
  </section>;
}
