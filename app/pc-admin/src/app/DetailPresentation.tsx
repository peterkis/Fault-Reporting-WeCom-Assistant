import {StepEntry,useNextStep} from '../design/components/Drawer/NextStep';
import {Button as HButton} from '../design/components/Button/Button';
import {useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {Check,Lock} from 'lucide-react';
import {MessageBubble} from '../design/components/MessageBubble/MessageBubble';
import {ActorAvatar} from './ActorAvatar';
import {Section} from '../design/components/Section/Section';
import {Timeline,TimelineGroup,TimelineItem} from '../design/components/Timeline/Timeline';
import {StatusBadge} from '../design/components/StatusBadge/StatusBadge';
import {statusTones} from '../design/status-map';
import type {Principal,WorkbenchDetail} from '../api/client';
import {statusLabels} from '../api/client';
import {PersonalReadMaterial} from '../features/personal-read/PersonalReadMaterial';
import {groupActivityRecords} from './activity-time.mjs';
import {activityActorName} from './activity-actors.mjs';
import {DetailDialog,useDetailModalOpen} from './DetailDialog';

export function DetailActionDialog({children,blocked,attention,available=true,readError=false,onOpenChange}:{children:ReactNode;blocked:boolean;attention:boolean;available?:boolean;readError?:boolean;onOpenChange?:((open:boolean)=>void)|undefined}){
  const [open,setOpen]=useState(false);
  const step=useNextStep();
  useEffect(()=>{if(attention)setOpen(true);},[attention]);
  const close=()=>{if(!blocked)setOpen(false);};
  if(step&&readError&&!open&&!attention)return children;
  return <>{!step||available||attention?<StepEntry action="complete" label={attention?'核对完工操作':'登记完工'} fallbackTone={'primary'}>{(tone,text)=><HButton type="button" className="detail-complete-button" onClick={()=>setOpen(true)} tone={tone}>{text}</HButton>}</StepEntry>:null}
    <DetailDialog open={open} onClose={close} closeBlocked={blocked} title="登记完工" closeLabel="关闭完工窗口" onOpenChange={onOpenChange}>{children}</DetailDialog></>;
}

export function ActivityTimeline({records,principal,item,active,now,children,description}:{records:WorkbenchDetail['records'];principal:Principal;item:WorkbenchDetail['item'];active:boolean;now:number;children:ReactNode;description?:string|null}){
  const modalOpen=useDetailModalOpen();
  const report=description?records.find(record=>record.audience==='REPORT'&&record.text===description):undefined;
  return <Section className="detail-main" titleClassName="activity-title" title="处理记录">
    {description?<div className="detail-description"><h3>报修描述</h3>{report?<Timeline className="activity-list"><ol><ActivityRecord record={report} principal={principal} item={item} active={active&&!modalOpen}/></ol></Timeline>:<MessageBubble className="detail-report-description">{description}</MessageBubble>}</div>:null}
    <Timeline className="activity-list">{groupActivityRecords(records.filter(record=>record!==report),now).map(group=><TimelineGroup className="activity-group" key={group.label} label={group.label} date={group.date} aria-label={group.label+'的处理记录'}>
      {group.records.map(record=><ActivityRecord key={record.id} record={record} principal={principal} item={item} active={active&&!modalOpen}/>)}
    </TimelineGroup>)}</Timeline>{children}
  </Section>;
}
function ActivityRecord({record,principal,item,active}:{record:WorkbenchDetail['records'][number];principal:Principal;item:WorkbenchDetail['item'];active:boolean}){
  const [expanded,setExpanded]=useState(false),name=activityActorName(record);
  const text=record.text??(record.new_status?(statusLabels[record.old_status??'']??'新建')+' → '+(statusLabels[record.new_status]??'状态已更新'):'已记录处理操作。');
  return <TimelineItem className={'detail-record'+(expanded?' is-expanded':'')} data-audience={record.audience} avatar={<ActorAvatar principal={principal} item={item} actor={record.actor_ref} name={name}/>} time={<time dateTime={record.at.replace(' ','T')+'+08:00'} title={record.at+'（北京时间）'}>{record.at.slice(11,16)}</time>}>
    <HButton tone="ghost" className="record-content" aria-expanded={expanded} title={expanded?'收起记录':'展开完整记录'} onPress={()=>setExpanded(value=>!value)}>
      <span className="record-name">{name}</span>
      {record.read_material?<span className="record-text"><PersonalReadMaterial inline active={active} principal={principal} item={{kind:item.kind,id:item.id}} sourceRef={record.read_material.source_ref} revision={record.read_material.revision} text={text}/></span>:<span className="record-text">{!record.text&&record.new_status?<><StatusBadge tone={statusTones[record.old_status??'']??'neutral'}>{statusLabels[record.old_status??'']??'新建'}</StatusBadge>{' → '}<StatusBadge tone={statusTones[record.new_status]??'neutral'}>{statusLabels[record.new_status]??'状态已更新'}</StatusBadge></>:text}</span>}
      {record.audience==='INTERNAL'?<span className="record-audience" aria-label="内部，仅信息科可见"><Lock size={12}/>内部</span>:record.audience==='EXTERNAL'?<span className="record-audience public">报修人可见</span>:null}
    </HButton>
  </TimelineItem>;
}
