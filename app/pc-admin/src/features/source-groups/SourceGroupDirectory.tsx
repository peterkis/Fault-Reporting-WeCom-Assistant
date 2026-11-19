import {ReadTableSkeleton} from '../read-states/ReadTableSkeleton';
import {ErrorState} from '../../design/components/ErrorState/ErrorState';
import {useDelayedLoading} from '../../design/hooks/useDelayedLoading';
import {copiedReadDiagnostics} from '../../app/read-state-diagnostics';
import {DataTable as HTable} from '../../design/components/DataTable/DataTable';
import {UsersRound} from 'lucide-react';
import {SearchField} from '../../design/components/SearchField/SearchField';
import {EmptyState} from '../../design/components/EmptyState/EmptyState';
import {PageHeader} from '../../design/components/PageHeader/PageHeader';
import {Toolbar} from '../../design/components/Toolbar/Toolbar';
import {WorkbenchLink as Link} from '../../app/WorkbenchLink';
import {Button as HButton} from '../../design/components/Button/Button';
import {Form as HForm} from "@heroui/react";
import {ToastFeedback,useFeedbackState} from '../../app/ToastFeedback';
import {useEffect,useState} from 'react';
import {useSearchParams} from 'react-router';
import {useQuery} from '@tanstack/react-query';
import {api,ApiError,errorMessage} from '../../api/client';
import type {Principal} from '../../api/client';
import type {SourceGroupDisplay} from '../../../../../contracts/web01_workbench_contracts';
import {GroupNameEditor} from './GroupNameEditor';

