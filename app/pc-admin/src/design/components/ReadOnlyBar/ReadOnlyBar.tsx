import {createContext,useCallback,useContext,useId,useLayoutEffect,useMemo,useState} from 'react';
import type {ReactNode} from 'react';
import {CircleCheck,CircleX,Clock3,Eye,Lock} from 'lucide-react';
import {Button} from '../Button/Button';
import type {ButtonProps} from '../Button/Button';
import './read-only-bar.css';

export type ReadOnlyReason='permission'|'assigned'|'completed'|'dismissed'|'pending';
export function readOnlyReason(facts:{denied:boolean;assignedName?:string|undefined;completed:boolean;dismissed:boolean;pending:boolean}):ReadOnlyReason|null{
  return facts.denied?'permission':facts.assignedName?'assigned':facts.completed?'completed':facts.dismissed?'dismissed':facts.pending?'pending':null;
}
export function readOnlyCopy(reason:ReadOnlyReason,name?:string){
  return reason==='permission'?{title:'只能查看',reason:'你的账号没有处理这类工单的权限'}:reason==='assigned'?{title:'只能查看',reason:(name??'处理人')+'已接手这张工单'}:reason==='completed'?{title:'已完成',reason:'如需继续处理，先重开'}:reason==='dismissed'?{title:'已关闭',reason:'如需继续处理，先恢复'}:{title:'暂时只能查看',reason:'上次操作的结果还在确认'};
}
export function ReadOnlyBar({reason,name,action}:{reason:ReadOnlyReason;name?:string|undefined;action?:ReactNode}){
  const copy=readOnlyCopy(reason,name),Icon=reason==='permission'?Eye:reason==='completed'?CircleCheck:reason==='dismissed'?CircleX:reason==='pending'?Clock3:Lock;
  return <div className="ds-read-only-bar" data-readonly-reason={reason} role="status"><Icon aria-hidden="true"/><div className="ds-read-only-copy"><strong>{copy.title}</strong><span> · {copy.reason}</span></div>{action?<div className="ds-read-only-action">{action}</div>:null}</div>;
}
export function ReadOnlyBadge(){return <span className="ds-read-only-badge"><Lock aria-hidden="true"/>只读</span>;}
/** Unavailable action stays reachable; the command's owner still decides availability. */
export function ReadOnlyButton({reason,children,...props}:Omit<ButtonProps,'isDisabled'>&{reason:string}){
  return <Button {...props} isDisabled disabledReason={reason}>{children}</Button>;
}
export function ReadOnlyNote({reason}:{reason:string}){
  return <div className="ds-read-only-note"><Lock aria-hidden="true"/><textarea aria-label="内部备注" aria-disabled="true" readOnly placeholder="只读时不能添加内部备注"/><ReadOnlyButton reason={reason} size="sm">保存</ReadOnlyButton></div>;
}

type PendingScope={pending:boolean;report:(id:string,unknown:boolean)=>()=>void};
const PendingContext=createContext<PendingScope|null>(null);
/** Observe original controllers' UNKNOWN presentation; never infer it from navigation blocking or dirty input. */
export function ReadOnlyOperationProvider({children}:{children:ReactNode}){
  const [sources,setSources]=useState<Record<string,boolean>>({});
  const report=useCallback((id:string,unknown:boolean)=>{setSources(current=>current[id]===unknown?current:{...current,[id]:unknown});return()=>setSources(current=>{const next={...current};delete next[id];return next;});},[]);
  const value=useMemo(()=>({pending:Object.values(sources).some(Boolean),report}),[sources,report]);
  return <PendingContext.Provider value={value}>{children}</PendingContext.Provider>;
}
export const useReadOnlyOperation=()=>useContext(PendingContext)?.pending??false;
export function useReportReadOnlyOperation(source:string,state:string|undefined){
  const scope=useContext(PendingContext),id=useId(),report=scope?.report;
  useLayoutEffect(()=>report?.(id,source.startsWith('ticket-')&&(state==='unknown'||state==='checking')),[report,id,source,state]);
}
