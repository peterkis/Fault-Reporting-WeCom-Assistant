import {createContext,useContext,useEffect,useId,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {useLocation,useNavigate} from 'react-router';
import {useQuery} from '@tanstack/react-query';
import {ArrowUpRight,LayoutList,Plus,Search,TriangleAlert,X} from 'lucide-react';
import {Button} from '../../design/components/Button/Button';
import {Modal} from '../../design/components/Modal/Modal';
import {SearchField} from '../../design/components/SearchField/SearchField';
import {api,errorMessage} from '../../api/client';
import type {Principal} from '../../api/client';
import {manualReportCapabilitiesKey} from '../manual-report/use-manual-report-draft';
import {parseSearchRequest} from '../../../../../shared/workbench-search-contracts.mjs';
import type {WorkbenchSearchCriteria} from '../../../../../contracts/workbench_search_contracts';
import './efficiency.css';

const EfficiencyContext=createContext<{open:()=>void;blocked:boolean}|null>(null);
const editable='input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=combobox],[role=spinbutton]';
const overlays='[role=dialog],[role=alertdialog],[role=menu],[role=listbox],.detail-dialog,.detail-page';
const shortcuts=[['J / K','下一张 / 上一张'],['H / L','左列 / 右列'],['Enter','打开工单'],['E','领取当前工单'],['N','新报修'],['/','聚焦搜索'],['Ctrl + K','搜索与命令'],['?','查看快捷键']];

/** Both entry points share one panel and one window listener. */
export function EfficiencyEntry({compact=false}:{compact?:boolean}){
  const context=useContext(EfficiencyContext);
  return context?<Button className={compact?'efficiency-compact':'sidebar-search efficiency-entry'} tone="ghost" isDisabled={context.blocked} aria-label="搜索与命令" aria-haspopup="dialog" onPress={context.open}><Search size={16}/>{compact?null:<span>搜索工作区</span>}<kbd>Ctrl K</kbd></Button>:null;
}

export function WorkbenchEfficiency({principal,blocked,children}:{principal:Principal;blocked:boolean;children:ReactNode}){
  const [panel,setPanel]=useState<'commands'|'shortcuts'|null>(null),navigate=useNavigate(),location=useLocation();
  const capabilities=useQuery({queryKey:manualReportCapabilitiesKey(principal.principal_id),queryFn:({signal})=>api.manualReportCapabilities(signal),enabled:principal.manual_reports_enabled});
  const canCreate=principal.manual_reports_enabled&&capabilities.isSuccess&&!capabilities.isError&&capabilities.data.can_create;
  const returnFocus=useRef<HTMLElement|null>(null);
  const open=(kind:'commands'|'shortcuts')=>{if(blocked)return;returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setPanel(kind);};
  const close=()=>{setPanel(null);requestAnimationFrame(()=>{if(returnFocus.current?.isConnected)returnFocus.current.focus({preventScroll:true});});};
  const go=(path:string)=>{if(blocked)return;setPanel(null);void navigate(path);};
  useEffect(()=>{setPanel(null);},[location.pathname,location.search,principal.authorization_revision]);
  useEffect(()=>{
    const keydown=(event:KeyboardEvent)=>{
      const target=event.target;
      if(event.defaultPrevented||event.repeat||event.isComposing||blocked||panel||!(target instanceof Element)||target.closest(editable)||document.querySelector(overlays))return;
      const key=event.key.toLowerCase();
      if((event.ctrlKey||event.metaKey)&&key==='k'&&!event.altKey&&!event.shiftKey){event.preventDefault();open('commands');return;}
      if(event.ctrlKey||event.metaKey||event.altKey)return;
      const board=document.querySelector<HTMLElement>('.board');
      if(!board||location.pathname!=='/'||event.shiftKey&&event.key!=='?')return;
      if(event.key==='?'){event.preventDefault();open('shortcuts');return;}
      if(key==='n'&&canCreate){event.preventDefault();go('/reports/new');return;}
      if(key==='/'&&principal.workbench_search_enabled){
        const input=document.querySelector<HTMLInputElement>('.workbench-search input[name=q]');
        if(input){event.preventDefault();const disclosure=input.closest('details');if(disclosure)disclosure.open=true;input.focus();}return;
      }
      if(!['j','k','h','l'].includes(key))return;
      const columns=[...board.querySelectorAll<HTMLElement>('.board-column')].map(column=>[...column.querySelectorAll<HTMLAnchorElement>('.card-open')].filter(link=>link.checkVisibility()));
      const focus=document.activeElement instanceof HTMLAnchorElement?document.activeElement:null;let column=columns.findIndex(cards=>focus!==null&&cards.includes(focus));
      let row=column<0||!focus?-1:columns[column]?.indexOf(focus)??-1;
      if(column<0){column=columns.findIndex(cards=>cards.length>0);row=key==='k'?(columns[column]?.length??1)-1:0;}
      else if(key==='j'||key==='k')row=Math.max(0,Math.min((columns[column]?.length??1)-1,row+(key==='j'?1:-1)));
      else {const step=key==='h'?-1:1;for(let next=column+step;next>=0&&next<columns.length;next+=step)if(columns[next]?.length){column=next;break;}}
      const next=columns[column]?.[Math.min(row,(columns[column]?.length??1)-1)];
      if(next){event.preventDefault();next.focus({preventScroll:true});next.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});}
    };
    window.addEventListener('keydown',keydown);
    return()=>window.removeEventListener('keydown',keydown);
  },[blocked,panel,canCreate,principal.workbench_search_enabled,location.pathname]);
  return <EfficiencyContext.Provider value={{open:()=>open('commands'),blocked}}>{children}
    {panel==='commands'?<CommandPanel key={principal.principal_id+':'+principal.authorization_revision} principal={principal} blocked={blocked} canCreate={canCreate} go={go} close={close}/>:null}
    <Modal.Backdrop className="workbench-modal-backdrop" isOpen={panel==='shortcuts'} onOpenChange={value=>{if(!value)close();}} isDismissable>
      <Modal.Container size="md"><Modal.Dialog className="efficiency-help" aria-label="看板快捷键"><header><Modal.Heading>看板快捷键</Modal.Heading><Button tone="ghost" isIconOnly aria-label="关闭快捷键" onPress={close}><X size={18}/></Button></header><p>输入文字、填写表单时，单键快捷键暂停。</p><dl>{shortcuts.map(([key,label])=><div key={key}><dt>{label}</dt><dd><kbd>{key}</kbd></dd></div>)}</dl><p>领取沿用当前工单的可用操作；没有领取权限时不执行。</p></Modal.Dialog></Modal.Container>
    </Modal.Backdrop>
  </EfficiencyContext.Provider>;
}