export function SourceGroupDirectory({principal,onBlockedChange}:{principal:Principal;onBlockedChange:(blocked:boolean)=>void}){
  const [params,setParams]=useSearchParams(),q=params.get('q')??'';
  const [input,setInput]=useState(q),[cursor,setCursor]=useState<string|null>(null),[history,setHistory]=useState<(string|null)[]>([]),[selected,setSelected]=useState<SourceGroupDisplay|null>(null),[invalid,setInvalid]=useState(false);
  const [blocked,setBlocked]=useState(false),[notice,setNotice,noticeRevision]=useFeedbackState('');
  useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
  const enabled=principal.source_group_directory_enabled&&principal.roles.includes('ADMIN');
  const result=useQuery({queryKey:['source-groups',principal.principal_id,q,cursor],queryFn:({signal})=>api.sourceGroups(q,cursor,signal),enabled});
  const loading=useDelayedLoading(enabled&&result.isPending);
  useEffect(()=>{setInput(q);setCursor(null);setHistory([]);if(!blocked)setSelected(null);},[q]);
  if(!principal.source_group_directory_enabled)return <section className="workspace ds-page source-group-directory"><PageHeader title="来源群名称" icon={<UsersRound/>}/><Toolbar/><EmptyState size="page" title="来源群目录尚未开放" description="返回工作台继续处理。" action={<Link to="/">返回工作台</Link>}/></section>;
  if(!principal.roles.includes('ADMIN'))return <section className="workspace ds-page source-group-directory"><PageHeader title="来源群名称" icon={<UsersRound/>}/><Toolbar/><EmptyState size="page" title="当前账号不能查看目录" description="返回工作台，或联系管理员。" action={<Link to="/">返回工作台</Link>}/></section>;
  const items=result.isError?[]:result.data?.items??[];
  const current=selected?(items.find(item=>item.ref===selected.ref)??selected):null,authorizationRejected=result.error instanceof ApiError&&[401,403,404].includes(result.error.status);
  return <section className="workspace ds-page source-group-directory" aria-label="来源群设置"><PageHeader title="来源群名称" icon={<UsersRound/>} description="登记已观察到的来源群，方便同事辨认报修来源。" actions={<Link to="/" onClick={event=>{if(blocked)event.preventDefault();}}>返回工作台</Link>}/>
    <Toolbar><HForm className="source-group-search" onSubmit={event=>{event.preventDefault();if(blocked)return;const search=input.trim();if([...search].length>128||/[\u0000-\u001f\u007f]/u.test(input)){setInvalid(true);return;}setInvalid(false);setNotice('');setCursor(null);setHistory([]);setSelected(null);setParams(search?{q:search}:{});}}><SearchField aria-label="检索来源群" placeholder="当前名称或来源群引用" value={input} maxLength={256} disabled={blocked} onChange={event=>setInput(event.target.value)} onClear={()=>setInput('')}/><HButton type="submit" data-action="search-source-groups" isDisabled={blocked} tone="secondary">检索</HButton><HButton type="button" isDisabled={blocked} onClick={()=>{void result.refetch();}} tone="ghost">重新读取目录</HButton></HForm></Toolbar>
    {invalid?<p role="alert">检索内容最多128个字符，不得含控制字符。</p>:null}
    {notice?<ToastFeedback revision={noticeRevision} source="source-groups" role="alert">{notice}</ToastFeedback>:null}
    {loading.visible?<ReadTableSkeleton className="" label="正在加载来源群目录…" columns={[{title:'来源群名称'},{title:'登记情况',className:'ds-table-state'},{title:'来源群引用',className:'ds-table-reference'},{title:'维护',className:'ds-table-action'}]} slow={loading.slow} {...(!blocked?{onRetry:()=>{void result.refetch();}}:{})}/>:result.isPending?null:result.isError?blocked?<p role="alert">目录读取失败：{errorMessage(result.error)}</p>:<ErrorState size="page" title="来源群目录没有读出来" description="点击重试加载来源群目录。" onRetry={()=>{void result.refetch();}} diagnostics={copiedReadDiagnostics(result.error,result.errorUpdatedAt)}/>:<div className="ds-state-region" data-refreshing={result.isFetching?'true':undefined}>
      <div className="ds-state-content"><p data-source-group-page>第 {history.length+1} 页 · 本页 {items.length} 个来源群</p>
      {items.length?<HTable><HTable.ScrollContainer><HTable.Content aria-label="来源群目录"><HTable.Header><HTable.Column isRowHeader>来源群名称</HTable.Column><HTable.Column className="ds-table-state">登记情况</HTable.Column><HTable.Column className="ds-table-reference">来源群引用</HTable.Column><HTable.Column className="ds-table-action">维护</HTable.Column></HTable.Header><HTable.Body className="source-group-rows">{items.map(group=><HTable.Row id={group.ref} key={group.ref} data-source-group-ref={group.ref}><HTable.Cell><strong>{group.display_name??'企微群聊'}</strong></HTable.Cell><HTable.Cell>{group.name_source==='ADMIN_CONFIRMED'?'管理员已登记':'尚未登记'}</HTable.Cell><HTable.Cell><code title={group.ref}>{group.ref}</code></HTable.Cell><HTable.Cell><HButton type="button" data-action="edit-source-group" isDisabled={blocked} onClick={()=>{setNotice('');setSelected(group);}} tone="secondary">维护名称</HButton></HTable.Cell></HTable.Row>)}</HTable.Body></HTable.Content></HTable.ScrollContainer></HTable>:<EmptyState size="page" className="empty" title={q?'没有符合条件的来源群':'本页没有可见的来源群'} icon={<UsersRound/>} {...(q?{variant:'filtered',summary:'检索：'+q,onClear:()=>{setInput('');setCursor(null);setHistory([]);setSelected(null);setParams({});}}:{description:'返回第一页，或稍后再查看。'})}/>}
      </div><div className="source-group-pagination"><HButton type="button" data-action="previous-source-groups" isDisabled={blocked||!history.length||result.isFetching} onClick={()=>{setCursor(history.at(-1)??null);setHistory(history.slice(0,-1));setSelected(null);}} tone="secondary">上一页</HButton><HButton type="button" data-action="next-source-groups" isDisabled={blocked||!result.data?.next_cursor||result.isFetching} onClick={()=>{if(result.data?.next_cursor){setHistory([...history,cursor]);setCursor(result.data.next_cursor);setSelected(null);}}} tone="secondary">下一页</HButton></div>
    </div>}
    {current&&!authorizationRejected?<section className="source-group-selected"><h2>{current.display_name??'企微群聊'}</h2><code>{current.ref}</code><GroupNameEditor key={current.ref} group={current} principal={principal} onSaved={setSelected} onBlockedChange={setBlocked} onDenied={error=>{setSelected(null);setNotice(errorMessage(error));}}/><HButton type="button" isDisabled={blocked} onClick={()=>setSelected(null)} tone="secondary">关闭维护</HButton></section>:null}
    <p className="workspace ds-page-footnote">相同名称可以对应不同来源群。名称只影响展示，不改变工单状态、原始来源或通知目的地。</p>
  </section>;
}
