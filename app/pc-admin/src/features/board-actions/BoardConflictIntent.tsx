import {WorkbenchButton as HButton} from '../../app/WorkbenchButton';
import {WorkbenchDisclosure} from "../../app/WorkbenchDisclosure";
import {useEffect,useRef,useState} from 'react';
import {captureWorkbenchRead} from '../../api/client';

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
    <WorkbenchDisclosure title={<>查看原 UUID、版本与完整命令</>}><pre>{JSON.stringify(original,null,2)}</pre></WorkbenchDisclosure>
    {failed?<p role="alert">新意图尚未开始，原操作与输入保留，请重新核对。</p>:null}
    <HButton type="button" data-action="adopt-current-board-facts" isDisabled={busy} onClick={()=>{void adopt();}} variant="secondary">明确读取当前事实，保留填写内容并开始新意图</HButton>
  </section>;
}
