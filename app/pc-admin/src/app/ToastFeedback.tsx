import {WorkbenchButton as HButton} from './WorkbenchButton';
import {useCallback,useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import type {HTMLAttributes,SetStateAction} from 'react';
import {createPortal} from 'react-dom';
import {useLocation} from 'react-router';
import toast,{resolveValue,useToaster} from 'react-hot-toast/headless';
import {overflowToasts,toastDuration,toastHeading,toastTone} from './toast-policy';
import type {ToastTone} from './toast-policy';
import {Check,CircleCheck,CircleX,Info,LoaderCircle,TriangleAlert,X} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';

const loadingStates=new Set(['loading','reading','preparing','submitting','checking','sending','saving']);
const successStates=new Set(['succeeded','success','committed']);
const errorStates=new Set(['failed','error','denied','conflict','invalid']);

export function clearWorkbenchToasts(){toast.remove();}

type Box={left:number;top:number;right:number;bottom:number;width:number};
const viewportBox=():Box=>({left:0,top:0,right:window.innerWidth,bottom:window.innerHeight,width:window.innerWidth});
/** A transformed / filtered / contained ancestor becomes the containing block of a fixed element; offsets are measured from it. */
function containingBlock(element:HTMLElement):Box{
  for(let node=element.parentElement;node&&node!==document.documentElement;node=node.parentElement){
    const style=getComputedStyle(node),backdrop=style.getPropertyValue('backdrop-filter');
    if(style.transform!=='none'||style.perspective!=='none'||style.filter!=='none'||(backdrop!==''&&backdrop!=='none')
      ||/transform|perspective|filter/u.test(style.willChange)||/paint|layout|strict|content/u.test(style.contain)){const box=node.getBoundingClientRect();return {left:box.left,top:box.top,right:box.right,bottom:box.bottom,width:box.width};}
  }
  return viewportBox();
}
const shown=(element:Element)=>element instanceof HTMLElement&&element.checkVisibility()&&!element.closest('[aria-hidden="true"],[data-exiting]');
/** The declared detail container (drawer, full page or closing dialog) whose bottom-right corner the notices dock to. */
function toastHost(target:HTMLElement):HTMLElement|null{
  if(target.matches('[data-toast-host]'))return target;
  if(target!==document.body)return null;
  return Array.from(document.querySelectorAll<HTMLElement>('[data-toast-host]')).filter(host=>shown(host)&&!host.closest('[data-workbench-overlay]')).at(-1)??null;
}
/**
 * Card 32D: notices sit bottom-right of the window, or of the open detail container above its declared bottom input area
 * (`data-toast-avoid="bottom"`) and below its top control bar (`data-toast-avoid="top"`), so the toolbar, the composer and dialog
 * actions stay reachable even when a short window or several notices waiting to be closed limit the stack's height; the stack then
 * scrolls. Card 33: the scroll box keeps a transparent shadow gutter around the notices so their shadows are drawn whole. Positions
 * are written as CSS variables only when the target, a size or the notices change; nothing polls per frame.
 */
function useToastPlacement(viewport:HTMLDivElement|null,target:HTMLElement,count:number){
  useLayoutEffect(()=>{
    if(!viewport)return;
    let frame=0;
    const place=()=>{
      frame=0;
      const host=toastHost(target),screen=viewportBox(),narrow=window.matchMedia('(max-width: 640px)').matches;
      let left=narrow?12:screen.right-20-Math.min(400,screen.width-32),right=narrow?screen.right-12:screen.right-20,bottom=screen.bottom-20,top=screen.top+16;
      if(host){
        const box=host.getBoundingClientRect(),hostBottom=Math.min(box.bottom,screen.bottom),hostTop=Math.max(box.top,screen.top);
        const avoid=Array.from(host.querySelectorAll('[data-toast-avoid="bottom"]')).filter(shown).map(element=>element.getBoundingClientRect())
          .filter(area=>area.height>0&&area.top<hostBottom&&area.bottom>hostTop);
        bottom=avoid.length?Math.min(...avoid.map(area=>area.top))-12:hostBottom-16;
        const bars=Array.from(host.querySelectorAll('[data-toast-avoid="top"]')).filter(shown).map(element=>element.getBoundingClientRect())
          .filter(area=>area.height>0&&area.top<hostBottom&&area.bottom>hostTop);
        top=bars.length?Math.max(...bars.map(area=>area.bottom))+12:hostTop+16;
        if(!narrow){right=Math.min(box.right,screen.right)-16;left=right-Math.min(400,box.width-32,screen.width-32);}
      }
      const block=containingBlock(viewport),style=viewport.style;
      style.setProperty('--toast-right',Math.round(block.right-right)+'px');style.setProperty('--toast-left',Math.round(left-block.left)+'px');
      style.setProperty('--toast-bottom',Math.round(block.bottom-bottom)+'px');style.setProperty('--toast-width',Math.max(0,Math.round(right-left))+'px');
      style.setProperty('--toast-max-height',Math.max(0,Math.round(bottom-top))+'px');
      viewport.dataset.toastHosted=host?'true':'false';
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(place);};
    place();
    const resize=new ResizeObserver(schedule);resize.observe(document.documentElement);
    const host=toastHost(target);if(host){resize.observe(host);for(const area of host.querySelectorAll('[data-toast-avoid]'))resize.observe(area);}
    const mutation=new MutationObserver(schedule);mutation.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-toast-host','data-toast-avoid','aria-hidden','data-exiting']});
    // A detail opening or closing settles through its own animation; recompute once when it ends.
    window.addEventListener('resize',schedule);document.addEventListener('animationend',schedule,true);document.addEventListener('transitionend',schedule,true);
    return()=>{if(frame)cancelAnimationFrame(frame);resize.disconnect();mutation.disconnect();window.removeEventListener('resize',schedule);document.removeEventListener('animationend',schedule,true);document.removeEventListener('transitionend',schedule,true);};
  },[viewport,target,count]);
}

export function useFeedbackState(initial=''){
  const [value,setValue]=useState({text:initial,revision:0});
  const update=useCallback((next:SetStateAction<string>)=>setValue(previous=>({text:typeof next==='function'?next(previous.text):next,revision:previous.revision+1})),[]);
  return [value.text,update,value.revision] as const;
}
interface FeedbackProps extends Omit<HTMLAttributes<HTMLDivElement>,'children'|'title'> {children:string|null|undefined;source:string;state?:string|undefined;enabled?:boolean|undefined;persistent?:boolean|undefined;revision?:number|undefined;/** Card 29 D4: an outcome title replacing the purpose label. */title?:string|undefined}

/** Presentation only: a close button never settles, retries or discards an operation. */
export function ToastFeedback({children,source,state,enabled=true,persistent=false,revision,role,title,'aria-live':live,...attributes}:FeedbackProps){
  const id=useId(),latest=useRef(attributes);latest.current=attributes;
  useEffect(()=>{
    if(!enabled||!children){toast.remove(id);return;}
    const unknown=state==='unknown',loading=loadingStates.has(state??''),success=successStates.has(state??''),error=!unknown&&(role==='alert'||errorStates.has(state??''));
    const show=()=>{
      // Card 33: with neither an outcome title nor a purpose label the message itself is the single-line title.
      const heading=toastHeading(title,source);
      const content=<div {...latest.current} className={'workbench-toast-content'+(heading?'':' is-single')+' '+(latest.current.className??'')} data-toast-source={source} data-toast-state={state??''}>{heading?<><strong className="workbench-toast-purpose">{heading}</strong><span>{children}</span></>:<strong className="workbench-toast-purpose">{children}</strong>}</div>;
      const options={id,duration:toastDuration({unknown,loading,error,persistent}),removeDelay:180,className:unknown?'is-warning':'',ariaProps:{role:error?'alert' as const:'status' as const,'aria-live':live??(error?'assertive' as const:'polite' as const)}};
      if(loading)toast.loading(content,options);else if(success)toast.success(content,options);else if(error)toast.error(content,options);else toast(content,options);
    };
    if(loading){toast.remove(id);const timer=window.setTimeout(show,200);return()=>window.clearTimeout(timer);}
    show();
  },[children,source,state,enabled,persistent,revision,role,title,live,id]);
  useEffect(()=>()=>{toast.remove(id);},[id]);
  return null;
}

/** Routine autosave is an accessible status, not another notification on every keystroke. */
export function DraftFeedback({children,enabled=true}:{children:string;enabled?:boolean}){
  const warning=/未知|过期|失败|不可用|无法|未确认|须核对|只能只读/u.test(children);
  return <ToastFeedback source="draft" state={warning?'unknown':undefined} enabled={enabled&&(warning||/已恢复/u.test(children))}>{children}</ToastFeedback>;
}

export function DraftStatus({children,notify=true,inlineText=false,...attributes}:Omit<HTMLAttributes<HTMLSpanElement>,'children'> & {children:string;notify?:boolean;inlineText?:boolean}){
  const warning=/未知|过期|失败|不可用|无法|未确认|须核对|只能只读/u.test(children);
  const quiet=inlineText&&(!children||/^草稿仅在当前浏览器/u.test(children));
  const short=/^已保存恢复副本/u.test(children)?'草稿已保存':/^已提交；恢复副本已清理/u.test(children)?'草稿已清理':children;
  return <><span {...attributes} role={inlineText?'status':'img'} aria-label={children} title={children} className={'workbench-draft-status'+(inlineText?' inbox-draft-status':'')+(quiet?' sr-only':'')}>{!quiet?<>{warning?<TriangleAlert size={13}/>:/^已保存|^已提交/u.test(children)?<Check size={13}/>:<Info size={13}/>}{inlineText?<span className="inbox-draft-copy">{short}</span>:null}</>:null}<span className="sr-only">{children}</span></span>{notify?<DraftFeedback>{children}</DraftFeedback>:null}</>;
}

/** Card 33: each tone's icon; an error is a crossed circle so it never reads as an unknown outcome. */
const toneIcons:Record<ToastTone,readonly [LucideIcon,string]>={success:[CircleCheck,'CircleCheck'],info:[Info,'Info'],warning:[TriangleAlert,'TriangleAlert'],danger:[CircleX,'CircleX'],loading:[LoaderCircle,'LoaderCircle']};

export function WorkbenchToasts(){
  const {toasts,handlers}=useToaster(),location=useLocation();
  useEffect(()=>{if(!toasts.length)handlers.endPause();},[toasts.length,handlers.endPause]);
  useEffect(()=>{for(const item of overflowToasts(toasts))toast.dismiss(item.id);},[toasts]);
  const [target,setTarget]=useState<HTMLElement>(document.body),priorFocus=useRef<HTMLElement|null>(null),[viewport,setViewport]=useState<HTMLDivElement|null>(null);
  useToastPlacement(viewport,target,toasts.length);
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
  return createPortal(<div ref={setViewport} className="workbench-toast-viewport" aria-label="操作提示" data-workbench-toasts onMouseEnter={handlers.startPause} onMouseLeave={handlers.endPause} onFocusCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget)){priorFocus.current=event.relatedTarget instanceof HTMLElement?event.relatedTarget:null;}handlers.startPause();}} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))handlers.endPause();}}>
    {[...toasts].reverse().map(item=>{const tone=toastTone(item.type,item.className),[Icon,icon]=toneIcons[tone];return <div key={item.id} className={'workbench-toast '+item.type+' '+(item.className??'')} data-tone={tone} data-toast-id={item.id} data-visible={item.visible} aria-hidden={!item.visible} {...item.ariaProps}>
      <span className="workbench-toast-tone" aria-hidden="true"><span className="workbench-toast-icon" data-icon={icon}><Icon size={20} strokeWidth={1.75}/></span></span>
      {resolveValue(item.message,item)}
      {tone==='loading'?<span className="workbench-toast-close-space" aria-hidden="true"/>:<HButton type="button" className="workbench-toast-close" aria-label="关闭提示" tabIndex={item.visible?0:-1} onMouseDown={event=>event.preventDefault()} onClick={event=>{if(event.currentTarget instanceof HTMLElement)dismiss(item.id,event.currentTarget);}} variant="secondary"><X size={16}/></HButton>}
    </div>;})}
  </div>,target);
}
