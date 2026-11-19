import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {RefObject} from 'react';
import {canStartLiftFlip,flip,getFlipLayout,hasFreeFlipSlot} from './flip';
import type {MotionRect} from './flip';
import {highlight} from './highlight';
import type {HighlightTone} from './highlight';
import {finishedAnimation,trackAnimation} from './lifecycle';
import {consumeSelfWrite} from './self-write';
import {highlightToneColor,motionToken,prefersReducedMotion,subscribeMotion,warmMotionTokens} from './tokens';

export type MotionColumn='pending'|'active'|'handled';
export interface MotionItem {
  kind:'ticket'|'review'|'intake';
  id:string;
  intake_id:string;
  column:MotionColumn;
  closure_kind?:'COMPLETED'|'DISMISSED'|null;
}
export interface OffscreenChipState {
  count:number;
  direction:'up'|'down';
  activate:()=>void;
}
export interface BoardMotionOptions {
  view:'board'|'list';
  principalId:string;
  items:readonly MotionItem[];
  sequence:string;
  refreshing:boolean;
  ready:boolean;
  scope:string;
  arrivalKeys:readonly string[];
}
export interface BoardMotionResult {
  boardChips:Record<MotionColumn,OffscreenChipState>;
  listChip:OffscreenChipState;
}
interface CardSnapshot {
  left:number;
  top:number;
  right:number;
  bottom:number;
  width:number;
  height:number;
  column:MotionColumn;
  group:string|null;
  visible:boolean;
  intakeId:string;
}
interface LiveCard extends CardSnapshot {
  el:HTMLElement;
  columnEl:HTMLElement|null;
  collapsedHeader:HTMLElement|null;
}
interface InFlightMove {
  el:HTMLElement;
  animation:Animation;
  from:MotionRect;
  to:MotionRect;
  scrollX:number;
  scrollY:number;
  column:MotionColumn;
}
interface OffscreenEntry {
  key:string;
  direction:'up'|'down';
  tone:HighlightTone;
}

const COLUMNS:readonly MotionColumn[]=['pending','active','handled'];
const EMPTY_BOARD_OFFSCREEN:Record<MotionColumn,OffscreenEntry[]>={pending:[],active:[],handled:[]};

export function columnHighlightTone(column:MotionColumn):HighlightTone{
  return column==='pending'?'intake':column==='active'?'active':'done';
}

export function isOutsideVerticalBounds(rect:{top:number;bottom:number},topBound:number,bottomBound:number,margin:number=motionToken('--shift-md')):'up'|'down'|null{
  if(rect.bottom<=topBound+margin)return 'up';
  if(rect.top>=bottomBound-margin)return 'down';
  return null;
}

export function clampToColumnEdge(colRect:{top:number;bottom:number},target:{left:number;top:number;height:number},viewportHeight:number,edgeInset:number=motionToken('--space-12')):MotionRect{
  if(target.top+target.height<=0)return {left:target.left,top:Math.max(0,colRect.top)};
  if(target.top>=viewportHeight){
    const visibleBottom=Math.min(viewportHeight,colRect.bottom);
    return {left:target.left,top:Math.max(0,visibleBottom-Math.min(target.height,edgeInset))};
  }
  return {left:target.left,top:target.top};
}

export function interpolateFlightOrigin(from:MotionRect,to:MotionRect,progress:number|null|undefined,deltaScrollX=0,deltaScrollY=0):MotionRect{
  const p=typeof progress==='number'&&Number.isFinite(progress)?Math.min(1,Math.max(0,progress)):1;
  return {
    left:from.left+(to.left-from.left)*p-deltaScrollX,
    top:from.top+(to.top-from.top)*p-deltaScrollY,
  };
}

/** Pure during render (StrictMode-safe): returns true only after the current scope has settled at least once. */
export function useMotionScopeReady(scope:string,ready:boolean,fetching:boolean):boolean{
  const settled=useRef<string|null>(null);
  const animate=ready&&settled.current===scope;
  useLayoutEffect(()=>{
    if(settled.current===scope){if(!ready)settled.current=null;}
    else if(ready&&!fetching)settled.current=scope;
  },[scope,ready,fetching]);
  return animate;
}

/** Drives the merged closure-restored highlight on a card (column tone) or list row (brand tone). */
export function useClosureElementHighlight(ref:RefObject<HTMLElement|null>,active:boolean,tone:HighlightTone){
  useLayoutEffect(()=>{
    if(!active)return;
    const el=ref.current;
    if(!el)return;
    const handle=highlight(el,{tone});
    return()=>handle.cancel();
  },[ref,active,tone]);
}

function itemKey(item:Pick<MotionItem,'kind'|'id'>):string{
  return item.kind+':'+item.id;
}

function listGroupKey(item:MotionItem):string{
  if(item.column==='pending')return item.kind==='ticket'?'pending:ticket':'pending:intake';
  if(item.column==='handled')return item.closure_kind==='DISMISSED'?'handled:dismissed':'handled:completed';
  return 'active';
}

function groupCollapsedHeader(group:HTMLElement):HTMLElement|null{
  const trigger=group.querySelector<HTMLElement>('.ds-board-group-trigger');
  if(trigger?.getAttribute('aria-expanded')==='false')return trigger;
  const content=group.querySelector<HTMLElement>(':scope > .disclosure__content');
  if(content&&content.getAttribute('data-expanded')!=='true')return trigger;
  return null;
}

function computeColumnSignatures(items:readonly MotionItem[]):Record<MotionColumn,string>{
  const sigs:Record<MotionColumn,string[]>={pending:[],active:[],handled:[]};
  for(const item of items){
    sigs[item.column].push(item.kind+':'+item.id+':'+(item.closure_kind??''));
  }
  return {
    pending:sigs.pending.join('|'),
    active:sigs.active.join('|'),
    handled:sigs.handled.join('|'),
  };
}

