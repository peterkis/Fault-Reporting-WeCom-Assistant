import {Tooltip} from '@heroui/react';
import {Inbox,AlarmClock,UserRound,CheckCheck} from 'lucide-react';
import type {WorkbenchCard} from '../../../api/client';
import {matchesBoardSummary} from '../../board-presentation';
import type {BoardSummaryFilter} from '../../board-presentation';
import {Button} from '../Button/Button';
import './board-summary.css';

const metrics = [
  {key:'pending',label:'待受理',tone:'warning',icon:Inbox,note:'受理与工单中等待处理的事项。'},
  {key:'overdue',label:'已超时',tone:'danger',icon:AlarmClock,note:'仅计待受理工单；处理中暂未计入，等待状态起始时间补齐。'},
  {key:'mine',label:'我负责',tone:'brand',icon:UserRound,note:'仅计当前读取资料中由你负责处理的事项，不包含仅关注或接待的事项。'},
  {key:'today',label:'今日已处理',tone:'success',icon:CheckCheck,note:'按北京时间的完成时间统计，沿当前日期与查询范围。'},
] as const;

export function BoardSummary({items,now,selected,onSelect,mineAvailable,loading,partial,blocked}:{
  items:readonly WorkbenchCard[];now:number;selected:BoardSummaryFilter|null;
  onSelect:(value:BoardSummaryFilter|null)=>void;mineAvailable:boolean;loading:boolean;partial:boolean;blocked:boolean;
}){
  return <div className="ds-board-summary" role="group" aria-label="工作概况">
    {metrics.map(({key,label,tone,icon:Icon,note})=>{
      const unavailable=key==='mine'&&!mineAvailable,disabled=loading||unavailable||blocked;
      const description='基于已加载的 '+items.length+' 项。'+note+(unavailable?'当前没有本人处理关系资料。':'')+(partial?'部分事项读取失败，统计可能不完整。':'');
      const value=loading?'正在读取':unavailable?'暂不可用':String(items.filter(item=>matchesBoardSummary(item,key,now)).length);
      return <Tooltip key={key}><Tooltip.Trigger><Button tone="ghost" className="ds-summary-card" data-summary-filter={key} data-summary-tone={tone}
        aria-label={label+' '+value} aria-pressed={selected===key} aria-disabled={disabled} title={description}
        onPress={()=>{if(!disabled)onSelect(selected===key?null:key);}}>
        <span className="ds-summary-icon" aria-hidden="true"><Icon/></span><span className="ds-summary-label">{label}</span>
        <strong className="ds-summary-value">{loading||unavailable?'—':value}</strong>
      </Button></Tooltip.Trigger><Tooltip.Content className="ds-summary-tooltip">{description}</Tooltip.Content></Tooltip>;
    })}
  </div>;
}
