import {useCallback,useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError,captureWorkbenchRead,errorMessage} from '../../api/client';
import type {P2016TicketNotification} from '../../api/client';
import {clearSessionAuthorization,clearTicketAuthorization} from '../../app/authorization';

const nodeLabels={FIRST_RESPONSIBILITY:'首次责任',STAFF_COMPLETED:'工作人员完工'};
const deliveryLabels:Record<P2016TicketNotification['status'],string>={PENDING:'待发送',LEASED:'已领取待发送',SENDING:'发送中',SENT:'已发送',DEAD_LETTER:'发送失败',RECONCILIATION_REQUIRED:'待核对',CANCELLED:'已取消'};
const effectLabels:Record<P2016TicketNotification['side_effect_state'],string>={NOT_ATTEMPTED:'尚未尝试',ACKNOWLEDGED:'已确认',UNKNOWN:'结果未知'};

export function TicketRoundNotifications({ticketId,principalId}:{ticketId:string;principalId:string}){
  const client=useQueryClient(),request=useRef<AbortController|null>(null),generation=useRef(0);
  const [items,setItems]=useState<P2016TicketNotification[]|null>(null),[loading,setLoading]=useState(false),[message,setMessage]=useState('');
  const read=useCallback(async()=>{
    request.current?.abort();
    const controller=new AbortController(),token=++generation.current,checkRead=captureWorkbenchRead(controller.signal);
    request.current=controller;setItems(null);setLoading(true);setMessage('');
    const current=()=>token===generation.current&&!controller.signal.aborted;
    try{
      const response=await api.ticketNotifications(ticketId,controller.signal);
      checkRead();if(current())setItems(response.items);
    }catch(error){
      if(!current()||error instanceof DOMException&&error.name==='AbortError')return;
      setItems(null);setMessage(errorMessage(error));
      if(error instanceof ApiError&&[401,403,404].includes(error.status)){
        if(error.status===401)void clearSessionAuthorization(client,principalId,401,'revoked');
        else void clearTicketAuthorization(client,principalId,ticketId,error);
      }
    }finally{if(current())setLoading(false);if(request.current===controller)request.current=null;}
  },[client,principalId,ticketId]);
  useEffect(()=>{void read();return()=>{generation.current++;request.current?.abort();request.current=null;};},[read]);
  const nodes=items?.filter(item=>item.node==='FIRST_RESPONSIBILITY'||item.node==='STAFF_COMPLETED')??[];
  return <section className="attachment-section ticket-round-notifications" role="region" aria-label="报修人通知送达">
    <h3>报修人通知送达</h3>
    {loading?<p role="status">正在读取通知送达状态…</p>:message?<p role="status">{message}</p>:!nodes.length?<p>当前没有可读取的轮次节点通知。</p>:<ul>{nodes.map(item=><li key={item.delivery_id}><span>
      <strong>{item.node?nodeLabels[item.node]:''}</strong>
      <small>处理轮次 {item.cycle_no} · {item.destination_type==='PERSON'?'原报修人单聊':'群聊'} · {deliveryLabels[item.status]}</small>
      <small>尝试次数 {item.attempt_count} · {effectLabels[item.side_effect_state]}</small>
      {item.sent_at?<small>发送时间 {item.sent_at}（北京时间）</small>:null}
    </span></li>)}</ul>}
    <button type="button" disabled={loading} onClick={()=>{void read();}}>重新读取通知</button>
  </section>;
}
