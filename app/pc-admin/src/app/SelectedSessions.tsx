import {useRef} from 'react';
import {Button as HButton} from '../design/components/Button/Button';
import {shortCode} from './short-code';

type Row={session_id:string;conversation_principal_name?:string|null};
/**
 * Codex review (card 34C): every selected session is listed, including those on another page, with its code, its colleague when its
 * page was seen, the full number on request and a way to cancel it, so a cross-page choice can be checked before it is sent.
 */
export function useSeenSessions(){
  const seen=useRef(new Map<string,string>());
  const remember=(rows:readonly Row[]|undefined)=>{for(const row of rows??[])seen.current.set(row.session_id,row.conversation_principal_name??'尚未分配沟通人');};
  return {seen,remember};
}
export function SelectedSessions({selected,page,seen,fullShown,disabled,onCancel}:{selected:readonly string[];page:readonly Row[];seen:Map<string,string>;fullShown:boolean;disabled:boolean;onCancel:(id:string)=>void}){
  if(!selected.length)return null;
  const ids=[...page.map(row=>row.session_id),...selected,...seen.keys()];
  return <ul className="selected-sessions">{selected.map(id=>{
    const onPage=page.find(row=>row.session_id===id),code=shortCode(id,ids),name=onPage?onPage.conversation_principal_name??'尚未分配沟通人':seen.get(id);
    const label='已选：会话尾号 '+code+(onPage?'':'（不在当前列表）')+(name?' · '+name:'');
    return <li key={id} title={'会话编号 '+id}>{label}{fullShown?<small className="full-number"> · 会话编号 {id}</small>:null}<HButton type="button" aria-label={'取消选择：'+label} isDisabled={disabled} onClick={()=>onCancel(id)} tone="secondary">取消选择</HButton></li>;
  })}</ul>;
}
