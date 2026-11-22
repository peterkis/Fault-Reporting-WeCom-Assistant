import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useSyncExternalStore,type ReactNode} from 'react';
import type {BoardCompletionRange,Principal,WorkbenchCard} from '../../api/client';
import {syncHoverCardAuthorityScope} from './denied-items';

export interface BoardHoverCardsInput {
  hasBoard:boolean;
  items:readonly WorkbenchCard[];
  range:BoardCompletionRange;
  handledDates:{from:string;to:string}|null;
  searchMode:boolean;
  now:number;
  onFilterByPerson:((name:string)=>void)|null;
}

export interface BoardHoverCardsIndex {
  byKey:ReadonlyMap<string,WorkbenchCard>;
  byNumber:ReadonlyMap<string,WorkbenchCard|null>;
}

export interface BoardHoverCardsState extends BoardHoverCardsInput {
  index:BoardHoverCardsIndex;
}

export interface HoverCardTransferTarget {
  ticketId:string;
  canTransfer:boolean;
  openForPerson:(displayName:string)=>void;
}

export interface HoverCardsActionsValue {
  principal:Principal;
  publishBoard:(next:BoardHoverCardsInput)=>void;
  clearBoard:(token:symbol)=>void;
  setBoardToken:(token:symbol)=>void;
  registerTransfer:(token:symbol,next:HoverCardTransferTarget)=>void;
  unregisterTransfer:(token:symbol)=>void;
}

export interface HoverCardsStateValue {
  board:BoardHoverCardsState;
  transfer:HoverCardTransferTarget|null;
}

export interface StoreValue extends HoverCardsActionsValue,HoverCardsStateValue {}

const EMPTY_INDEX:BoardHoverCardsIndex={
  byKey:new Map(),
  byNumber:new Map(),
};

const EMPTY_BOARD:BoardHoverCardsState={
  hasBoard:false,
  items:[],
  range:'recent',
  handledDates:null,
  searchMode:false,
  now:Date.now(),
  onFilterByPerson:null,
  index:EMPTY_INDEX,
};

function handledDatesEqual(
  a:{from:string;to:string}|null,
  b:{from:string;to:string}|null,
):boolean{
  if(a===b)return true;
  if(!a||!b)return false;
  return a.from===b.from&&a.to===b.to;
}

function itemsEqual(a:readonly WorkbenchCard[],b:readonly WorkbenchCard[]):boolean{
  if(a===b)return true;
  if(a.length!==b.length)return false;
  for(let index=0;index<a.length;index++){
    if(a[index]!==b[index])return false;
  }
  return true;
}

function buildBoardIndex(items:readonly WorkbenchCard[]):BoardHoverCardsIndex{
  const byKey=new Map<string,WorkbenchCard>();
  const byNumber=new Map<string,WorkbenchCard|null>();
  for(const item of items){
    byKey.set(`${item.kind}:${item.id.toLowerCase()}`,item);
    if(item.kind==='ticket'&&item.number&&!byNumber.has(item.number)){
      byNumber.set(item.number,item);
    }
  }
  return {byKey,byNumber};
}

interface HoverCardsStateStore {
  getSnapshot:()=>HoverCardsStateValue;
  subscribe:(listener:()=>void)=> () => void;
}

const HoverCardsActionsContext=createContext<HoverCardsActionsValue|null>(null);
const HoverCardsStateContext=createContext<HoverCardsStateStore|null>(null);

export function HoverCardsStoreProvider({principal,children}:{principal:Principal;children:ReactNode}){
  syncHoverCardAuthorityScope(principal.principal_id,principal.authorization_revision);
  const boardTokenRef=useRef<symbol|null>(null);
  const transferTokenRef=useRef<symbol|null>(null);
  const stateRef=useRef<HoverCardsStateValue>({board:EMPTY_BOARD,transfer:null});
  const listenersRef=useRef<Set<()=>void>>(new Set());

  const notifyState=useCallback(()=>{
    for(const listener of listenersRef.current)listener();
  },[]);

  const setBoardToken=useCallback((token:symbol)=>{
    boardTokenRef.current=token;
  },[]);

  const publishBoard=useCallback((next:BoardHoverCardsInput)=>{
    const current=stateRef.current.board;
    if(
      current.hasBoard===next.hasBoard
      &&current.range===next.range
      &&current.searchMode===next.searchMode
      &&current.now===next.now
      &&handledDatesEqual(current.handledDates,next.handledDates)
      &&current.onFilterByPerson===next.onFilterByPerson
      &&itemsEqual(current.items,next.items)
    ){
      return;
    }
    const nextBoard:BoardHoverCardsState={
      ...next,
      index:itemsEqual(current.items,next.items)?current.index:buildBoardIndex(next.items),
    };
    stateRef.current={board:nextBoard,transfer:stateRef.current.transfer};
    notifyState();
  },[notifyState]);

  const clearBoard=useCallback((token:symbol)=>{
    if(boardTokenRef.current===token){
      boardTokenRef.current=null;
      if(stateRef.current.board!==EMPTY_BOARD){
        stateRef.current={board:EMPTY_BOARD,transfer:stateRef.current.transfer};
        notifyState();
      }
    }
  },[notifyState]);

  const registerTransfer=useCallback((token:symbol,next:HoverCardTransferTarget)=>{
    transferTokenRef.current=token;
    const current=stateRef.current.transfer;
    if(
      current
      &&current.ticketId===next.ticketId
      &&current.canTransfer===next.canTransfer
      &&current.openForPerson===next.openForPerson
    ){
      return;
    }
    stateRef.current={board:stateRef.current.board,transfer:next};
    notifyState();
  },[notifyState]);

  const unregisterTransfer=useCallback((token:symbol)=>{
    if(transferTokenRef.current===token){
      transferTokenRef.current=null;
      if(stateRef.current.transfer!==null){
        stateRef.current={board:stateRef.current.board,transfer:null};
        notifyState();
      }
    }
  },[notifyState]);

  const actions=useMemo<HoverCardsActionsValue>(()=>({
    principal,
    publishBoard,
    clearBoard,
    setBoardToken,
    registerTransfer,
    unregisterTransfer,
  }),[clearBoard,principal,publishBoard,registerTransfer,setBoardToken,unregisterTransfer]);

  const stateStore=useMemo<HoverCardsStateStore>(()=>({
    getSnapshot:()=>stateRef.current,
    subscribe:(listener:()=>void)=>{
      listenersRef.current.add(listener);
      return ()=>{listenersRef.current.delete(listener);};
    },
  }),[]);

  return <HoverCardsActionsContext.Provider value={actions}>
    <HoverCardsStateContext.Provider value={stateStore}>{children}</HoverCardsStateContext.Provider>
  </HoverCardsActionsContext.Provider>;
}

