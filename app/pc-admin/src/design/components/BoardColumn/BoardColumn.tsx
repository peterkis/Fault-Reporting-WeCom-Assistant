import type {HTMLAttributes} from 'react';
import {useRef,useState} from 'react';
import {useDragDropMonitor} from '@dnd-kit/react';
import {Disclosure,Button,Dropdown,Label} from '@heroui/react';
import {ArrowDownWideNarrow,ArrowUp,ChevronDown} from 'lucide-react';
import {Button as ActionButton} from '../Button/Button';
import type {BoardSort} from '../../board-presentation';
import {StatusBadge} from '../StatusBadge/StatusBadge';
import {stagePresentation} from '../../status-map';
import './board-column.css';

type Props=HTMLAttributes<HTMLElement> & {column:keyof typeof stagePresentation;label:string;count:number|string;countTitle?:string;sort?:BoardSort;onSort?:(value:BoardSort)=>void;blocked?:boolean;newCount?:number;onReveal?:()=>void};
export function BoardColumn({column,label,count,countTitle='当前筛选后已加载的事项',sort='oldest',onSort,blocked=false,newCount=0,onReveal,className='',children,...props}:Props){
  const section=useRef<HTMLElement>(null);
  useDragDropMonitor({onCollision(event,manager){
    if(column!=='closed')return;
    const point=manager.dragOperation.position.current,rect=section.current?.querySelector('[data-board-group="已关闭"]')?.getBoundingClientRect();
    // The library also tests the dragged rectangle. Reject the pointer's whole closed group,
    // including its heading, so overlap with the completed area cannot retain an old target.
    if(rect&&rect.width>0&&rect.height>0&&Number.isFinite(point.x)&&Number.isFinite(point.y)&&point.x>=rect.left&&point.x<=rect.right&&point.y>=rect.top&&point.y<=rect.bottom)event.collisions.splice(0);
  }});
  const labels=column==='closed'?{oldest:'最早完成',newest:'最新完成'}:{oldest:'等待最久',newest:'最新到达'};
  return <section {...props} ref={section} data-has-arrivals={newCount>0?'true':undefined} aria-label={label} className={'board-column ds-board-column '+column+' '+className}><div className="column-heading" data-summary-filter={column==='pending'?'pending':undefined} data-summary-tone={column==='pending'?'warning':undefined} aria-label={label+' '+count}><h2 className={'stage-pill '+column}><StatusBadge tone={stagePresentation[column].tone}>{label}</StatusBadge></h2><span className="ds-stage-count ds-summary-value" title={countTitle}>{count}</span>
    {newCount>0?<ActionButton className="ds-column-arrivals" tone="ghost" size="sm" isDisabled={blocked} onPress={()=>onReveal?.()} aria-label={'显示 '+newCount+' 条新报修'}><ArrowUp aria-hidden="true"/>{newCount} 条新报修</ActionButton>:null}
    {onSort&&column!=='active'?<Dropdown><Dropdown.Trigger className="ds-column-sort" aria-label={label+'排序'} isDisabled={blocked}><ArrowDownWideNarrow aria-hidden="true"/><span>{labels[sort]}</span><ChevronDown aria-hidden="true"/></Dropdown.Trigger>
      <Dropdown.Popover><Dropdown.Menu aria-label={label+'排序方式'} selectionMode="single" disallowEmptySelection selectedKeys={new Set([sort])} onSelectionChange={keys=>{if(keys!=='all'){const key=[...keys][0];if(key==='oldest'||key==='newest')onSort(key);}}}>
        <Dropdown.Item id="oldest" textValue={labels.oldest}><Dropdown.ItemIndicator/><Label>{labels.oldest}</Label></Dropdown.Item>
        <Dropdown.Item id="newest" textValue={labels.newest}><Dropdown.ItemIndicator/><Label>{labels.newest}</Label></Dropdown.Item>
      </Dropdown.Menu></Dropdown.Popover></Dropdown>:null}
    </div>{children}</section>;
}

export function BoardGroup({label,count,children,note,defaultExpanded=true,preferenceKey}: {label:string;count:number;children:React.ReactNode;note?:string;defaultExpanded?:boolean;preferenceKey?:string}){
  const [expanded,setExpanded]=useState(()=>{
    if(preferenceKey)try{const saved=sessionStorage.getItem(preferenceKey);if(saved==='true'||saved==='false')return saved==='true';}catch{/* Storage may be disabled; keep the session's in-memory preference. */}
    return defaultExpanded;
  });
  return <Disclosure className="ds-board-group" data-board-group={label} isExpanded={expanded} onExpandedChange={value=>{setExpanded(value);if(preferenceKey)try{sessionStorage.setItem(preferenceKey,String(value));}catch{/* Folding remains usable without browser storage. */}}}>
    <Disclosure.Heading><Button slot="trigger" variant="ghost" className="ds-board-group-trigger"><Disclosure.Indicator/><span>{label}</span><span className="ds-board-group-count">{count}</span>{note?<span className="ds-board-group-note">{note}</span>:null}</Button></Disclosure.Heading>
    <Disclosure.Content><Disclosure.Body>{children}</Disclosure.Body></Disclosure.Content>
  </Disclosure>;
}

/** Format only the server's confirmed half-open Shanghai window. */
export function boardEmptyMessage(column:keyof typeof stagePresentation,range?:{mode:string;from:string;until:string}){
  if(column!=='closed')return '这里暂时没有工单';
  if(!range||range.mode==='all')return '当前没有已处理的工单';
  // Calendar arithmetic on the server's civil fields; historical DST must not move a date.
  const last=new Date(Date.parse(range.until.replace(' ','T')+'Z')-1);
  if(!Number.isFinite(last.getTime()))return '这段时间没有已处理的工单';
  const end=last.toISOString().slice(5,10).replace('-','/');
  return range.from.slice(5,10).replace('-','/')+'–'+end+' 没有已处理的工单';
}
