import {CalendarDays,ChevronDown,Shapes,UserRound} from 'lucide-react';
import {useRef,useState} from 'react';
import type {ReactNode} from 'react';
import type {BoardCompletionRange,WorkbenchCard} from '../../../api/client';
import {ProcessedDatePicker} from '../../../app/ProcessedDatePicker';
import {matchesBoardSummary,type BoardSummaryFilter} from '../../board-presentation';
import {Button} from '../Button/Button';
import './board-summary.css';

export function BoardSummary({items,now,selected,onSelect,mineAvailable,loading,partial,blocked,scope,relatedAvailable,onScope}:{
  items:readonly WorkbenchCard[];now:number;selected:BoardSummaryFilter|null;
  onSelect:(value:BoardSummaryFilter|null)=>void;mineAvailable:boolean;loading:boolean;partial:boolean;blocked:boolean;
  scope:'team'|'related';relatedAvailable:boolean;onScope:(value:'team'|'related')=>void;
}){
  const tabs=[
    {key:'all',label:'全部',tone:'neutral',note:'计数基于已加载数据。'},
    {key:'mine',label:'我负责',tone:'brand',note:'仅计当前资料中由你负责处理的事项。'},
    {key:'related',label:'与我有关',tone:'brand',note:'查看与你有关的事项；当前没有独立计数。'},
    {key:'overdue',label:'已超时',tone:'danger',note:'计入所有显示红色超时热度的事项。'},
    {key:'today',label:'今日完成',tone:'success',note:'按北京时间完成时间统计，沿当前日期与查询范围。'},
  ] as const;
  return <div className="ds-board-summary scope-tabs" role="group" aria-label="工作范围">
    {tabs.map(({key,label,tone,note})=>{
      const unavailable=partial||(key==='mine'&&!mineAvailable),metric=key==='mine'||key==='overdue'||key==='today'?key:null;
      const count=loading||unavailable||key==='related'?null:metric?items.filter(item=>matchesBoardSummary(item,metric,now)).length:items.length;
      const description=(key==='all'?'已加载 '+items.length+' 项；':'基于已加载的 '+items.length+' 项。')+note+(loading?'正在读取，暂不显示计数。':partial?'部分事项读取失败，暂无法统计。':key==='mine'&&!mineAvailable?'当前没有本人处理关系资料，暂无法统计。':'');
      const active=metric?selected===metric:!selected&&(key==='related'?scope==='related':scope==='team');
      return <Button key={key} tone="ghost" className="ds-summary-card" data-summary-filter={key} data-summary-tone={tone}
        {...(key==='related'?{'data-action':'related-scope'}:{})} data-overdue={key==='overdue'&&count!==null&&count>0?'true':undefined}
        aria-label={label+(count===null?'':' '+count)} aria-pressed={active} aria-disabled={blocked||loading||key==='mine'&&!mineAvailable||key==='related'&&!relatedAvailable} title={description}
        onPress={()=>{if(blocked||loading||key==='mine'&&!mineAvailable||key==='related'&&!relatedAvailable)return;if(metric)onSelect(selected===metric?null:metric);else{onSelect(null);onScope(key==='related'?'related':'team');}}}>
        <span className="ds-summary-label">{label}</span>{count===null?null:<strong className="ds-summary-value">{count}</strong>}
      </Button>;
    })}
  </div>;
}

/** Decorations only: selection and the original Select controller remain with the caller. */
export function BoardFilterPill({active,label,onClear,blocked,children}:{active:boolean;label:string;onClear:()=>void;blocked:boolean;children:ReactNode}){
  return <div className="ds-board-filter-pill" data-filter-active={active?'true':undefined}><span className="ds-board-filter-icon" aria-hidden="true">{label==='类别'?<Shapes/>:<UserRound/>}</span>{children}{active?<Button tone="ghost" isIconOnly size="sm" aria-label={'清除'+label+'筛选'} isDisabled={blocked} onPress={onClear}>×</Button>:null}</div>;
}

const dateLabels={today:'今天',recent:'近两天',week:'近 7 天',month:'本月'} as const;
type Preset=keyof typeof dateLabels;
const dateKey=(range:BoardCompletionRange,dates?:{from:string;to:string})=>[range,dates?.from??'',dates?.to??''].join(':');
export function BoardDatePresets({range,dates,now,blocked,onApply}:{range:BoardCompletionRange;dates?:{from:string;to:string}|undefined;now:number;blocked:boolean;onApply:(range:BoardCompletionRange,dates?:{from:string;to:string})=>void}){
  const panel=useRef<HTMLDetailsElement>(null),day=new Date(now+8*3_600_000).toISOString().slice(0,10);
  const [choice,setChoice]=useState<{key:string;preset:Preset|'custom'}|null>(null);
  const key=dateKey(range,dates);
  const week=new Date(Date.parse(day+'T00:00:00Z')-6*86_400_000).toISOString().slice(0,10),month=day.slice(0,8)+'01';
  const selected:Preset|'custom'=choice?.key===key&&(choice.preset==='custom'||range==='recent'||dates?.to===day)?choice.preset:range==='recent'?'recent':range==='custom'&&dates?.to===day?(dates.from===day?'today':dates.from===week?'week':dates.from===month?'month':'custom'):'custom';
  const customSelected=range==='custom'&&selected==='custom';
  const caption=range==='all'?'全部日期':selected==='custom'&&dates?dates.from.slice(5).replace('-','/')+'–'+dates.to.slice(5).replace('-','/'):selected==='custom'?'自定义':dateLabels[selected];
  const select=(preset:Preset)=>{if(blocked)return;if(panel.current)panel.current.open=false;const next=preset==='recent'?undefined:{from:preset==='today'?day:preset==='week'?week:month,to:day},mode=preset==='recent'?'recent':'custom';setChoice({key:dateKey(mode,next),preset});onApply(mode,next);};
  const presets=(compact=false)=>(Object.keys(dateLabels) as Preset[]).map(key=><Button key={key} tone="ghost" data-date-preset={key} data-compact={compact?'true':undefined} aria-pressed={selected===key} isDisabled={blocked} onPress={()=>select(key)}>{dateLabels[key]}</Button>);
  return <div className="ds-board-dates" title="日期仅影响已处理列，未完成事项不限日期">
    <span className="ds-board-date-label">已处理</span><div className="ds-date-segments">{presets()}
      <details ref={panel} className="ds-toolbar-filters ds-date-custom"><summary className="ds-toolbar-date-filter" data-date-preset="custom" data-date-selected={customSelected?'true':undefined} aria-current={customSelected?'true':undefined} data-action="open-closed-date-filter" aria-label="筛选已处理日期" aria-disabled={blocked} onClick={event=>{if(blocked)event.preventDefault();}}>
        <span className="ds-date-wide"><CalendarDays aria-hidden="true"/>{selected==='custom'?caption:'自定义'}</span><span className="ds-date-compact">已处理 · {caption}<ChevronDown aria-hidden="true"/></span>
      </summary><div className="ds-toolbar-filter-content"><div className="ds-date-mobile-presets">{presets(true)}</div>
        <ProcessedDatePicker key={key} range={range} dates={dates} now={now} blocked={blocked} onApply={(value,next)=>{setChoice({key:dateKey(value,next),preset:'custom'});onApply(value,next);if(panel.current)panel.current.open=false;}}/>
      </div></details>
    </div>
  </div>;
}
