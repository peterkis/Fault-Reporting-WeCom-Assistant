import {useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {Link,Route,Routes,useLocation,useNavigate,useParams,useSearchParams} from 'react-router';
import {useInfiniteQuery,useQuery} from '@tanstack/react-query';
import {Button} from '@heroui/react/button';
import {LayoutGrid,List,MessageSquare,TriangleAlert,Bell,BookOpen,Settings,ChevronDown,ArrowUpRight,MapPin,UserRound,RefreshCw,ArrowLeft,X,LifeBuoy} from 'lucide-react';
import {MorphIcon} from 'morphicons/react';
import {PanelsTopLeft,Rows3,PanelLeftClose as CollapseData,PanelLeftOpen as ExpandData} from 'lucide';
import {createColumnHelper,tableFeatures,useTable} from '@tanstack/react-table';
import {api,errorMessage,statusLabels,sourceLabels} from '../api/client';
import type {BoardColumn,CompletionRange,WorkbenchCard,Principal} from '../api/client';
import {useUiStore} from './ui-store';

const names:Record<BoardColumn,string>={pending:'待受理',active:'处理中',closed:'已关闭'};
const columns:readonly BoardColumn[]=['pending','active','closed'];
function useColumn(principal:string,column:BoardColumn,range:CompletionRange){
  return useInfiniteQuery({queryKey:['board',principal,column,range],initialPageParam:null as string|null,
    queryFn:({pageParam,signal})=>api.board(column,range,pageParam,signal),getNextPageParam:p=>p.next_cursor??undefined});
}
function Message({text,retry}:{text:string;retry?:()=>void}){return <div className="state-message" role="status"><TriangleAlert size={17}/><p>{text}</p>{retry?<Button variant="secondary" onPress={retry}>重新读取</Button>:null}</div>;}
function itemLink(item:WorkbenchCard,search:string){return '/items/'+item.kind+'/'+item.id+search;}
function Card({item,search}:{item:WorkbenchCard;search:string}){
  return <article className="ticket-card" data-kind={item.kind} data-item-id={item.id}>
    <div className="card-top"><span>{item.number}</span><span>{sourceLabels[item.source]??item.source}</span></div>
    <Link className="card-open" to={itemLink(item,search)} state={{fromBoard:true}}><h3>{item.title}</h3><span className="sr-only">查看详情</span></Link>
    <p className="location"><MapPin size={12}/>{item.location??'位置未提供'}</p>
    <p className="reporter"><UserRound size={12}/>{item.reporter_name??'报修人资料未提供'}</p>
    <div className="card-tags"><span className={'status-chip '+item.column}>{statusLabels[item.status]??item.status}</span>{item.kind==='ticket'&&item.review_reason?<span className="attention-chip">待复核</span>:null}</div>
    <footer className="card-footer"><span>{item.assignee_name?<><span className="avatar small">{item.assignee_name.slice(0,1)}</span>{item.assignee_name}</>:'尚未指派'}</span><time>{item.updated_at.slice(5,16)}</time></footer>
  </article>;
}
const tableFeaturesForWork=tableFeatures({});
const tableHelper=createColumnHelper<typeof tableFeaturesForWork,WorkbenchCard>();
const tableColumns=tableHelper.columns([
  tableHelper.accessor('title',{header:'问题',cell:({row})=><span className="table-title">{row.original.title}<small>{row.original.number}</small></span>}),
  tableHelper.accessor('status',{header:'真实状态',cell:({row})=><span className={'status-chip '+row.original.column}>{statusLabels[row.original.status]??row.original.status}</span>}),
  tableHelper.accessor('reporter_name',{header:'报修人 / 位置',cell:({row})=><>{row.original.reporter_name??'未提供'}<small>{row.original.location??'位置未提供'}</small></>}),
  tableHelper.accessor('assignee_name',{header:'处理人',cell:({row})=>row.original.assignee_name??'尚未指派'}),
  tableHelper.accessor('updated_at',{header:'最新活动（北京时间）'}),
]);
function WorkList({items,search}:{items:WorkbenchCard[];search:string}){
  const table=useTable({features:tableFeaturesForWork,columns:tableColumns,data:items,getRowId:row=>row.kind+':'+row.id});
  // Server order and cursor pagination are authoritative; no client-wide sort/filter/pagination claim.
  return <div className="table-wrap"><table className="work-table"><thead>{table.getHeaderGroups().map(group=><tr key={group.id}>{group.headers.map(header=><th key={header.id}><table.FlexRender header={header}/></th>)}</tr>)}</thead>
    <tbody>{table.getRowModel().rows.map(row=><tr key={row.id}>{row.getAllCells().map((cell,index)=><td key={cell.id}>{index===0?<Link to={itemLink(row.original,search)} state={{fromBoard:true}}><table.FlexRender cell={cell}/></Link>:<table.FlexRender cell={cell}/>}</td>)}</tr>)}</tbody></table></div>;
}
function Shell({principal,children}:{principal:Principal;children:ReactNode}){
  const collapsed=useUiStore(s=>s.sidebarCollapsed),toggle=useUiStore(s=>s.toggleSidebar);
  const [online,setOnline]=useState(navigator.onLine);
  useEffect(()=>{const changed=()=>setOnline(navigator.onLine);window.addEventListener('online',changed);window.addEventListener('offline',changed);return()=>{window.removeEventListener('online',changed);window.removeEventListener('offline',changed);};},[]);
  return <div className={'app '+(collapsed?'sidebar-collapsed':'')}><aside className="sidebar"><div className="brand"><span className="brandmark"><LifeBuoy size={22}/></span><strong>医小修</strong><ChevronDown size={14}/></div>
    <p className="nav-label">工作区</p><Link className="nav-item current" to="/"><LayoutGrid size={17}/><span>工作台</span></Link>
    <div className="nav-item muted"><MessageSquare size={17}/><span>会话</span><small>后续</small></div><div className="nav-item muted"><TriangleAlert size={17}/><span>公共故障</span><small>后续</small></div><div className="nav-item muted"><Bell size={17}/><span>通知异常</span><small>后续</small></div><div className="nav-item muted"><BookOpen size={17}/><span>团队知识库</span><small>规划中</small></div>
    <div className="sidebar-note">共同协作，清楚交接。<br/>每一项都有真实的服务记录。</div><div className="sidebar-bottom"><div className="nav-item muted"><Settings size={16}/><span>设置</span></div><div className="account"><span className="avatar">{principal.display_name.slice(0,1)}</span><div><strong>{principal.display_name}</strong><small>已授权内部身份</small></div></div></div></aside>
    <main><header className="topbar"><button className="icon-button" aria-label={collapsed?'展开侧栏':'收起侧栏'} onClick={toggle}><MorphIcon icon={collapsed?ExpandData:CollapseData} size={17} reducedMotion="user"/></button><span>工作区 <span className="slash">/</span> 工作台</span><span className={'connection '+(!online?'offline':'')}>{online?'按需读取服务数据':'网络已断开'}</span><a href="/workbench">旧管理端<ArrowUpRight size={12}/></a></header>{children}</main></div>;
}
function Detail({principal}:{principal:Principal}){
  const {kind='',id=''}=useParams(),navigate=useNavigate(),location=useLocation(),dialog=useRef<HTMLDialogElement>(null),previousFocus=useRef<HTMLElement|null>(null);
  const result=useInfiniteQuery({queryKey:['detail',principal.principal_id,kind,id],initialPageParam:null as string|null,
    queryFn:({pageParam,signal})=>api.detail(kind,id,pageParam,signal),getNextPageParam:p=>p.next_cursor??undefined});
  const close=()=>{if(location.state&&typeof location.state==='object'&&'fromBoard' in location.state&&location.state.fromBoard===true)void navigate(-1);else void navigate('/'+location.search,{replace:true});};
  useEffect(()=>{previousFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;dialog.current?.showModal();return()=>{dialog.current?.close();if(previousFocus.current?.isConnected)previousFocus.current.focus();};},[]);
  const detail=result.data?.pages[0],records=result.data?.pages.flatMap(p=>p.records)??[];
  return <dialog className="detail-dialog" ref={dialog} aria-labelledby="detail-title" onCancel={event=>{event.preventDefault();close();}}>
    <div className="detail-navigation"><button onClick={close}><ArrowLeft size={15}/>返回工作台</button><span>只读详情</span><button className="icon-button" aria-label="关闭详情" onClick={close}><X size={18}/></button></div>
    {result.isPending?<Message text="正在读取事项详情…"/>:result.isError?<Message text={errorMessage(result.error)} retry={()=>{void result.refetch();}}/>:detail?<>
      <header className="detail-heading"><div className="context-line">{detail.item.number} <span>·</span> {detail.item.kind==='ticket'?'工单':detail.item.kind==='review'?'未建单复核事项':'未建单受理事项'}</div><h2 id="detail-title">{detail.item.title}</h2><div className="detail-status"><span className={'status-chip '+detail.item.column}>{statusLabels[detail.item.status]??detail.item.status}</span>{detail.item.review_reason?<span className="attention-chip">待复核 · {detail.item.review_reason}</span>:null}</div></header>
      <div className="detail-grid"><section className="detail-main"><h3>报修内容</h3><p className="description">{detail.description??'暂无可读取的原始报修内容。'}</p><p className="read-only-note">当前页面只读。接管、处理和关闭将在后续交付中接入。</p><h3 className="activity-title">活动记录 <span>{records.length} 条已加载</span></h3>
        <ol className="activity-list">{records.map(record=><li key={record.id}><span className={'activity-dot '+record.audience.toLowerCase()}/><div><header><strong>{record.actor??(record.audience==='REPORT'?'报修材料':'系统记录')}</strong><span className="record-type">{record.audience==='INTERNAL'?'内部':record.audience==='EXTERNAL'?'对外摘要':'原始报修'}</span><time>{record.at}</time></header><p>{record.text??(record.new_status?(statusLabels[record.old_status??'']??record.old_status??'新建')+' → '+(statusLabels[record.new_status]??record.new_status):record.type)}</p><small>{record.type}</small></div></li>)}</ol>
        {!records.length?<p className="empty">暂无可读取的活动记录。</p>:null}{result.hasNextPage?<Button variant="secondary" isDisabled={result.isFetchingNextPage} onPress={()=>{void result.fetchNextPage();}}>加载更早记录</Button>:<p className="column-end">当前范围的记录已加载完毕</p>}</section>
        <aside className="properties"><h3>事项信息</h3><dl><dt>真实状态</dt><dd>{detail.item.status}</dd><dt>处理责任</dt><dd>{detail.responsibility.ticket_assignee_name??'尚未指派'}</dd><dt>沟通责任</dt><dd>{detail.responsibility.conversation_assignees.join('、')||'暂无明确沟通人'}</dd><dt>报修人</dt><dd>{detail.item.reporter_name??'未提供'}</dd><dt>故障位置</dt><dd>{detail.item.location??'未提供'}</dd><dt>来源</dt><dd>{sourceLabels[detail.item.source]??detail.item.source}</dd><dt>创建时间</dt><dd>{detail.item.created_at}</dd><dt>最新活动</dt><dd>{detail.item.updated_at}</dd><dt>实际完结时间</dt><dd>{detail.item.completed_at??'尚无完结事件'}</dd></dl><p>以上时间均为北京时间。</p></aside></div>
    </>:null}
  </dialog>;
}
function Workbench({principal}:{principal:Principal}){
  const [params,setParams]=useSearchParams(),location=useLocation(),selected=useParams();
  const view=params.get('view')==='list'?'list':'board',range:CompletionRange=params.get('range')==='cancelled'?'cancelled':params.get('range')==='all'?'all':'recent';
  const pending=useColumn(principal.principal_id,'pending',range),active=useColumn(principal.principal_id,'active',range),closed=useColumn(principal.principal_id,'closed',range);
  const queries=[pending,active,closed],items=queries.flatMap(q=>q.isError?[]:q.data?.pages.flatMap(p=>p.items)??[]);
  const unique=[...new Map(items.map(i=>[i.kind+':'+i.id,i])).values()];
  const update=(key:string,value:string)=>{const next=new URLSearchParams(params);next.set(key,value);setParams(next);};
  const refresh=()=>{void pending.refetch();void active.refetch();void closed.refetch();};
  const window=closed.data?.pages[0]?.range;
  const label=(column:BoardColumn)=>column==='closed'&&range==='cancelled'?'已取消':names[column];
  return <Shell principal={principal}><div className="workspace"><div className="page-title"><span className="page-icon"><LayoutGrid size={28}/></span><div><h1>团队工作台</h1><p>让每一件报修，都有回应。</p></div><span className="read-only-badge">只读工作台</span></div>
    <div className="toolbar"><div className="scope-tabs"><span className="selected">团队工作</span><button disabled title="处理、沟通与关注的完整范围尚未接入">与我有关<small>后续</small></button></div><div className="view-tabs"><button aria-pressed={view==='board'} onClick={()=>update('view','board')}><LayoutGrid size={14}/>看板</button><button aria-pressed={view==='list'} onClick={()=>update('view','list')}><List size={14}/>列表</button></div>
      <div className="tools"><MorphIcon icon={view==='board'?PanelsTopLeft:Rows3} reducedMotion="user" size={17}/><span>授权范围 · 按列排序</span><Button variant="tertiary" onPress={refresh}><RefreshCw size={14}/>刷新</Button></div></div>
    <div className="range-bar"><span>未完成事项保留全部时间范围</span><label>已关闭范围 <select value={range} onChange={e=>update('range',e.target.value)}><option value="recent">今天和昨天</option><option value="all">全部完结记录</option><option value="cancelled">已取消（全部时间）</option></select></label>{window&&range==='recent'?<small>北京时间 {window.from.slice(0,10)} 至 {window.until.slice(0,10)} 前 · 已解决待确认不限日期</small>:window?<small>{range==='cancelled'?'第三列仅查看已取消事项':'完结记录不限日期；取消事项另行查看'}</small>:null}</div>
    {view==='board'?<div className="board">{columns.map((column,index)=>{const q=queries[index];if(!q)return null;const loaded=q.data?.pages.flatMap(p=>p.items)??[];return <section className={'board-column '+column} key={column} aria-label={label(column)}><div className="column-heading"><h2><span className={'stage-dot '+column}/>{label(column)}</h2><span>{q.isError?'—':loaded.length} 已加载</span></div>
      {q.isPending?<Message text="正在读取…"/>:q.isError?<Message text={errorMessage(q.error)} retry={()=>{void q.refetch();}}/>:<div className="column-cards">{loaded.map(item=><Card key={item.kind+item.id} item={item} search={location.search}/>)}{!loaded.length?<p className="empty">当前授权范围内暂无事项</p>:null}</div>}
      {!q.isError&&!q.isPending?(q.hasNextPage?<Button className="load-more" variant="tertiary" isDisabled={q.isFetchingNextPage} onPress={()=>{void q.fetchNextPage();}}>加载下一页</Button>:<p className="column-end">当前范围已加载完毕</p>):null}</section>;})}</div>:<>
      {queries.map((q,index)=>q.isError?<Message key={index} text={label(columns[index]??'pending')+'：'+errorMessage(q.error)} retry={()=>{void q.refetch();}}/>:null)}
      {queries.some(q=>q.isPending)?<Message text="正在读取列表…"/>:unique.length?<WorkList items={unique} search={location.search}/>:queries.some(q=>q.isError)?null:<p className="empty">当前授权范围内暂无事项</p>}
      <div className="list-pagination">{queries.map((q,index)=><div key={index}><span>{label(columns[index]??'pending')} · {q.isError?'读取失败':(q.data?.pages.flatMap(p=>p.items).length??0)+' 条已加载'}</span>{q.hasNextPage&&!q.isError?<Button variant="secondary" onPress={()=>{void q.fetchNextPage();}} isDisabled={q.isFetchingNextPage}>加载下一页</Button>:null}</div>)}</div></>}
    <p className="workspace-footnote">仅展示当前身份获权的服务记录；不会因打开事项而接管或关闭。</p></div>
    {selected.id?<Detail principal={principal} key={selected.kind+':'+selected.id}/>:null}
  </Shell>;
}
function Session(){const failure=useUiStore(s=>s.sessionError),reset=useUiStore(s=>s.reset);
  const bootstrap=useQuery({queryKey:['session'],queryFn:({signal})=>api.bootstrap(signal),enabled:failure===null});
  if(failure)return <div className="entry-state"><h1>医小修工作台</h1><Message text={failure===401?"会话已失效，请重新进入已授权工作台。":"当前身份没有查看权限。"} retry={reset}/><a href="/workbench">返回现有工作台入口</a></div>;
  if(bootstrap.isPending)return <div className="entry-state"><Message text="正在核验内部会话…"/></div>;
  if(bootstrap.isError)return <div className="entry-state"><h1>医小修工作台</h1><Message text={errorMessage(bootstrap.error)} retry={()=>{void bootstrap.refetch();}}/><a href="/workbench">返回现有工作台入口</a></div>;
  return <Workbench principal={bootstrap.data}/>;
}
export function App(){return <Routes><Route path="/" element={<Session/>}/><Route path="items/:kind/:id" element={<Session/>}/><Route path="*" element={<div className="entry-state"><Message text="页面不存在。"/><Link to="/">返回工作台</Link></div>}/></Routes>;}
