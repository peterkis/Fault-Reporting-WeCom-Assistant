import {WorkbenchButton as HButton} from './WorkbenchButton';
import {useEffect,useMemo,useState} from 'react';
import type {ReactNode} from 'react';
import {Check} from 'lucide-react';
import {Avatar,Chip} from '@heroui/react';
import type {Principal,WorkbenchDetail} from '../api/client';
import {statusLabels} from '../api/client';
import {PersonalReadMaterial} from '../features/personal-read/PersonalReadMaterial';
import {groupActivityRecords} from './activity-time.mjs';
import {activityActorName,extendActivityActorColors} from './activity-actors.mjs';
import type {ActivityActorColor} from './activity-actors.mjs';
import {DetailDialog,useDetailModalOpen} from './DetailDialog';

export function DetailActionDialog({children,blocked,attention,onOpenChange}:{children:ReactNode;blocked:boolean;attention:boolean;onOpenChange?:((open:boolean)=>void)|undefined}){
  const [open,setOpen]=useState(false);
  useEffect(()=>{if(attention)setOpen(true);},[attention]);
  const close=()=>{if(!blocked)setOpen(false);};
  return <><HButton type="button" className="detail-complete-button" onClick={()=>setOpen(true)} variant="secondary"><Check size={16}/>{attention?'核对完工操作':'登记完工'}</HButton>
    <DetailDialog open={open} onClose={close} closeBlocked={blocked} title="登记完工" closeLabel="关闭完工窗口" onOpenChange={onOpenChange}>{children}</DetailDialog></>;
}

export function ActivityTimeline({records,principal,item,active,now,children}:{records:WorkbenchDetail['records'];principal:Principal;item:WorkbenchDetail['item'];active:boolean;now:number;children:ReactNode}){
  const modalOpen=useDetailModalOpen();
  const [assigned,setAssigned]=useState<ReadonlyMap<string,ActivityActorColor>>(()=>extendActivityActorColors(new Map(),records));
  const colors=useMemo(()=>extendActivityActorColors(assigned,records),[assigned,records]);
  useEffect(()=>{if(colors!==assigned)setAssigned(colors);},[assigned,colors]);
  return <section className="detail-main"><h3 className="activity-title">处理记录 <span>{records.length} 条已加载</span></h3>
    <div className="activity-list">{groupActivityRecords(records,now).map(group=><section className="activity-group" key={group.label} aria-label={group.label+'的处理记录'}>
      <h4>{group.label}{group.label!==group.date?<span>{group.date}</span>:null}</h4><ol>{group.records.map(record=><ActivityRecord key={record.id} record={record} principal={principal} item={item} active={active&&!modalOpen} color={colors.get(activityActorName(record))}/>)}</ol>
    </section>)}</div>{children}
  </section>;
}
function ActivityRecord({record,principal,item,active,color}:{record:WorkbenchDetail['records'][number];principal:Principal;item:WorkbenchDetail['item'];active:boolean;color:ActivityActorColor|undefined}){
  const [expanded,setExpanded]=useState(false),name=activityActorName(record);
  const text=record.text??(record.new_status?(statusLabels[record.old_status??'']??'新建')+' → '+(statusLabels[record.new_status]??'状态已更新'):'已记录处理操作。');
  return <li className={'detail-record'+(expanded?' is-expanded':'')}>
    <span className="record-actor-rail" aria-hidden="true"><Avatar className="record-avatar" style={color}><Avatar.Fallback>{Array.from(name)[0]}</Avatar.Fallback></Avatar></span>
    <HButton variant="ghost" className="record-content" aria-expanded={expanded} title={expanded?'收起记录':'展开完整记录'} onPress={()=>setExpanded(value=>!value)}>
      <span className="record-name" style={color}>{name}</span>
      {record.read_material?<PersonalReadMaterial inline active={active} principal={principal} item={{kind:item.kind,id:item.id}} sourceRef={record.read_material.source_ref} revision={record.read_material.revision} text={text}/>:<span className="record-text">{text}</span>}
      {record.audience==='INTERNAL'?<Chip className="record-audience" aria-label="内部，仅信息科可见">内部</Chip>:record.audience==='EXTERNAL'?<Chip className="record-audience public">报修人可见</Chip>:null}
    </HButton>
    <time dateTime={record.at.replace(' ','T')+'+08:00'} title={record.at+'（北京时间）'}>{record.at.slice(11,16)}</time>
  </li>;
}
