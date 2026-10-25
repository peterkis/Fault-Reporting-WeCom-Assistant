import {useInfiniteQuery} from '@tanstack/react-query';
import {Link,useSearchParams} from 'react-router';
import type {Principal} from '../../api/client';
import {errorMessage} from '../../api/client';
import {candidateApi,candidateStates} from './client';
import type {CandidateState} from './client';

const labels:Record<CandidateState,string>={CANDIDATE:'待复核',UNDER_REVIEW:'复核中',CONFIRMED:'已确认',REJECTED:'已拒绝',EXPIRED:'已过期'};
export function IncidentCandidates({principal}:{principal:Principal}){
  const [params,setParams]=useSearchParams(),selected=params.get('state'),state:CandidateState=candidateStates.includes(selected as CandidateState)?selected as CandidateState:'CANDIDATE';
  const result=useInfiniteQuery({queryKey:['incident-candidates',principal.principal_id,state],enabled:principal.incident_candidate_workspace_enabled,
    initialPageParam:null as string|null,maxPages:3,queryFn:({pageParam,signal})=>candidateApi.list(state,pageParam,signal),getNextPageParam:page=>page.next_cursor??undefined});
  if(!principal.incident_candidate_workspace_enabled)return <div className="workspace"><h1>公共故障候选</h1><p role="status">候选工作区尚未启用。</p><a href="/workbench">返回现有工作台</a></div>;
  const items=result.data?.pages.flatMap(page=>page.items)??[];
  return <div className="workspace"><div className="page-title"><div><h1>公共故障候选</h1><p>先核对来源，再由获权工作人员明确决定。</p></div></div>
    <div className="toolbar"><label>候选状态 <select aria-label="候选状态" value={state} onChange={event=>setParams({state:event.target.value})}>{candidateStates.map(value=><option key={value} value={value}>{labels[value]}</option>)}</select></label><button type="button" onClick={()=>{void result.refetch();}}>刷新候选</button></div>
    <p>当前加载 {items.length} 个候选；此数量不表示全量公共故障或受影响人数。</p>
    {result.isPending?<p role="status">正在读取获权候选…</p>:result.isError?<p role="alert">{errorMessage(result.error)}</p>:<div className="table-wrap"><table className="work-table"><thead><tr><th>来源服务与症状</th><th>状态</th><th>来源观察人数</th><th>候选依据版本</th><th>到期时间（北京时间）</th></tr></thead><tbody>{items.map(item=><tr key={item.id} data-candidate-id={item.id}><td><Link to={'/incidents/candidates/'+item.id}>{item.service_family} · {item.symptom_family}</Link></td><td>{labels[item.status]}</td><td>{item.distinct_reporters??'来源未提供'}</td><td>{item.row_version}</td><td>{item.expires_at}</td></tr>)}</tbody></table>{items.length===0?<p>当前获权范围没有此状态的候选。</p>:null}</div>}
    {result.hasNextPage?<button type="button" disabled={result.isFetchingNextPage} onClick={()=>{void result.fetchNextPage();}}>读取下一页（保留最近三页）</button>:null}
  </div>;
}
