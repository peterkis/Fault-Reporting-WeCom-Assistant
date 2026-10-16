import {useEffect,useRef} from 'react';
import {captureWorkbenchRead} from '../../api/client';

/** The original feature controller owns this immutable command and its purpose. */
export function BoardConflictIntent({original,onAdopt}:{original:unknown;onAdopt:(current:()=>boolean)=>void}){
  const generation=useRef(0),request=useRef<AbortController|null>(null);
  useEffect(()=>()=>{generation.current++;request.current?.abort();},[original]);
  const adopt=()=>{const controller=new AbortController(),token=++generation.current;request.current?.abort();request.current=controller;const check=captureWorkbenchRead(controller.signal);onAdopt(()=>{if(controller.signal.aborted||token!==generation.current)return false;try{check();return true;}catch{return false;}});};
  return <section className="board-conflict-intent" data-board-original-intent>
    <p role="alert">原操作冲突，完整原意图保留。未自动发送，也未按拖动目标移动事项。</p>
    <details><summary>查看原 UUID、版本与完整命令</summary><pre>{JSON.stringify(original,null,2)}</pre></details>
    <button type="button" data-action="adopt-current-board-facts" onClick={adopt}>明确读取当前事实，保留填写内容并开始新意图</button>
  </section>;
}
