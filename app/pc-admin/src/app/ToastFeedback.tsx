import {WorkbenchButton as HButton} from './WorkbenchButton';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import type {HTMLAttributes,SetStateAction} from 'react';
import {createPortal} from 'react-dom';
import {useLocation} from 'react-router';
import toast,{resolveValue,useToaster} from 'react-hot-toast/headless';
import {Check,CheckCircle2,Info,LoaderCircle,TriangleAlert,X} from 'lucide-react';

const loadingStates=new Set(['loading','reading','preparing','submitting','checking','sending','saving']);
const successStates=new Set(['succeeded','success','committed']);
const errorStates=new Set(['failed','error','denied','conflict','invalid']);
const labels:Record<string,string>={'ticket-assignment':'派单','ticket-self-handling':'接单','ticket-conversation-handling':'接单','ticket-completion':'完工','ticket-notes':'内部备注','ticket-reopen':'重新打开工单','ticket-unassign':'解除分派','ticket-takeover':'接管工单','ticket-takeover-completion':'接管与完工','ticket-return-to-dispatch':'退回调度','ticket-waiting-cancel':'取消工单','ticket-waiting-request-information':'等待补充','ticket-waiting-wait-vendor':'等待厂商','ticket-waiting-resume':'恢复处理','web-report':'公开进度','attachments':'报修资料','item-follow':'关注','board-actions':'看板操作','manual-report':'登记报修','manual-review':'报修复核','conversations':'会话操作','source-groups':'来源群','reminders':'提醒设置','supplement-follow-up':'补充材料','follow-up':'跟进安排','incident-candidates':'公共故障','draft':'恢复状态'};

export function clearWorkbenchToasts(){toast.remove();}
export function useFeedbackState(initial=''){
  const [value,setValue]=useState({text:initial,revision:0});
  const update=useCallback((next:SetStateAction<string>)=>setValue(previous=>({text:typeof next==='function'?next(previous.text):next,revision:previous.revision+1})),[]);
  return [value.text,update,value.revision] as const;
}
interface FeedbackProps extends Omit<HTMLAttributes<HTMLDivElement>,'children'> {children:string|null|undefined;source:string;state?:string|undefined;enabled?:boolean|undefined;persistent?:boolean|undefined;revision?:number|undefined}

/** Presentation only: a close button never settles, retries or discards an operation. */
export function ToastFeedback({children,source,state,enabled=true,persistent=false,revision,role,'aria-live':live,...attributes}:FeedbackProps){
  const id=useId(),latest=useRef(attributes);latest.current=attributes;
  useEffect(()=>{
    if(!enabled||!children){toast.remove(id);return;}
    const unknown=state==='unknown',loading=loadingStates.has(state??''),success=successStates.has(state??''),error=!unknown&&(role==='alert'||errorStates.has(state??''));
    const show=()=>{
      const content=<div {...latest.current} className={'workbench-toast-content '+(latest.current.className??'')} data-toast-source={source} data-toast-state={state??''}><strong className="workbench-toast-purpose">{labels[source]??'操作提示'}</strong><span>{children}</span></div>;
      const options={id,duration:unknown||persistent||loading?Infinity:success?4500:error?8500:6000,removeDelay:180,className:unknown?'is-warning':'',ariaProps:{role:error?'alert' as const:'status' as const,'aria-live':live??(error?'assertive' as const:'polite' as const)}};
      if(loading)toast.loading(content,options);else if(success)toast.success(content,options);else if(error)toast.error(content,options);else toast(content,options);
    };
    if(loading){toast.remove(id);const timer=window.setTimeout(show,200);return()=>window.clearTimeout(timer);}
    show();
  },[children,source,state,enabled,persistent,revision,role,live,id]);
  useEffect(()=>()=>{toast.remove(id);},[id]);
  return null;
}

/** Routine autosave is an accessible status, not another notification on every keystroke. */
export function DraftFeedback({children,enabled=true}:{children:string;enabled?:boolean}){
  const warning=/未知|过期|失败|不可用|无法|未确认|须核对|只能只读/u.test(children);
  return <ToastFeedback source="draft" state={warning?'unknown':undefined} enabled={enabled&&(warning||/已恢复/u.test(children))}>{children}</ToastFeedback>;
}

export function DraftStatus({children,notify=true,...attributes}:Omit<HTMLAttributes<HTMLSpanElement>,'children'> & {children:string;notify?:boolean}){
  const warning=/未知|过期|失败|不可用|无法|未确认|须核对|只能只读/u.test(children);
  return <><span {...attributes} role="img" aria-label={children} title={children} className="workbench-draft-status">{warning?<TriangleAlert size={13}/>:/^已保存|^已提交/u.test(children)?<Check size={13}/>:<Info size={13}/>}<span className="sr-only">{children}</span></span>{notify?<DraftFeedback>{children}</DraftFeedback>:null}</>;
}

export function WorkbenchToasts(){
  const {toasts,handlers}=useToaster(),location=useLocation();
  useEffect(()=>{if(!toasts.length)handlers.endPause();},[toasts.length,handlers.endPause]);
  const [target,setTarget]=useState<HTMLElement>(document.body),priorFocus=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    const update=()=>{
      const focused=document.activeElement?.closest<HTMLElement>('[data-workbench-overlay]');
      const next=focused?.isConnected&&!focused.closest('[aria-hidden="true"],[data-exiting]')?focused:Array.from(document.querySelectorAll<HTMLElement>('[data-workbench-overlay]')).filter(element=>!element.closest('[aria-hidden="true"],[data-exiting]')).at(-1)??document.body;
      setTarget(previous=>previous===next?previous:next);
    };
    update();const observer=new MutationObserver(update);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-hidden','data-exiting']});document.addEventListener('focusin',update);
    return()=>{observer.disconnect();document.removeEventListener('focusin',update);};
  },[]);
  useEffect(()=>{clearWorkbenchToasts();},[location.pathname,location.search]);
  const dismiss=(id:string,button:HTMLElement)=>{
    if(document.activeElement===button){const previous=priorFocus.current;if(previous?.isConnected&&previous.checkVisibility()&&!previous.matches(':disabled'))previous.focus({preventScroll:true});else target.querySelector<HTMLElement>('h2[tabindex]')?.focus({preventScroll:true});}
    toast.dismiss(id);
  };
  return createPortal(<div className="workbench-toast-viewport" aria-label="操作提示" data-workbench-toasts onMouseEnter={handlers.startPause} onMouseLeave={handlers.endPause} onFocusCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget)){priorFocus.current=event.relatedTarget instanceof HTMLElement?event.relatedTarget:null;}handlers.startPause();}} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))handlers.endPause();}}>
    {toasts.map(item=><div key={item.id} className={'workbench-toast '+item.type+' '+(item.className??'')} data-toast-id={item.id} data-visible={item.visible} aria-hidden={!item.visible} {...item.ariaProps}>
      <span className="workbench-toast-icon" aria-hidden="true">{item.type==='loading'?<LoaderCircle size={19}/>:item.type==='success'?<CheckCircle2 size={19}/>:item.type==='error'||item.className==='is-warning'?<TriangleAlert size={19}/>:<Info size={19}/>}</span>
      {resolveValue(item.message,item)}<HButton type="button" className="workbench-toast-close" aria-label="关闭提示" isDisabled={item.type==='loading'} tabIndex={item.visible&&item.type!=='loading'?0:-1} onMouseDown={event=>event.preventDefault()} onClick={event=>{if(event.currentTarget instanceof HTMLElement)dismiss(item.id,event.currentTarget);}} variant="secondary"><X size={16}/></HButton>
    </div>)}
  </div>,target);
}
