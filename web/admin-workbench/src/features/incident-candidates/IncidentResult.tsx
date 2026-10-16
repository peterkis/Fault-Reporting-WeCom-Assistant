import {useQuery} from '@tanstack/react-query';
import {useParams} from 'react-router';
import type {Principal} from '../../api/client';
import {errorMessage} from '../../api/client';
import {candidateApi} from './client';
import type {IncidentResult} from './client';
import {IncidentFollowup} from './IncidentFollowup';
import './candidate.css';

export function IncidentResultPage({principal,onBlockedChange}:{principal:Principal;onBlockedChange:(blocked:boolean)=>void}){
  const {id=''}=useParams();
  if(!principal.incident_candidate_workspace_enabled)return <div className="workspace"><h1>公共故障</h1><p role="status">候选工作区尚未启用。</p><a href="/workbench">返回现有工作台</a></div>;
  return <IncidentFollowup key={principal.principal_id+':'+id} principal={principal} incidentId={id} onBlockedChange={onBlockedChange}/>;
}
export function IncidentResultView({principal,incidentId,authorityRevision='standalone'}:{principal:Principal;incidentId:string;authorityRevision?:string}){
  const query=useQuery({queryKey:['incident-result',principal.principal_id,incidentId,authorityRevision],queryFn:({signal})=>candidateApi.incident(incidentId,signal)});
  if(query.isPending)return <p role="status">正在独立读取当前获权的公共故障…</p>;
  if(query.isError)return <section aria-label="公共故障读取结果"><p role="alert">{errorMessage(query.error)} 已知确认结果仍保留；这里仅显示当前获权事实。</p><button type="button" onClick={()=>{void query.refetch();}}>重新读取公共故障</button></section>;
  return <IncidentResultFacts result={query.data}/>;
}
export function IncidentResultFacts({result}:{result:IncidentResult}){
  return <section className="properties" aria-label="当前公共故障" data-incident-id={result.id}>
    <h2>{result.incident_no} · {result.safe_title}</h2><dl><dt>状态</dt><dd>{result.status}</dd><dt>确认范围</dt><dd>{result.confirmed_scope}</dd><dt>公共故障版本</dt><dd>{result.row_version}</dd><dt>确认时间</dt><dd>{result.confirmed_at}（北京时间）</dd>
      {result.owner_principal_id!==undefined?<><dt>故障负责人</dt><dd>{result.owner_display_name??'当前姓名不可用'}</dd><dt>责任组</dt><dd>{result.owner_team_id??'未设责任组'}</dd><dt>主处理参考</dt><dd>{result.primary_ticket_id===null?'无主工单':result.primary_ticket_no??'当前编号不可用'}</dd></>:null}
    </dl><p>这是独立 Incident 的当前投影；个人工单仍保持各自的状态与责任，确认不代表通知已发送。</p>
  </section>;
}
