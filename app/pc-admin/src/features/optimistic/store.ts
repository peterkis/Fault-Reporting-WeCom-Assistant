import {useLayoutEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import type {BoardColumn,WorkbenchCard} from '../../api/client';
import {OPTIMISTIC_CONFIRMED_HOLD_MAX_MS} from './constants';

export type OptimisticOperationKind='claim'|'close'|'follow';
export type OptimisticSlot='movement'|'follow';
export type OptimisticStatus='pending'|'unknown'|'confirmed';
export type CardSubgroup='intake'|'ticket'|'completed'|'dismissed'|null;

export interface CardPositionAnchor {
  column:BoardColumn;
  subgroup:CardSubgroup;
  beforeKey:string|null;
  afterKey:string|null;
  index:number;
}

export interface OptimisticOverlayEndState {
  column?:BoardColumn|undefined;
  status?:string|undefined;
  assigneeName?:string|null|undefined;
  closure?:WorkbenchCard['closure']|undefined;
  updatedAt?:string|undefined;
  following?:boolean|undefined;
  position?:CardPositionAnchor|undefined;
  restorePosition?:CardPositionAnchor|undefined;
  card?:WorkbenchCard|undefined;
}

export interface OptimisticOverlayEntry {
  itemKey:string;
  intakeId?:string|undefined;
  kind:OptimisticOperationKind;
  slot:OptimisticSlot;
  clientCommandId:string;
  status:OptimisticStatus;
  startedAt:number;
  confirmedAt?:number|undefined;
  undo?:boolean|undefined;
  from:OptimisticOverlayEndState;
  to:OptimisticOverlayEndState;
}

export interface OptimisticItemRecord {
  movement?:OptimisticOverlayEntry|undefined;
  follow?:OptimisticOverlayEntry|undefined;
}

export interface RollbackCueState {
  revision:number;
  originColumn?:BoardColumn|undefined;
  kind:OptimisticOperationKind;
  register:()=>()=>void;
}

export interface OptimisticPrincipalState {
  overlays:Map<string,OptimisticItemRecord>;
  positionPins:Map<string,CardPositionAnchor & {storeVersion:number}>;
  rollbackCues:Map<string,RollbackCueState>;
}

const EMPTY_PRINCIPAL_STATE:OptimisticPrincipalState={
  overlays:new Map(),
  positionPins:new Map(),
  rollbackCues:new Map(),
};

interface PrincipalStore {
  version:number;
  snapshot:OptimisticPrincipalState;
  displayedItems:readonly WorkbenchCard[];
  timers:Map<string,ReturnType<typeof setTimeout>>;
  listeners:Set<()=>void>;
}

const stores=new Map<string,PrincipalStore>();
let globalRollbackSeq=0;

export function optimisticItemKey(kind:string,id:string):string{
  return kind+':'+id.toLowerCase();
}

export function cardSubgroupOf(item:Pick<WorkbenchCard,'kind'|'column'|'closure'>):CardSubgroup{
  if(item.column==='pending')return item.kind==='ticket'?'ticket':'intake';
  if(item.column==='handled')return item.closure?.kind==='DISMISSED'?'dismissed':'completed';
  return null;
}

function getOrCreateStore(principalId:string):PrincipalStore{
  let store=stores.get(principalId);
  if(!store){
    store={
      version:0,
      snapshot:{overlays:new Map(),positionPins:new Map(),rollbackCues:new Map()},
      displayedItems:[],
      timers:new Map(),
      listeners:new Set(),
    };
    stores.set(principalId,store);
  }
  return store;
}

function commitStore(store:PrincipalStore){
  store.version++;
  store.snapshot={
    overlays:new Map(store.snapshot.overlays),
    positionPins:new Map(store.snapshot.positionPins),
    rollbackCues:new Map(store.snapshot.rollbackCues),
  };
  for(const listener of store.listeners)listener();
}

function timerKey(itemKey:string,slot:OptimisticSlot):string{
  return itemKey+'|'+slot;
}

function clearHoldTimer(store:PrincipalStore,itemKey:string,slot:OptimisticSlot){
  const key=timerKey(itemKey,slot);
  const existing=store.timers.get(key);
  if(existing!==undefined){
    clearTimeout(existing);
    store.timers.delete(key);
  }
}

export function setDisplayedBoardSnapshot(principalId:string,items:readonly WorkbenchCard[]):void{
  if(!principalId)return;
  getOrCreateStore(principalId).displayedItems=items;
}

export function getDisplayedCard(principalId:string,kind:string,id:string):WorkbenchCard|undefined{
  if(!principalId)return undefined;
  const store=stores.get(principalId);
  if(!store)return undefined;
  const target=id.toLowerCase();
  return store.displayedItems.find(item=>item.kind===kind&&item.id.toLowerCase()===target);
}

export function captureDisplayedCardPosition(principalId:string,item:Pick<WorkbenchCard,'kind'|'id'|'column'|'closure'>|null|undefined):CardPositionAnchor|undefined{
  if(!principalId||!item)return undefined;
  const store=stores.get(principalId);
  if(!store||store.displayedItems.length===0)return undefined;
  const key=optimisticItemKey(item.kind,item.id);
  const subgroup=cardSubgroupOf(item);
  const slice=store.displayedItems.filter(candidate=>candidate.column===item.column&&cardSubgroupOf(candidate)===subgroup);
  const index=slice.findIndex(candidate=>optimisticItemKey(candidate.kind,candidate.id)===key);
  if(index<0)return undefined;
  const before=index>0?slice[index-1]:undefined;
  const after=index+1<slice.length?slice[index+1]:undefined;
  return {
    column:item.column,
    subgroup,
    beforeKey:before?optimisticItemKey(before.kind,before.id):null,
    afterKey:after?optimisticItemKey(after.kind,after.id):null,
    index,
  };
}

export function beginOptimisticOverlay(principalId:string,entry:OptimisticOverlayEntry):void{
  if(!principalId)return;
  const store=getOrCreateStore(principalId);
  clearHoldTimer(store,entry.itemKey,entry.slot);
  const existing=store.snapshot.overlays.get(entry.itemKey);
  const nextRecord:OptimisticItemRecord=existing?{...existing}:{};
  nextRecord[entry.slot]=entry;
  store.snapshot.overlays.set(entry.itemKey,nextRecord);
  commitStore(store);
}

export function markOptimisticUnknown(principalId:string,itemKey:string,slot:OptimisticSlot,clientCommandId:string):void{
  const store=stores.get(principalId);
  if(!store)return;
  const existing=store.snapshot.overlays.get(itemKey);
  const current=existing?.[slot];
  if(!existing||!current||current.clientCommandId!==clientCommandId)return;
  clearHoldTimer(store,itemKey,slot);
  if(current.status==='unknown')return;
  store.snapshot.overlays.set(itemKey,{
    ...existing,
    [slot]:{...current,status:'unknown'},
  });
  commitStore(store);
}

export function confirmOptimisticOverlay(principalId:string,itemKey:string,slot:OptimisticSlot,clientCommandId:string):void{
  const store=stores.get(principalId);
  if(!store)return;
  const existing=store.snapshot.overlays.get(itemKey);
  const current=existing?.[slot];
  if(!existing||!current||current.clientCommandId!==clientCommandId)return;
  clearHoldTimer(store,itemKey,slot);
  const confirmedAt=typeof performance!=='undefined'?performance.now():Date.now();
  store.snapshot.overlays.set(itemKey,{
    ...existing,
    [slot]:{...current,status:'confirmed',confirmedAt},
  });
  // A pending move carries its own position. Only a confirmed move replaces the last restored position.
  if(slot==='movement'){
    if(current.to.restorePosition)store.snapshot.positionPins.set(itemKey,{...current.to.restorePosition,storeVersion:store.version+1});
    else store.snapshot.positionPins.delete(itemKey);
  }
  // Safety net: if a column query was excluded by current filters/date range, release confirmed hold after TTL.
  const timer=setTimeout(()=>{
    const latest=stores.get(principalId);
    const rec=latest?.snapshot.overlays.get(itemKey);
    if(rec?.[slot]?.clientCommandId===clientCommandId&&rec[slot]?.status==='confirmed'){
      releaseConfirmedOverlay(principalId,itemKey,slot,clientCommandId);
    }
  },OPTIMISTIC_CONFIRMED_HOLD_MAX_MS);
  store.timers.set(timerKey(itemKey,slot),timer);
  commitStore(store);
}

export function removeOptimisticOverlay(principalId:string,itemKey:string,slot:OptimisticSlot,clientCommandId?:string):void{
  const store=stores.get(principalId);
  if(!store)return;
  const existing=store.snapshot.overlays.get(itemKey);
  const current=existing?.[slot];
  if(!existing||!current)return;
  if(clientCommandId!==undefined&&current.clientCommandId!==clientCommandId)return;
  clearHoldTimer(store,itemKey,slot);
  const nextRecord:OptimisticItemRecord={...existing};
  delete nextRecord[slot];
  if(!nextRecord.movement&&!nextRecord.follow){
    store.snapshot.overlays.delete(itemKey);
  }else{
    store.snapshot.overlays.set(itemKey,nextRecord);
  }
  commitStore(store);
}

export function releaseConfirmedOverlay(principalId:string,itemKey:string,slot:OptimisticSlot,clientCommandId:string):void{
  if(stores.get(principalId)?.snapshot.overlays.get(itemKey)?.[slot]?.status==='confirmed'){
    removeOptimisticOverlay(principalId,itemKey,slot,clientCommandId);
  }
}

/** Only a successful board/search read started after a pin was installed can retire it. */
export async function readBoardPage<T extends {items:readonly WorkbenchCard[]}>(
  principalId:string,signal:AbortSignal,read:()=>Promise<T>,
):Promise<T>{
  const store=stores.get(principalId);
  if(!store?.snapshot.positionPins.size)return read();
  const versionAtStart=store.version;
  const page=await read();
  if(signal.aborted)return page;
  let changed=false;
  for(const item of page.items){
    const key=optimisticItemKey(item.kind,item.id),pin=store.snapshot.positionPins.get(key);
    if(!pin||pin.storeVersion>versionAtStart)continue;
    if(item.column===pin.column&&cardSubgroupOf(item)===pin.subgroup)continue;
    store.snapshot.positionPins.delete(key);
    changed=true;
  }
  if(changed)commitStore(store);
  return page;
}

export function isItemActionPending(principalId:string,kind:string,id:string,slot:OptimisticSlot):boolean{
  if(!principalId)return false;
  const store=stores.get(principalId);
  if(!store)return false;
  const entry=store.snapshot.overlays.get(optimisticItemKey(kind,id))?.[slot];
  return Boolean(entry&&(entry.status==='pending'||entry.status==='unknown'));
}

export function triggerRollbackCue(principalId:string,kind:string,id:string,opKind:OptimisticOperationKind,intakeId?:string,originColumn?:BoardColumn):Promise<void>{
  if(!principalId)return Promise.resolve();
  const store=getOrCreateStore(principalId);
  globalRollbackSeq++;
  const waiting=new Set<Promise<void>>();
  const state:RollbackCueState={revision:globalRollbackSeq,kind:opKind,originColumn,register(){
    let finish=()=>{};
    const done=new Promise<void>(resolve=>{finish=resolve;});
    waiting.add(done);
    return ()=>{waiting.delete(done);finish();};
  }};
  store.snapshot.rollbackCues.set(optimisticItemKey(kind,id),state);
  if(kind!=='ticket'&&intakeId){
    store.snapshot.rollbackCues.set(optimisticItemKey('intake',intakeId),state);
  }
  commitStore(store);
  // Layout effects register the visible card. A route change can mount its replacement
  // in the same commit as the old card's cleanup, so check again after each settlement.
  return Promise.resolve().then(async()=>{
    while(waiting.size)await Promise.all(waiting);
    consumeRollbackCue(principalId,kind,id,state.revision,intakeId);
  });
}

function consumeRollbackCue(principalId:string,kind:string,id:string,revision:number,intakeId?:string):void{
  const store=stores.get(principalId);
  if(!store)return;
  let changed=false;
  const keys=[optimisticItemKey(kind,id)];
  if(kind!=='ticket'&&intakeId)keys.push(optimisticItemKey('intake',intakeId));
  for(const key of keys){
    const current=store.snapshot.rollbackCues.get(key);
    if(current&&current.revision===revision){
      store.snapshot.rollbackCues.delete(key);
      changed=true;
    }
  }
  if(changed)commitStore(store);
}

export function clearItemOptimisticState(principalId:unknown,kind:unknown,id:unknown):void{
  if(typeof principalId!=='string'||typeof kind!=='string'||typeof id!=='string')return;
  const store=stores.get(principalId);
  if(!store)return;
  const key=optimisticItemKey(kind,id);
  clearHoldTimer(store,key,'movement');
  clearHoldTimer(store,key,'follow');
  const hadOverlay=store.snapshot.overlays.delete(key);
  const hadPin=store.snapshot.positionPins.delete(key);
  const hadCue=store.snapshot.rollbackCues.delete(key);
  if(hadOverlay||hadPin||hadCue)commitStore(store);
}

export function clearOptimisticState(principalId?:string):void{
  if(principalId!==undefined){
    const store=stores.get(principalId);
    if(!store)return;
    for(const timer of store.timers.values())clearTimeout(timer);
    store.timers.clear();
    store.displayedItems=[];
    if(store.snapshot.overlays.size||store.snapshot.positionPins.size||store.snapshot.rollbackCues.size){
      store.snapshot.overlays.clear();
      store.snapshot.positionPins.clear();
      store.snapshot.rollbackCues.clear();
      commitStore(store);
    }
    return;
  }
  for(const store of stores.values()){
    for(const timer of store.timers.values())clearTimeout(timer);
    store.timers.clear();
    store.displayedItems=[];
    const changed=Boolean(store.snapshot.overlays.size||store.snapshot.positionPins.size||store.snapshot.rollbackCues.size);
    store.snapshot.overlays.clear();
    store.snapshot.positionPins.clear();
    store.snapshot.rollbackCues.clear();
    if(changed)commitStore(store);
  }
}

export function useOptimisticSnapshot(principalId:string):OptimisticPrincipalState{
  return useSyncExternalStore(
    listener=>{
      if(!principalId)return()=>{};
      const store=getOrCreateStore(principalId);
      store.listeners.add(listener);
      return()=>{store.listeners.delete(listener);};
    },
    ()=>principalId?getOrCreateStore(principalId).snapshot:EMPTY_PRINCIPAL_STATE,
    ()=>EMPTY_PRINCIPAL_STATE,
  );
}

function findItemRecord(snapshot:OptimisticPrincipalState,kind:string,id:string,intakeId?:string):OptimisticItemRecord|undefined{
  const direct=snapshot.overlays.get(optimisticItemKey(kind,id));
  if(direct)return direct;
  if(kind!=='ticket'&&intakeId){
    for(const record of snapshot.overlays.values()){
      if(record.movement?.intakeId===intakeId||record.follow?.intakeId===intakeId)return record;
    }
  }
  return undefined;
}

export interface ItemOptimisticView {
  pending:boolean;
  pendingKind:OptimisticOperationKind|null;
  state:OptimisticStatus|null;
  followPending:boolean;
  followTarget:boolean|null;
}

export function useItemOptimisticState(principalId:string,kind:string,id:string,intakeId?:string):ItemOptimisticView{
  const snapshot=useOptimisticSnapshot(principalId);
  return useMemo(()=>{
    const record=findItemRecord(snapshot,kind,id,intakeId);
    const movement=record?.movement;
    const follow=record?.follow;
    const pendingEntry=movement?.status==='pending'?movement:follow?.status==='pending'?follow:null;
    const stateEntry=pendingEntry??(movement?.status==='unknown'?movement:follow?.status==='unknown'?follow:movement??follow??null);
    return {
      pending:Boolean(pendingEntry),
      pendingKind:pendingEntry?.kind??null,
      state:stateEntry?.status??null,
      followPending:follow?.status==='pending',
      followTarget:follow?.to.following??null,
    };
  },[snapshot,kind,id,intakeId]);
}

export function useItemRollbackCue(principalId:string,{kind,id,intake_id:intakeId,column}:WorkbenchCard,visible=true){
  const snapshot=useOptimisticSnapshot(principalId);
  const registration=useRef<{cue:RollbackCueState;finish:()=>void}|null>(null);
  const cue=snapshot.rollbackCues.get(optimisticItemKey(kind,id))??
    (kind!=='ticket'&&intakeId?snapshot.rollbackCues.get(optimisticItemKey('intake',intakeId)):undefined);
  const active=visible&&Boolean(cue)&&(cue?.originColumn===undefined||cue.originColumn===column);
  useLayoutEffect(()=>{
    if(!cue||!active)return;
    const finish=cue.register();
    registration.current={cue,finish};
    return ()=>{registration.current=null;finish();};
  },[active,cue]);
  return {active,revision:cue?.revision??0,onFinished:()=>{
    const current=registration.current;
    if(current&&current.cue===cue)current.finish();
  }};
}