function scanBoardCards(itemsByKey:Map<string,MotionItem>,inFlight:Map<string,InFlightMove>,columnsToScan?:ReadonlySet<MotionColumn>):Map<string,LiveCard>{
  const result=new Map<string,LiveCard>();
  if(columnsToScan&&columnsToScan.size===0)return result;
  const board=document.querySelector<HTMLElement>('.board');
  if(!board)return result;
  const targetCols=columnsToScan&&columnsToScan.size<COLUMNS.length?[...columnsToScan]:COLUMNS;
  const scrollX=window.scrollX,scrollY=window.scrollY;
  for(const column of targetCols){
    const columnEl=board.querySelector<HTMLElement>(`.board-column.${column}`);
    if(!columnEl)continue;
    const groupMeta=new Map<HTMLElement,{name:string|null;collapsedHeader:HTMLElement|null}>();
    const groups=columnEl.querySelectorAll<HTMLElement>('.ds-board-group');
    for(const groupEl of groups){
      groupMeta.set(groupEl,{
        name:groupEl.getAttribute('data-board-group'),
        collapsedHeader:groupCollapsedHeader(groupEl),
      });
    }
    const hasGroups=groupMeta.size>0;
    for(const card of columnEl.querySelectorAll<HTMLElement>('.ticket-card')){
      const kind=card.dataset.kind,id=card.dataset.itemId;
      if(!kind||!id)continue;
      const key=kind+':'+id;
      let group:string|null=null;
      let header:HTMLElement|null=null;
      if(hasGroups){
        const groupEl=card.closest<HTMLElement>('.ds-board-group');
        const meta=groupEl?groupMeta.get(groupEl):undefined;
        if(meta){group=meta.name;header=meta.collapsedHeader;}
      }
      const rect=card.getBoundingClientRect();
      const visible=header===null&&rect.width>0&&rect.height>0;
      const activeFlight=inFlight.get(key);
      let left=rect.left,top=rect.top;
      const isActiveFlight=Boolean(activeFlight&&activeFlight.el===card&&activeFlight.animation.playState==='running');
      if(isActiveFlight||card.dataset.motionFlipping==='true'||card.dataset.motionEntering==='true'){
        const transform=getComputedStyle(card).transform;
        if(transform&&transform!=='none'){
          const matrix=new DOMMatrixReadOnly(transform);
          left-=matrix.m41;
          top-=matrix.m42;
        }else{
          const flipLayout=getFlipLayout(card);
          if(flipLayout){left=flipLayout.left;top=flipLayout.top;}
          else if(isActiveFlight&&activeFlight){
            left=activeFlight.to.left-(scrollX-activeFlight.scrollX);
            top=activeFlight.to.top-(scrollY-activeFlight.scrollY);
          }
        }
      }
      result.set(key,{
        el:card,
        columnEl,
        collapsedHeader:header,
        left,
        top,
        right:left+rect.width,
        bottom:top+rect.height,
        width:rect.width,
        height:rect.height,
        column,
        group,
        visible,
        intakeId:itemsByKey.get(key)?.intake_id??'',
      });
    }
  }
  return result;
}

function toSnapshot(card:LiveCard):CardSnapshot{
  return {
    left:card.left,
    top:card.top,
    right:card.right,
    bottom:card.bottom,
    width:card.width,
    height:card.height,
    column:card.column,
    group:card.group,
    visible:card.visible,
    intakeId:card.intakeId,
  };
}

function enterSlide(el:HTMLElement):Animation{
  if(document.hidden||prefersReducedMotion())return finishedAnimation(el);
  const shift=motionToken('--shift-md');
  if(el.dataset)el.dataset.motionEntering='true';
  const animation=el.animate(
    [{transform:`translateY(${-shift}px)`,opacity:0},{transform:'translateY(0)',opacity:1}],
    {duration:motionToken('--dur-base'),easing:motionToken('--ease-standard')},
  );
  return trackAnimation(animation,()=>{if(el.dataset)delete el.dataset.motionEntering;});
}

function createFlightGhost(source:HTMLElement,width:number,target:MotionRect):HTMLElement{
  const clone=source.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id');
  clone.removeAttribute('data-item-id');
  clone.removeAttribute('data-kind');
  clone.removeAttribute('data-closure-highlight');
  clone.removeAttribute('data-presence');
  for(const node of clone.querySelectorAll('[id],[data-item-id],[data-kind]')){
    node.removeAttribute('id');
    node.removeAttribute('data-item-id');
    node.removeAttribute('data-kind');
  }
  clone.setAttribute('aria-hidden','true');
  clone.setAttribute('data-motion-flight','collapsed');
  clone.inert=true;
  clone.style.position='fixed';
  clone.style.left=`${target.left}px`;
  clone.style.top=`${target.top}px`;
  clone.style.width=`${width}px`;
  clone.style.margin='0';
  clone.style.pointerEvents='none';
  return clone;
}

function findCardElement(key:string):HTMLElement|null{
  const split=key.indexOf(':');
  if(split<0)return null;
  const kind=key.slice(0,split),id=key.slice(split+1);
  return document.querySelector<HTMLElement>(`.board .ticket-card[data-kind="${CSS.escape(kind)}"][data-item-id="${CSS.escape(id)}"]`);
}

function findRowElement(key:string):HTMLTableRowElement|null{
  const split=key.indexOf(':');
  if(split<0)return null;
  const kind=key.slice(0,split),id=key.slice(split+1);
  return document.getElementById(`list-item-${kind}-${id}`) as HTMLTableRowElement|null;
}

function tableVisibleBounds():{wrap:HTMLElement|null;headHeight:number;top:number;bottom:number}{
  const wrap=document.querySelector<HTMLElement>('.ds-work-table-wrap');
  if(!wrap)return {wrap:null,headHeight:0,top:0,bottom:window.innerHeight};
  const wrapRect=wrap.getBoundingClientRect();
  const headHeight=wrap.querySelector('thead')?.getBoundingClientRect().height??0;
  return {
    wrap,
    headHeight,
    top:Math.max(0,wrapRect.top+headHeight),
    bottom:Math.min(window.innerHeight,wrapRect.bottom),
  };
}

function sameEntries(a:readonly OffscreenEntry[],b:readonly OffscreenEntry[]):boolean{
  return a.length===b.length&&a.every((entry,index)=>entry.key===b[index]?.key&&entry.direction===b[index]?.direction&&entry.tone===b[index]?.tone);
}

/**
 * Coordinates server-confirmed data motion (B1 card moves & make-room/close-up,
 * B2 arrivals & off-screen chips, B3 list highlights & chip) without retaining business DTOs.
 */
