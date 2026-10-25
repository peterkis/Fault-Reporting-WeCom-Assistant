import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Link,useParams} from 'react-router';
import type {Principal} from '../../api/client';
import {api,ApiError,errorMessage,advanceWorkbenchAuthorizationEpoch} from '../../api/client';
import {clearSessionAuthorization} from '../../app/authorization';
import {purgeDrafts} from '../drafts/encrypted-drafts';
import {candidateApi} from './client';
import {CandidateDecisionForm} from './CandidateDecisionForm';

export const candidateLabels={CANDIDATE:'待复核',UNDER_REVIEW:'复核中',CONFIRMED:'已确认',REJECTED:'已拒绝',EXPIRED:'已过期'};
export const actionLabels={START_REVIEW:'开始复核',REJECT_CANDIDATE:'拒绝候选',CONFIRM_INCIDENT:'人工确认公共故障'};
const scopeLabels:Record<string,string>={UNKNOWN:'未知',ROOM:'房间',DEPARTMENT:'科室',LOCAL:'局部',BUILDING:'楼宇',CAMPUS:'院区',HOSPITAL_WIDE:'全院'};
const unavailable='不可用（来源未提供或当前权限不可见）';
export function CandidateDetailPage({principal,onBlockedChange}:{principal:Principal;onBlockedChange:(blocked:boolean)=>void}){
  const {id=''}=useParams();
  if(!principal.incident_candidate_workspace_enabled)return <div className="workspace"><h1>公共故障候选</h1><p role="status">候选工作区尚未启用。</p><a href="/workbench">返回现有工作台</a></div>;
  return <CandidateDetail key={principal.principal_id+':'+id} principal={principal} candidateId={id} onBlockedChange={onBlockedChange}/>;
}
export function CandidateDetail({principal,candidateId,onBlockedChange}:{principal:Principal;candidateId:string;onBlockedChange:(blocked:boolean)=>void}){
  const client=useQueryClient(),heading=useRef<HTMLHeadingElement|null>(null),query=useQuery({queryKey:['incident-candidate-detail',principal.principal_id,candidateId],queryFn:({signal})=>candidateApi.detail(candidateId,signal)}),detail=query.data;
  const [refreshError,setRefreshError]=useState('');
  const [cleanupError,setCleanupError]=useState('');
  const refresh=async()=>{try{setRefreshError('');const fresh=await client.fetchQuery({queryKey:['session'],queryFn:({signal})=>api.bootstrap(signal),staleTime:0});const identity=(actor:Principal)=>JSON.stringify([actor.principal_id,actor.csrf_token,actor.authorization_revision,[...actor.roles].sort(),actor.incident_candidate_workspace_enabled,actor.incident_candidate_draft_recovery_enabled]);if(identity(fresh)!==identity(principal))advanceWorkbenchAuthorizationEpoch();await query.refetch();}catch(error){setRefreshError(errorMessage(error));if(error instanceof ApiError&&(error.status===401||error.status===403))await clearSessionAuthorization(client,principal.principal_id,error.status,'revoked');}};
  const [blocked,setBlocked]=useState(false),purposeRevoked=Boolean(detail&&detail.allowed_scopes.length===0);
  useEffect(()=>{const error=query.error,readRejected=error instanceof ApiError&&[401,403,404].includes(error.status);if(!readRejected&&!purposeRevoked)return;let mounted=true;advanceWorkbenchAuthorizationEpoch();if(readRejected){const key=['incident-candidate-detail',principal.principal_id,candidateId];client.getQueryCache().find({queryKey:key,exact:true})?.setState({data:undefined,dataUpdatedAt:0,error,status:'error',fetchStatus:'idle'});}for(const mutation of client.getMutationCache().findAll({predicate:entry=>entry.options.mutationKey?.[1]===principal.principal_id&&entry.options.mutationKey[2]===candidateId&&['incident-candidate-command','incident-candidate-receipt'].includes(String(entry.options.mutationKey[0]))}))client.getMutationCache().remove(mutation);if(principal.incident_candidate_draft_recovery_enabled)void purgeDrafts({principal:principal.principal_id,kind:'incident-candidate',id:candidateId,purpose:'incident-review',reason:'revoked'}).catch(()=>{if(mounted)setCleanupError('当前决定权限已撤销；恢复副本清理尚未确认，请保持页面关闭。');});return()=>{mounted=false;};},[client,principal.principal_id,principal.incident_candidate_draft_recovery_enabled,candidateId,query.error,purposeRevoked]);
  useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
  useEffect(()=>{if(detail)heading.current?.focus();},[Boolean(detail)]);
  return <article className="detail-page" data-candidate-id={candidateId} aria-labelledby={'candidate-heading-'+candidateId}>
    <div className="detail-navigation"><Link to="/incidents/candidates" aria-label="返回候选队列" aria-disabled={blocked} onClick={event=>{if(blocked)event.preventDefault();}}>返回候选队列</Link><span>候选详情</span><button type="button" data-action="refresh-candidate" onClick={()=>{void refresh();}}>刷新当前事实</button></div>
    {refreshError?<p role="alert">{refreshError}</p>:null}
    {cleanupError?<p role="alert">{cleanupError}</p>:null}
    {query.isPending?<p role="status">正在读取获权候选…</p>:query.isError?<p role="alert">{errorMessage(query.error)}</p>:detail?<div className="detail-body">
      <header className="detail-heading"><p className="context-line">人工公共故障候选 · {candidateLabels[detail.status]}</p><h1 id={'candidate-heading-'+candidateId} ref={heading} tabIndex={-1}>{detail.service_family} · {detail.symptom_family}</h1><p>候选依据版本 {detail.row_version}；候选并非已确认公共故障。</p></header>
      <section className="properties" aria-label="候选来源与数量"><dl><dt>来源观察人数</dt><dd>{detail.distinct_reporters??unavailable}</dd><dt>来源观察科室</dt><dd>{detail.distinct_departments??unavailable}</dd><dt>来源观察位置</dt><dd>{detail.distinct_locations??unavailable}</dd><dt>原观察窗口</dt><dd>{detail.correlation_window_ms===null?unavailable:detail.correlation_window_ms+' 毫秒'}</dd><dt>来源建议范围</dt><dd>{scopeLabels[detail.scope_candidate]??detail.scope_candidate}（尚未确认）</dd><dt>原观察时间</dt><dd>{detail.first_seen_at??unavailable} 至 {detail.last_seen_at??unavailable}</dd><dt>候选到期</dt><dd>{detail.expires_at}（北京时间）</dd></dl>
        <p>获权来源总数：{detail.visible_report_source_count}；已提供选项：{detail.report_sources.length}。{detail.report_sources_truncated?'选项已裁剪。':'当前获权选项已全部提供。'}以上来源观察不代表确认后的关联数或受影响全量。</p>
      </section>
      <section className="detail-main" aria-label="原候选证据"><h2>原候选证据</h2><dl className="candidate-evidence"><dt>规则与目录</dt><dd>{detail.source_decision.catalog_version} / {detail.source_decision.rule_set_version}</dd><dt>原结果依据</dt><dd>{detail.source_result_hash}</dd><dt>原决定原因</dt><dd>{detail.source_decision.reason_code}</dd><dt>人工复核来源</dt><dd>{detail.manual_review?detail.manual_review.status+' · 版本 '+detail.manual_review.row_version:'没有关联的人工复核事项'}</dd></dl>
        <h3>安全来源引用</h3>{detail.source_decision.source_refs.length?<ul>{detail.source_decision.source_refs.map(ref=><li key={ref}>{ref}</li>)}</ul>:<p>来源未提供可展示的引用。</p>}
        <p>原事实引用 {detail.evidence_fact_ids.length} 项，当前展示前 {Math.min(50,detail.evidence_fact_ids.length)} 项。</p><ul>{detail.evidence_fact_ids.slice(0,50).map(fact=><li key={fact}>{fact}</li>)}</ul>
        <h3>当前材料</h3><p>原材料依据保持不可变；变化或过期需要重新核对，不会自动确认或替换原决定。</p>
        <ul>{detail.materials.map((material,index)=><li key={material.source_decision_id}>{index+1}. {material.source_kind==='WEB'?'医小修材料':'Bot 材料'} · {material.status==='CURRENT'?'与原依据一致':material.status==='CHANGED'?'已有新材料':'材料已过期或不可用'} · 原版本 {material.original_revision} / 当前版本 {material.current_revision??'不可用'}<p>原材料依据：{material.original_source_hash}</p>{material.status!=='EXPIRED'&&material.current_source_hash?<p>当前材料依据：{material.current_source_hash}</p>:null}</li>)}</ul>
        <h3>当前获权动作</h3><p>{detail.allowed_actions.map(action=>actionLabels[action]).join('、')||'当前没有可执行动作。'}</p><p>所有决定由工作人员明确作出；确认只产生独立 Incident，不合并或关闭个人工单。</p>
      </section>
      <CandidateDecisionForm key={principal.principal_id+':'+candidateId} principal={principal} detail={detail} onBlockedChange={setBlocked} onRefresh={()=>{void refresh();}}/>
    </div>:null}
  </article>;
}
