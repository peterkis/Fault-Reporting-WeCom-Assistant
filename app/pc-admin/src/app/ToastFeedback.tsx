import {useReportReadOnlyOperation} from '../design/components/ReadOnlyBar/ReadOnlyBar';
import {WorkbenchButton as HButton} from './WorkbenchButton';
import {useCallback,useEffect,useId,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {HTMLAttributes,SetStateAction} from 'react';
import {createPortal} from 'react-dom';
import {useLocation} from 'react-router';
import toast,{resolveValue,useToaster} from 'react-hot-toast/headless';
import {AUTO_DISMISS_MS,UNDO_TOAST_MAX_VISIBLE_MS,UNDO_TOAST_MS,isDetailNavigation,overflowToasts,toastDuration,toastHeading,toastTone} from './toast-policy';
import type {ToastTone} from './toast-policy';
import {Bell,Check,CircleCheck,CircleX,Info,LoaderCircle,TriangleAlert,Undo2,X} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';

const loadingStates=new Set(['loading','reading','preparing','submitting','checking','sending','saving']);
const successStates=new Set(['succeeded','success','committed']);
const errorStates=new Set(['failed','error','denied','conflict','invalid']);

export interface UndoToastOptions {
  id?:string|undefined;
  source:string;
  title:string;
  message?:string|undefined;
  actionLabel?:string|undefined;
  onUndo:()=>void|Promise<unknown>;
  onExpire?:(()=>void)|undefined;
}

export interface ErrorActionToastOptions {
  id?:string|undefined;
  source:string;
  title:string;
  message:string;
  actionLabel?:string|undefined;
  onAction?:(()=>void|Promise<unknown>)|undefined;
  persistent?:boolean|undefined;
  state?:string|undefined;
}

interface ToastActionMeta {
  kind:'undo'|'view';
  id:string;
  source:string;
  title:string;
  message?:string|undefined;
  actionLabel:string;
  onAction:()=>void|Promise<unknown>;
  onExpire?:(()=>void)|undefined;
  createdAtMs:number;
  undoDeadlineEpochMs?:number;
  elapsedUnpausedMs:number;
  lastTickMs:number;
  expired:boolean;
  triggered:boolean;
}

let toastSequence=0;
let metaRevision=0;
const toastMetaMap=new Map<string,ToastActionMeta>();
const undoOrder:string[]=[];
const metaListeners=new Set<()=>void>();

function notifyMeta(){
  metaRevision++;
  for(const listener of metaListeners)listener();
}

function subscribeMeta(listener:()=>void){
  metaListeners.add(listener);
  return()=>{metaListeners.delete(listener);};
}

function unregisterUndoId(id:string){
  const index=undoOrder.indexOf(id);
  if(index>=0)undoOrder.splice(index,1);
}

function removeToastMeta(id:string){
  unregisterUndoId(id);
  if(toastMetaMap.delete(id))notifyMeta();
}

function renderImperativeContent(source:string,title:string|undefined,message:string|undefined,state?:string){
  const heading=toastHeading(title,source);
  const body=message?.trim()||'';
  if(heading&&body){
    return <div className="workbench-toast-content" data-toast-source={source} data-toast-state={state??''}><strong className="workbench-toast-purpose">{heading}</strong><span>{body}</span></div>;
  }
  const single=heading||body;
  return <div className="workbench-toast-content is-single" data-toast-source={source} data-toast-state={state??''}><strong className="workbench-toast-purpose">{single}</strong></div>;
}

function nextImperativeId(prefix:string,explicit?:string){
  if(explicit)return explicit;
  toastSequence++;
  return prefix+'-'+toastSequence;
}

function nowMonotonic(){
  return typeof performance!=='undefined'?performance.now():Date.now();
}

function dismissUndoToastEntry(meta:ToastActionMeta){
  if(meta.triggered||meta.expired)return;
  unregisterUndoId(meta.id);
  meta.expired=true;
  notifyMeta();
  meta.onExpire?.();
  toast.dismiss(meta.id);
}

function expireUndoToastToPlainSuccess(meta:ToastActionMeta){
  if(meta.triggered||meta.expired)return;
  unregisterUndoId(meta.id);
  meta.expired=true;
  notifyMeta();
  meta.onExpire?.();
  toast.success(renderImperativeContent(meta.source,meta.title,meta.message,'succeeded'),{
    id:meta.id,
    duration:AUTO_DISMISS_MS,
    removeDelay:180,
    className:'',
    ariaProps:{role:'status', 'aria-live':'polite'},
  });
}

function undoWindowEnded(meta:ToastActionMeta){
  return nowMonotonic()-meta.createdAtMs>=UNDO_TOAST_MAX_VISIBLE_MS
    ||meta.undoDeadlineEpochMs!==undefined&&Date.now()>=meta.undoDeadlineEpochMs;
}

function triggerUndoMeta(meta:ToastActionMeta):boolean{
  if(meta.kind!=='undo'||meta.expired||meta.triggered)return false;
  if(undoWindowEnded(meta)){
    expireUndoToastToPlainSuccess(meta);
    return false;
  }
  meta.triggered=true;
  unregisterUndoId(meta.id);
  notifyMeta();
  toast.dismiss(meta.id);
  void Promise.resolve(meta.onAction());
  return true;
}

/** Shows a 5s undoable success toast (paused per-toast on hover/focus, capped at 10s total). */
export function showUndoToast(options:UndoToastOptions):string{
  const id=nextImperativeId('undo',options.id);
  unregisterUndoId(id);
  const now=nowMonotonic();
  const meta:ToastActionMeta={
    kind:'undo',
    id,
    source:options.source,
    title:options.title,
    message:options.message,
    actionLabel:options.actionLabel??'撤销',
    onAction:options.onUndo,
    undoDeadlineEpochMs:Date.now()+UNDO_TOAST_MAX_VISIBLE_MS,
    ...(options.onExpire?{onExpire:options.onExpire}:{}),
    createdAtMs:now,
    elapsedUnpausedMs:0,
    lastTickMs:now,
    expired:false,
    triggered:false,
  };
  toastMetaMap.set(id,meta);
  undoOrder.push(id);
  notifyMeta();
  toast.success(renderImperativeContent(options.source,options.title,options.message,'succeeded'),{
    id,
    duration:UNDO_TOAST_MAX_VISIBLE_MS+AUTO_DISMISS_MS,
    removeDelay:180,
    className:'',
    ariaProps:{role:'status','aria-live':'polite'},
  });
  return id;
}

/** Shows a plain auto-dismissing success toast. */
export function showSuccessToast(options:{id?:string|undefined;source:string;title:string;message?:string|undefined;duration?:number|undefined}):string{
  const id=nextImperativeId('success',options.id);
  removeToastMeta(id);
  toast.success(renderImperativeContent(options.source,options.title,options.message,'succeeded'),{
    id,
    duration:options.duration??AUTO_DISMISS_MS,
    removeDelay:180,
    className:'',
    ariaProps:{role:'status','aria-live':'polite'},
  });
  return id;
}

/** Shows a plain informational notice toast. */
export function showInfoToast(options:{id?:string|undefined;source:string;title?:string|undefined;message?:string|undefined;state?:string|undefined;persistent?:boolean|undefined}):string{
  const id=nextImperativeId('info',options.id);
  removeToastMeta(id);
  const unknown=options.state==='unknown';
  toast(renderImperativeContent(options.source,options.title,options.message,options.state),{
    id,
    duration:toastDuration({unknown,loading:false,error:false,persistent:Boolean(options.persistent)}),
    removeDelay:180,
    className:unknown?'is-warning':'',
    ariaProps:{role:'status','aria-live':'polite'},
  });
  return id;
}

/** Shows an error notice toast with an optional contextual action button (e.g. 「查看」). */
export function showErrorActionToast(options:ErrorActionToastOptions):string{
  const id=nextImperativeId('error',options.id);
  unregisterUndoId(id);
  if(options.onAction){
    const now=nowMonotonic();
    toastMetaMap.set(id,{
      kind:'view',
      id,
      source:options.source,
      title:options.title,
      message:options.message,
      actionLabel:options.actionLabel??'查看',
      onAction:options.onAction,
      createdAtMs:now,
      elapsedUnpausedMs:0,
      lastTickMs:now,
      expired:false,
      triggered:false,
    });
    notifyMeta();
  }else{
    removeToastMeta(id);
  }
  toast.error(renderImperativeContent(options.source,options.title,options.message,options.state??'denied'),{
    id,
    duration:toastDuration({unknown:false,loading:false,error:true,persistent:Boolean(options.persistent)}),
    removeDelay:180,
    className:'',
    ariaProps:{role:'alert','aria-live':'assertive'},
  });
  return id;
}

/** Triggers the newest still-active undo toast (used by `Ctrl+Z` / `⌘+Z`). */
export function triggerNewestUndoToast():boolean{
  for(let i=undoOrder.length-1;i>=0;i--){
    const id=undoOrder[i];
    if(!id)continue;
    const meta=toastMetaMap.get(id);
    if(!meta||meta.expired||meta.triggered){
      undoOrder.splice(i,1);
      continue;
    }
    if(triggerUndoMeta(meta))return true;
  }
  return false;
}

export function clearWorkbenchToasts(){
  undoOrder.length=0;
  toastMetaMap.clear();
  notifyMeta();
  toast.remove();
}

type Box={left:number;top:number;right:number;bottom:number;width:number};
const viewportBox=():Box=>({left:0,top:0,right:window.innerWidth,bottom:window.innerHeight,width:window.innerWidth});
/** A transformed / filtered / contained ancestor becomes the containing block of a fixed element; offsets are measured from it. */
function containingBlock(element:HTMLElement):Box{
  for(let node=element.parentElement;node&&node!==document.documentElement;node=node.parentElement){
    const style=getComputedStyle(node),backdrop=style.getPropertyValue('backdrop-filter');
    // Card 33 review: the individual transform properties count too (the detail drawer declares will-change: translate), as do
    // size container queries and content-visibility:auto, which imply layout / paint containment.
    if(style.transform!=='none'||style.translate!=='none'||style.scale!=='none'||style.rotate!=='none'||style.perspective!=='none'||style.filter!=='none'||(backdrop!==''&&backdrop!=='none')
      ||/transform|translate|scale|rotate|perspective|filter|contain/u.test(style.willChange)||/paint|layout|strict|content/u.test(style.contain)
      ||/size/u.test(style.containerType)||style.contentVisibility==='auto'){const box=node.getBoundingClientRect();return {left:box.left,top:box.top,right:box.right,bottom:box.bottom,width:box.width};}
  }
  return viewportBox();
}
/**
 * CI (t05 at 900 wide): inside the detail drawer (the containing block) the stack's transparent side gutter reached past the
 * drawer's scroll box (beside its scrollbar) and made it scroll sideways. The right edge of the nearest scrolling ancestor's
 * content box, used when the stack is not positioned against the window.
 */
function scrollerRight(element:HTMLElement):number{
  for(let node=element.parentElement;node&&node!==document.body&&node!==document.documentElement;node=node.parentElement){
    const style=getComputedStyle(node);
    if(style.overflowX!=='visible'||style.overflowY!=='visible'){const box=node.getBoundingClientRect();return box.left+node.clientLeft+node.clientWidth;}
  }
  return Infinity;
}
const shown=(element:Element)=>element instanceof HTMLElement&&element.checkVisibility()&&!element.closest('[aria-hidden="true"],[data-exiting]');
const inBoardSubtree=(node:Node)=>node instanceof Element&&Boolean(node.closest('.board,.ds-work-table'));
/** The declared detail container (drawer, full page or closing dialog) whose bottom-right corner the notices dock to. */
function toastHost(target:HTMLElement):HTMLElement|null{
  if(target.matches('[data-toast-host]'))return target;
  if(target!==document.body)return null;
  return Array.from(document.querySelectorAll<HTMLElement>('[data-toast-host]')).filter(host=>shown(host)&&!host.closest('[data-workbench-overlay]')).at(-1)??null;
}
/** Card 34A: how the stack is laid out. docked: 32D-T (window corner, or the open detail container); window: a modal is open and the
 * stack sits in the window's bottom-right corner beside it; chip: a modal is open and there is no room beside it, so the notices
 * collapse into one chip that expands on demand. */
type ToastMode='docked'|'window'|'chip';
const MIN_SIDE_LIST=272;
type ChipSlot={x:number;y:number;side:'right'|'below'|'left'|'above'};
/** Codex review: a place for a w×h chip in the window that keeps 8 from the modal and 8–20 from the window edge, trying the
 * margin right of, below, left of and above the modal in that order; null when no margin is wide enough. */
function chipSlot(dialog:DOMRect,screen:Box,w:number,h:number):ChipSlot|null{
  const gap=8,edge=20,min=8;
  const right=Math.min(edge,screen.right-dialog.right-gap-w);if(right>=min)return {x:screen.right-right-w,y:screen.bottom-edge-h,side:'right'};
  const below=Math.min(edge,screen.bottom-dialog.bottom-gap-h);if(below>=min)return {x:screen.right-edge-w,y:screen.bottom-below-h,side:'below'};
  const left=Math.min(edge,dialog.left-gap-w-screen.left);if(left>=min)return {x:screen.left+left,y:screen.bottom-edge-h,side:'left'};
  const above=Math.min(16,dialog.top-gap-h-screen.top);if(above>=min)return {x:screen.right-edge-w,y:screen.top+above,side:'above'};
  return null;
}
const COMPACT_CHIP=32;
/**
 * Card 32D: notices sit bottom-right of the window, or of the open detail container above its declared bottom input area
 * (`data-toast-avoid="bottom"`) and below its top control bar (`data-toast-avoid="top"`), so the toolbar, the composer and dialog
 * actions stay reachable even when a short window or several notices waiting to be closed limit the stack's height; the stack then
 * scrolls. Card 33: the scroll box keeps a transparent shadow gutter around the notices so their shadows are drawn whole.
 * Card 34A: while a modal (`data-workbench-modal`) is open the notices stay in the window's bottom-right corner and never enter the
 * modal: beside it when the room to its right holds a notice plus 32, otherwise as a chip whose list opens above it, beside the
 * modal when that room is at least 272 wide and as a popover over it otherwise. The DOM stays inside the modal only because a
 * modal makes the rest of the page inert. Positions are written as CSS variables only when the target, a size or the notices
 * change; nothing polls per frame.
 */
function useToastPlacement(viewport:HTMLDivElement|null,chip:HTMLElement|null,target:HTMLElement,count:number,expanded:boolean,onMode:(mode:ToastMode)=>void){
  const report=useRef(onMode);report.current=onMode;
  // The full chip's measured width (it cannot be measured while compact) and the height the modals currently give up for it.
  const fullWidth=useRef(112),reserve=useRef(0),reserveWindow=useRef('');
  useLayoutEffect(()=>{
    if(!viewport)return;
    let frame=0;
    const place=()=>{
      frame=0;
      const modal=target.matches('[data-workbench-modal]')?target:null,host=modal?null:toastHost(target),screen=viewportBox(),narrow=window.matchMedia('(max-width: 640px)').matches;
      let left=narrow?12:screen.right-20-Math.min(400,screen.width-32),right=narrow?screen.right-12:screen.right-20,bottom=screen.bottom-20,top=screen.top+16,mode:ToastMode='docked',popover=false;
      const block=containingBlock(viewport),style=viewport.style;
      if(modal){
        const dialog=modal.getBoundingClientRect(),width=Math.min(400,screen.width-32);
        right=screen.right-20;left=right-width;
        if(screen.right-dialog.right>=width+32)mode='window';
        else{
          mode='chip';
          // Codex review: the collapsed chip never covers the modal either. The full chip goes into a margin around the modal that
          // holds it; otherwise a compact chip (bell and count); otherwise the modals give up height for it (centred, so half of it
          // becomes the bottom margin) and the compact chip sits below.
          const size=chip?.getBoundingClientRect(),compactNow=chip?.dataset.compact==='true';
          if(size&&size.width>0&&!compactNow)fullWidth.current=size.width;
          const h=size&&size.height>0?size.height:32;
          // Codex review: once the modals give up height it is kept, not re-derived from their shortened size (the media preview's own
          // max-height shrinks with it too, so no "natural" size can be reconstructed reliably and re-deciding would loop). It is
          // released only when the chip goes away, the window size changes (then measured afresh) or the modal changes (effect cleanup).
          const windowSize=screen.width+'x'+screen.bottom;
          let dialogBox=dialog;
          if(reserve.current&&(!chip||reserveWindow.current!==windowSize)){reserve.current=0;document.documentElement.style.removeProperty('--workbench-toast-reserve');dialogBox=modal.getBoundingClientRect();}
          let slot:ChipSlot|null=null,compact=false;
          if(!reserve.current){
            slot=chipSlot(dialogBox,screen,fullWidth.current,h);
            if(!slot){slot=chipSlot(dialogBox,screen,COMPACT_CHIP,COMPACT_CHIP);compact=true;}
            // Only a chip that is actually shown (a visible notice exists) may take height from the modals.
            if(!slot&&chip){
              reserve.current=Math.ceil(2*(COMPACT_CHIP+16-(screen.bottom-dialogBox.bottom)));reserveWindow.current=windowSize;
              document.documentElement.style.setProperty('--workbench-toast-reserve',reserve.current+'px');dialogBox=modal.getBoundingClientRect();
            }
          }
          if(!slot){
            // The modals give up height (centred, so half of it becomes the bottom margin); the room below may then hold the full chip.
            const below=screen.bottom-dialogBox.bottom-8;compact=below<h+8||fullWidth.current+40>screen.width;
            slot={x:screen.right-20-(compact?COMPACT_CHIP:fullWidth.current),y:screen.bottom-8-(compact?COMPACT_CHIP:h),side:'below'};
          }
          const w=compact?COMPACT_CHIP:fullWidth.current;
          if(chip){chip.dataset.compact=compact?'true':'false';chip.style.setProperty('--toast-chip-right',Math.round(block.right-(slot.x+w))+'px');chip.style.setProperty('--toast-chip-bottom',Math.round(block.bottom-(slot.y+h))+'px');}
          // The list opens from the chip: beside the modal when the room between them holds it, otherwise as a popover.
          if(slot.side==='above'){top=slot.y+h+8;right=slot.x+w;left=right-width;popover=true;}
          else if(slot.side==='left'){bottom=slot.y-8;left=slot.x;const room=dialogBox.left-16-left;popover=room<MIN_SIDE_LIST;right=left+(popover?width:Math.min(width,room));}
          else{bottom=slot.y-8;right=slot.x+w;const room=right-(dialogBox.right+16);popover=slot.side==='below'||room<MIN_SIDE_LIST;left=right-(popover?width:Math.min(width,room));}
          left=Math.max(screen.left+16,left);
        }
      }else if(host){
        const box=host.getBoundingClientRect(),hostBottom=Math.min(box.bottom,screen.bottom),hostTop=Math.max(box.top,screen.top);
        const avoid=Array.from(host.querySelectorAll('[data-toast-avoid="bottom"]')).filter(shown).map(element=>element.getBoundingClientRect())
          .filter(area=>area.height>0&&area.top<hostBottom&&area.bottom>hostTop);
        bottom=avoid.length?Math.min(...avoid.map(area=>area.top))-12:hostBottom-16;
        const bars=Array.from(host.querySelectorAll('[data-toast-avoid="top"]')).filter(shown).map(element=>element.getBoundingClientRect())
          .filter(area=>area.height>0&&area.top<hostBottom&&area.bottom>hostTop);
        top=bars.length?Math.max(...bars.map(area=>area.bottom))+12:hostTop+16;
        if(!narrow){right=Math.min(box.right,screen.right)-16;left=right-Math.min(400,box.width-32,screen.width-32);}
      }
      // The stack (with its full shadow gutter) stays inside a scrolling ancestor's content box: it moves left by the overshoot,
      // so the drawer never scrolls sideways and the shadow is never cut.
      const windowBlock=block.left===0&&block.top===0&&block.right===window.innerWidth&&block.bottom===window.innerHeight;
      const gutter=parseFloat(getComputedStyle(viewport).getPropertyValue('--toast-gutter-x'))||0,limit=windowBlock?Infinity:scrollerRight(viewport),overshoot=Math.ceil(right+gutter-limit);
      if(overshoot>0){right-=overshoot;left=Math.max(left-overshoot,screen.left+(narrow?12:16));}
      style.setProperty('--toast-right',Math.round(block.right-right)+'px');style.setProperty('--toast-left',Math.round(left-block.left)+'px');
      style.setProperty('--toast-bottom',Math.round(block.bottom-bottom)+'px');style.setProperty('--toast-width',Math.max(0,Math.round(right-left))+'px');
      style.setProperty('--toast-max-height',Math.max(0,Math.round(bottom-top))+'px');
      if(mode!=='chip'&&reserve.current){reserve.current=0;document.documentElement.style.removeProperty('--workbench-toast-reserve');}
      viewport.dataset.toastHosted=host?'true':'false';viewport.dataset.toastMode=mode;viewport.dataset.toastPopover=popover?'true':'false';
      // Card 33 review: while the stack scrolls, notices are clipped to the content box (see feedback.css) so a scrolled notice never
      // enters the 12px kept clear of the top bar and the bottom input area; the shadow gutter is only for an unscrolled stack.
      viewport.dataset.toastOverflow=viewport.scrollHeight>viewport.clientHeight+1?'true':'false';
      report.current(mode);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(place);};
    place();
    const host=target.matches('[data-workbench-modal]')?target:toastHost(target);
    const resize=count>0||host?new ResizeObserver(schedule):null;
    if(resize){
      resize.observe(document.documentElement);resize.observe(viewport);if(chip)resize.observe(chip);
      if(host){resize.observe(host);for(const area of host.querySelectorAll('[data-toast-avoid]'))resize.observe(area);}
    }
    const onMutation=(records:MutationRecord[])=>{
      for(const record of records){
        if(record.type==='attributes'){schedule();return;}
        if(inBoardSubtree(record.target))continue;
        schedule();return;
      }
    };
    const mutation=new MutationObserver(onMutation);mutation.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-toast-host','data-toast-avoid','aria-hidden','data-exiting']});
    // A detail opening or closing settles through its own animation; recompute once when it ends.
    const onMotionEnd=(event:Event)=>{if(event.target instanceof Node&&inBoardSubtree(event.target))return;schedule();};
    window.addEventListener('resize',schedule);document.addEventListener('animationend',onMotionEnd,true);document.addEventListener('transitionend',onMotionEnd,true);
    return()=>{if(frame)cancelAnimationFrame(frame);if(reserve.current){reserve.current=0;document.documentElement.style.removeProperty('--workbench-toast-reserve');}resize?.disconnect();mutation.disconnect();window.removeEventListener('resize',schedule);document.removeEventListener('animationend',onMotionEnd,true);document.removeEventListener('transitionend',onMotionEnd,true);};
  },[viewport,chip,target,count,expanded]);
}

export function useFeedbackState(initial=''){
  const [value,setValue]=useState({text:initial,revision:0});
  const update=useCallback((next:SetStateAction<string>)=>setValue(previous=>({text:typeof next==='function'?next(previous.text):next,revision:previous.revision+1})),[]);
  return [value.text,update,value.revision] as const;
}
export interface FeedbackProps extends Omit<HTMLAttributes<HTMLDivElement>,'children'|'title'> {children:string|null|undefined;source:string;state?:string|undefined;enabled?:boolean|undefined;persistent?:boolean|undefined;revision?:number|undefined;/** Card 29 D4: an outcome title replacing the purpose label. */title?:string|undefined}

/** Presentation only: a close button never settles, retries or discards an operation. */
export function ToastFeedback({children,source,state,enabled=true,persistent=false,revision,role,title,'aria-live':live,...attributes}:FeedbackProps){
  useReportReadOnlyOperation(source,state);
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
// Card 34C: draft feedback that needs attention (not saved, not cleared, not confirmed, too long).
export const DRAFT_WARNING=/未知|过期|失败|不可用|无法|未确认|未能|未保存|暂未|过长|只能查看/u,DRAFT_DONE=/^(?:草稿已保存|已保存|已提交)/u;
const DRAFT_SAVED_HINT='仅保存在这台电脑；从第一次保存起最多保留 24 小时，到期后不再恢复。';
export function DraftFeedback({children,enabled=true}:{children:string;enabled?:boolean}){
  const warning=DRAFT_WARNING.test(children);
  return <ToastFeedback source="draft" state={warning?'unknown':undefined} enabled={enabled&&(warning||/已恢复/u.test(children))}>{children}</ToastFeedback>;
}

export function DraftStatus({children,notify=true,inlineText=false,...attributes}:Omit<HTMLAttributes<HTMLSpanElement>,'children'> & {children:string;notify?:boolean;inlineText?:boolean}){
  const warning=DRAFT_WARNING.test(children),done=DRAFT_DONE.test(children);
  const quiet=inlineText&&(!children||/^草稿仅在当前浏览器/u.test(children));
  const short=children;
  // Codex review: the saved-draft limit is part of the status's accessible text, not only a hover title (keyboard, touch and
  // assistive technology users get it too); the visible line stays 「草稿已保存」.
  const spoken=children==='草稿已保存'?children+'。'+DRAFT_SAVED_HINT:children;
  // Codex review: keyboard and touch users without a screen reader open the limit with a small info button beside every saved
  // status, the icon-only ones included.
  const [limitShown,setLimitShown]=useState(false),limitId=useId(),saved=children==='草稿已保存';
  return <><span {...attributes} role={inlineText?'status':'img'} aria-label={spoken} title={spoken} className={'workbench-draft-status'+(inlineText?' inbox-draft-status':'')+(quiet?' sr-only':'')}>{!quiet?<>{warning?<TriangleAlert size={13}/>:done?<Check size={13}/>:<Info size={13}/>}{inlineText?<span className="inbox-draft-copy">{short}</span>:null}</>:null}<span className="sr-only">{spoken}</span></span>{saved?<><HButton type="button" className="workbench-draft-limit-toggle" data-action="toggle-draft-limit" variant="ghost" isIconOnly aria-label="草稿保存期限" aria-expanded={limitShown} aria-controls={limitId} onClick={()=>setLimitShown(value=>!value)}><Info size={13} aria-hidden="true"/></HButton>{limitShown?<span id={limitId} className="workbench-draft-limit">{DRAFT_SAVED_HINT}</span>:null}</>:null}{notify?<DraftFeedback>{children}</DraftFeedback>:null}</>;
}

/** Card 34A: the tone of a feedback state, shared by the toast and the dialog's inline alert. */
export function feedbackTone(state:string|undefined,role:string|undefined):'success'|'info'|'warning'|'danger'{
  const value=state??'';
  return value==='unknown'?'warning':role==='alert'||errorStates.has(value)?'danger':successStates.has(value)?'success':'info';
}

/** Card 33: each tone's icon; an error is a crossed circle so it never reads as an unknown outcome. */
const toneIcons:Record<ToastTone,readonly [LucideIcon,string]>={success:[CircleCheck,'CircleCheck'],info:[Info,'Info'],warning:[TriangleAlert,'TriangleAlert'],danger:[CircleX,'CircleX'],loading:[LoaderCircle,'LoaderCircle']};

function UndoToastCountdown({meta,visible,paused}:{meta:ToastActionMeta;visible:boolean;paused:boolean}){
  const fillRef=useRef<HTMLSpanElement|null>(null);
  useEffect(()=>{
    if(!visible||meta.expired||meta.triggered)return;
    let frame=0;
    meta.lastTickMs=nowMonotonic();
    const step=()=>{
      if(meta.expired||meta.triggered)return;
      const now=nowMonotonic();
      if(undoWindowEnded(meta)){
        expireUndoToastToPlainSuccess(meta);
        return;
      }
      if(!paused){
        meta.elapsedUnpausedMs+=Math.max(0,now-meta.lastTickMs);
      }
      meta.lastTickMs=now;
      const remaining=Math.max(0,1-meta.elapsedUnpausedMs/UNDO_TOAST_MS);
      if(fillRef.current){
        fillRef.current.style.transform='scaleX('+remaining.toFixed(4)+')';
      }
      if(meta.elapsedUnpausedMs>=UNDO_TOAST_MS){
        dismissUndoToastEntry(meta);
        return;
      }
      frame=requestAnimationFrame(step);
    };
    const initialRemaining=Math.max(0,1-meta.elapsedUnpausedMs/UNDO_TOAST_MS);
    if(fillRef.current){
      fillRef.current.style.transform='scaleX('+initialRemaining.toFixed(4)+')';
    }
    frame=requestAnimationFrame(step);
    return()=>cancelAnimationFrame(frame);
  },[meta,visible,paused]);
  if(meta.expired||meta.triggered)return null;
  return <div className="workbench-toast-countdown" data-toast-countdown="true" aria-hidden="true"><span ref={fillRef} className="workbench-toast-countdown-fill"/></div>;
}

export function WorkbenchToasts(){
  const {toasts,handlers}=useToaster(),location=useLocation();
  useSyncExternalStore(subscribeMeta,()=>metaRevision,()=>0);
  const [hoveredIds,setHoveredIds]=useState<Record<string,boolean>>({});
  const [focusedIds,setFocusedIds]=useState<Record<string,boolean>>({});
  useEffect(()=>{if(!toasts.length)handlers.endPause();},[toasts.length,handlers.endPause]);
  useEffect(()=>{for(const item of overflowToasts(toasts))toast.dismiss(item.id);},[toasts]);
  useEffect(()=>{
    const activeIds=new Set(toasts.map(item=>item.id));
    for(const item of toasts){
      if(!item.visible)unregisterUndoId(item.id);
    }
    for(const id of Array.from(toastMetaMap.keys())){
      if(!activeIds.has(id))removeToastMeta(id);
    }
  },[toasts]);
  const [target,setTarget]=useState<HTMLElement>(document.body),priorFocus=useRef<HTMLElement|null>(null),[viewport,setViewport]=useState<HTMLDivElement|null>(null);
  // Card 34A: chip mode while a modal leaves no room beside it.
  const [mode,setMode]=useState<ToastMode>('docked'),[expanded,setExpanded]=useState(false),[chip,setChip]=useState<HTMLSpanElement|null>(null),listId=useId();
  const visibleCount=toasts.filter(item=>item.visible).length,chipped=mode==='chip'&&visibleCount>0,open=chipped&&expanded;
  useToastPlacement(viewport,chipped?chip:null,target,toasts.length,open,setMode);
  useEffect(()=>{if(!chipped)setExpanded(false);},[chipped]);
  const collapse=useCallback(()=>{setExpanded(false);chip?.querySelector<HTMLElement>('button')?.focus({preventScroll:true});},[chip]);
  useEffect(()=>{
    if(!open)return;
    // A press anywhere outside the chip and its list (the modal included) closes the list; the press itself still goes through.
    const outside=(event:PointerEvent)=>{const node=event.target;if(node instanceof Node&&!viewport?.contains(node)&&!chip?.contains(node))setExpanded(false);};
    document.addEventListener('pointerdown',outside,true);return()=>document.removeEventListener('pointerdown',outside,true);
  },[open,viewport,chip]);
  // Codex review: while the list is open, Escape anywhere (focus may have moved back into the modal) only collapses the list; it is
  // caught before the modal's own Escape so the dialog stays open.
  useEffect(()=>{
    if(!open)return;
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();event.preventDefault();collapse();}};
    document.addEventListener('keydown',escape,true);return()=>document.removeEventListener('keydown',escape,true);
  },[open,collapse]);
  useEffect(()=>{
    const update=()=>{
      const focused=document.activeElement?.closest<HTMLElement>('[data-workbench-overlay]');
      const next=focused?.isConnected&&!focused.closest('[aria-hidden="true"],[data-exiting]')?focused:Array.from(document.querySelectorAll<HTMLElement>('[data-workbench-overlay]')).filter(element=>!element.closest('[aria-hidden="true"],[data-exiting]')).at(-1)??document.body;
      setTarget(previous=>previous===next?previous:next);
    };
    update();
    const onMutation=(records:MutationRecord[])=>{
      for(const record of records){
        if(record.type==='attributes'){update();return;}
        if(inBoardSubtree(record.target))continue;
        update();return;
      }
    };
    const observer=new MutationObserver(onMutation);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-hidden','data-exiting']});document.addEventListener('focusin',update);
    return()=>{observer.disconnect();document.removeEventListener('focusin',update);};
  },[]);
  const previousRoute=useRef<{pathname:string;search:string}|null>(null);
  useLayoutEffect(()=>{
    const {pathname,search}=location,previous=previousRoute.current;
    if(previous?.pathname===pathname&&previous.search===search)return;
    previousRoute.current={pathname,search};
    if(previous&&isDetailNavigation(previous,location)){
      for(const item of toasts){
        const meta=toastMetaMap.get(item.id);
        if(item.visible&&meta?.kind==='undo'&&!meta.triggered&&!meta.expired&&!undoWindowEnded(meta))continue;
        removeToastMeta(item.id);
        toast.remove(item.id);
      }
    }else clearWorkbenchToasts();
  },[location,toasts]);
  const dismiss=(id:string,button:HTMLElement)=>{
    if(document.activeElement===button){const previous=priorFocus.current;if(previous?.isConnected&&previous.checkVisibility()&&!previous.matches(':disabled'))previous.focus({preventScroll:true});else target.querySelector<HTMLElement>('h2[tabindex]')?.focus({preventScroll:true});}
    toast.dismiss(id);
  };
  return createPortal(<><div ref={setViewport} id={listId} className="workbench-toast-viewport" aria-label="操作提示" data-workbench-toasts hidden={chipped&&!open} onMouseEnter={handlers.startPause} onMouseLeave={handlers.endPause} onFocusCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget)){priorFocus.current=event.relatedTarget instanceof HTMLElement?event.relatedTarget:null;}handlers.startPause();}} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))handlers.endPause();}}>
    {[...toasts].reverse().map(item=>{
      const tone=toastTone(item.type,item.className),[Icon,icon]=toneIcons[tone];
      const meta=toastMetaMap.get(item.id);
      const showAction=Boolean(meta&&!meta.expired&&!meta.triggered);
      const isPaused=Boolean(hoveredIds[item.id]||focusedIds[item.id]);
      return <div key={item.id} className={'workbench-toast '+item.type+' '+(item.className??'')} data-tone={tone} data-toast-id={item.id} data-visible={item.visible} aria-hidden={!item.visible} {...item.ariaProps}
        onMouseEnter={()=>{if(meta?.kind==='undo')setHoveredIds(prev=>prev[item.id]?prev:{...prev,[item.id]:true});}}
        onMouseLeave={()=>{if(meta?.kind==='undo')setHoveredIds(prev=>{if(!prev[item.id])return prev;const next={...prev};delete next[item.id];return next;});}}
        onFocusCapture={()=>{if(meta?.kind==='undo')setFocusedIds(prev=>prev[item.id]?prev:{...prev,[item.id]:true});}}
        onBlurCapture={event=>{if(meta?.kind==='undo'&&!event.currentTarget.contains(event.relatedTarget))setFocusedIds(prev=>{if(!prev[item.id])return prev;const next={...prev};delete next[item.id];return next;});}}>
      <span className="workbench-toast-tone" aria-hidden="true"><span className="workbench-toast-icon" data-icon={icon}><Icon size={20} strokeWidth={1.75}/></span></span>
      {resolveValue(item.message,item)}
      {showAction&&meta?<div className="workbench-toast-actions"><HButton type="button" className="workbench-toast-action" data-toast-action={meta.kind} tabIndex={item.visible?0:-1} onClick={()=>{
        if(meta.kind==='undo'){triggerUndoMeta(meta);}else{toast.dismiss(item.id);void Promise.resolve(meta.onAction());}
      }} variant="secondary">{meta.kind==='undo'?<><Undo2 size={14} strokeWidth={1.75} aria-hidden="true"/><span>{meta.actionLabel}</span></>:meta.actionLabel}</HButton></div>:null}
      {tone==='loading'?<span className="workbench-toast-close-space" aria-hidden="true"/>:<HButton type="button" className="workbench-toast-close" aria-label="关闭提示" tabIndex={item.visible?0:-1} onMouseDown={event=>event.preventDefault()} onClick={event=>{if(event.currentTarget instanceof HTMLElement)dismiss(item.id,event.currentTarget);}} variant="secondary"><X size={16}/></HButton>}
      {meta?.kind==='undo'?<UndoToastCountdown meta={meta} visible={item.visible} paused={isPaused}/>:null}
    </div>;})}
  </div>{chipped?<span ref={setChip} className="workbench-toast-chip-anchor"><HButton type="button" className="workbench-toast-chip" data-action="toggle-toast-chip" aria-expanded={open} aria-controls={listId} onClick={()=>setExpanded(value=>!value)} variant="secondary"><Bell size={14} aria-hidden="true"/><span aria-live="polite"><span className="workbench-toast-chip-count">{visibleCount}</span><span className="workbench-toast-chip-label"> 条提示</span></span></HButton></span>:null}</>,target);
}
