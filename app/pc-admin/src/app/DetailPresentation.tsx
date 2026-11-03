import {StepEntry,useNextStep} from '../design/components/Drawer/NextStep';
import {Button as HButton} from '../design/components/Button/Button';
import {useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {Check,Lock} from 'lucide-react';
import {MessageBubble} from '../design/components/MessageBubble/MessageBubble';
import {ActorAvatar} from './ActorAvatar';
import {Section} from '../design/components/Section/Section';
import {Timeline,TimelineGroup,TimelineItem} from '../design/components/Timeline/Timeline';
import {BeijingTime} from '../design/components/Timeline/BeijingTime';
import {recordKind} from '../design/components/Timeline/record-kind';
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
    <Timeline className="activity-list">
    {description?<div className="detail-description"><h3>报修描述</h3>{report?<ol><ActivityRecord record={report} principal={principal} item={item} active={active&&!modalOpen} now={now}/></ol>:<MessageBubble className="detail-report-description">{description}</MessageBubble>}</div>:null}
    {groupActivityRecords(records.filter(record=>record!==report),now).map(group=><TimelineGroup className="activity-group" key={group.label} label={group.label} date={group.date} aria-label={group.label+'的处理记录'}>
      {group.records.map(record=><ActivityRecord key={record.id} record={record} principal={principal} item={item} active={active&&!modalOpen} now={now}/>)}
    </TimelineGroup>)}</Timeline>{children}
  </Section>;
}
function ActivityRecord({record,principal,item,active,now}:{record:WorkbenchDetail['records'][number];principal:Principal;item:WorkbenchDetail['item'];active:boolean;now:number}){
  const [expanded,setExpanded]=useState(false),name=activityActorName(record),kind=recordKind(record);
  const text=record.text??(kind==='status'?'更新状态':'已记录处理操作。');
  const bubble=kind==='note'||kind==='report',time=<BeijingTime value={record.at} now={now}/>;
  const audience=kind==='note'&&record.audience==='INTERNAL'?<span className="record-audience" aria-label="内部，仅信息科可见"><Lock size={12}/>内部</span>:kind==='note'&&record.audience==='EXTERNAL'?<span className="record-audience public">报修人可见</span>:null;
  return <TimelineItem className={'detail-record'+(expanded?' is-expanded':'')} data-record-kind={kind} data-audience={record.audience} avatar={<ActorAvatar principal={principal} item={item} actor={record.actor_ref} name={name}/>} time={bubble?undefined:time}>
    <HButton tone="ghost" className="record-content" aria-expanded={expanded} title={expanded?'收起记录':'展开完整记录'} onPress={()=>setExpanded(value=>!value)}>
      {bubble?<span className="record-heading"><span className="record-name">{name}</span><span className="record-action">{kind==='report'?'提交报修':record.audience==='INTERNAL'?'添加内部备注':'对外说明'}</span>{audience}{time}</span>:<span className="record-name">{name}</span>}
      {record.read_material?<PersonalReadMaterial inline active={active} principal={principal} item={{kind:item.kind,id:item.id}} sourceRef={record.read_material.source_ref} revision={record.read_material.revision} text={text}/>:<span className="record-text">{text}</span>}
      {kind==='status'?<span className="record-status-change"><StatusBadge data-status={record.old_status??''} tone={statusTones[record.old_status??'']??'neutral'}>{statusLabels[record.old_status??'']??'新建'}</StatusBadge>{' → '}<StatusBadge data-status={record.new_status??''} tone={statusTones[record.new_status??'']??'neutral'}>{statusLabels[record.new_status??'']??'状态未记录'}</StatusBadge></span>:null}
    </HButton>
  </TimelineItem>;
}
