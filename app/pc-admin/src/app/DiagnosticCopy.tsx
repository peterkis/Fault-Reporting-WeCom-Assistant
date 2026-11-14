import {useRef,useState} from 'react';
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
  // Codex review: the feedback belongs to the text it copied; when the data changes it resets, and a late callback for older data
  // never shows against the current one.
  const text=JSON.stringify(data,null,2),[attempt,setAttempt]=useState<{text:string;outcome:'copied'|'failed'}|null>(null);
  const outcome=attempt?.text===text?attempt.outcome:'idle',sequence=useRef(0);
  const copy=()=>{
    const written=text,mine=++sequence.current,settle=(result:'copied'|'failed')=>{if(mine===sequence.current)setAttempt({text:written,outcome:result});},clipboard=typeof navigator==='undefined'?undefined:navigator.clipboard;
    if(!clipboard?.writeText){settle('failed');return;}
    clipboard.writeText(written).then(()=>settle('copied'),()=>settle('failed'));
  };
  return <span className="diagnostic-copy" data-diagnostic-copy={outcome}>
    <HButton type="button" data-action="copy-diagnostics" data-diagnostics={text} tone="ghost" onClick={copy}><Copy aria-hidden="true"/>复制诊断信息</HButton>
    {outcome==='copied'?<span role="status">已复制</span>:null}
    {outcome==='failed'?<><span role="status">无法自动复制，请选中下方内容手动复制。</span><HTextArea readOnly aria-label="诊断信息" className="diagnostic-copy-fallback" rows={4} value={text} onFocus={event=>event.currentTarget.select()}/></>:null}
  </span>;
}

/**
 * Codex review: the hint beside 「核对结果」 says what is actually known: a confirmed commit or failure (with its local draft still
 * to be cleared only when `cleanupPending`), otherwise an unconfirmed outcome. Callers that keep the operation only after a
 * failed cleanup use the default.
 */
export function operationHint(state:string,cleanupPending=true):string{
  const committed=state==='committed'||state==='succeeded';
  // Codex review: the draft is only said to be uncleared when its cleanup actually failed (a known result whose reading of the
  // current facts failed has not reached the cleanup yet).
  if(committed)return cleanupPending?'已提交，本机草稿还没清除完。点击「核对结果」再次清除。':'已提交。最新内容还没加载完，点击「核对结果」。';
  if(state==='failed')return cleanupPending?'上次操作没有成功，本机草稿还没清除完。点击「核对结果」再次清除。':'上次操作没有成功。点击「核对结果」查看最新内容。';
  return '上次操作的结果还没确认，点击「核对结果」。';
}
