import type {HTMLAttributes} from 'react';
import {StatusBadge} from '../StatusBadge/StatusBadge';
import {stagePresentation} from '../../status-map';
import './board-column.css';

type Props=HTMLAttributes<HTMLElement> & {column:keyof typeof stagePresentation;label:string;count:number|string};
export function BoardColumn({column,label,count,className='',children,...props}:Props){
  return <section {...props} aria-label={label} className={'board-column ds-board-column '+column+' '+className}><div className="column-heading"><h2 className={'stage-pill '+column}><StatusBadge tone={stagePresentation[column].tone}>{label}</StatusBadge></h2><span>{count}</span></div>{children}</section>;
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
