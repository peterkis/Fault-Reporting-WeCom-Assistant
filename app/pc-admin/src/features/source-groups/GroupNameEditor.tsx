import {Button as HButton} from '../../design/components/Button/Button';
import {Form as HForm,Input as HInput,Label as HLabel} from "@heroui/react";
import {ToastFeedback,useFeedbackState} from '../../app/ToastFeedback';
import {useEffect,useRef,useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {Button} from '../../design/components/Button/Button';
import {api,ApiError,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal} from '../../api/client';
import type {SourceGroupDisplay,SourceGroupNameCommand} from '../../../../../contracts/web01_workbench_contracts';
import {clearSourceGroupAuthorization} from './authority';
type SaveState='idle'|'submitting'|'checking'|'succeeded'|'conflict'|'denied'|'unknown';
export function GroupNameEditor({group,principal,onSaved,onDenied,onBlockedChange,tone='primary'}:{group:SourceGroupDisplay;principal:Principal;onSaved?:(group:SourceGroupDisplay)=>void;onDenied?:(error:ApiError)=>void;onBlockedChange?:(blocked:boolean)=>void;tone?:'primary'|'secondary'}){
  // Only entry, success, or explicit adoption changes the edit basis. Refetch never authorizes overwriting a newer name.
  const [basis,setBasis]=useState(group),[name,setName]=useState(group.display_name??''),[state,setState]=useState<SaveState>('idle'),[message,setMessage,messageRevision]=useFeedbackState('');
  const [pending,setPending]=useState<SourceGroupNameCommand|null>(null),[denied,setDenied]=useState(false),[reading,setReading]=useState(false);
  const client=useQueryClient(),request=useRef<AbortController|null>(null);
  const refresh=async()=>{await Promise.all([client.invalidateQueries({queryKey:['board',principal.principal_id]}),client.invalidateQueries({queryKey:['detail',principal.principal_id]}),client.invalidateQueries({queryKey:['source-groups',principal.principal_id]})]);};
  const refuse=(error:ApiError)=>{setPending(null);setState(error.status===409?'conflict':'denied');setMessage(error.status===409?'名称已被他人修改：你的输入还在，查看最新名称后再保存。':'保存被拒绝：'+errorMessage(error));
    if([401,403,404].includes(error.status)){setDenied(true);setName('');onDenied?.(error);}
  };
  const mutation=useMutation({mutationKey:['source-group-name',principal.principal_id,group.ref],
    mutationFn:({command,signal}:{command:SourceGroupNameCommand;signal:AbortSignal})=>api.saveGroupName(group.ref,command,principal.csrf_token,signal),
    onSuccess:async result=>{setPending(null);setBasis(result.group);setState('succeeded');setMessage(result.replayed?'已保存：已核对原操作结果。':'已保存群名称。');onSaved?.(result.group);await refresh();},
    onError:async(error,variables)=>{if(error instanceof ApiError){refuse(error);if(error.status===409)await refresh();if(error.code==='P2_016_DISABLED')void client.invalidateQueries({queryKey:['session']});}
      else{setPending(variables.command);setState('unknown');setMessage('结果未确认：网络中断，暂不确定是否已提交。点击「核对结果」，不要重复提交。');}},
    onSettled:()=>{request.current=null;},
  });
  const blocked=mutation.isPending||reading||state==='unknown';
  useEffect(()=>{onBlockedChange?.(blocked);return()=>onBlockedChange?.(false);},[blocked,onBlockedChange]);
  useEffect(()=>()=>{request.current?.abort();},[]);
  useEffect(()=>{if(!blocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[blocked]);
  const send=(command:SourceGroupNameCommand,checking:boolean)=>{
    if(!checking&&!workbenchTransportWritable()){setState('denied');setMessage('网络未就绪：网络恢复前不会提交，你的输入已保留。');return;}
    if(request.current)return;const controller=new AbortController();request.current=controller;setPending(command);setState(checking?'checking':'submitting');setMessage(checking?'正在核对原操作结果…':'正在保存群名称…');mutation.mutate({command,signal:controller.signal});
  };
  const adopt=async()=>{
    if(blocked||request.current)return;const controller=new AbortController();request.current=controller;setReading(true);
    try{const page=await api.sourceGroups(group.ref,null,controller.signal),current=page.items.find(item=>item.ref===group.ref);
      if(!current){if(page.next_cursor)throw new Error('SOURCE_GROUP_LOOKUP_BOUNDED');throw new ApiError(404,'P2_016_NOT_FOUND');}
      setBasis(current);setPending(null);setState('idle');setMessage('已更新为最新资料，你输入的名称还在。');onSaved?.(current);
    }catch(error){if(error instanceof ApiError&&[401,403,404].includes(error.status)){await clearSourceGroupAuthorization(client,principal.principal_id,error);refuse(error);}else{setState('conflict');setMessage('群资料读取失败，输入已保留。点击重试。');}}
    finally{request.current=null;setReading(false);}
  };
  const value=name.trim(),valid=value.length>0&&[...value].length<=128&&!/[\u0000-\u001f\u007f]/u.test(value),versionAvailable=BigInt(basis.row_version)<9223372036854775807n;
  return <section className="source-group-editor">
    {!denied?<HForm className="source-group-form" aria-label="维护来源群名称" onSubmit={event=>{event.preventDefault();if(blocked||state==='conflict'||!valid||!versionAvailable||value===basis.display_name)return;send(Object.freeze({client_command_id:crypto.randomUUID(),expected_row_version:basis.row_version,display_name:value}),false);}}><p hidden className="source-group-version">编辑依据版本 {basis.row_version}</p><HLabel>来源群名称<HInput name="source-group-name" value={name} required maxLength={256} disabled={blocked} onChange={event=>setName(event.target.value)}/><span>{[...value].length} / 128</span></HLabel><Button type="submit" data-action="save-source-group-name" tone={tone} isDisabled={blocked||state==='conflict'||!valid||!versionAvailable||value===basis.display_name}>{state==='submitting'?'正在保存…':'保存群名称'}</Button>{state==='unknown'&&pending?<HButton type="button" data-action="check-source-group-name" isDisabled={mutation.isPending} onClick={()=>send(pending,true)} tone="secondary">重新提交</HButton>:null}{!blocked?<HButton type="button" data-action="refresh-source-group" onClick={()=>{void adopt();}} tone="secondary">使用最新内容</HButton>:null}<p>群名称由管理员确认，用于该群报修事项的来源展示。</p>{group.row_version!==basis.row_version?<p>群资料已更新，你的输入还在。点击「使用最新内容」后再保存。</p>:null}{!versionAvailable?<p role="alert">这个群的名称已修改太多次，暂时不能再改。</p>:null}</HForm>:null}
    {message?<ToastFeedback revision={messageRevision} source="source-groups" state={state} className="source-group-save-state" role={['conflict','denied','unknown'].includes(state)?'alert':'status'}>{message}</ToastFeedback>:null}
  </section>;
}
