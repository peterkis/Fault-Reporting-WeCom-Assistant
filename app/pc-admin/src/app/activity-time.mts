const dayMs=86_400_000,beijingOffsetMs=8*60*60*1000;
const epoch=(value:string)=>Date.parse(value.replace(' ','T')+'+08:00');
const beijingDay=(value:number)=>Math.floor((value+beijingOffsetMs)/dayMs);

/** Keep the server's newest-first order, including records loaded through older pages. */
export function groupActivityRecords<T extends {at:string}>(records:readonly T[],now:number):{label:string;date:string;records:T[]}[]{
  const today=beijingDay(now),groups=new Map<string,{label:string;date:string;records:T[]}>();
  for(const record of records){
    const key=record.at.slice(0,10),day=beijingDay(epoch(record.at)),date=Number(key.slice(5,7))+'月'+Number(key.slice(8,10))+'日';
    const label=day===today?'今天':day===today-1?'昨天':(key.slice(0,4)===new Date(now+beijingOffsetMs).getUTCFullYear().toString()?'':key.slice(0,4)+'年')+date;
    const group=groups.get(key);if(group)group.records.push(record);else groups.set(key,{label,date,records:[record]});
  }
  return Array.from(groups.values());
}

export function activityTime(value:string,now:number):string{
  const elapsed=now-epoch(value),minutes=Math.floor(elapsed/60_000);
  if(Number.isFinite(elapsed)&&elapsed>=0){
    if(minutes<1)return '刚刚';
    if(minutes<60)return minutes+' 分钟前';
    if(elapsed<dayMs)return Math.floor(minutes/60)+' 小时前';
    if(elapsed<7*dayMs)return Math.floor(elapsed/dayMs)+' 天前';
  }
  const currentYear=new Date(now+beijingOffsetMs).getUTCFullYear();
  return (Number(value.slice(0,4))===currentYear?'':value.slice(0,4)+'年')+Number(value.slice(5,7))+'月'+Number(value.slice(8,10))+'日';
}
