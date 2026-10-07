import {useEffect,useRef,useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {ApiError,errorMessage} from '../../api/client';
import {attachmentApi} from './client';
import type {AttachmentMetadata,AttachmentReason} from '../../../../../contracts/workbench_attachment_contracts';
const labels:Record<AttachmentReason,string>={STORAGE_UNAVAILABLE:'附件存储暂不可用',EXPIRED:'附件已超过保留期限',MISSING:'已保存文件缺失',OVERSIZED:'附件超过10 MiB限制',UNSUPPORTED:'此文件格式不可用',UNTRUSTED:'附件尚未通过可信检查',INTEGRITY_FAILED:'附件完整性校验失败',BUSY:'附件读取正忙，请稍后重新读取'};
function message(error:unknown):string {if(error instanceof ApiError){const reason=error.code.replace('ATTACHMENT_','');if(Object.hasOwn(labels,reason))return labels[reason as AttachmentReason];if(error.code==='ATTACHMENT_NOT_FOUND')return '该附件已不可读取，请重新读取附件列表。';if(error.code==='ATTACHMENT_TIMEOUT')return '附件读取超时，请重新读取。';if(error.code==='INVALID_RESPONSE')return '附件响应无法安全识别。';}return errorMessage(error);}
export function AttachmentSection({principal,kind,id}:{principal:string;kind:string;id:string}){
  const client=useQueryClient(),request=useRef<AbortController|null>(null),url=useRef<string|null>(null),alive=useRef(false),[status,setStatus]=useState('');
  const queryKey=['attachments',principal,kind,id];
  const result=useQuery({queryKey,queryFn:({signal})=>attachmentApi.list(kind,id,signal)});
  const revoke=()=>{if(url.current){URL.revokeObjectURL(url.current);url.current=null;}};
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current?.abort();revoke();};},[]);
  const mutation=useMutation({mutationKey:['attachment-download',principal,kind,id],mutationFn:async(item:AttachmentMetadata)=>{
    const controller=new AbortController();request.current=controller;const timer=window.setTimeout(()=>controller.abort(),15_000);
    try{const blob=await attachmentApi.download(kind,id,item,controller.signal);controller.signal.throwIfAborted();if(!alive.current)return;
      url.current=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url.current;link.download='report-attachment.'+(item.mime_type==='image/png'?'png':'jpg');link.rel='noopener';document.body.append(link);
      try{link.click();}finally{link.remove();revoke();}
    }finally{window.clearTimeout(timer);if(request.current===controller)request.current=null;}
  },onSuccess:()=>{if(alive.current)setStatus('已交给浏览器下载。');},onError:error=>{if(alive.current){setStatus(message(error));void client.invalidateQueries({queryKey,exact:true});}}});
  return <section className="attachment-section" aria-label="报修附件"><h3>报修附件</h3>
    {result.isPending?<p role="status">正在读取附件信息…</p>:result.isError?<p role="status">{message(result.error)}</p>:!result.data.available?<p>{labels.STORAGE_UNAVAILABLE}，当前无法读取原始文件。</p>:!result.data.items.length?<p>当前事项没有可读取的已保存附件。</p>:<ul>{result.data.items.map(item=><li key={item.ref}><span>{item.display_name}<small>{(item.byte_size/1024).toFixed(1)} KiB · {item.mime_type}</small>{item.reason?<small>{labels[item.reason]}</small>:null}</span><button type="button" disabled={!item.available||mutation.isPending} onClick={()=>{if(request.current)return;setStatus('正在安全读取附件…');mutation.mutate(item);}}>下载</button></li>)}</ul>}
    {result.data?.truncated?<p>当前仅显示前20个已关联附件。</p>:null}
    <p role="status" aria-live="polite">{status}</p><button type="button" disabled={result.isFetching||mutation.isPending} onClick={()=>{setStatus('');void result.refetch();}}>重新读取附件</button>
  </section>;
}