export function useBoardCardMotion({view,principalId,items,sequence,refreshing,ready,scope,arrivalKeys}:BoardMotionOptions):BoardMotionResult{
  const previousCards=useRef(new Map<string,CardSnapshot>());
  const departedCards=useRef(new Map<string,CardSnapshot>());
  const prevColumnSignatures=useRef<Record<MotionColumn,string>>({pending:'',active:'',handled:''});
  const lastCommitSig=useRef('');
  const previousList=useRef(new Map<string,{column:MotionColumn;groupKey:string;intakeId:string}>());
  const owner=useRef<string|null>(null);
  const settled=useRef(false);
  const seenArrivals=useRef(new Set<string>());
  const inFlight=useRef(new Map<string,InFlightMove>());
  const flightGhosts=useRef(new Set<HTMLElement>());
  const arrivalAnimations=useRef(new Set<Animation>());
  const scrollOrigin=useRef({x:0,y:0});
  const itemsByKeyRef=useRef(new Map<string,MotionItem>());
  const [boardOffscreen,setBoardOffscreen]=useState<Record<MotionColumn,OffscreenEntry[]>>(EMPTY_BOARD_OFFSCREEN);
  const [listOffscreen,setListOffscreen]=useState<OffscreenEntry[]>([]);
  const boardOffscreenRef=useRef(boardOffscreen);boardOffscreenRef.current=boardOffscreen;
  const listOffscreenRef=useRef(listOffscreen);listOffscreenRef.current=listOffscreen;
  const revealedKeys=useRef(new Set<string>());
  const pendingSettled=useRef(new Map<string,HTMLElement>());
  const settledFrame=useRef(0);
  const deferredHighlightBatches=useRef(new Map<ReturnType<typeof setTimeout>,Array<{el:HTMLElement;tone:HighlightTone;bg:string|undefined}>>());
  const followUpHighlights=useRef(new Map<Animation,{el:HTMLElement;tone:HighlightTone;bg:string|undefined}>());

  const scheduleSettledRectRefresh=useCallback((key:string,el:HTMLElement)=>{
    pendingSettled.current.set(key,el);
    if(settledFrame.current)return;
    settledFrame.current=requestAnimationFrame(()=>{
      settledFrame.current=0;
      const batch=pendingSettled.current;
      if(!batch.size)return;
      const entries=[...batch.entries()];
      batch.clear();
      for(const [itemKeyEntry,node] of entries){
        if(!node.isConnected)continue;
        const stored=previousCards.current.get(itemKeyEntry);
        if(!stored||!stored.visible)continue;
        const activeFlight=inFlight.current.get(itemKeyEntry);
        if(activeFlight&&activeFlight.el===node&&activeFlight.animation.playState==='running')continue;
        const flipLayout=getFlipLayout(node);
        if(flipLayout){
          stored.left=flipLayout.left;stored.top=flipLayout.top;
          stored.right=flipLayout.left+stored.width;stored.bottom=flipLayout.top+stored.height;
          continue;
        }
        if(node.dataset.motionFlipping==='true'||node.dataset.motionEntering==='true')continue;
        const rect=node.getBoundingClientRect();
        if(rect.width<=0||rect.height<=0)continue;
        stored.left=rect.left;stored.top=rect.top;
        stored.right=rect.right;stored.bottom=rect.bottom;
        stored.width=rect.width;stored.height=rect.height;
      }
    });
  },[]);

  const drainPendingHighlights=useCallback(()=>{
    const pending:Array<{el:HTMLElement;tone:HighlightTone;bg:string|undefined}>=[];
    if(deferredHighlightBatches.current.size>0){
      const entries=[...deferredHighlightBatches.current.entries()];
      deferredHighlightBatches.current.clear();
      for(const [timer,batch] of entries){
        clearTimeout(timer);
        pending.push(...batch);
      }
    }
    if(followUpHighlights.current.size>0){
      pending.push(...followUpHighlights.current.values());
      followUpHighlights.current.clear();
    }
    return pending;
  },[]);

  const clearTransientEffects=useCallback(()=>{
    if(settledFrame.current){cancelAnimationFrame(settledFrame.current);settledFrame.current=0;}
    pendingSettled.current.clear();
    for(const timer of deferredHighlightBatches.current.keys())clearTimeout(timer);
    deferredHighlightBatches.current.clear();
    followUpHighlights.current.clear();
    for(const flight of inFlight.current.values())flight.animation.cancel();
    inFlight.current.clear();
    for(const ghost of flightGhosts.current)ghost.remove();
    flightGhosts.current.clear();
    for(const animation of arrivalAnimations.current)animation.cancel();
    arrivalAnimations.current.clear();
  },[]);

  useEffect(()=>{
    scrollOrigin.current={x:window.scrollX,y:window.scrollY};
    const refreshBaseline=()=>{
      pendingSettled.current.clear();
      const scanned=scanBoardCards(itemsByKeyRef.current,inFlight.current);
      const merged=new Map(previousCards.current);
      for(const [key,card] of scanned)merged.set(key,toSnapshot(card));
      previousCards.current=merged;
      scrollOrigin.current={x:window.scrollX,y:window.scrollY};
    };
    // Refresh coordinates at explicit gestures, resize, and group/remainder expand-collapse without animating.
    const capture=(event:Event)=>{
      if(event.target instanceof Element&&event.target.closest('.board'))refreshBaseline();
    };
    const onScroll=()=>{
      const dx=window.scrollX-scrollOrigin.current.x,dy=window.scrollY-scrollOrigin.current.y;
      scrollOrigin.current={x:window.scrollX,y:window.scrollY};
      if(!dx&&!dy)return;
      for(const snap of previousCards.current.values()){
        snap.left-=dx;snap.right-=dx;snap.top-=dy;snap.bottom-=dy;
      }
      for(const snap of departedCards.current.values()){
        snap.left-=dx;snap.right-=dx;snap.top-=dy;snap.bottom-=dy;
      }
    };
    const onResize=()=>{if(document.querySelector('.board'))refreshBaseline();};
    const onTransitionEnd=(event:Event)=>{
      if(event.target instanceof Element&&event.target.closest('.board')&&(event.target.matches('.disclosure__content,.ds-collapse'))){
        refreshBaseline();
      }
    };
    let clickFrame=0;
    const onClick=(event:Event)=>{
      if(event.target instanceof Element&&event.target.closest('.board')&&event.target.closest('.ds-board-group-trigger,[data-action=expand-column]')){
        cancelAnimationFrame(clickFrame);
        clickFrame=requestAnimationFrame(refreshBaseline);
      }
    };
    const unsubscribe=subscribeMotion(()=>{
      if(document.hidden){
        clearTransientEffects();
      }else if(prefersReducedMotion()){
        const pendingHighlights=drainPendingHighlights();
        clearTransientEffects();
        for(const {el,tone,bg} of pendingHighlights){
          if(el.isConnected)highlight(el,{tone,...(bg?{background:bg}:{})});
        }
      }
    });
    document.addEventListener('pointerdown',capture,true);
    window.addEventListener('keydown',capture,true);
    window.addEventListener('scroll',onScroll,{capture:true,passive:true});
    window.addEventListener('resize',onResize,{passive:true});
    document.addEventListener('transitionend',onTransitionEnd,true);
    document.addEventListener('click',onClick,true);
    return()=>{
      cancelAnimationFrame(clickFrame);
      document.removeEventListener('pointerdown',capture,true);
      window.removeEventListener('keydown',capture,true);
      window.removeEventListener('scroll',onScroll,true);
      window.removeEventListener('resize',onResize);
      document.removeEventListener('transitionend',onTransitionEnd,true);
      document.removeEventListener('click',onClick,true);
      unsubscribe();
      clearTransientEffects();
    };
  },[clearTransientEffects,drainPendingHighlights]);

  const arrivalSignature=arrivalKeys.join('|');
  useLayoutEffect(()=>{
    const itemsByKey=new Map<string,MotionItem>();
    for(const item of items)itemsByKey.set(itemKey(item),item);
    itemsByKeyRef.current=itemsByKey;

    if(owner.current!==scope){
      owner.current=scope;
      settled.current=false;
      lastCommitSig.current='';
      clearTransientEffects();
      previousCards.current.clear();
      departedCards.current.clear();
      prevColumnSignatures.current={pending:'',active:'',handled:''};
      previousList.current.clear();
      seenArrivals.current.clear();
      revealedKeys.current.clear();
      setBoardOffscreen(current=>COLUMNS.every(col=>current[col].length===0)?current:EMPTY_BOARD_OFFSCREEN);
      setListOffscreen(current=>current.length===0?current:[]);
    }

    const commitSig=view+'|'+scope+'|'+sequence+'|'+arrivalSignature;

    if(view==='board'){
      const newArrivals=new Set(arrivalKeys);
      const nextColSigs=computeColumnSignatures(items);

      if(!settled.current){
        if(ready&&!refreshing){
          const initial=scanBoardCards(itemsByKey,inFlight.current);
          warmMotionTokens();
          scrollOrigin.current={x:window.scrollX,y:window.scrollY};
          settled.current=true;
          lastCommitSig.current=commitSig;
          prevColumnSignatures.current=nextColSigs;
          previousCards.current=new Map([...initial].map(([k,v])=>[k,toSnapshot(v)]));
          departedCards.current.clear();
          seenArrivals.current=new Set(newArrivals);
        }
        return;
      }

      if(commitSig===lastCommitSig.current){
        if(!refreshing){
          departedCards.current.clear();
          for(const k of previousCards.current.keys())if(!itemsByKey.has(k))previousCards.current.delete(k);
        }
        return;
      }
      lastCommitSig.current=commitSig;

      const prev=previousCards.current;
      const departed=departedCards.current;

      // Determine which columns actually changed so unaffected columns skip DOM queries and layout reads.
      const columnsToScan=new Set<MotionColumn>();
      if(window.innerWidth<=900){
        for(const col of COLUMNS)columnsToScan.add(col);
      }else{
        for(const col of COLUMNS){
          if(nextColSigs[col]!==prevColumnSignatures.current[col])columnsToScan.add(col);
        }
        for(const item of items){
          const key=itemKey(item);
          if(!prev.has(key)||(newArrivals.has(key)&&!seenArrivals.current.has(key))){
            columnsToScan.add(item.column);
          }
        }
      }

      // Single batched read phase: measure cards in affected columns first (forces layout and browser scroll anchoring).
      const scanned=scanBoardCards(itemsByKey,inFlight.current,columnsToScan);
      for(const key of scanned.keys())pendingSettled.current.delete(key);
      const anchorDx=window.scrollX-scrollOrigin.current.x,anchorDy=window.scrollY-scrollOrigin.current.y;
      scrollOrigin.current={x:window.scrollX,y:window.scrollY};
      if(anchorDx||anchorDy){
        for(const snap of departed.values()){
          snap.left-=anchorDx;snap.right-=anchorDx;snap.top-=anchorDy;snap.bottom-=anchorDy;
        }
      }
      const viewportHeight=window.innerHeight;

      const prevByIntake=new Map<string,{key:string;snapshot:CardSnapshot}>();
      for(const [k,snap] of prev)if(snap.intakeId)prevByIntake.set(snap.intakeId,{key:k,snapshot:snap});
      const departedByIntake=new Map<string,{key:string;snapshot:CardSnapshot}>();
      for(const [k,snap] of departed)if(snap.intakeId)departedByIntake.set(snap.intakeId,{key:k,snapshot:snap});

      // Prune off-screen entries whose items left their column.
      const nextOffscreen:Record<MotionColumn,OffscreenEntry[]>={
        pending:boardOffscreenRef.current.pending.filter(entry=>itemsByKey.get(entry.key)?.column==='pending'),
        active:boardOffscreenRef.current.active.filter(entry=>itemsByKey.get(entry.key)?.column==='active'),
        handled:boardOffscreenRef.current.handled.filter(entry=>itemsByKey.get(entry.key)?.column==='handled'),
      };
      const addBoardOffscreen=(column:MotionColumn,entry:OffscreenEntry)=>{
        if(nextOffscreen[column].some(existing=>existing.key===entry.key))return;
        revealedKeys.current.delete(entry.key);
        nextOffscreen[column]=[...nextOffscreen[column],entry];
      };

      interface PlannedMove {
        key:string;
        oldKey:string;
        curr:LiveCard;
        old:CardSnapshot;
        fromVisual:MotionRect;
        selfCaused:boolean;
      }
      const moves:PlannedMove[]=[];
      const movedKeys=new Set<string>();
      const movedFromCollapsedKeys=new Set<string>();
      const handledSelfChecked=new Map<string,boolean>();
      const visuallyAffectedColumns=new Set<MotionColumn>();

      // Detect cards that disappeared from a visible slot in this commit (for close-up in old column).
      for(const [oldKey,oldSnap] of prev){
        if(!columnsToScan.has(oldSnap.column))continue;
        const curr=scanned.get(oldKey);
        if(!curr&&!itemsByKey.has(oldKey)&&refreshing){
          departed.set(oldKey,oldSnap);
        }
        if(!oldSnap.visible)continue;
        if(!curr||!curr.visible||curr.column!==oldSnap.column){
          if(isOutsideVerticalBounds(oldSnap,0,viewportHeight)===null){
            visuallyAffectedColumns.add(oldSnap.column);
          }
        }
      }

      // 1. Identify server-confirmed column changes.
      for(const [key,curr] of scanned){
        let oldKey=key,old=prev.get(key),fromDeparted=false;
        if(!old){
          const dep=departed.get(key);
          if(dep){old=dep;fromDeparted=true;}
        }
        if(!old&&curr.intakeId){
          const matchedPrev=prevByIntake.get(curr.intakeId);
          if(matchedPrev&&matchedPrev.snapshot.column!==curr.column){
            oldKey=matchedPrev.key;
            old=matchedPrev.snapshot;
            fromDeparted=false;
          }else{
            const matchedDep=departedByIntake.get(curr.intakeId);
            if(matchedDep&&matchedDep.snapshot.column!==curr.column){
              oldKey=matchedDep.key;
              old=matchedDep.snapshot;
              fromDeparted=true;
            }
          }
        }
        if(!old||old.column===curr.column)continue;
        if(fromDeparted)departed.delete(oldKey);
        const item=itemsByKey.get(key);
        const selfCaused=item?consumeSelfWrite(principalId,{kind:item.kind,id:item.id,intakeId:item.intake_id}):false;
        handledSelfChecked.set(key,selfCaused);

        if(!old.visible){
          // Came from a collapsed group (e.g. restored from collapsed 已关闭): treat as B2 arrival into the new column.
          movedFromCollapsedKeys.add(key);
          continue;
        }

        const flight=inFlight.current.get(oldKey)??inFlight.current.get(key);
        let fromVisual:MotionRect={left:old.left,top:old.top};
        if(flight&&flight.animation.playState==='running'&&flight.el!==curr.el){
          const timing=flight.animation.effect?.getComputedTiming();
          fromVisual=interpolateFlightOrigin(flight.from,flight.to,timing?.progress,window.scrollX-flight.scrollX,window.scrollY-flight.scrollY);
          followUpHighlights.current.delete(flight.animation);
          flight.animation.cancel();
          inFlight.current.delete(oldKey);
          inFlight.current.delete(key);
        }

        movedKeys.add(key);
        if(!fromDeparted&&isOutsideVerticalBounds(old,0,viewportHeight)===null)visuallyAffectedColumns.add(old.column);
        if(curr.visible&&isOutsideVerticalBounds(curr,0,viewportHeight)===null)visuallyAffectedColumns.add(curr.column);
        moves.push({key,oldKey,curr,old,fromVisual,selfCaused});
      }

      // 2. Identify new arrivals (brand new items + items emerging from collapsed groups).
      const arrivalsToProcess:Array<{key:string;curr:LiveCard;selfCaused:boolean}>=[];
      for(const key of new Set([...newArrivals,...movedFromCollapsedKeys])){
        if(movedKeys.has(key))continue;
        if(!movedFromCollapsedKeys.has(key)&&seenArrivals.current.has(key))continue;
        const curr=scanned.get(key);
        if(!curr||!curr.visible)continue;
        const item=itemsByKey.get(key);
        const selfCaused=handledSelfChecked.has(key)?(handledSelfChecked.get(key)===true):(item?consumeSelfWrite(principalId,{kind:item.kind,id:item.id,intakeId:item.intake_id}):false);
        arrivalsToProcess.push({key,curr,selfCaused});
        if(isOutsideVerticalBounds(curr,0,viewportHeight)===null)visuallyAffectedColumns.add(curr.column);
      }

      // Complete all remaining DOM & computed-style reads before any writes / animate() calls.
      const columnRects=new Map<HTMLElement,DOMRect>();
      const headerRects=new Map<HTMLElement,DOMRect>();
      const cardBackgrounds=new Map<HTMLElement,string>();
      let sharedUnselectedCardBg:string|null=null;
      const sampleCardBackground=(el:HTMLElement)=>{
        if(cardBackgrounds.has(el))return;
        if(!el.style.backgroundColor&&!el.classList.contains('is-selected')&&!el.dataset.reminderLocated){
          if(sharedUnselectedCardBg===null)sharedUnselectedCardBg=getComputedStyle(el).backgroundColor;
          cardBackgrounds.set(el,sharedUnselectedCardBg);
        }else{
          cardBackgrounds.set(el,getComputedStyle(el).backgroundColor);
        }
      };
      for(const move of moves){
        const {curr,selfCaused}=move;
        if(curr.collapsedHeader){
          if(!headerRects.has(curr.collapsedHeader))headerRects.set(curr.collapsedHeader,curr.collapsedHeader.getBoundingClientRect());
          if(curr.columnEl&&!columnRects.has(curr.columnEl))columnRects.set(curr.columnEl,curr.columnEl.getBoundingClientRect());
        }else if(isOutsideVerticalBounds(curr,0,viewportHeight)!==null){
          if(curr.columnEl&&!columnRects.has(curr.columnEl))columnRects.set(curr.columnEl,curr.columnEl.getBoundingClientRect());
        }else if(!selfCaused){
          sampleCardBackground(curr.el);
          highlightToneColor(columnHighlightTone(curr.column));
        }
      }
      for(const {curr,selfCaused} of arrivalsToProcess){
        if(!selfCaused&&isOutsideVerticalBounds(curr,0,viewportHeight)===null){
          sampleCardBackground(curr.el);
          highlightToneColor(columnHighlightTone(curr.column));
        }
      }

      // Write / Animate Phase: no layout, scroll, or computed-style reads between animate() calls.
      const currentScroll={x:scrollOrigin.current.x,y:scrollOrigin.current.y};
      const motionDisabled=document.hidden||prefersReducedMotion();
      let liftSlotsExhausted=motionDisabled;
      const snappedHighlights:Array<{el:HTMLElement;tone:HighlightTone;bg:string|undefined}>=[];
      // Priority 1: Moving cards first so they claim the 6 FLIP slots.
      for(const move of moves){
        const {key,curr,old,fromVisual,selfCaused}=move;
        const tone=columnHighlightTone(curr.column);
        if(curr.collapsedHeader){
          const headerRect=headerRects.get(curr.collapsedHeader);
          const colRect=curr.columnEl?columnRects.get(curr.columnEl):undefined;
          if(headerRect&&!motionDisabled&&!liftSlotsExhausted){
            const target=colRect?clampToColumnEdge(colRect,{left:headerRect.left,top:headerRect.top,height:headerRect.height},viewportHeight):{left:headerRect.left,top:headerRect.top};
            const ghost=createFlightGhost(curr.el,old.width,target);
            document.body.appendChild(ghost);
            const animation=flip(ghost,fromVisual,target,{duration:'--dur-move',easing:'--ease-soft',lift:true,fadeOut:true,scroll:currentScroll});
            if(animation.playState==='finished'){
              ghost.remove();
              if(!canStartLiftFlip(ghost))liftSlotsExhausted=true;
            }else{
              flightGhosts.current.add(ghost);
              const cleanup=()=>{ghost.remove();flightGhosts.current.delete(ghost);};
              void animation.finished.then(cleanup,cleanup);
            }
          }
          continue;
        }

        const offDir=isOutsideVerticalBounds(curr,0,viewportHeight);
        if(offDir){
          if(!liftSlotsExhausted||curr.el.dataset.motionFlipping==='true'){
            const colRect=curr.columnEl?columnRects.get(curr.columnEl):undefined;
            const edge=colRect?clampToColumnEdge(colRect,{left:curr.left,top:curr.top,height:curr.height},viewportHeight):{left:curr.left,top:offDir==='up'?0:Math.max(0,viewportHeight-motionToken('--space-12'))};
            const animation=flip(curr.el,fromVisual,{left:curr.left,top:curr.top},{duration:'--dur-move',easing:'--ease-soft',lift:true,fadeOut:true,end:edge,scroll:currentScroll});
            if(animation.playState==='running'){
              const record:InFlightMove={el:curr.el,animation,from:fromVisual,to:edge,scrollX:currentScroll.x,scrollY:currentScroll.y,column:curr.column};
              inFlight.current.set(key,record);
              const release=()=>{if(inFlight.current.get(key)===record)inFlight.current.delete(key);};
              void animation.finished.then(release,release);
            }else if(!canStartLiftFlip(curr.el)){
              liftSlotsExhausted=true;
            }
          }
          if(!selfCaused)addBoardOffscreen(curr.column,{key,direction:offDir,tone});
          continue;
        }

        if(liftSlotsExhausted&&curr.el.dataset.motionFlipping!=='true'){
          if(!selfCaused){
            const bg=cardBackgrounds.get(curr.el);
            if(motionDisabled){
              if(!document.hidden){
                void Promise.resolve().then(()=>{
                  if(curr.el.isConnected&&!document.hidden)highlight(curr.el,{tone,...(bg?{background:bg}:{})});
                });
              }
            }else{
              snappedHighlights.push({el:curr.el,tone,bg});
            }
          }
          continue;
        }

        const toRect:MotionRect={left:curr.left,top:curr.top};
        const animation=flip(curr.el,fromVisual,toRect,{duration:'--dur-move',easing:'--ease-soft',lift:true,scroll:currentScroll});
        if(animation.playState==='running'){
          const record:InFlightMove={el:curr.el,animation,from:fromVisual,to:toRect,scrollX:currentScroll.x,scrollY:currentScroll.y,column:curr.column};
          inFlight.current.set(key,record);
          const release=()=>{
            if(inFlight.current.get(key)===record){
              inFlight.current.delete(key);
              if(curr.el.isConnected)scheduleSettledRectRefresh(key,curr.el);
            }
          };
          void animation.finished.then(release,release);
        }else if(!canStartLiftFlip(curr.el)){
          liftSlotsExhausted=true;
        }
        if(!selfCaused){
          const bg=cardBackgrounds.get(curr.el);
          const entry={el:curr.el,tone,bg};
          followUpHighlights.current.set(animation,entry);
          void animation.finished.then(()=>{
            if(!followUpHighlights.current.delete(animation))return;
            if(entry.el.isConnected&&!document.hidden)highlight(entry.el,{tone:entry.tone,...(entry.bg?{background:entry.bg}:{})});
          },()=>{
            followUpHighlights.current.delete(animation);
          });
        }
      }

      if(snappedHighlights.length>0){
        const batch=snappedHighlights;
        const timer=setTimeout(()=>{
          deferredHighlightBatches.current.delete(timer);
          for(const {el,tone,bg} of batch){
            if(el.isConnected)highlight(el,{tone,...(bg?{background:bg}:{})});
          }
        },0);
        deferredHighlightBatches.current.set(timer,batch);
      }

      // Priority 2: Make-room / close-up sibling cards in affected columns.
      if(visuallyAffectedColumns.size>0&&!liftSlotsExhausted){
        const arrivedKeySet=new Set(arrivalsToProcess.map(entry=>entry.key));
        for(const [key,curr] of scanned){
          if(movedKeys.has(key)||arrivedKeySet.has(key)||!curr.visible)continue;
          if(!visuallyAffectedColumns.has(curr.column))continue;
          const activeFlight=inFlight.current.get(key);
          if(activeFlight&&activeFlight.el===curr.el&&activeFlight.animation.playState==='running'){
            activeFlight.to={left:curr.left,top:curr.top};
            activeFlight.scrollX=currentScroll.x;
            activeFlight.scrollY=currentScroll.y;
            continue;
          }
          if(!hasFreeFlipSlot()&&curr.el.dataset.motionFlipping!=='true')continue;
          const old=prev.get(key);
          if(!old||!old.visible||old.column!==curr.column||old.group!==curr.group)continue;
          // 1px sub-pixel layout rounding tolerance (not a visual offset).
          if(Math.abs(old.left-curr.left)<1&&Math.abs(old.top-curr.top)<1)continue;
          // Skip cards completely outside the viewport both before and after so visible cards get the 6 slots.
          if(isOutsideVerticalBounds(old,0,viewportHeight)!==null&&isOutsideVerticalBounds(curr,0,viewportHeight)!==null)continue;
          const animation=flip(curr.el,{left:old.left,top:old.top},{left:curr.left,top:curr.top},{duration:'--dur-base',easing:'--ease-standard',scroll:currentScroll});
          if(animation.playState==='running'){
            const el=curr.el,runScope=scope;
            void animation.finished.then(()=>{
              if(owner.current===runScope&&!document.hidden&&el.isConnected)scheduleSettledRectRefresh(key,el);
            },()=>{});
          }
        }
      }

      // Priority 3: New arrivals (B2).
      for(const {key,curr,selfCaused} of arrivalsToProcess){
        const tone=columnHighlightTone(curr.column);
        const offDir=isOutsideVerticalBounds(curr,0,viewportHeight);
        if(offDir){
          if(!selfCaused)addBoardOffscreen(curr.column,{key,direction:offDir,tone});
          continue;
        }
        const animation=enterSlide(curr.el);
        if(animation.playState==='running'){
          arrivalAnimations.current.add(animation);
          const release=()=>arrivalAnimations.current.delete(animation);
          void animation.finished.then(release,release);
        }
        if(!selfCaused){
          const bg=cardBackgrounds.get(curr.el);
          const entry={el:curr.el,tone,bg};
          followUpHighlights.current.set(animation,entry);
          void animation.finished.then(()=>{
            if(!followUpHighlights.current.delete(animation))return;
            if(entry.el.isConnected&&!document.hidden)highlight(entry.el,{tone:entry.tone,...(entry.bg?{background:entry.bg}:{})});
          },()=>{
            followUpHighlights.current.delete(animation);
          });
        }
      }

      setBoardOffscreen(current=>COLUMNS.every(col=>sameEntries(current[col],nextOffscreen[col]))?current:nextOffscreen);
      seenArrivals.current=new Set(newArrivals);
      const nextSnapshots=new Map<string,CardSnapshot>();
      for(const key of itemsByKey.keys()){
        const live=scanned.get(key);
        if(live)nextSnapshots.set(key,toSnapshot(live));
        else{
          const existing=prev.get(key);
          if(existing){
            if(anchorDx||anchorDy){
              existing.left-=anchorDx;existing.right-=anchorDx;existing.top-=anchorDy;existing.bottom-=anchorDy;
            }
            nextSnapshots.set(key,existing);
          }
        }
      }
      previousCards.current=nextSnapshots;
      prevColumnSignatures.current=nextColSigs;
      if(!refreshing)departed.clear();
      return;
    }

    // List view (B3): rows never move; highlight brand on other/system group-change or new row; chip if outside viewport.
    const nextList=new Map<string,{column:MotionColumn;groupKey:string;intakeId:string}>();
    for(const item of items)nextList.set(itemKey(item),{column:item.column,groupKey:listGroupKey(item),intakeId:item.intake_id});
    const newArrivals=new Set(arrivalKeys);

    if(!settled.current){
      if(ready&&!refreshing){
        warmMotionTokens();
        settled.current=true;
        lastCommitSig.current=commitSig;
        previousList.current=nextList;
        seenArrivals.current=new Set(newArrivals);
      }
      return;
    }

    if(commitSig===lastCommitSig.current){
      if(!refreshing){
        for(const k of previousList.current.keys())if(!itemsByKey.has(k))previousList.current.delete(k);
      }
      return;
    }
    lastCommitSig.current=commitSig;

    const prevList=previousList.current;
    const prevListByIntake=new Map<string,{column:MotionColumn;groupKey:string;intakeId:string}>();
    for(const entry of prevList.values())if(entry.intakeId)prevListByIntake.set(entry.intakeId,entry);

    const nextOffscreen=listOffscreenRef.current.filter(entry=>itemsByKey.has(entry.key));
    const candidates:Array<{key:string;row:HTMLTableRowElement}>=[];

    for(const item of items){
      const key=itemKey(item);
      const curr=nextList.get(key);
      if(!curr)continue;
      const old=prevList.get(key)??(item.intake_id?prevListByIntake.get(item.intake_id):undefined);
      const isGroupChange=Boolean(old&&old.groupKey!==curr.groupKey);
      const isNewRow=newArrivals.has(key)&&!seenArrivals.current.has(key);
      if(!isGroupChange&&!isNewRow)continue;
      const selfCaused=consumeSelfWrite(principalId,{kind:item.kind,id:item.id,intakeId:item.intake_id});
      if(selfCaused)continue;
      const row=findRowElement(key);
      if(!row||row.hidden)continue;
      candidates.push({key,row});
    }

    if(candidates.length>0){
      // Single batched read phase for list rows before any highlight() animate calls.
      const bounds=tableVisibleBounds();
      const shiftSm=motionToken('--shift-sm');
      let sharedRowBg:string|null=null;
      const measured:Array<{key:string;row:HTMLTableRowElement;offDir:'up'|'down'|null;bg:string}>=[];
      for(const {key,row} of candidates){
        const rect=row.getBoundingClientRect();
        if(rect.width<=0||rect.height<=0)continue;
        let bg:string;
        if(!row.style.backgroundColor&&!row.classList.contains('is-selected')){
          if(sharedRowBg===null)sharedRowBg=getComputedStyle(row).backgroundColor;
          bg=sharedRowBg;
        }else{
          bg=getComputedStyle(row).backgroundColor;
        }
        measured.push({key,row,offDir:isOutsideVerticalBounds(rect,bounds.top,bounds.bottom,shiftSm),bg});
      }
      for(const {key,row,offDir,bg} of measured){
        if(offDir){
          if(!nextOffscreen.some(entry=>entry.key===key)){
            revealedKeys.current.delete(key);
            nextOffscreen.push({key,direction:offDir,tone:'brand'});
          }
        }else{
          highlight(row,{tone:'brand',background:bg});
        }
      }
    }

    setListOffscreen(current=>sameEntries(current,nextOffscreen)?current:nextOffscreen);
    seenArrivals.current=new Set(newArrivals);
    previousList.current=refreshing?new Map([...prevList,...nextList]):nextList;
  },[view,principalId,sequence,refreshing,ready,scope,arrivalSignature,clearTransientEffects,scheduleSettledRectRefresh]);

  // IntersectionObserver for board off-screen arrivals: scrolling them into view dismisses chip and highlights once.
  const boardOffscreenKey=COLUMNS.map(col=>col+':'+boardOffscreen[col].map(entry=>entry.key).join(',')).join('|');
  useEffect(()=>{
    if(view!=='board'||typeof IntersectionObserver==='undefined')return;
    const targets=new Map<Element,{column:MotionColumn;entry:OffscreenEntry}>();
    for(const col of COLUMNS){
      for(const entry of boardOffscreenRef.current[col]){
        const el=findCardElement(entry.key);
        if(el)targets.set(el,{column:col,entry});
      }
    }
    if(!targets.size)return;
    const observer=new IntersectionObserver(entries=>{
      const revealed:Array<{column:MotionColumn;entry:OffscreenEntry;el:HTMLElement}>=[];
      for(const ioEntry of entries){
        if(!ioEntry.isIntersecting)continue;
        const meta=targets.get(ioEntry.target);
        if(!meta||revealedKeys.current.has(meta.entry.key))continue;
        const el=ioEntry.target as HTMLElement;
        if(isOutsideVerticalBounds(el.getBoundingClientRect(),0,window.innerHeight)!==null)continue;
        revealedKeys.current.add(meta.entry.key);
        revealed.push({...meta,el});
      }
      if(!revealed.length)return;
      const removed=new Set(revealed.map(item=>item.entry.key));
      setBoardOffscreen(current=>{
        let changed=false;
        const next:Record<MotionColumn,OffscreenEntry[]>={pending:current.pending,active:current.active,handled:current.handled};
        for(const col of COLUMNS){
          const filtered=current[col].filter(entry=>!removed.has(entry.key));
          if(filtered.length!==current[col].length){next[col]=filtered;changed=true;}
        }
        return changed?next:current;
      });
      for(const item of revealed){
        observer.unobserve(item.el);
        if(item.el.isConnected)highlight(item.el,{tone:item.entry.tone});
      }
    },{threshold:0.1});
    for(const el of targets.keys())observer.observe(el);
    return()=>observer.disconnect();
  },[view,boardOffscreenKey]);

  // IntersectionObserver for list off-screen arrivals: observes both internal table scroll and window viewport.
  const listOffscreenKey=listOffscreen.map(entry=>entry.key).join(',');
  useEffect(()=>{
    if(view!=='list'||!listOffscreenRef.current.length||typeof IntersectionObserver==='undefined')return;
    const targets=new Map<Element,OffscreenEntry>();
    for(const entry of listOffscreenRef.current){
      const row=findRowElement(entry.key);
      if(row&&!row.hidden)targets.set(row,entry);
    }
    if(!targets.size)return;
    const {wrap,headHeight}=tableVisibleBounds();
    const handleEntries=(entries:IntersectionObserverEntry[])=>{
      const currentBounds=tableVisibleBounds();
      const revealed:Array<{entry:OffscreenEntry;el:HTMLElement}>=[];
      for(const ioEntry of entries){
        if(!ioEntry.isIntersecting)continue;
        const entry=targets.get(ioEntry.target);
        if(!entry||revealedKeys.current.has(entry.key))continue;
        const el=ioEntry.target as HTMLElement;
        if(isOutsideVerticalBounds(el.getBoundingClientRect(),currentBounds.top,currentBounds.bottom,motionToken('--shift-sm'))!==null)continue;
        revealedKeys.current.add(entry.key);
        revealed.push({entry,el});
      }
      if(!revealed.length)return;
      const removed=new Set(revealed.map(item=>item.entry.key));
      setListOffscreen(current=>{
        const filtered=current.filter(entry=>!removed.has(entry.key));
        return filtered.length===current.length?current:filtered;
      });
      for(const item of revealed){
        for(const obs of observers)obs.unobserve(item.el);
        if(item.el.isConnected)highlight(item.el,{tone:item.entry.tone});
      }
    };
    const observers:IntersectionObserver[]=[new IntersectionObserver(handleEntries,{threshold:0.1})];
    if(wrap){
      observers.push(new IntersectionObserver(handleEntries,{root:wrap,rootMargin:`-${Math.ceil(headHeight)}px 0px 0px 0px`,threshold:0.1}));
    }
    for(const obs of observers)for(const el of targets.keys())obs.observe(el);
    return()=>{for(const obs of observers)obs.disconnect();};
  },[view,listOffscreenKey]);

  const activateBoardColumn=useCallback((column:MotionColumn)=>{
    const pending=boardOffscreenRef.current[column];
    if(!pending.length)return;
    for(const entry of pending)revealedKeys.current.add(entry.key);
    setBoardOffscreen(current=>current[column].length===0?current:{...current,[column]:[]});
    const elements=pending.map(entry=>({entry,el:findCardElement(entry.key)})).filter((item):item is {entry:OffscreenEntry;el:HTMLElement}=>item.el!==null);
    const earliest=elements[0]?.el;
    if(earliest)earliest.scrollIntoView({behavior:prefersReducedMotion()?'auto':'smooth',block:'center'});
    for(const {entry,el} of elements)highlight(el,{tone:entry.tone});
  },[]);

  const activateList=useCallback(()=>{
    const pending=listOffscreenRef.current;
    if(!pending.length)return;
    for(const entry of pending)revealedKeys.current.add(entry.key);
    setListOffscreen([]);
    const elements=pending.map(entry=>({entry,el:findRowElement(entry.key)})).filter((item):item is {entry:OffscreenEntry;el:HTMLTableRowElement}=>item.el!==null&&!item.el.hidden);
    const earliest=elements[0]?.el;
    if(earliest)earliest.scrollIntoView({behavior:prefersReducedMotion()?'auto':'smooth',block:'center'});
    for(const {entry,el} of elements)highlight(el,{tone:entry.tone});
  },[]);

  const activatePending=useCallback(()=>activateBoardColumn('pending'),[activateBoardColumn]);
  const activateActive=useCallback(()=>activateBoardColumn('active'),[activateBoardColumn]);
  const activateHandled=useCallback(()=>activateBoardColumn('handled'),[activateBoardColumn]);
  const boardChips=useMemo<Record<MotionColumn,OffscreenChipState>>(()=>({
    pending:{count:boardOffscreen.pending.length,direction:boardOffscreen.pending[0]?.direction??'up',activate:activatePending},
    active:{count:boardOffscreen.active.length,direction:boardOffscreen.active[0]?.direction??'up',activate:activateActive},
    handled:{count:boardOffscreen.handled.length,direction:boardOffscreen.handled[0]?.direction??'up',activate:activateHandled},
  }),[boardOffscreen,activatePending,activateActive,activateHandled]);

  const listChip=useMemo<OffscreenChipState>(()=>({
    count:listOffscreen.length,
    direction:listOffscreen[0]?.direction??'up',
    activate:activateList,
  }),[listOffscreen,activateList]);

  return {boardChips,listChip};
}
