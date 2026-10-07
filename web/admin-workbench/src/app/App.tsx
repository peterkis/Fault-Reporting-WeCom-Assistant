import {useEffect,useRef,useState} from 'react';
import type {KeyboardEvent,ReactNode} from 'react';
import {Link,Route,Routes,useLocation,useNavigate,useParams,useSearchParams} from 'react-router';
import {useInfiniteQuery,useQuery} from '@tanstack/react-query';
import {Button} from '@heroui/react/button';
import {LayoutGrid,List,MessageSquare,TriangleAlert,Bell,BookOpen,Settings,ChevronDown,ChevronUp,ArrowUpRight,RefreshCw,ArrowLeft,X,LifeBuoy,Search} from 'lucide-react';
import {MorphIcon} from 'morphicons/react';
import {PanelLeftClose as CollapseData,PanelLeftOpen as ExpandData} from 'lucide';
import {createColumnHelper,tableFeatures,useTable} from '@tanstack/react-table';
import {api,errorMessage,statusLabels,sourceLabels} from '../api/client';
import type {BoardColumn,CompletionRange,WorkbenchCard,Principal} from '../api/client';
import {useUiStore} from './ui-store';

const names:Record<BoardColumn,string>={pending:'待受理',active:'处理中',closed:'已关闭'};
const columns:readonly BoardColumn[]=['pending','active','closed'];
const statusColors:Record<string,string>={NEW:'yellow',QUEUED:'yellow',ACCEPTED:'yellow',PENDING:'yellow',RECEIVED:'yellow',WAITING_TRIAGE:'yellow',REOPENED:'orange',WAITING_DESCRIPTION:'orange',WAITING_REQUESTER:'orange',IN_PROGRESS:'blue',WAITING_VENDOR:'blue',CLOSED:'green',RESOLVED:'green',FAILED:'red'};
function useColumn(principal:string,column:BoardColumn,range:CompletionRange){
  return useInfiniteQuery({queryKey:['board',principal,column,range],initialPageParam:null as string|null,
    queryFn:({pageParam,signal})=>api.board(column,range,pageParam,signal),getNextPageParam:p=>p.next_cursor??undefined});
}
function useClock(){
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),60_000);return()=>window.clearInterval(timer);},[]);
  return now;
}
function relativeTime(value:string,now:number){
  // API timestamps are Asia/Shanghai local time; never parse in the browser's local timezone.
  const elapsed=now-Date.parse(value.replace(' ','T')+'+08:00');
  if(!Number.isFinite(elapsed)||elapsed<0)return value.slice(5,16);
  const minutes=Math.floor(elapsed/60_000);
  if(minutes===0)return '刚刚';
  if(minutes<60)return minutes+' 分钟前';
  const hours=Math.floor(minutes/60),rest=minutes%60;
  if(hours<24)return hours+' 小时'+(rest?' '+rest+' 分':'')+'前';
  return Math.floor(hours/24)+' 天前';
}
function Message({text,retry}:{text:string;retry?:()=>void}){
  return <div className="state-message" role="status"><TriangleAlert size={18}/><p>{text}</p>{retry?<Button variant="secondary" onPress={retry}>重新读取</Button>:null}</div>;
}
function itemLink(item:WorkbenchCard,search:string){return '/items/'+item.kind+'/'+item.id+search;}
function Status({item}:{item:WorkbenchCard}){
  return <><span className={'status-chip '+(statusColors[item.status]??'gray')}>{statusLabels[item.status]??item.status}</span>{item.kind==='ticket'&&item.review_reason?<span className="status-chip yellow">待复核</span>:null}</>;
}
function TeamAvatar({name}:{name:string}){
  let color=0;for(const character of name)color=(color*31+(character.codePointAt(0)??0))>>>0;
  return <span aria-hidden="true" className={'avatar av'+(color%4+1)}>{Array.from(name).at(-1)}</span>;
}
function Owner({name,compact=false}:{name:string|null;compact?:boolean}){
  return <span className="owner">{name?<TeamAvatar name={name}/>:<span aria-hidden="true" className="avatar unassigned"/>}<span className="owner-name">{name??(compact?'未领取':'等待领取')}</span></span>;
}
function trapDialogFocus(event:KeyboardEvent<HTMLDialogElement>){
  if(event.key!=='Tab')return;
  const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')).filter(element=>element.getClientRects().length>0);
  const first=controls[0],last=controls.at(-1);
  if(!first||!last)return;
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
}
function Card({item,search,selected,now}:{item:WorkbenchCard;search:string;selected:boolean;now:number}){
  return <article className={'ticket-card '+(selected?'is-selected':'')} data-kind={item.kind} data-item-id={item.id}>
    <Link className="card-open" to={itemLink(item,search)} state={{fromBoard:true}}>
      <div className="card-top"><span>{item.number}</span></div>
      <h3>{item.title}</h3>
      <p className="card-meta" title={(item.location??'位置未提供')+' · '+(item.reporter_name??'报修人资料未提供')}>{item.location??'位置未提供'} · {item.reporter_name??'报修人资料未提供'}</p>
      <div className="card-tags"><Status item={item}/><span className="neutral-chip">{sourceLabels[item.source]??item.source}</span></div>
      <footer className="card-footer"><Owner name={item.assignee_name}/><time className="activity-time" dateTime={item.updated_at.replace(' ','T')+'+08:00'} title={'最新活动：'+item.updated_at+'（北京时间）'}>更新 {relativeTime(item.updated_at,now)}</time></footer>
      <span className="sr-only">查看详情</span>
    </Link>
  </article>;
}
function More({expanded,count,onClick,controls}:{expanded:boolean;count:number;onClick:()=>void;controls:string}){
  return count>3?<button className="column-more" data-action="expand-column" aria-expanded={expanded} aria-controls={controls} onClick={onClick}>{expanded?<ChevronUp size={14}/>:<ChevronDown size={14}/>}<span>{expanded?'收起':('还有 '+(count-3)+' 项')}</span><span className="sr-only">（当前已加载范围）</span></button>:null;
}
const tableFeaturesForWork=tableFeatures({});
const tableHelper=createColumnHelper<typeof tableFeaturesForWork,WorkbenchCard>();
function WorkList({items,search,selected,now,column,label}:{items:WorkbenchCard[];search:string;selected:string|undefined;now:number;column:BoardColumn;label:string}){
  const [expanded,setExpanded]=useState(false),visible=expanded?items:items.slice(0,3);
  const tableColumns=tableHelper.columns([
    tableHelper.accessor('number',{header:'编号'}),
    tableHelper.accessor('title',{header:'问题',cell:({row})=><Link className="row-link" to={itemLink(row.original,search)} state={{fromBoard:true}} title={row.original.title}>{row.original.title}<span className="sr-only">查看详情</span></Link>}),
    tableHelper.accessor('status',{header:'状态',cell:({row})=><Status item={row.original}/>}),
    tableHelper.accessor('source',{header:'来源',cell:({row})=><span className="neutral-chip">{sourceLabels[row.original.source]??row.original.source}</span>}),
    tableHelper.accessor('location',{header:'位置',cell:({getValue})=>getValue()??'未提供'}),
    tableHelper.accessor('reporter_name',{header:'报修人',cell:({getValue})=>getValue()??'未提供'}),
    tableHelper.accessor('assignee_name',{header:'负责人',cell:({getValue})=><Owner name={getValue()} compact/>}),
    tableHelper.accessor('updated_at',{header:'最新活动',cell:({getValue})=><time className="activity-time" title={getValue()+'（北京时间）'}>{relativeTime(getValue(),now)}</time>}),
  ]);
  const table=useTable({features:tableFeaturesForWork,columns:tableColumns,data:visible,getRowId:row=>row.kind+':'+row.id});
  // Server order and cursors stay authoritative; folding does not claim full-range totals or filtering.
  return <section className="list-group" aria-label={label}><div className="column-heading"><h2 className={'stage-pill '+column}>{label}</h2><span>{items.length} 已加载</span></div>
    <div className="table-wrap" id={'list-'+column}><table className="work-table"><thead>{table.getHeaderGroups().map(group=><tr key={group.id}>{group.headers.map(header=><th scope="col" key={header.id}><table.FlexRender header={header}/></th>)}</tr>)}</thead>
      <tbody>{table.getRowModel().rows.map(row=><tr className={row.original.id===selected?'is-selected':''} key={row.id}>{row.getAllCells().map(cell=><td title={typeof cell.getValue()==='string'?String(cell.getValue()):undefined} key={cell.id}><table.FlexRender cell={cell}/></td>)}</tr>)}</tbody></table></div>
    <More expanded={expanded} count={items.length} controls={'list-'+column} onClick={()=>setExpanded(value=>!value)}/>
  </section>;
}
function Shell({principal,children}:{principal:Principal;children:ReactNode}){
  const collapsed=useUiStore(s=>s.sidebarCollapsed),toggle=useUiStore(s=>s.toggleSidebar);
  const [online,setOnline]=useState(navigator.onLine);
  useEffect(()=>{const changed=()=>setOnline(navigator.onLine);window.addEventListener('online',changed);window.addEventListener('offline',changed);return()=>{window.removeEventListener('online',changed);window.removeEventListener('offline',changed);};},[]);
  return <div className={'app '+(collapsed?'sidebar-collapsed':'')}><aside className="sidebar" aria-label="主导航"><div className="brand"><span className="brandmark"><LifeBuoy size={18}/></span><strong>医小修</strong><ChevronDown size={14}/></div>
    <button className="sidebar-search" disabled title="全局搜索尚未开放"><Search size={16}/><span>搜索工作区</span><small>预留</small></button>
    <p className="nav-label">工作空间</p><Link className="nav-item current" to="/" aria-current="page" title="工作台"><LayoutGrid/><span>工作台</span></Link>
    <div className="nav-item muted" title="会话 · 后续开放"><MessageSquare/><span>会话</span><small>后续</small></div><div className="nav-item muted" title="公共故障 · 后续开放"><TriangleAlert/><span>公共故障</span><small>后续</small></div><div className="nav-item muted" title="团队知识库 · 规划中"><BookOpen/><span>团队知识库</span><small>规划中</small></div><div className="nav-item muted" title="通知异常 · 后续开放"><Bell/><span>通知异常</span><small>后续</small></div>
    <div className="sidebar-note">共同协作，清楚交接。</div><div className="sidebar-bottom"><div className="nav-item muted" title="设置"><Settings/><span>设置</span></div><div className="account"><TeamAvatar name={principal.display_name}/><div><strong>{principal.display_name}</strong><small>已授权内部身份</small></div></div></div></aside>
    <main><header className="topbar"><button className="icon-button" aria-label={collapsed?'展开侧栏':'收起侧栏'} onClick={toggle}><MorphIcon icon={collapsed?ExpandData:CollapseData} size={18} reducedMotion="user"/></button><span>信息服务团队 <span className="slash">/</span> <strong>工作台</strong></span><span className={'connection '+(!online?'offline':'')}>{online?'按需读取':'网络已断开'}</span><a href="/workbench">旧管理端<ArrowUpRight size={14}/></a></header>{children}</main></div>;
}
function Detail({principal,items,now,fullPage}:{principal:Principal;items:WorkbenchCard[];now:number;fullPage:boolean}){
  const {kind='',id=''}=useParams(),navigate=useNavigate(),location=useLocation(),dialog=useRef<HTMLDialogElement>(null),previousFocus=useRef<HTMLElement|null>(null),pageHeading=useRef<HTMLHeadingElement>(null);
  const result=useInfiniteQuery({queryKey:['detail',principal.principal_id,kind,id],initialPageParam:null as string|null,
    queryFn:({pageParam,signal})=>api.detail(kind,id,pageParam,signal),getNextPageParam:p=>p.next_cursor??undefined});
  const close=()=>{const search=new URLSearchParams(location.search);search.delete('detail');if(!fullPage&&location.state&&typeof location.state==='object'&&'fromBoard' in location.state&&location.state.fromBoard===true)void navigate(-1);else void navigate('/'+(search.size?'?'+search:'') ,{replace:true});};
  useEffect(()=>{
    if(fullPage)return;
    previousFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    dialog.current?.showModal();
    return()=>{dialog.current?.close();if(previousFocus.current?.isConnected)previousFocus.current.focus();};
  },[fullPage]);
  const detail=result.data?.pages[0],records=result.data?.pages.flatMap(p=>p.records)??[];
  useEffect(()=>{if(fullPage&&detail)pageHeading.current?.focus();},[fullPage,detail]);
  const index=items.findIndex(item=>item.kind===kind&&item.id===id),previous=index>0?items[index-1]:undefined,next=index>=0?items[index+1]:undefined;
  const move=(item:WorkbenchCard|undefined)=>{if(item)void navigate(itemLink(item,location.search),{replace:true,state:location.state});};
  const pageParams=new URLSearchParams(location.search);pageParams.set('detail','page');
  const content=<>
    <div className="detail-navigation"><button className="icon-button" aria-label="关闭详情" title="返回工作台" onClick={close}>{fullPage?<ArrowLeft size={18}/>:<X size={18}/>}</button>
      {!fullPage?<><Link className="icon-button" aria-label="展开完整页面" title="展开完整页面" to={location.pathname+'?'+pageParams} replace><ArrowUpRight size={18}/></Link><button className="icon-button" aria-label="上一项" title="上一项（已加载范围）" disabled={!previous} onClick={()=>move(previous)}><ChevronUp size={18}/></button><button className="icon-button" aria-label="下一项" title="下一项（已加载范围）" disabled={!next} onClick={()=>move(next)}><ChevronDown size={18}/></button></>:null}
      <span>只读详情</span>{!fullPage?<Link className="full-page-link" to={location.pathname+'?'+pageParams} replace>展开完整页面<ArrowUpRight size={14}/></Link>:null}</div>
    {result.isPending?<Message text="正在读取事项详情…"/>:result.isError?<Message text={errorMessage(result.error)} retry={()=>{void result.refetch();}}/>:detail?<div className="detail-body">
      <header className="detail-heading"><div className="context-line">{detail.item.number}<span>· {detail.item.kind==='ticket'?'工单':detail.item.kind==='review'?'未建单复核事项':'未建单受理事项'}</span></div><h2 id="detail-title" ref={pageHeading} tabIndex={fullPage?-1:undefined}>{detail.item.title}</h2></header>
      <section className="properties" aria-label="事项信息"><dl>
        <dt>状态</dt><dd><Status item={detail.item}/></dd>
        <dt>处理责任</dt><dd><Owner name={detail.responsibility.ticket_assignee_name}/></dd>
        <dt>报修人</dt><dd>{detail.item.reporter_name??'未提供'}</dd>
        <dt>位置</dt><dd>{detail.item.location??'未提供'}</dd>
        <dt>来源</dt><dd><span className="neutral-chip">{sourceLabels[detail.item.source]??detail.item.source}</span></dd>
        <dt>沟通责任</dt><dd>{detail.responsibility.conversation_assignees.join('、')||'暂无明确沟通人'}</dd>
        <dt>创建时间</dt><dd>{detail.item.created_at}</dd>
        <dt>最新活动</dt><dd>{detail.item.updated_at}</dd>
        <dt>实际完结</dt><dd>{detail.item.completed_at??'尚无完结事件'}</dd>
      </dl><p>以上时间均为北京时间；最新活动不代表当前环节耗时。</p></section>
      <p className="read-only-note">当前为只读视图。处理操作请使用 <a href="/workbench">旧管理端</a>。</p>
      <section className="detail-main"><h3>报修内容</h3><p className="description">{detail.description??'暂无可读取的原始报修内容。'}</p><h3 className="activity-title">动态 <span>{records.length} 条已加载</span></h3>
        <ol className="activity-list">{records.map(record=><li key={record.id}>{record.audience!=='REPORT'&&record.actor&&record.actor!=='SYSTEM'?<TeamAvatar name={record.actor}/>:<span className="avatar" aria-hidden="true">{record.audience==='REPORT'?'报':'系'}</span>}<div><header><strong>{record.actor??(record.audience==='REPORT'?'报修材料':'系统记录')}</strong><time title={record.at+'（北京时间）'}>{relativeTime(record.at,now)}</time><span className="record-type">{record.audience==='INTERNAL'?'内部记录':record.audience==='EXTERNAL'?'对外摘要':'原始报修'}</span></header><p>{record.text??(record.new_status?(statusLabels[record.old_status??'']??record.old_status??'新建')+' → '+(statusLabels[record.new_status]??record.new_status):record.type)}</p></div></li>)}</ol>
        {!records.length?<p className="empty">暂无可读取的活动记录。</p>:null}{result.hasNextPage?<Button variant="secondary" isDisabled={result.isFetchingNextPage} onPress={()=>{void result.fetchNextPage();}}>加载更早记录</Button>:<p className="column-end">当前范围的记录已加载完毕</p>}</section>
    </div>:null}
  </>;
  if(fullPage)return <article className="detail-page" aria-labelledby="detail-title">{content}</article>;
  return <dialog className="detail-dialog" ref={dialog} aria-labelledby={detail?'detail-title':undefined} aria-label={detail?undefined:'事项详情'} onKeyDown={trapDialogFocus} onCancel={event=>{event.preventDefault();close();}} onClick={event=>{if(event.target===event.currentTarget){const bounds=event.currentTarget.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)close();}}}>{content}</dialog>;
}
function BoardSection({query,column,label,search,selected,now}:{query:ReturnType<typeof useColumn>;column:BoardColumn;label:string;search:string;selected:string|undefined;now:number}){
  const [expanded,setExpanded]=useState(false),loaded=query.data?.pages.flatMap(page=>page.items)??[],visible=expanded?loaded:loaded.slice(0,3);
  return <section className={'board-column '+column} aria-label={label}><div className="column-heading"><h2 className={'stage-pill '+column}>{label}</h2><span>{query.isError?'—':loaded.length} 已加载</span></div>
    {query.isPending?<Message text="正在读取…"/>:query.isError?<Message text={errorMessage(query.error)} retry={()=>{void query.refetch();}}/>:<><div className="column-cards" id={'cards-'+column}>{visible.map(item=><Card key={item.kind+item.id} item={item} search={search} selected={item.id===selected} now={now}/>)}{!loaded.length?<p className="empty">当前授权范围内暂无事项</p>:null}</div><More expanded={expanded} count={loaded.length} controls={'cards-'+column} onClick={()=>setExpanded(value=>!value)}/></>}
    {!query.isError&&!query.isPending?(query.hasNextPage?<Button className="load-more" variant="tertiary" isDisabled={query.isFetchingNextPage} onPress={()=>{void query.fetchNextPage();}}>加载下一页</Button>:null):null}
  </section>;
}
function Workbench({principal}:{principal:Principal}){
  const [params,setParams]=useSearchParams(),location=useLocation(),selected=useParams(),now=useClock();
  const view=params.get('view')==='list'?'list':'board',range:CompletionRange=params.get('range')==='cancelled'?'cancelled':params.get('range')==='all'?'all':'recent',fullPage=Boolean(selected.id&&params.get('detail')==='page');
  const pending=useColumn(principal.principal_id,'pending',range),active=useColumn(principal.principal_id,'active',range),closed=useColumn(principal.principal_id,'closed',range);
  const queries=[pending,active,closed],items=queries.flatMap(query=>query.isError?[]:query.data?.pages.flatMap(page=>page.items)??[]),unique=[...new Map(items.map(item=>[item.kind+':'+item.id,item])).values()];
  const update=(key:string,value:string)=>{const next=new URLSearchParams(params);next.set(key,value);setParams(next);};
  const refresh=()=>{void pending.refetch();void active.refetch();void closed.refetch();};
  const completionWindow=closed.data?.pages[0]?.range;
  const until=completionWindow?new Date(Date.parse(completionWindow.until.replace(' ','T')+'Z')-86_400_000).toISOString().slice(5,10):'';
  const label=(column:BoardColumn)=>column==='closed'&&range==='cancelled'?'已取消':names[column];
  return <Shell principal={principal}>{!fullPage?<div className="workspace"><div className="page-title"><span className="page-icon"><LayoutGrid size={30} strokeWidth={1.6}/></span><div><h1>团队工作台</h1><p>让每一件报修，都有回应。</p></div><span className="read-only-badge">只读</span></div>
    <div className="toolbar"><div className="scope-tabs"><span className="selected">团队工作</span><button disabled title="处理、沟通与关注的完整范围尚未开放">与我有关<small>后续</small></button></div>
      <div className="tools"><Button variant="tertiary" onPress={refresh}><RefreshCw size={16}/>刷新</Button><div className="view-tabs" role="group" aria-label="展示方式"><button aria-pressed={view==='board'} onClick={()=>update('view','board')}><LayoutGrid size={16}/>看板</button><button aria-pressed={view==='list'} onClick={()=>update('view','list')}><List size={16}/>列表</button></div></div></div>
    <div className="range-bar"><span>{queries.some(query=>query.isError)?'部分事项读取失败':'已加载 '+unique.length+' 项'}</span><span>未完成事项不限日期</span><label>已关闭范围 <select value={range} onChange={event=>update('range',event.target.value)}><option value="recent">今天和昨天</option><option value="all">全部完结记录</option><option value="cancelled">已取消（全部时间）</option></select></label>
      {completionWindow?<span className="range-caption">{range==='recent'?'已关闭：'+completionWindow.from.slice(5,10)+' – '+until+'（北京时间） · 已解决待确认保留':range==='cancelled'?'第三列仅查看已取消事项':'完结记录不限日期；取消事项另行查看'}</span>:null}</div>
    {view==='board'?<div className="board">{columns.map((column,index)=>{const query=queries[index];return query?<BoardSection key={column+':'+range} query={query} column={column} label={label(column)} search={location.search} selected={selected.id} now={now}/>:null;})}</div>:<>
      {columns.map((column,index)=>{const query=queries[index];return query?<div key={column+':'+range}>{query.isPending?<Message text={label(column)+'：正在读取…'}/>:query.isError?<Message text={label(column)+'：'+errorMessage(query.error)} retry={()=>{void query.refetch();}}/>:<><WorkList column={column} label={label(column)} items={query.data.pages.flatMap(page=>page.items)} search={location.search} selected={selected.id} now={now}/>{!query.data.pages.some(page=>page.items.length)?<p className="empty">当前授权范围内暂无事项</p>:null}{query.hasNextPage?<Button className="load-more" variant="tertiary" isDisabled={query.isFetchingNextPage} onPress={()=>{void query.fetchNextPage();}}>加载下一页</Button>:null}</>}</div>:null;})}</>}
    <p className="workspace-footnote">展示当前身份获权的服务记录。打开详情不会接管工单。</p></div>:null}
    {selected.id?<Detail principal={principal} items={unique} now={now} fullPage={fullPage}/>:null}
  </Shell>;
}
function Session(){const failure=useUiStore(s=>s.sessionError),reset=useUiStore(s=>s.reset);
  const bootstrap=useQuery({queryKey:['session'],queryFn:({signal})=>api.bootstrap(signal),enabled:failure===null});
  if(failure)return <div className="entry-state"><h1>医小修工作台</h1><Message text={failure===401?'会话已失效，请重新进入已授权工作台。':'当前身份没有查看权限。'} retry={reset}/><a href="/workbench">返回现有工作台入口</a></div>;
  if(bootstrap.isPending)return <div className="entry-state"><Message text="正在核验内部会话…"/></div>;
  if(bootstrap.isError)return <div className="entry-state"><h1>医小修工作台</h1><Message text={errorMessage(bootstrap.error)} retry={()=>{void bootstrap.refetch();}}/><a href="/workbench">返回现有工作台入口</a></div>;
  return <Workbench principal={bootstrap.data}/>;
}
export function App(){return <Routes><Route path="/" element={<Session/>}/><Route path="items/:kind/:id" element={<Session/>}/><Route path="*" element={<div className="entry-state"><Message text="页面不存在。"/><Link to="/">返回工作台</Link></div>}/></Routes>;}
