import {useEffect,useRef,useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {Button} from '@heroui/react/button';
import {api,ApiError,errorMessage,workbenchTransportWritable} from '../../api/client';
import type {Principal} from '../../api/client';
import type {SourceGroupDisplay,SourceGroupNameCommand} from '../../../../../contracts/web01_workbench_contracts';
import {clearSourceGroupAuthorization} from './authority';
type SaveState='idle'|'submitting'|'checking'|'succeeded'|'conflict'|'denied'|'unknown';
export function GroupNameEditor({group,principal,onSaved,onDenied,onBlockedChange}:{group:SourceGroupDisplay;principal:Principal;onSaved?:(group:SourceGroupDisplay)=>void;onDenied?:(error:ApiError)=>void;onBlockedChange?:(blocked:boolean)=>void}){
  // Only entry, success, or explicit adoption changes the edit basis. Refetch never authorizes overwriting a newer name.
  const [basis,setBasis]=useState(group),[name,setName]=useState(group.display_name??''),[state,setState]=useState<SaveState>('idle'),[message,setMessage]=useState('');
  const [pending,setPending]=useState<SourceGroupNameCommand|null>(null),[denied,setDenied]=useState(false),[reading,setReading]=useState(false);
  const client=useQueryClient(),request=useRef<AbortController|null>(null);
  const refresh=async()=>{await Promise.all([client.invalidateQueries({queryKey:['board',principal.principal_id]}),client.invalidateQueries({queryKey:['detail',principal.principal_id]}),client.invalidateQueries({queryKey:['source-groups',principal.principal_id]})]);};
  const refuse=(error:ApiError)=>{setPending(null);setState(error.status===409?'conflict':'denied');setMessage(error.status===409?'保存冲突：名称已保留。请核对并明确采用最新版本后再保存。':'保存被拒绝：'+errorMessage(error));
    if([401,403,404].includes(error.status)){setDenied(true);setName('');onDenied?.(error);}
  };
  const mutation=useMutation({mutationKey:['source-group-name',principal.principal_id,group.ref],
    mutationFn:({command,signal}:{command:SourceGroupNameCommand;signal:AbortSignal})=>api.saveGroupName(group.ref,command,principal.csrf_token,signal),
    onSuccess:async result=>{setPending(null);setBasis(result.group);setState('succeeded');setMessage(result.replayed?'已保存：已核对原操作结果。':'已保存群名称。');onSaved?.(result.group);await refresh();},
    onError:async(error,variables)=>{if(error instanceof ApiError){refuse(error);if(error.status===409)await refresh();if(error.code==='P2_016_DISABLED')void client.invalidateQueries({queryKey:['session']});}
      else{setPending(variables.command);setState('unknown');setMessage('结果未知：请求可能已保存。请核对原操作，原名称、版本和命令保持不变。');}},
    onSettled:()=>{request.current=null;},
  });
  const blocked=mutation.isPending||reading||state==='unknown';
  useEffect(()=>{onBlockedChange?.(blocked);return()=>onBlockedChange?.(false);},[blocked,onBlockedChange]);
  useEffect(()=>()=>{request.current?.abort();},[]);
  useEffect(()=>{if(!blocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[blocked]);
  const send=(command:SourceGroupNameCommand,checking:boolean)=>{
    if(!checking&&!workbenchTransportWritable()){setState('denied');setMessage('连接尚未完成事实核验，新名称尚未发送；输入和版本已保留，请重新读取。');return;}
    if(request.current)return;const controller=new AbortController();request.current=controller;setPending(command);setState(checking?'checking':'submitting');setMessage(checking?'正在核对原操作结果…':'正在保存群名称…');mutation.mutate({command,signal:controller.signal});
  };
  const adopt=async()=>{
    if(blocked||request.current)return;const controller=new AbortController();request.current=controller;setReading(true);
    try{const page=await api.sourceGroups(group.ref,null,controller.signal),current=page.items.find(item=>item.ref===group.ref);
      if(!current){if(page.next_cursor)throw new Error('SOURCE_GROUP_LOOKUP_BOUNDED');throw new ApiError(404,'P2_016_NOT_FOUND');}
      setBasis(current);setPending(null);setState('idle');setMessage('已采用当前群资料版本；输入名称仍保留，请确认后保存。');onSaved?.(current);
    }catch(error){if(error instanceof ApiError&&[401,403,404].includes(error.status)){await clearSourceGroupAuthorization(client,principal.principal_id,error);refuse(error);}else{setState('conflict');setMessage('当前群资料读取失败，输入和原版本已保留，请重新核对。');}}
    finally{request.current=null;setReading(false);}
  };
  const value=name.trim(),valid=value.length>0&&[...value].length<=128&&!/[\u0000-\u001f\u007f]/u.test(value),versionAvailable=BigInt(basis.row_version)<9223372036854775807n;
  return <section className="source-group-editor">
    {!denied?<form className="source-group-form" aria-label="维护来源群名称" onSubmit={event=>{event.preventDefault();if(blocked||state==='conflict'||!valid||!versionAvailable||value===basis.display_name)return;send(Object.freeze({client_command_id:crypto.randomUUID(),expected_row_version:basis.row_version,display_name:value}),false);}}>
      <p hidden className="source-group-version">编辑依据版本 {basis.row_version}</p>
      <label>来源群名称<input name="source-group-name" value={name} required maxLength={256} disabled={blocked} onChange={event=>setName(event.target.value)}/><span>{[...value].length} / 128</span></label>
      <Button type="submit" data-action="save-source-group-name" variant="secondary" isDisabled={blocked||state==='conflict'||!valid||!versionAvailable||value===basis.display_name}>{state==='submitting'?'正在保存…':'保存群名称'}</Button>
      {state==='unknown'&&pending?<button type="button" data-action="check-source-group-name" disabled={mutation.isPending} onClick={()=>send(pending,true)}>核对保存结果</button>:null}
      {!blocked?<button type="button" data-action="refresh-source-group" onClick={()=>{void adopt();}}>重新读取并采用最新版本</button>:null}
      <p>群名称由管理员确认，用于该群报修事项的来源展示。</p>
      {group.row_version!==basis.row_version?<p>目录资料已更新；编辑仍依据版本 {basis.row_version}，不会自动采用新版本。</p>:null}
      {!versionAvailable?<p role="alert">群资料版本已达到维护上限。</p>:null}
    </form>:null}
    {message?<p className="source-group-save-state" role={['conflict','denied','unknown'].includes(state)?'alert':'status'}>{message}</p>:null}
  </section>;
}
