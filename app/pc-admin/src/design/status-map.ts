import type {WorkbenchCard} from '../api/client';

export type Tone='neutral'|'warning'|'info'|'success'|'attention'|'danger'|'review'|'brand';
export const stagePresentation={
  pending:{label:'待受理',tone:'warning'},
  active:{label:'处理中',tone:'info'},
  closed:{label:'已处理',tone:'success'},
} as const satisfies Record<WorkbenchCard['column'],{label:string;tone:Tone}>;

export const statusTones:Readonly<Record<string,Tone>>={
  NEW:'warning',QUEUED:'warning',ACCEPTED:'neutral',REOPENED:'neutral',
  PENDING:'review',RECEIVED:'neutral',WAITING_TRIAGE:'neutral',WAITING_DESCRIPTION:'attention',
  IN_PROGRESS:'info',WAITING_REQUESTER:'neutral',WAITING_VENDOR:'neutral',
  RESOLVED:'success',CLOSED:'success',CANCELLED:'neutral',DUPLICATE_LINKED:'neutral',FAILED:'danger',
};
export const actionPresentation={
  urge:{label:'已催单',tone:'attention'},
  supplement:{label:'待补充',tone:'attention'},
  review:{label:'待复核',tone:'review'},
  responsible:{label:'我负责',tone:'brand'},
} as const;
export const notificationTones:Readonly<Record<string,Tone>>={PENDING:'neutral',LEASED:'neutral',SENDING:'warning',SENT:'success',DEAD_LETTER:'danger',RECONCILIATION_REQUIRED:'warning',CANCELLED:'neutral'};

export interface CardTag {key:string;label:string;tone:Tone;title?:string;icon?:'clock'|'bell';className?:string}
const substatus:Readonly<Record<string,{label:string;tone:Tone;icon?:'clock';title?:string}>>={
  ACCEPTED:{label:'已领取',tone:'neutral'},
  REOPENED:{label:'重新报障',tone:'neutral'},
  RECEIVED:{label:'已受理待建单',tone:'neutral'},
  WAITING_TRIAGE:{label:'待判断',tone:'neutral'},
  DUPLICATE_LINKED:{label:'已关联重复单',tone:'neutral'},
  WAITING_REQUESTER:{label:'等待中',tone:'neutral',icon:'clock',title:'等待补充'},
  WAITING_VENDOR:{label:'等待中',tone:'neutral',icon:'clock',title:'等待厂商'},
  RESOLVED:{label:'待确认',tone:'success',title:'已解决待确认'},
  CANCELLED:{label:'已取消',tone:'neutral'},
  FAILED:{label:'受理处理失败',tone:'danger'},
  WAITING_DESCRIPTION:{label:'待补充',tone:'attention'},
};
const priority:Record<Tone,number>={danger:0,attention:1,review:2,brand:3,success:4,info:4,warning:4,neutral:4};

/** Presentation only: never changes the DTO's status, grouping or action eligibility. */
export function cardTags(item:WorkbenchCard):CardTag[]{
  const tags:CardTag[]=[];
  if(item.web_report_urge?.active)tags.push({key:'urge',...actionPresentation.urge,icon:'bell',className:'web-report-urge',
    title:'本轮已催单'+(item.web_report_urge.count>1?' · '+item.web_report_urge.count+' 次':'')+(item.web_report_urge.last_urged_at?'；最近催单：'+item.web_report_urge.last_urged_at+'（北京时间）':'')});
  if(item.supplement_follow_up?.has_pending_supplements)tags.push({key:'supplement',...actionPresentation.supplement,className:'supplement-pending-summary',title:'补充待跟进'});
  if(item.kind==='review'||item.status==='PENDING'||item.kind==='ticket'&&item.review_reason)tags.push({key:'review',...actionPresentation.review});
  if(item.attention?.related_reasons.includes('HANDLING'))tags.push({key:'responsible',...actionPresentation.responsible});
  const state=substatus[item.status];
  if(state)tags.push({key:'substatus',...state});
  else if(!Object.hasOwn(statusTones,item.status))tags.push({key:'substatus',label:'状态待确认',tone:'neutral'});
  return tags.sort((a,b)=>priority[a.tone]-priority[b.tone]);
}

/** Keep neutral substatus facts; collapse excess colored tags into one accessible +n. */
export function visibleCardTags(tags:readonly CardTag[]){
  let colored=0;
  const shown:CardTag[]=[],hidden:CardTag[]=[];
  for(const tag of [...tags].sort((a,b)=>priority[a.tone]-priority[b.tone])){
    if(tag.tone==='neutral'||colored++<2)shown.push(tag);else hidden.push(tag);
  }
  return {shown,hidden};
}
