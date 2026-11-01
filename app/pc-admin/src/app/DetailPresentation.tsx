import {Button as HButton} from '../design/components/Button/Button';
import {useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {Check} from 'lucide-react';
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

export function DetailActionDialog({children,blocked,attention,onOpenChange}:{children:ReactNode;blocked:boolean;attention:boolean;onOpenChange?:((open:boolean)=>void)|undefined}){
  const [open,setOpen]=useState(false);
  useEffect(()=>{if(attention)setOpen(true);},[attention]);
  const close=()=>{if(!blocked)setOpen(false);};
  return <><HButton type="button" className="detail-complete-button" onClick={()=>setOpen(true)} tone="primary"><Check size={16}/>{attention?'核对完工操作':'登记完工'}</HButton>
    <DetailDialog open={open} onClose={close} closeBlocked={blocked} title="登记完工" closeLabel="关闭完工窗口" onOpenChange={onOpenChange}>{children}</DetailDialog></>;
}

export function ActivityTimeline({records,principal,item,active,now,children}:{records:WorkbenchDetail['records'];principal:Principal;item:WorkbenchDetail['item'];active:boolean;now:number;children:ReactNode}){
  const modalOpen=useDetailModalOpen();
  return <Section className="detail-main" titleClassName="activity-title" title="处理记录">
    <Timeline className="activity-list">{groupActivityRecords(records,now).map(group=><TimelineGroup className="activity-group" key={group.label} label={group.label} date={group.date} aria-label={group.label+'的处理记录'}>
      {group.records.map(record=><ActivityRecord key={record.id} record={record} principal={principal} item={item} active={active&&!modalOpen}/>)}
    </TimelineGroup>)}</Timeline>{children}
  </Section>;
}
function ActivityRecord({record,principal,item,active}:{record:WorkbenchDetail['records'][number];principal:Principal;item:WorkbenchDetail['item'];active:boolean}){
  const [expanded,setExpanded]=useState(false),name=activityActorName(record);
  const text=record.text??(record.new_status?(statusLabels[record.old_status??'']??'新建')+' → '+(statusLabels[record.new_status]??'状态已更新'):'已记录处理操作。');
  return <TimelineItem className={'detail-record'+(expanded?' is-expanded':'')} avatar={<ActorAvatar principal={principal} item={item} actor={record.actor_ref} name={name}/>} time={<time dateTime={record.at.replace(' ','T')+'+08:00'} title={record.at+'（北京时间）'}>{record.at.slice(11,16)}</time>}>
    <HButton tone="ghost" className="record-content" aria-expanded={expanded} title={expanded?'收起记录':'展开完整记录'} onPress={()=>setExpanded(value=>!value)}>
      <span className="record-name">{name}</span>
      {record.read_material?<PersonalReadMaterial inline active={active} principal={principal} item={{kind:item.kind,id:item.id}} sourceRef={record.read_material.source_ref} revision={record.read_material.revision} text={text}/>:<span className="record-text">{!record.text&&record.new_status?<><StatusBadge tone={statusTones[record.old_status??'']??'neutral'}>{statusLabels[record.old_status??'']??'新建'}</StatusBadge>{' → '}<StatusBadge tone={statusTones[record.new_status]??'neutral'}>{statusLabels[record.new_status]??'状态已更新'}</StatusBadge></>:text}</span>}
      {record.audience==='INTERNAL'?<span className="record-audience" aria-label="内部，仅信息科可见">内部</span>:record.audience==='EXTERNAL'?<span className="record-audience public">报修人可见</span>:null}
    </HButton>
  </TimelineItem>;
}
