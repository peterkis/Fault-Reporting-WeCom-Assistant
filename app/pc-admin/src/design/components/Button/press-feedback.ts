import type {KeyboardEvent as ReactKeyboardEvent,PointerEvent as ReactPointerEvent} from 'react';

interface PressSession {
  el:HTMLButtonElement;
  kind:'pointer'|'keyboard';
  pointerId?:number;
  key?:'Enter'|'Space';
  dispose:()=>void;
}

let activePress:PressSession|null=null;

export function endButtonPress(session:PressSession|null=activePress){
  if(!session)return;
  session.dispose();
  delete session.el.dataset.pressed;
  if(activePress===session)activePress=null;
}

export function endButtonPressFor(el:HTMLButtonElement|null){
  if(el&&activePress?.el===el)endButtonPress(activePress);
}

export function isKeyboardPressActive(el:HTMLButtonElement):boolean{
  return activePress?.kind==='keyboard'&&activePress.el===el;
}

function isSpaceKey(key:string,code?:string):boolean{
  return key===' '||key==='Spacebar'||code==='Space';
}

function activationKeyOf(key:string,code?:string):'Enter'|'Space'|null{
  if(key==='Enter')return 'Enter';
  if(isSpaceKey(key,code))return 'Space';
  return null;
}

function releaseImplicitPointerCapture(target:EventTarget|null,pointerId:number){
  if(!(target instanceof Element)||typeof target.releasePointerCapture!=='function')return;
  try{
    if(typeof target.hasPointerCapture==='function'){
      if(target.hasPointerCapture(pointerId))target.releasePointerCapture(pointerId);
    }else{
      target.releasePointerCapture(pointerId);
    }
  }catch{/* Synthetic pointer events without active capture may throw NotFoundError. */}
}

function isPointInsideButton(el:HTMLButtonElement,event:PointerEvent):boolean{
  const rect=el.getBoundingClientRect();
  if(rect.width<=0||rect.height<=0)return false;
  const rx=Math.max(0,(event.width||0)/2);
  const ry=Math.max(0,(event.height||0)/2);
  return event.clientX+rx>=rect.left&&event.clientX-rx<=rect.right&&event.clientY+ry>=rect.top&&event.clientY-ry<=rect.bottom;
}

/** Shared zero-hook E1 press feedback matching HeroUI/React Aria `usePress` pointer and keyboard semantics. */
export function startPointerButtonPress(event:ReactPointerEvent<HTMLButtonElement>,disabled:boolean){
  if(disabled||event.defaultPrevented||event.button!==0)return;
  const el=event.currentTarget;
  if(activePress?.kind==='pointer'&&activePress.el===el)return;
  endButtonPress();
  const pointerId=event.pointerId;
  // Release implicit touch/pen pointer capture so sliding off emits pointerleave, matching React Aria usePress.
  releaseImplicitPointerCapture(event.target,pointerId);
  if(event.target!==el)releaseImplicitPointerCapture(el,pointerId);
  el.dataset.pressed='true';
  const trackMove=event.pointerType==='touch'||event.pointerType==='pen';
  const onPointerMove=(move:PointerEvent)=>{
    if(move.pointerId!==pointerId)return;
    if(!isPointInsideButton(el,move)){
      delete el.dataset.pressed;
    }else if(el.isConnected&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&el.dataset.exiting!=='true'&&move.target instanceof Node&&el.contains(move.target)){
      el.dataset.pressed='true';
    }
  };
  const onPointerDone=(done:PointerEvent)=>{if(done.pointerId===pointerId)endButtonPress(session);};
  const onWindowBlur=()=>endButtonPress(session);
  if(trackMove)window.addEventListener('pointermove',onPointerMove,true);
  window.addEventListener('pointerup',onPointerDone,true);
  window.addEventListener('pointercancel',onPointerDone,true);
  window.addEventListener('blur',onWindowBlur);
  const session:PressSession={el,kind:'pointer',pointerId,dispose:()=>{
    if(trackMove)window.removeEventListener('pointermove',onPointerMove,true);
    window.removeEventListener('pointerup',onPointerDone,true);
    window.removeEventListener('pointercancel',onPointerDone,true);
    window.removeEventListener('blur',onWindowBlur);
  }};
  activePress=session;
}

export function leavePointerButtonPress(event:ReactPointerEvent<HTMLButtonElement>){
  if(activePress?.kind==='pointer'&&activePress.el===event.currentTarget&&activePress.pointerId===event.pointerId){
    delete event.currentTarget.dataset.pressed;
  }
}

export function enterPointerButtonPress(event:ReactPointerEvent<HTMLButtonElement>,disabled:boolean){
  if(!disabled&&activePress?.kind==='pointer'&&activePress.el===event.currentTarget&&activePress.pointerId===event.pointerId){
    event.currentTarget.dataset.pressed='true';
  }
}

export function cancelPointerButtonPress(event:ReactPointerEvent<HTMLButtonElement>){
  if(activePress?.kind==='pointer'&&activePress.el===event.currentTarget&&activePress.pointerId===event.pointerId){
    endButtonPress(activePress);
  }
}

export function startKeyboardButtonPress(event:ReactKeyboardEvent<HTMLButtonElement>,disabled:boolean,{ignoreShift=false}:{ignoreShift?:boolean}={}){
  if(event.defaultPrevented||event.nativeEvent.isComposing||event.altKey||event.ctrlKey||event.metaKey||(ignoreShift&&event.shiftKey))return;
  const key=activationKeyOf(event.key,event.code);
  if(!key||disabled)return;
  // Prevent native repeated Enter clicks and Space scroll; activate once on keyup like HeroUI/React Aria press.
  event.preventDefault();
  if(event.repeat)return;
  const el=event.currentTarget;
  if(activePress?.kind==='keyboard'&&activePress.el===el)return;
  endButtonPress();
  el.dataset.pressed='true';
  const onKeyUp=(up:KeyboardEvent)=>{
    if(activationKeyOf(up.key,up.code)!==key)return;
    const stillInside=up.target instanceof Node&&el.contains(up.target);
    endButtonPress(session);
    if(stillInside&&el.isConnected&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&el.dataset.exiting!=='true'){
      up.preventDefault();
      el.click();
    }
  };
  const onWindowBlur=()=>endButtonPress(session);
  document.addEventListener('keyup',onKeyUp,true);
  window.addEventListener('blur',onWindowBlur);
  const session:PressSession={el,kind:'keyboard',key,dispose:()=>{
    document.removeEventListener('keyup',onKeyUp,true);
    window.removeEventListener('blur',onWindowBlur);
  }};
  activePress=session;
}
