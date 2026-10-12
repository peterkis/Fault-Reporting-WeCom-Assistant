import {useEffect,useRef} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import type {CanonicalItem} from '../../../../../contracts/workbench_review_contracts';
import type {PersonalReadCommand,PersonalReadAcknowledgement} from '../../../../../contracts/workbench_personal_read_contracts';
import type {Principal} from '../../api/client';
import {ApiError,captureWorkbenchRead,workbenchTransportWritable} from '../../api/client';
import {clearItemAuthorization,clearSessionAuthorization} from '../../app/authorization';
import {personalReadApi} from './client';
import {foregroundTextReader,hasForegroundText} from './foreground-text';
export function PersonalReadMaterial({principal,item,sourceRef,revision,text}:{principal:Principal;item:CanonicalItem;sourceRef:string;revision:string;text:string|null}){
  const node=useRef<HTMLParagraphElement|null>(null),client=useQueryClient();
  useEffect(()=>{
    const element=node.current;if(!element||!text?.trim()||!principal.personal_read_enabled)return;
    // Safe coordinates/UUID only. The bounded in-memory family holds no text or credentials.
    client.setQueryDefaults(['personal-read-command'],{gcTime:Infinity});
    let pendingKey:readonly ['personal-read-command',string,CanonicalItem['kind'],string,string,string]=['personal-read-command',principal.principal_id,item.kind,item.id,sourceRef,revision];
    const pending=()=>{
      const query=client.getQueryCache().findAll({predicate:query=>query.queryKey[0]==='personal-read-command'&&query.queryKey[1]===principal.principal_id&&query.queryKey[4]===sourceRef&&query.queryKey[5]===revision})[0];
      const command=query?client.getQueryData<PersonalReadCommand>(query.queryKey):undefined;
      return query&&command?{key:query.queryKey,command}:undefined;
    };
    const full=()=>client.getQueryCache().findAll({predicate:query=>query.queryKey[0]==='personal-read-command'}).length>=100;
    let disposed=false,attempted=false,busy=false,receiptChecked=false,ownCommandId:string|null=null;const readText=foregroundTextReader(element),controller=new AbortController(),current=captureWorkbenchRead(controller.signal);
    const discard=(commandId:string|null)=>{
      const saved=pending();
      if(commandId&&saved?.command.client_command_id===commandId)client.removeQueries({queryKey:saved.key,exact:true});
    };
    const confirmed=(result:PersonalReadAcknowledgement)=>{
      discard(result.client_command_id);
      client.setQueryData(['personal-read-position',principal.principal_id,item.kind,item.id],result);
      void client.invalidateQueries({queryKey:['board',principal.principal_id]});
    };
    const observe=async()=>{
      if(disposed||busy)return;
      if(!hasForegroundText(element)){receiptChecked=false;return;}
      if(!workbenchTransportWritable())return;
      if(pending()?receiptChecked:attempted||full())return;
      if(!readText())return;
      busy=true;ownCommandId=pending()?.command.client_command_id??null;
      try{
        const page=await personalReadApi.page(item,controller.signal);current();
        if(disposed||!workbenchTransportWritable()||!hasForegroundText(element))return;
        pendingKey=['personal-read-command',principal.principal_id,page.canonical_item.kind,page.canonical_item.id,sourceRef,revision];
        // Another rendered copy may own these coordinates while this GET awaited.
        const saved=pending();
        if(saved){
          receiptChecked=true;ownCommandId=saved.command.client_command_id;
          // Move only this already saved intent after current-scope authorization; no alias creates another UUID.
          client.removeQueries({queryKey:saved.key,exact:true});client.setQueryData(pendingKey,saved.command);
          const receipt=await personalReadApi.receipt(item,saved.command,controller.signal);current();if(disposed)return;
          if(receipt.state==='COMMITTED'){confirmed(receipt.result);attempted=true;}
          return;
        }
        if(attempted||full())return;
        const command:PersonalReadCommand={client_command_id:crypto.randomUUID(),source_ref:sourceRef,revision};
        client.setQueryData(pendingKey,command);attempted=true;ownCommandId=command.client_command_id;
        const result=await personalReadApi.advance(item,command,principal.csrf_token,controller.signal);current();if(disposed)return;
        confirmed(result);
      }catch(error){
        if(disposed||controller.signal.aborted||error instanceof DOMException&&error.name==='AbortError')return;
        try{current();}catch{return;}
        if(error instanceof ApiError&&[401,403,404].includes(error.status)){
          discard(ownCommandId);
          if(error.status===401||error.status===403&&error.code==='WORKBENCH_CSRF_INVALID')await clearSessionAuthorization(client,principal.principal_id,error.status===401?401:403,'revoked');else await clearItemAuthorization(client,principal.principal_id,item.kind,item.id,error);
        }else if(error instanceof ApiError&&error.status>=400&&error.status<500)discard(ownCommandId);
        // UNKNOWN survives until another real foreground observation checks this same intent.
        receiptChecked=true;
      }finally{busy=false;}
    };
    const onChange=()=>{void observe();};
    const intersection=new IntersectionObserver(onChange,{threshold:[0,1]});intersection.observe(element);
    document.addEventListener('visibilitychange',onChange);window.addEventListener('focus',onChange);window.addEventListener('blur',onChange);window.addEventListener('scroll',onChange,true);window.addEventListener('resize',onChange);
    onChange();
    return()=>{disposed=true;controller.abort();intersection.disconnect();document.removeEventListener('visibilitychange',onChange);window.removeEventListener('focus',onChange);window.removeEventListener('blur',onChange);window.removeEventListener('scroll',onChange,true);window.removeEventListener('resize',onChange);};
  },[client,principal.principal_id,principal.authorization_revision,principal.expires_epoch_ms,principal.personal_read_enabled,principal.csrf_token,item.kind,item.id,sourceRef,revision,text]);
  return <p ref={node} data-personal-read-ref={text?.trim()?sourceRef:undefined} data-personal-read-revision={text?.trim()?revision:undefined}>{text??'当前没有可展示的文本内容。'}</p>;
}
