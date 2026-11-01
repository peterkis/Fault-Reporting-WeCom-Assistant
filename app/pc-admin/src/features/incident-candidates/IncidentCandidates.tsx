import {TriangleAlert} from 'lucide-react';
import {EmptyState} from '../../design/components/EmptyState/EmptyState';
import {PageHeader} from '../../design/components/PageHeader/PageHeader';
import {Toolbar} from '../../design/components/Toolbar/Toolbar';
import {WorkbenchLink as Link} from '../../app/WorkbenchLink';
import {DataTable as HTable} from '../../design/components/DataTable/DataTable';
import {Button as HButton} from '../../design/components/Button/Button';
import {Link as HLink,ListBox} from "@heroui/react";
import {FilterSelect as WorkbenchSelect} from "../../design/components/FilterSelect/FilterSelect";
import {useInfiniteQuery} from '@tanstack/react-query';
import {useSearchParams} from 'react-router';
import type {Principal} from '../../api/client';
import {errorMessage} from '../../api/client';
import {candidateApi,candidateStates} from './client';
import type {CandidateState} from './client';

const labels:Record<CandidateState,string>={CANDIDATE:'待复核',UNDER_REVIEW:'复核中',CONFIRMED:'已确认',REJECTED:'已拒绝',EXPIRED:'已过期'};
export function IncidentCandidates({principal}:{principal:Principal}){
  const [params,setParams]=useSearchParams(),selected=params.get('state'),state:CandidateState=candidateStates.includes(selected as CandidateState)?selected as CandidateState:'CANDIDATE';
  const result=useInfiniteQuery({queryKey:['incident-candidates',principal.principal_id,state],enabled:principal.incident_candidate_workspace_enabled,
    initialPageParam:null as string|null,maxPages:3,queryFn:({pageParam,signal})=>candidateApi.list(state,pageParam,signal),getNextPageParam:page=>page.next_cursor??undefined});
  if(!principal.incident_candidate_workspace_enabled)return <div className="workspace ds-page"><PageHeader title="公共故障候选" icon={<TriangleAlert/>}/><Toolbar/><p role="status">候选工作区尚未启用。</p><HLink href="/workbench">返回现有工作台</HLink></div>;
  const items=result.data?.pages.flatMap(page=>page.items)??[];
  return <div className="workspace ds-page"><PageHeader title="公共故障候选" icon={<TriangleAlert/>} description="先核对来源，再由获权工作人员明确决定。"/>
    <Toolbar><WorkbenchSelect label={<>候选状态 </>} aria-label="候选状态" value={state} onChange={event=>setParams({state:event})}>{candidateStates.map(value=><ListBox.Item key={value} id={value} textValue={String(labels[value])}>{labels[value]}<ListBox.ItemIndicator/></ListBox.Item>)}</WorkbenchSelect><HButton type="button" onClick={()=>{void result.refetch();}} tone="ghost">刷新候选</HButton></Toolbar>
    <p>当前加载 {items.length} 个候选；此数量不表示全量公共故障或受影响人数。</p>
    {result.isPending?<p role="status">正在读取获权候选…</p>:result.isError?<p role="alert">{errorMessage(result.error)}</p>:<div className="table-wrap"><HTable><HTable.ScrollContainer><HTable.Content aria-label="公共故障候选列表" className="work-table"><HTable.Header><><HTable.Column isRowHeader>来源服务与症状</HTable.Column><HTable.Column>状态</HTable.Column><HTable.Column>来源观察人数</HTable.Column><HTable.Column>候选依据版本</HTable.Column><HTable.Column>到期时间（北京时间）</HTable.Column></></HTable.Header><HTable.Body>{items.map(item=><HTable.Row key={item.id} data-candidate-id={item.id} id={item.id}><HTable.Cell><Link to={'/incidents/candidates/'+item.id}>{item.service_family} · {item.symptom_family}</Link></HTable.Cell><HTable.Cell>{labels[item.status]}</HTable.Cell><HTable.Cell>{item.distinct_reporters??'来源未提供'}</HTable.Cell><HTable.Cell>{item.row_version}</HTable.Cell><HTable.Cell>{item.expires_at}</HTable.Cell></HTable.Row>)}</HTable.Body></HTable.Content></HTable.ScrollContainer></HTable>{items.length===0?<EmptyState title="当前获权范围没有此状态的候选。" icon={<TriangleAlert/>}/>:null}</div>}
    {result.hasNextPage?<HButton type="button" isDisabled={result.isFetchingNextPage} onClick={()=>{void result.fetchNextPage();}} tone="secondary">读取下一页（保留最近三页）</HButton>:null}
  </div>;
}
