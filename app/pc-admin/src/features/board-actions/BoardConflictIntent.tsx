import {Button as HButton} from '../../design/components/Button/Button';
import {useEffect,useRef,useState} from 'react';
import {captureWorkbenchRead} from '../../api/client';
import {DiagnosticCopy} from '../../app/DiagnosticCopy';

/**
 * Codex review: only the fields that identify the operation are copied (its number, the version it was submitted against and
 * the action), never the command body: a completion carries internal-only text and the public summary.
 */
function boardDiagnostics(original:unknown):Record<string,unknown>{
  const outer=original&&typeof original==='object'?original as Record<string,unknown>:{},inner=outer.command&&typeof outer.command==='object'?outer.command as Record<string,unknown>:outer;
  const pick=(value:unknown)=>typeof value==='string'||typeof value==='number'?value:null;
  return {operation_id:pick(inner.client_command_id),expected_version:pick(inner.expected_version??inner.expected_row_version),action:pick(outer.action)};
}
/** The original feature controller owns this immutable command and its purpose. */
export function BoardConflictIntent({original,onAdopt}:{original:unknown;onAdopt:(current:()=>boolean)=>void|Promise<void>}){
  const generation=useRef(0),request=useRef<AbortController|null>(null),active=useRef(false);
  const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
  useEffect(()=>{active.current=false;setBusy(false);setFailed(false);return()=>{generation.current++;request.current?.abort();};},[original]);
  const adopt=async()=>{
    if(active.current)return;active.current=true;setBusy(true);setFailed(false);
    const controller=new AbortController(),token=++generation.current;request.current?.abort();request.current=controller;
    try{const check=captureWorkbenchRead(controller.signal);const current=()=>{if(controller.signal.aborted||token!==generation.current)return false;try{check();return true;}catch{return false;}};if(current())await onAdopt(current);}
    catch{if(!controller.signal.aborted&&token===generation.current)setFailed(true);}
    finally{if(token===generation.current){active.current=false;if(!controller.signal.aborted)setBusy(false);}}
  };
  return <section className="board-conflict-intent" data-board-original-intent>
    <p role="alert">原操作冲突，完整原意图保留。未自动发送，也未按拖动目标移动事项。</p>
    {/* Card 34C: the original operation is diagnostics; it is copied on request, not shown in the body. */}
    <DiagnosticCopy data={boardDiagnostics(original)}/>
    {failed?<p role="alert">新意图尚未开始，原操作与输入保留，请重新核对。</p>:null}
    <HButton type="button" data-action="adopt-current-board-facts" isDisabled={busy} onClick={()=>{void adopt();}} tone="secondary">明确读取当前事实，保留填写内容并开始新意图</HButton>
  </section>;
}
