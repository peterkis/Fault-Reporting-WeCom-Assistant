import {useEffect,useRef} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import type {Principal} from '../../api/client';
import {ApiError,captureWorkbenchRead,readWorkbench,workbenchTransportWritable} from '../../api/client';
import {clearItemAuthorization,clearSessionAuthorization} from '../../app/authorization';
import {foregroundTextReader,hasForegroundText} from '../personal-read/foreground-text';
import type {ConversationWorkspaceItem} from './client';
function object(value:unknown):Record<string,unknown>{if(value===null||typeof value!=='object'||Array.isArray(value))throw new ApiError(502,'INVALID_RESPONSE');return value as Record<string,unknown>;}
function cursor(value:unknown){const v=object(object(value).read_cursor);if(typeof v.last_read_sequence!=='string'||!/^(0|[1-9][0-9]{0,15})$/u.test(v.last_read_sequence)||!Number.isSafeInteger(Number(v.last_read_sequence))||typeof v.row_version!=='number'||!Number.isSafeInteger(v.row_version)||v.row_version<0)throw new ApiError(502,'INVALID_RESPONSE');return {last:Number(v.last_read_sequence),version:v.row_version};}
export function ConversationReadTimeline({principal,id,items}:{principal:Principal;id:string;items:ConversationWorkspaceItem[]}){
  const root=useRef<HTMLOListElement|null>(null),client=useQueryClient(),signature=JSON.stringify(items.map(item=>[item.item_id,item.sequence_no,item.text]));
  useEffect(()=>{
    if(!principal.personal_read_enabled||!root.current)return;
    const elements=[...root.current.querySelectorAll<HTMLParagraphElement>('p[data-session-read-sequence]')].filter(node=>node.textContent?.trim());
    const readers=elements.map(node=>({node,read:foregroundTextReader(node),sequence:Number(node.dataset.sessionReadSequence)})).filter(value=>Number.isSafeInteger(value.sequence)&&value.sequence>0);
    const controller=new AbortController(),current=captureWorkbenchRead(controller.signal);let disposed=false,busy=false,blocked=false,confirmed=0;
    const observe=async()=>{
      if(disposed||busy||blocked||!workbenchTransportWritable())return;
      const seen=readers.filter(reader=>reader.read()).sort((a,b)=>b.sequence-a.sequence),target=seen[0];if(!target||target.sequence<=confirmed)return;
      busy=true;
      try{
        const fresh=await readWorkbench('/api/conversations/'+id,controller.signal,cursor);current();
        if(disposed||!workbenchTransportWritable()||!hasForegroundText(target.node))return;
        confirmed=Math.max(confirmed,fresh.last);if(target.sequence<=confirmed)return;
        const command={client_command_id:crypto.randomUUID(),expected_cursor_row_version:fresh.version,last_read_sequence:target.sequence};
        const response=await fetch('/api/conversations/'+id+'/read-cursor',{method:'POST',signal:controller.signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':command.client_command_id,...(principal.csrf_token?{'x-csrf-token':principal.csrf_token}:{})},body:JSON.stringify(command)});current();
        if(!response.ok)throw new ApiError(response.status,'SESSION_READ_REJECTED');
        const result=object(await response.json());current();const ack=object(result.cursor);
        if(result.ok!==true||typeof ack.last_read_sequence!=='number'||!Number.isSafeInteger(ack.last_read_sequence)||ack.last_read_sequence<target.sequence)throw new ApiError(502,'INVALID_RESPONSE');
        confirmed=Math.max(confirmed,ack.last_read_sequence);void client.invalidateQueries({queryKey:['conversations',principal.principal_id]});
      }catch(error){
        if(disposed||controller.signal.aborted)return;
        if(error instanceof ApiError&&[401,403,404].includes(error.status)){if(error.status===401)await clearSessionAuthorization(client,principal.principal_id,401,'revoked');else await clearItemAuthorization(client,principal.principal_id,'conversation',id,error);}
        if(!(error instanceof ApiError&&error.status===409))blocked=true;
      }finally{busy=false;}
    };
    const changed=()=>{void observe();};const observer=new IntersectionObserver(changed,{threshold:[0,1]});for(const {node}of readers)observer.observe(node);
    document.addEventListener('visibilitychange',changed);window.addEventListener('focus',changed);window.addEventListener('scroll',changed,true);window.addEventListener('resize',changed);changed();
    return()=>{disposed=true;controller.abort();observer.disconnect();document.removeEventListener('visibilitychange',changed);window.removeEventListener('focus',changed);window.removeEventListener('scroll',changed,true);window.removeEventListener('resize',changed);};
  },[client,principal.principal_id,principal.authorization_revision,principal.expires_epoch_ms,principal.csrf_token,principal.personal_read_enabled,id,signature]);
  return <ol ref={root}>{items.map(item=><li key={item.item_id} data-conversation-item={item.item_id}><header><strong>{item.visibility==='INTERNAL'?'内部协作':item.sender_kind==='USER'?'报修人':'工作人员'}</strong><time>{item.occurred_at}</time><span>{item.visibility==='INTERNAL'?'内部备注':'服务材料'}</span></header><p data-session-read-sequence={item.text?.trim()?item.sequence_no:undefined}>{item.text??'本条材料没有可展示的文本。'}</p></li>)}</ol>;
}