const noopSubscribe=()=>()=>{};
const getNullState=():HoverCardsStateValue|null=>null;

/** Stable actions/principal handle that does not change when board items or clock ticks update. */
export function useHoverCardsActions():HoverCardsActionsValue|null{
  return useContext(HoverCardsActionsContext);
}

/** Reactive board/transfer snapshot; subscribed only inside open hover card bodies, never in closed triggers. */
export function useHoverCardsState():HoverCardsStateValue|null{
  const store=useContext(HoverCardsStateContext);
  return useSyncExternalStore(
    store?store.subscribe:noopSubscribe,
    store?store.getSnapshot:getNullState,
    store?store.getSnapshot:getNullState,
  );
}

/** Combined store accessor retained for compatibility; prefer `useHoverCardsActions` + `useHoverCardsState`. */
export function useHoverCardsStore():StoreValue|null{
  const actions=useHoverCardsActions();
  const state=useHoverCardsState();
  return useMemo(()=>{
    if(!actions||!state)return null;
    return {...actions,...state};
  },[actions,state]);
}

/** Publishes current loaded board/list items, filter callbacks, and handled date range while mounted. */
export function HoverCardsBoardBridge({
  items,
  range,
  handledDates,
  searchMode,
  now,
  onFilterByPerson,
}: {
  items:readonly WorkbenchCard[];
  range:BoardCompletionRange;
  handledDates:{from:string;to:string}|null|undefined;
  searchMode:boolean;
  now:number;
  onFilterByPerson:(name:string)=>void;
}){
  const actions=useHoverCardsActions();
  const tokenRef=useRef<symbol>(Symbol('board-bridge'));
  const filterRef=useRef(onFilterByPerson);
  filterRef.current=onFilterByPerson;
  const stableFilterByPerson=useCallback((name:string)=>{
    filterRef.current(name);
  },[]);

  useEffect(()=>{
    if(!actions)return;
    const token=tokenRef.current;
    actions.setBoardToken(token);
    return ()=>{actions.clearBoard(token);};
  },[actions]);

  useEffect(()=>{
    if(!actions)return;
    actions.publishBoard({
      hasBoard:true,
      items,
      range,
      handledDates:handledDates??null,
      searchMode,
      now,
      onFilterByPerson:stableFilterByPerson,
    });
  },[actions,handledDates,items,now,range,searchMode,stableFilterByPerson]);

  return null;
}

/** Finds a visible loaded card via O(1) index lookup (`kind:id` or unique ticket number). */
export function findBoardItemInIndex(
  index:BoardHoverCardsIndex,
  target:{kind?:WorkbenchCard['kind']|undefined;id?:string|undefined;number?:string|undefined},
):WorkbenchCard|null{
  if(target.kind&&target.id){
    return index.byKey.get(`${target.kind}:${target.id.toLowerCase()}`)??null;
  }
  if(target.number){
    return index.byNumber.get(target.number)??null;
  }
  return null;
}

/** Finds a visible loaded card by `kind:id` or unique ticket number so opened hover cards avoid duplicate reads. */
export function findLoadedBoardItem(
  items:readonly WorkbenchCard[],
  target:{kind?:WorkbenchCard['kind']|undefined;id?:string|undefined;number?:string|undefined},
):WorkbenchCard|null{
  if(target.kind&&target.id){
    return items.find(item=>item.kind===target.kind&&item.id.toLowerCase()===target.id?.toLowerCase())??null;
  }
  if(target.number){
    return items.find(item=>item.kind==='ticket'&&item.number===target.number)??null;
  }
  return null;
}
