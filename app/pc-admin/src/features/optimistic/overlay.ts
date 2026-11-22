import type {WorkbenchCard} from '../../api/client';
import type {
  CardPositionAnchor,
  OptimisticItemRecord,
  OptimisticOverlayEntry,
  OptimisticPrincipalState,
} from './store';
import {
  cardSubgroupOf,
  optimisticItemKey,
  releaseConfirmedOverlay,
} from './store';

/** Formats a Date in Asia/Shanghai as `YYYY-MM-DD HH:mm:ss` matching server LocalDateTime strings. */
export function nowShanghaiLocalString(date=new Date()):string{
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Shanghai',
    year:'numeric',
    month:'2-digit',
    day:'2-digit',
    hour:'2-digit',
    minute:'2-digit',
    second:'2-digit',
    hour12:false,
  }).formatToParts(date);
  const map=new Map(parts.map(p=>[p.type,p.value]));
  const hour=map.get('hour')==='24'?'00':(map.get('hour')??'00');
  return `${map.get('year')??'1970'}-${map.get('month')??'01'}-${map.get('day')??'01'} ${hour}:${map.get('minute')??'00'}:${map.get('second')??'00'}`;
}

function projectCard(base:WorkbenchCard,record:OptimisticItemRecord):WorkbenchCard{
  let next={...base};
  const movement=record.movement;
  if(movement){
    if(movement.to.column!==undefined)next.column=movement.to.column;
    if(movement.to.status!==undefined)next.status=movement.to.status;
    if(movement.to.assigneeName!==undefined)next.assignee_name=movement.to.assigneeName;
    if(movement.to.closure!==undefined)next.closure=movement.to.closure;
    if(movement.to.updatedAt!==undefined)next.updated_at=movement.to.updatedAt;
  }
  const follow=record.follow;
  if(follow&&follow.to.following!==undefined&&next.attention){
    next={...next,attention:{...next.attention,following:follow.to.following}};
  }
  return next;
}

function findMatchingOverlayRecord(item:WorkbenchCard,snapshot:OptimisticPrincipalState):{key:string;record:OptimisticItemRecord}|undefined{
  const key=optimisticItemKey(item.kind,item.id);
  const direct=snapshot.overlays.get(key);
  if(direct)return {key,record:direct};
  if(item.kind!=='ticket'&&item.intake_id){
    for(const [entryKey,record] of snapshot.overlays){
      if(record.movement?.intakeId===item.intake_id||record.follow?.intakeId===item.intake_id){
        return {key:entryKey,record};
      }
    }
  }
  return undefined;
}

export function applyOptimisticOverlay(items:readonly WorkbenchCard[],snapshot:OptimisticPrincipalState):WorkbenchCard[]{
  if(snapshot.overlays.size===0)return items as WorkbenchCard[];
  return items.map(item=>{
    const matched=findMatchingOverlayRecord(item,snapshot);
    return matched?projectCard(item,matched.record):item;
  });
}

function insertWithAnchor(slice:WorkbenchCard[],target:WorkbenchCard,anchor:CardPositionAnchor):WorkbenchCard[]{
  const others=slice.filter(item=>optimisticItemKey(item.kind,item.id)!==optimisticItemKey(target.kind,target.id));
  if(anchor.beforeKey){
    const beforeIdx=others.findIndex(item=>optimisticItemKey(item.kind,item.id)===anchor.beforeKey);
    if(beforeIdx>=0){
      return [...others.slice(0,beforeIdx+1),target,...others.slice(beforeIdx+1)];
    }
  }
  if(anchor.afterKey){
    const afterIdx=others.findIndex(item=>optimisticItemKey(item.kind,item.id)===anchor.afterKey);
    if(afterIdx>=0){
      return [...others.slice(0,afterIdx),target,...others.slice(afterIdx)];
    }
  }
  const clamped=Math.max(0,Math.min(others.length,anchor.index));
  return [...others.slice(0,clamped),target,...others.slice(clamped)];
}

