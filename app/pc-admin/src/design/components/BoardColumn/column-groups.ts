import type {BoardColumn,WorkbenchCard} from '../../../api/client';

export interface ColumnGroup {
  key:'intake'|'ticket'|'completed'|'dismissed';label:string;defaultExpanded:boolean;note?:string;
}
export type ProcessedColumnGroup=ColumnGroup&{key:'completed'|'dismissed'};
export const PENDING_GROUPS:readonly ColumnGroup[]=[
  {key:'intake',label:'待判断',defaultExpanded:true},
  {key:'ticket',label:'待接单',defaultExpanded:true},
];
export const PROCESSED_GROUPS:readonly ProcessedColumnGroup[]=[
  {key:'completed',label:'已完成',defaultExpanded:true},
  {key:'dismissed',label:'已关闭',defaultExpanded:false,note:'不计入完成数'},
];
export const COLUMN_GROUPS:Record<BoardColumn,readonly ColumnGroup[]>={pending:PENDING_GROUPS,active:[],handled:PROCESSED_GROUPS};
/** Presentation order, labels and folding are shared by real rows/cards and their placeholders. */
export function itemsInGroup(group:ColumnGroup,items:readonly WorkbenchCard[]){
  return items.filter(item=>group.key==='intake'?item.kind!=='ticket':group.key==='ticket'?item.kind==='ticket':item.closure?.kind===group.key.toUpperCase());
}
export function groupPreferenceKey(group:ColumnGroup,principalId:string,view:'list'):string;
export function groupPreferenceKey(group:ColumnGroup,principalId:string|undefined,view:'board'|'list'):string|undefined;
export function groupPreferenceKey(group:ColumnGroup,principalId:string|undefined,view:'board'|'list'){
  if(principalId===undefined)return undefined;
  return group.key==='completed'||group.key==='dismissed'?'pc-admin:processed-group:'+principalId+':'+group.key:view==='list'?'pc-admin:list-pending:'+principalId+':'+group.key:undefined;
}
export function readGroupExpanded(initial:boolean,key?:string){
  if(key)try{const value=sessionStorage.getItem(key);if(value==='true'||value==='false')return value==='true';}catch{/* Keep the default when storage is unavailable. */}
  return initial;
}
export function boardGroupProps(group:ColumnGroup,principalId?:string){
  const preferenceKey=groupPreferenceKey(group,principalId,'board');
  return {label:group.label,defaultExpanded:group.defaultExpanded,...(group.note?{note:group.note}:{}),...(preferenceKey?{preferenceKey}:{})};
}
export function loadingSlots(total:number,index:number,groups:number){
  return index<0||groups===0?0:Math.floor(total/groups)+(index<total%groups?1:0);
}
