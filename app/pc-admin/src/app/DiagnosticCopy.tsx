import {useState} from 'react';
import {Copy} from 'lucide-react';
import {TextArea as HTextArea} from '@heroui/react';
import {Button as HButton} from '../design/components/Button/Button';

/**
 * Card 34C: facts that only help troubleshooting (the original operation number, the version a form was filled against) stay out
 * of the visible copy. They are copied on request, and kept on `data-diagnostics` so tests and support can still read them.
 * Codex review: without a clipboard (missing API, denied permission) the button says so and shows the same text, read-only and
 * selectable, for copying by hand.
 */
export function DiagnosticCopy({data}:{data:Record<string,unknown>}){
  const text=JSON.stringify(data,null,2),[outcome,setOutcome]=useState<'idle'|'copied'|'failed'>('idle');
  const copy=()=>{
    const clipboard=typeof navigator==='undefined'?undefined:navigator.clipboard;
    if(!clipboard?.writeText){setOutcome('failed');return;}
    clipboard.writeText(text).then(()=>setOutcome('copied'),()=>setOutcome('failed'));
  };
  return <span className="diagnostic-copy" data-diagnostic-copy={outcome}>
    <HButton type="button" data-action="copy-diagnostics" data-diagnostics={text} tone="ghost" onClick={copy}><Copy aria-hidden="true"/>复制诊断信息</HButton>
    {outcome==='copied'?<span role="status">已复制</span>:null}
    {outcome==='failed'?<><span role="status">无法自动复制，请选中下方内容手动复制。</span><HTextArea readOnly aria-label="诊断信息" className="diagnostic-copy-fallback" rows={4} value={text} onFocus={event=>event.currentTarget.select()}/></>:null}
  </span>;
}

/**
 * Codex review: the hint beside 「核对结果」 says what is actually known. After a confirmed commit (or a confirmed failure) only the
 * local draft is still to be cleared; otherwise the outcome itself is unconfirmed.
 */
export function operationHint(state:string):string{
  if(state==='committed'||state==='succeeded')return '已提交，本机草稿还没清除完。点击「核对结果」再次清除。';
  if(state==='failed')return '上次操作没有成功，本机草稿还没清除完。点击「核对结果」再次清除。';
  return '上次操作的结果还没确认，点击「核对结果」。';
}