export function applyOptimisticPositions(ordered:readonly WorkbenchCard[],snapshot:OptimisticPrincipalState):WorkbenchCard[]{
  if(snapshot.overlays.size===0&&snapshot.positionPins.size===0)return ordered as WorkbenchCard[];
  const anchors=new Map<string,CardPositionAnchor>(snapshot.positionPins);
  for(const [key,record] of snapshot.overlays){
    if(record.movement?.to.restorePosition){
      anchors.set(key,record.movement.to.restorePosition);
    }else if(record.movement)anchors.delete(key);
  }
  if(anchors.size===0)return ordered as WorkbenchCard[];

  let current=[...ordered];
  for(const [entryKey,anchor] of anchors){
    const target=current.find(item=>optimisticItemKey(item.kind,item.id)===entryKey&&item.column===anchor.column&&cardSubgroupOf(item)===anchor.subgroup);
    if(!target)continue;
    const slice=current.filter(item=>item.column===anchor.column&&cardSubgroupOf(item)===anchor.subgroup);
    const reordered=insertWithAnchor(slice,target,anchor);
    let cursor=0;
    current=current.map(item=>item.column===anchor.column&&cardSubgroupOf(item)===anchor.subgroup?(reordered[cursor++]??item):item);
  }
  return current;
}

export function computeHandledDismissedDelta(raw:readonly WorkbenchCard[],overlaid:readonly WorkbenchCard[]):number{
  const rawByKey=new Map<string,WorkbenchCard>();
  for(const item of raw)rawByKey.set(optimisticItemKey(item.kind,item.id),item);
  const overlaidByKey=new Map<string,WorkbenchCard>();
  for(const item of overlaid)overlaidByKey.set(optimisticItemKey(item.kind,item.id),item);

  const rawDismissed=raw.filter(item=>item.column==='handled'&&item.closure?.kind==='DISMISSED').length;
  const overlaidDismissed=overlaid.filter(item=>item.column==='handled'&&item.closure?.kind==='DISMISSED').length;
  return overlaidDismissed-rawDismissed;
}

function movementConfirmedInServer(entry:OptimisticOverlayEntry,serverCard:WorkbenchCard|undefined):boolean{
  if(!serverCard)return false;
  if(entry.kind==='claim'){
    if(entry.undo){
      return serverCard.column==='pending'&&!serverCard.assignee_name;
    }
    return serverCard.column!=='pending';
  }
  if(entry.kind==='close'){
    if(entry.undo){
      return serverCard.column!=='handled'&&serverCard.closure?.kind!=='DISMISSED';
    }
    return serverCard.column==='handled'&&serverCard.closure?.kind==='DISMISSED';
  }
  return false;
}

export function reconcileConfirmedOverlays(principalId:string,rawServerItems:readonly WorkbenchCard[],snapshot:OptimisticPrincipalState):void{
  if(!principalId||snapshot.overlays.size===0)return;
  const byKey=new Map<string,WorkbenchCard>();
  const byIntake=new Map<string,WorkbenchCard>();
  for(const item of rawServerItems){
    byKey.set(optimisticItemKey(item.kind,item.id),item);
    if(item.kind!=='ticket'&&item.intake_id)byIntake.set(item.intake_id,item);
  }

  for(const [entryKey,record] of snapshot.overlays){
    const movement=record.movement;
    if(movement&&movement.status==='confirmed'){
      const serverCard=byKey.get(entryKey)??(movement.intakeId?byIntake.get(movement.intakeId):undefined);
      const restoredPinRetired=movement.to.restorePosition!==undefined&&!snapshot.positionPins.has(entryKey);
      if(restoredPinRetired||movementConfirmedInServer(movement,serverCard)){
        releaseConfirmedOverlay(principalId,entryKey,'movement',movement.clientCommandId);
      }
    }
    const follow=record.follow;
    if(follow&&follow.status==='confirmed'){
      const serverCard=byKey.get(entryKey)??(follow.intakeId?byIntake.get(follow.intakeId):undefined);
      if(serverCard&&serverCard.attention?.following===follow.to.following){
        releaseConfirmedOverlay(principalId,entryKey,'follow',follow.clientCommandId);
      }
    }
  }
}
