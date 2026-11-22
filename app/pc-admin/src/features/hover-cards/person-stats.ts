import type {BoardCompletionRange,WorkbenchCard} from '../../api/client';
import {formatBeijingFull} from '../../design/beijing-time';
import {shanghaiDays} from '../../design/format-time';

export interface PersonStats {
  active:number;
  waiting:number;
  doneToday:number|null;
}

const WAITING_STATUSES=new Set(['WAITING_REQUESTER','WAITING_VENDOR']);

/** Check whether the loaded handled column query range covers today's Beijing calendar date. */
export function handledRangeIncludesToday(
  range:BoardCompletionRange,
  handledDates:{from:string;to:string}|null|undefined,
  nowMs:number,
):boolean{
  if(range==='recent'||range==='all')return true;
  if(!handledDates)return false;
  const {today}=shanghaiDays(nowMs);
  return handledDates.from<=today&&today<=handledDates.to;
}

function completedOnShanghaiDay(item:WorkbenchCard,today:string):boolean{
  if(item.closure?.kind!=='COMPLETED'||!item.completed_at)return false;
  return formatBeijingFull(item.completed_at).slice(0,10)===today;
}

/** Count visible deduplicated workload metrics for `displayName` from the loaded board/list projection. */
export function computePersonStats({
  items,
  displayName,
  range,
  handledDates,
  nowMs,
}: {
  items:readonly WorkbenchCard[];
  displayName:string;
  range:BoardCompletionRange;
  handledDates:{from:string;to:string}|null|undefined;
  nowMs:number;
}):PersonStats{
  const target=displayName.trim();
  const seen=new Set<string>();
  const includeToday=handledRangeIncludesToday(range,handledDates,nowMs);
  const {today}=shanghaiDays(nowMs);
  let active=0,waiting=0,doneToday=0;

  for(const item of items){
    const key=item.kind+':'+item.id;
    if(seen.has(key))continue;
    seen.add(key);
    if((item.assignee_name?.trim()??'')!==target)continue;
    if(item.column==='active'){
      if(WAITING_STATUSES.has(item.status))waiting++;
      else active++;
    }else if(includeToday&&item.column==='handled'&&completedOnShanghaiDay(item,today)){
      doneToday++;
    }
  }

  return {active,waiting,doneToday:includeToday?doneToday:null};
}
