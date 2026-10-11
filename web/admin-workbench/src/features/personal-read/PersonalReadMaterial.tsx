import {useEffect,useRef} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import type {CanonicalItem} from '../../../../../contracts/workbench_review_contracts';
import type {Principal} from '../../api/client';
import {ApiError,captureWorkbenchRead,workbenchTransportWritable} from '../../api/client';
import {clearItemAuthorization,clearSessionAuthorization} from '../../app/authorization';
import {personalReadApi} from './client';
import {foregroundTextReader,hasForegroundText} from './foreground-text';
export function PersonalReadMaterial({principal,item,sourceRef,revision,text}:{principal:Principal;item:CanonicalItem;sourceRef:string;revision:string;text:string|null}){
  const node=useRef<HTMLParagraphElement|null>(null),client=useQueryClient();
  useEffect(()=>{
    const element=node.current;if(!element||!text?.trim()||!principal.personal_read_enabled)return;
    let disposed=false,attempted=false;const readText=foregroundTextReader(element),controller=new AbortController(),current=captureWorkbenchRead(controller.signal);
    const observe=async()=>{
      if(disposed||attempted||!workbenchTransportWritable())return;
      if(!readText())return;
      attempted=true;
      try{
        await personalReadApi.page(item,controller.signal);current();
        if(disposed||!workbenchTransportWritable()||!hasForegroundText(element)){attempted=false;return;}
        const command={client_command_id:crypto.randomUUID(),source_ref:sourceRef,revision};
        const result=await personalReadApi.advance(item,command,principal.csrf_token,controller.signal);current();if(disposed)return;
        client.setQueryData(['personal-read-position',principal.principal_id,item.kind,item.id],result);
        void client.invalidateQueries({queryKey:['board',principal.principal_id]});
      }catch(error){
        if(disposed||controller.signal.aborted||error instanceof DOMException&&error.name==='AbortError')return;
        if(error instanceof ApiError&&[401,403,404].includes(error.status)){
          if(error.status===401)await clearSessionAuthorization(client,principal.principal_id,401,'revoked');else await clearItemAuthorization(client,principal.principal_id,item.kind,item.id,error);
        }
        // An unknown response is never converted into a displayed success or an automatic second POST.
      }
    };
    const onChange=()=>{void observe();};
    const intersection=new IntersectionObserver(onChange,{threshold:[0,1]});intersection.observe(element);
    document.addEventListener('visibilitychange',onChange);window.addEventListener('focus',onChange);window.addEventListener('scroll',onChange,true);window.addEventListener('resize',onChange);
    onChange();
    return()=>{disposed=true;controller.abort();intersection.disconnect();document.removeEventListener('visibilitychange',onChange);window.removeEventListener('focus',onChange);window.removeEventListener('scroll',onChange,true);window.removeEventListener('resize',onChange);};
  },[client,principal.principal_id,principal.authorization_revision,principal.expires_epoch_ms,principal.personal_read_enabled,principal.csrf_token,item.kind,item.id,sourceRef,revision,text]);
  return <p ref={node} data-personal-read-ref={text?.trim()?sourceRef:undefined} data-personal-read-revision={text?.trim()?revision:undefined}>{text??'当前没有可展示的文本内容。'}</p>;
}