function CommandPanel({principal,blocked,canCreate,go,close}:{principal:Principal;blocked:boolean;canCreate:boolean;go:(path:string)=>void;close:()=>void}){
  const [text,setText]=useState(''),[query,setQuery]=useState(''),[selected,setSelected]=useState(0),id=useId();
  useEffect(()=>{const timer=window.setTimeout(()=>setQuery(text.trim()),180);return()=>window.clearTimeout(timer);},[text]);
  let criteria:WorkbenchSearchCriteria|null=null;
  try{criteria=parseSearchRequest(new URLSearchParams({q:query,range:'all',scope:'team',column:'all'})).criteria;}catch{/* Invalid pasted text stays in the input and never becomes a request. */}
  const searched=useQuery({queryKey:['board',principal.principal_id,'search','commands',query,principal.authorization_revision,principal.expires_epoch_ms,[...principal.roles].sort().join(',')],enabled:principal.workbench_search_enabled===true&&Boolean(query)&&criteria!==null&&!blocked,
    queryFn:({signal})=>{if(!criteria)throw new TypeError('SEARCH_CRITERIA_REQUIRED');return api.search(criteria,null,signal,principal.csrf_token);},retry:false,gcTime:0,refetchOnWindowFocus:false,refetchOnReconnect:false});
  const current=query===text.trim(),items=principal.workbench_search_enabled===true&&criteria!==null&&!blocked&&current&&searched.isSuccess&&!searched.isError?searched.data.items:[];
  const commands=[...(canCreate?[{name:'新报修',path:'/reports/new',icon:Plus}]:[]),{name:'切到列表',path:'/?view=list',icon:LayoutList},...(principal.notification_exceptions_enabled?[{name:'打开通知异常',path:'/notification-exceptions',icon:TriangleAlert}]:[])].filter(command=>!text.trim()||command.name.includes(text.trim()));
  const options=[...commands.map(command=>({...command,description:'工作区操作'})),...items.map(item=>({name:item.number+' · '+item.title,description:[item.reporter_name,item.reporter_department].filter(Boolean).join(' · '),path:'/items/'+item.kind+'/'+item.id,icon:ArrowUpRight}))];
  const index=Math.min(selected,Math.max(0,options.length-1));
  useEffect(()=>{document.getElementById(id+'-'+index)?.scrollIntoView({block:'nearest',behavior:'instant'});},[id,index,options.length]);
  return <Modal.Backdrop className="workbench-modal-backdrop" isOpen onOpenChange={value=>{if(!value)close();}} isDismissable><Modal.Container size="md"><Modal.Dialog className="efficiency-panel" aria-label="搜索与命令">
    <header><Modal.Heading>搜索与命令</Modal.Heading><Button tone="ghost" isIconOnly aria-label="关闭命令面板" onPress={close}><X size={18}/></Button></header>
    <SearchField autoFocus role="combobox" aria-label="搜索工单号、报修人或科室" aria-expanded="true" aria-controls={id} aria-autocomplete="list" aria-activedescendant={options.length?id+'-'+index:undefined} placeholder="工单号、报修人、科室，或输入操作名称" value={text} maxLength={128} disabled={blocked} onChange={event=>{setText(event.target.value);setSelected(0);}} onKeyDown={event=>{
      if(event.nativeEvent.isComposing)return;
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setSelected(value=>Math.max(0,Math.min(options.length-1,value+(event.key==='ArrowDown'?1:-1))));}
      if(event.key==='Enter'){event.preventDefault();const option=options[index];if(option)go(option.path);}
    }}/>
    <p className="efficiency-hint">{principal.workbench_search_enabled?'搜索全部当前可查看的事项。':'当前可使用以下工作区操作。'}</p>
    <div className="efficiency-results" id={id} role="listbox" aria-label="工单和操作">{options.map((option,i)=>{const Icon=option.icon;return <Button key={option.path} id={id+'-'+i} role="option" aria-selected={i===index} className="efficiency-result" tone="ghost" isDisabled={blocked} onFocus={()=>setSelected(i)} onPress={()=>go(option.path)}><Icon size={18}/><span><strong>{option.name}</strong><small>{option.description}</small></span></Button>;})}</div>
    <p className="efficiency-status" role="status">{blocked?'请先完成当前操作。':criteria===null?'搜索文字包含不支持的字符，请修改后重试。':principal.workbench_search_enabled&&(query&&!current||query&&searched.isPending)?'正在搜索…':query&&searched.isError?errorMessage(searched.error):query&&!options.length?'没有找到当前可查看的事项或操作。':searched.data?.next_cursor?'仅显示首批结果；缩小搜索范围可找到更多事项。':'↑ ↓ 选择 · Enter 打开 · Esc 关闭'}</p>
  </Modal.Dialog></Modal.Container></Modal.Backdrop>;
}
