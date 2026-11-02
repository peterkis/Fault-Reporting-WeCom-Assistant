import {createContext,useCallback,useContext,useEffect,useId,useMemo,useState} from 'react';
import type {ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Button} from '../Button/Button';
import {DrawerMoreActions} from './Drawer';

type Entry={id:string;action:string};
export type StepReadState='pending'|'unknown'|'ready';
type Scope={entries:Entry[];register:(entry:Entry)=>()=>void;targets:(HTMLDivElement|null)[];primary:string|undefined;label:(action:string,fallback:string)=>string};
const Context=createContext<Scope|null>(null);
const orders:Record<string,string[]>={
  NEW:['take','assign'],QUEUED:['take','assign'],REOPENED:['take','assign'],ACCEPTED:['take','assign','return'],
  IN_PROGRESS:['complete','request-information','assign','wait-vendor'],
  WAITING_REQUESTER:['resume','follow-up'],WAITING_VENDOR:['resume','follow-up'],
  RESOLVED:['reopen'],CLOSED:['reopen'],PENDING:['review'],
};

/** Only arranges entries already admitted by their original command owners. */
export function NextStep({status,stage,summary,readState,children}:{status:string;stage:string;summary:string;readState:StepReadState;children:ReactNode}){
  const [entries,setEntries]=useState<Entry[]>([]),[main,setMain]=useState<HTMLDivElement|null>(null),[secondary,setSecondary]=useState<HTMLDivElement|null>(null),[more,setMore]=useState<HTMLDivElement|null>(null);
  const register=useCallback((entry:Entry)=>{setEntries(previous=>[...previous.filter(row=>row.id!==entry.id),entry]);return()=>setEntries(previous=>previous.filter(row=>row.id!==entry.id));},[]);
  const order=orders[status]??[],rank=(entry:Entry)=>{const index=order.indexOf(entry.action);return index<0?order.length:index;};
  const sorted=[...entries].sort((a,b)=>rank(a)-rank(b)),primary=sorted[0]?.id;
  const label=useCallback((action:string,fallback:string)=>action==='take'?(status==='ACCEPTED'?'开始处理':'领取并开始'):fallback,[status]);
  const scope=useMemo(()=>({entries:sorted,register,targets:[main,secondary,more],primary,label}),[entries,register,main,secondary,more,primary,label,status]);
  return <Context.Provider value={scope}>
    <section className="ds-next-step" data-stage={stage} aria-label="下一步">
      <div className="ds-next-step-copy"><h3>下一步</h3><p>{summary}</p>{!entries.length?<small>{readState==='pending'?'正在核对可用操作…':readState==='unknown'?'可用操作暂未确认，请刷新或选择复核项':'你当前为只读'}</small>:null}</div>
      <div className="ds-next-step-actions"><div ref={setMain}/><div className="ds-next-step-secondary" ref={setSecondary}/><DrawerMoreActions label="更多处理操作"><div ref={setMore}/></DrawerMoreActions></div>
    </section>
    <div className="ds-step-controllers">{children}</div>
  </Context.Provider>;
}

/** Moves the original button, never its command state, draft, or recovery owner. */
export function StepEntry({action,label,children,fallbackTone='secondary'}:{action:string;label:string;fallbackTone?:'primary'|'secondary';children:(tone:'primary'|'secondary',label:string)=>ReactNode}){
  const scope=useContext(Context),id=useId(),register=scope?.register;
  useEffect(()=>register?.({id,action}),[register,id,action]);
  if(!scope)return children(fallbackTone,label);
  const index=scope.entries.findIndex(entry=>entry.id===id),target=scope.targets[index===0?0:index<=2?1:2];
  return target?createPortal(children(scope.primary===id?'primary':'secondary',scope.label(action,label)),target):null;
}

/** Discloses an existing inline form without unmounting its protected state. */
export function StepWorkflow({action,label,available,attention=false,children}:{action:string;label:string;available:boolean;attention?:boolean;children:ReactNode}){
  const scope=useContext(Context),[open,setOpen]=useState(false),id=useId();
  if(!scope)return children;
  return <>
    {available?<StepEntry action={action} label={label}>{(tone,text)=><Button tone={tone} data-step-action={action} aria-expanded={open||attention} aria-controls={id} onPress={()=>setOpen(value=>!value)}>{text}</Button>}</StepEntry>:null}
    <div id={id} className="ds-step-workflow" hidden={!open&&!attention}>{children}</div>
  </>;
}

export function useNextStep(){return useContext(Context)!==null;}
