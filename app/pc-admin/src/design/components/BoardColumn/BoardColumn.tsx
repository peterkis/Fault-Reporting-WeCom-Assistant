import type {HTMLAttributes} from 'react';
import {useState} from 'react';
import {Disclosure,Button,Dropdown,Label} from '@heroui/react';
import {ArrowDownWideNarrow,ArrowUp,ChevronDown} from 'lucide-react';
import {Button as ActionButton} from '../Button/Button';
import type {BoardSort} from '../../board-presentation';
import {StatusBadge} from '../StatusBadge/StatusBadge';
import {stagePresentation} from '../../status-map';
import './board-column.css';

type Props=HTMLAttributes<HTMLElement> & {column:keyof typeof stagePresentation;label:string;count:number|string;sort?:BoardSort;onSort?:(value:BoardSort)=>void;blocked?:boolean;newCount?:number;onReveal?:()=>void};
export function BoardColumn({column,label,count,sort='oldest',onSort,blocked=false,newCount=0,onReveal,className='',children,...props}:Props){
  return <section {...props} data-has-arrivals={newCount>0?'true':undefined} aria-label={label} className={'board-column ds-board-column '+column+' '+className}><div className="column-heading"><h2 className={'stage-pill '+column}><StatusBadge tone={stagePresentation[column].tone}>{label}</StatusBadge></h2><span className="ds-stage-count" title="当前筛选后已加载的事项">{count}</span>
    {newCount>0?<ActionButton className="ds-column-arrivals" tone="ghost" size="sm" isDisabled={blocked} onPress={()=>onReveal?.()} aria-label={'显示 '+newCount+' 条新报修'}><ArrowUp aria-hidden="true"/>{newCount} 条新报修</ActionButton>:null}
    {onSort?<Dropdown><Dropdown.Trigger className="ds-column-sort" aria-label={label+'排序'} isDisabled={blocked}><ArrowDownWideNarrow aria-hidden="true"/><span>{sort==='oldest'?'等待最久':'最新到达'}</span><ChevronDown aria-hidden="true"/></Dropdown.Trigger>
      <Dropdown.Popover><Dropdown.Menu aria-label={label+'排序方式'} selectionMode="single" disallowEmptySelection selectedKeys={new Set([sort])} onSelectionChange={keys=>{if(keys!=='all'){const key=[...keys][0];if(key==='oldest'||key==='newest')onSort(key);}}}>
        <Dropdown.Item id="oldest" textValue="等待最久"><Dropdown.ItemIndicator/><Label>等待最久</Label></Dropdown.Item>
        <Dropdown.Item id="newest" textValue="最新到达"><Dropdown.ItemIndicator/><Label>最新到达</Label></Dropdown.Item>
      </Dropdown.Menu></Dropdown.Popover></Dropdown>:null}
    </div>{column==='active'&&onSort?<p className="ds-column-sort-note">按查询顺序排列</p>:null}{children}</section>;
}

export function BoardGroup({label,count,children}: {label:string;count:number;children:React.ReactNode}){
  const [expanded,setExpanded]=useState(true);
  return <Disclosure className="ds-board-group" data-board-group={label} isExpanded={expanded} onExpandedChange={setExpanded}>
    <Disclosure.Heading><Button slot="trigger" variant="ghost" className="ds-board-group-trigger"><Disclosure.Indicator/><span>{label}</span><span className="ds-board-group-count">{count}</span></Button></Disclosure.Heading>
    <Disclosure.Content><Disclosure.Body>{children}</Disclosure.Body></Disclosure.Content>
  </Disclosure>;
}

/** Format only the server's confirmed half-open Shanghai window. */
export function boardEmptyMessage(column:keyof typeof stagePresentation,range?:{mode:string;from:string;until:string}){
  if(column!=='closed')return '这里暂时没有工单';
  if(!range||range.mode==='all')return '当前没有已处理的工单';
  if(range.mode==='cancelled')return '当前没有已取消的工单';
  // Calendar arithmetic on the server's civil fields; historical DST must not move a date.
  const last=new Date(Date.parse(range.until.replace(' ','T')+'Z')-1);
  if(!Number.isFinite(last.getTime()))return '这段时间没有已处理的工单';
  const end=last.toISOString().slice(5,10).replace('-','/');
  return range.from.slice(5,10).replace('-','/')+'–'+end+' 没有已处理的工单';
}
