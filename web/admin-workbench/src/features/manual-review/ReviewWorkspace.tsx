import {ReviewStartControls} from './ReviewStartControls';
import {PersonalReadMaterial} from '../personal-read/PersonalReadMaterial';
import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorMessage} from '../../api/client';
import type {Principal} from '../../api/client';
import type {CanonicalItem,ReviewReference} from '../../../../../contracts/workbench_review_contracts';
import {clearReviewAuthorization,clearSessionAuthorization} from '../../app/authorization';
import {reviewApi,resolutions} from './client';
import type {ReviewCommand,ReviewView} from './client';
import {emptyReviewInput,hasReviewInput,useReviewDraft} from './use-review-draft';
import type {ReviewInput} from './use-review-draft';

const reasons={HUMAN_CONFIRMED:'人工核对确认',INFORMATION_INSUFFICIENT:'描述不足，需要补充',BUSINESS_CONSULTATION_CONFIRMED:'已核对为业务咨询',ACKNOWLEDGED:'确认收到',OUT_OF_SCOPE_CONFIRMED:'已核对为范围外诉求',SERVICE_REQUEST_CONFIRMED:'已核对为服务请求',INCIDENT_REVIEW_PENDING:'待公共故障审核',STALE_REVIEW_CANCELLED:'明确取消旧复核'};
const fields:Record<string,string>={selected_service_code:'服务',symptom_codes:'现象',domain_intent:'诉求',transaction_stage:'阶段',scope:'影响范围'};
type State='idle'|'submitting'|'checking'|'unknown'|'succeeded'|'conflict'|'denied';
const sameItem=(a:CanonicalItem,b:CanonicalItem)=>a.kind===b.kind&&a.id===b.id;
function Evidence({view,principal}:{view:ReviewView;principal:Principal}){
  const e=view.evidence;
  return <>
    {view.manual_report?<section data-review-manual-report aria-label="本次代录事实"><h4>{view.manual_report.source==='PHONE'?'电话代录':'现场代录'}</h4>
      <p>{view.manual_report.identity_source==='VERIFIED_DIRECTORY_SELECTION'?'本次已核实选择；人员与科室保留报修时资料。':'报修人身份未核实，需人工联系；本次不会自动通知。'}</p>
      <dl><div><dt>报修人</dt><dd>{view.manual_report.reporter.name}</dd></div>{view.manual_report.reporter.verification==='UNVERIFIED'?<div><dt>联系方式</dt><dd>{view.manual_report.reporter.contact}</dd></div>:null}
        <div><dt>报修人科室</dt><dd>{view.manual_report.reporter.verification==='VERIFIED'?view.manual_report.reporter.departments.join('、')||'未提供':view.manual_report.reporter.department??'未填写'}</dd></div><div><dt>位置</dt><dd>{view.manual_report.location.unknown?'位置暂不清楚':view.manual_report.location.text}</dd></div></dl>
      <p>代录人：{view.manual_report.actor_principal_id===principal.principal_id?principal.display_name:'工作人员身份已记录'}</p>
      <details><summary>代录主体记录</summary><p>{view.manual_report.actor_principal_id}</p><p>{view.manual_report.identity_source==='VERIFIED_DIRECTORY_SELECTION'?'报修人资料来自本次核实选择，后续目录变化不会改写此记录。':'报修人资料来自本次手工填报，尚未核实身份。'}</p></details>
    </section>:null}
    <section data-review-original aria-label="原判断"><h4>原判断</h4><p>{e.result} · {e.reason}</p><p>安全提示：{e.risk}</p>
      <dl>{e.known.map(item=><div key={item.field}><dt>{fields[item.field]??item.field}</dt><dd>{item.value}</dd></div>)}</dl>{!e.known.length?<p>暂无结构化已知字段，请核对来源材料。</p>:null}
      <p>缺失字段：{e.missing.join('、')||'未列出'}</p><p>冲突：{e.conflicts.map(item=>item.code+' '+item.sources.join('、')).join('；')||'未列出'}</p>
      <details><summary>来源、规则版本与事实依据</summary><p>原 Decision：{view.decision_id}</p><p>规则版本：{e.versions.join(' / ')}</p><p>来源：{e.sources.join('、')}</p>
        <ul>{e.provenance.map((item,index)=><li key={index}>{item.field}：{item.value} · {item.source} · {item.confidence}</li>)}</ul>
        <p>原建议仅作复核依据。</p><ul>{e.suggestions.map((item,index)=><li key={index}>{item.type} · {item.policy}</li>)}</ul>
      </details>
    </section>
    <section data-review-materials aria-label="当前来源材料"><h4>当前来源材料</h4><p>原材料修订 {view.material_basis.original_revision}；当前修订 {view.material_basis.current_revision}（{view.material_basis.source_kind}）。</p>
      {view.material_basis.stale?<p role="alert">来源材料已变化，旧判断只能明确取消。请选择仍待判断的新复核项。</p>:null}
      {view.materials_truncated?<p>当前只展示保留期内的有界材料，部分内容未展示。</p>:null}
      <ol>{view.materials.map(item=><li key={item.source_ref}><small>{item.source_ref} · 修订 {item.revision} · {item.in_original_basis?'原判断范围':'后来补充'}</small><PersonalReadMaterial principal={principal} item={{kind:'review',id:view.id}} sourceRef={item.source_ref} revision={item.revision} text={item.text}/></li>)}</ol>
      {!view.materials.length?<p>暂无保留期内的可展示材料。</p>:null}
    </section>
  </>;
}
export function ReviewWorkspace({principal,item,requested,refs,onBlockedChange}:{principal:Principal;item:CanonicalItem;requested:CanonicalItem;refs:ReviewReference[];onBlockedChange:(blocked:boolean)=>void}){
  const [selected,setSelected]=useState(()=>requested.kind==='review'?requested.id:refs.length===1?refs[0]?.id??'':'');
  const [blocked,setBlocked]=useState(false);
  useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
  if(!refs.length&&!selected)return null;
  return <section className="manual-review" data-review-workspace aria-label="材料与人工复核"><h3>材料与人工复核</h3>
    <label>复核项 <select aria-label="选择复核项" value={selected} disabled={blocked} onChange={event=>setSelected(event.target.value)}><option value="">请选择复核项</option>
      {refs.map(ref=><option key={ref.id} value={ref.id}>{ref.id} · {ref.status} · 版本 {ref.row_version}</option>)}
      {selected&&!refs.some(ref=>ref.id===selected)?<option value={selected}>已选择的复核项 {selected}</option>:null}
    </select></label>
    {selected?<ReviewForm key={principal.principal_id+':'+selected} principal={principal} item={item} reviewId={selected} onBlockedChange={setBlocked}/>:<p>每个材料版本独立复核；选择后查看其原判断与当前材料。</p>}
  </section>;
}
function ReviewForm({principal,item,reviewId,onBlockedChange}:{principal:Principal;item:CanonicalItem;reviewId:string;onBlockedChange:(blocked:boolean)=>void}){
  const client=useQueryClient(),request=useRef<AbortController|null>(null),mounted=useRef(true),generation=useRef(0);
  const [value,setValue]=useState<ReviewInput>(()=>emptyReviewInput(reviewId)),[pending,setPending]=useState<ReviewCommand|null>(null),[state,setState]=useState<State>('idle'),[message,setMessage]=useState(''),[startBlocked,setStartBlocked]=useState(false),[startNavigationBlocked,setStartNavigationBlocked]=useState(false);
  const latest=useRef(value);latest.current=value;
  const key=['manual-review',principal.principal_id,item.kind,item.id,reviewId] as const;
  const context=useQuery({queryKey:key,queryFn:({signal})=>reviewApi.detail(reviewId,signal)});
  const draft=useReviewDraft({principal,item,reviewId,value,pending,
    onRestore:restored=>{setValue(restored.value);setPending(restored.pending);if(restored.pending){setState('unknown');setMessage('结果未知：已恢复原命令，结论、原因、版本和材料摘要保持不变。');}},
    onOperation:()=>{setState('unknown');setMessage('结果未知：敏感恢复内容不可用，只能只读核对原操作。');},
    onSensitiveClear:()=>{generation.current++;request.current?.abort();request.current=null;setValue(emptyReviewInput(reviewId));setPending(null);setState('idle');setMessage('');}});
  const busy=state==='submitting'||state==='checking'||startBlocked,unresolved=state==='unknown'||Boolean(pending)||Boolean(draft.operationId);
  const navigationBlocked=startNavigationBlocked||(state==='submitting'||state==='checking'||unresolved||draft.enabled&&hasReviewInput(value))&&!draft.safeToLeave;
  useEffect(()=>{onBlockedChange(navigationBlocked);return()=>onBlockedChange(false);},[navigationBlocked,onBlockedChange]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;request.current?.abort();};},[]);
  useEffect(()=>{if(!navigationBlocked)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[navigationBlocked]);
  useEffect(()=>{
    if(!context.data||value.capture||state!=='idle'||pending||draft.operationId)return;
    const current=context.data;setValue(value=>({...value,capture:{row_version:current.row_version,material_basis:current.material_basis.current_hash,canonical_item:current.canonical_item}}));
  },[context.data,value.capture,state,pending,draft.operationId]);
  const refresh=()=>{void client.invalidateQueries({queryKey:key});void client.invalidateQueries({queryKey:['detail',principal.principal_id]});void client.invalidateQueries({queryKey:['board',principal.principal_id]});void client.invalidateQueries({queryKey:['ticket-command-context',principal.principal_id]});void client.invalidateQueries({queryKey:['ticket-related-conversations',principal.principal_id]});};
  const deny=(error:ApiError)=>{generation.current++;request.current?.abort();setValue(emptyReviewInput(reviewId));setPending(null);
    if(error.status===401)void clearSessionAuthorization(client,principal.principal_id,401,'revoked');else void clearReviewAuthorization(client,principal.principal_id,reviewId,item,error);};
  const preserveNewer=(command:ReviewCommand)=>latest.current.choice!==command.resolution_code||latest.current.reason!==command.resolution_reason_code
    ||latest.current.capture?.row_version!==command.expected_row_version||latest.current.capture?.material_basis!==command.expected_material_basis;
  const committed=async(commandId:string,preserve:boolean,label:string)=>{
    const cleaned=await draft.success(commandId,preserve);if(!mounted.current)return;
    setPending(null);if(!preserve)setValue(emptyReviewInput(reviewId));setState('succeeded');setMessage(label+(preserve?' 较新的未提交选择已保留。':'')+(cleaned?'':' 本地恢复副本清理尚未确认，禁止新提交；请只读核对并重试清理。'));
    const controller=new AbortController();request.current=controller;
    try{const current=await reviewApi.detail(reviewId,controller.signal);if(!mounted.current)return;client.setQueryData(key,current);await api.detail(current.canonical_item.kind,current.canonical_item.id,null,controller.signal);}
    catch(error){if(error instanceof ApiError&&[401,403,404].includes(error.status))deny(error);else if(mounted.current)setMessage(previous=>previous+' 当前事项暂未重新读取，请重试读取。');}
    finally{request.current=null;refresh();}
  };
  const mutation=useMutation({mutationKey:['manual-review-command',principal.principal_id,item.kind,item.id,reviewId],
    mutationFn:({command,signal}:{command:ReviewCommand;signal:AbortSignal;generation:number})=>reviewApi.resolve(reviewId,command,principal.csrf_token,signal),
    onSuccess:async(result,variables)=>{if(!mounted.current||variables.generation!==generation.current)return;await committed(variables.command.client_command_id,preserveNewer(variables.command),result.replayed?'已记录人工结论：已核对原操作结果。':'已记录人工结论。');},
    onError:(error,variables)=>{
      if(!mounted.current||variables.generation!==generation.current)return;
      if(error instanceof ApiError){if([401,403,404].includes(error.status)){deny(error);return;}setPending(null);void draft.knownFailure(variables.command.client_command_id).catch(()=>{});setState(error.status===409?'conflict':'denied');setMessage(error.status===409?'结论未记录：资料已变化，选择和原因已保留。重新读取后请明确采用当前材料。':('结论被拒绝：'+errorMessage(error)));refresh();}
      else{setPending(variables.command);setState('unknown');setMessage('结果未知：可能已经记录。请核对原命令，结论、原因、版本和材料摘要保持不变。');}
    },onSettled:()=>{request.current=null;}});
  const send=async(command:ReviewCommand,checking=false)=>{
    if(request.current)return;const controller=new AbortController(),token=generation.current;request.current=controller;setPending(command);setState(checking?'checking':'submitting');setMessage(checking?'正在核对原命令…':'正在记录人工结论…');
    try{await draft.prepare(command);}catch{request.current=null;setPending(checking?command:null);setState(checking?'unknown':'denied');setMessage(checking?'原操作仍未知；恢复存储不可用，尚未再次发送。':'恢复副本未保存，本次尚未发送；请保留当前选择。');return;}
    if(controller.signal.aborted||token!==generation.current)return;mutation.mutate({command,signal:controller.signal,generation:token});
  };
  const receipt=useMutation({mutationKey:['manual-review-command',principal.principal_id,item.kind,item.id,reviewId],
    mutationFn:({commandId,signal}:{commandId:string;signal:AbortSignal;generation:number})=>reviewApi.receipt(reviewId,commandId,signal),
    onSuccess:async(result,variables)=>{if(!mounted.current||variables.generation!==generation.current)return;
      if(result.state==='UNKNOWN'){setState('unknown');setMessage('结果仍未知：没有终态收据不代表未提交，请继续只读核对。');refresh();return;}
      if(result.state==='COMMITTED'){await committed(variables.commandId,pending?preserveNewer(pending):hasReviewInput(latest.current),'已记录人工结论：已核对原操作结果。');return;}
      if(pending)await draft.knownFailure(variables.commandId);else await draft.success(variables.commandId,hasReviewInput(latest.current));
      setPending(null);setState('conflict');setMessage('已核对原操作失败；选择已保留，请读取当前事实后明确新的操作。');refresh();
    },onError:error=>{if(error instanceof ApiError&&[401,403,404].includes(error.status)){deny(error);return;}setState('unknown');setMessage('只读核对失败，原操作仍未知，尚未发送新的操作。');},onSettled:()=>{request.current=null;}});
  const check=()=>{if(request.current||!draft.operationId)return;const controller=new AbortController();request.current=controller;setState('checking');receipt.mutate({commandId:draft.operationId,signal:controller.signal,generation:generation.current});};
  if(context.isPending)return <p role="status">正在独立核对复核权限与材料…</p>;
  if(context.isError)return <p role="alert">{errorMessage(context.error)} <button type="button" onClick={()=>{void context.refetch();}}>重新读取复核</button></p>;
  const view=context.data,capture=value.capture,changed=Boolean(capture&&(capture.row_version!==view.row_version||capture.material_basis!==view.material_basis.current_hash||!sameItem(capture.canonical_item,view.canonical_item)));
  const allowed=view.status==='PENDING'&&Boolean(value.choice)&&view.allowed_resolutions.includes(value.choice as keyof typeof resolutions)&&(!view.material_basis.stale||value.choice==='CANCEL_REVIEW');
  const canSubmit=allowed&&!changed&&!busy&&!unresolved&&state!=='succeeded'&&draft.canSubmit&&Boolean(value.reason)&&Boolean(capture)&&sameItem(item,view.canonical_item);
  return <div data-review-id={reviewId}><p>待复核原因：{view.review_reason}；复核版本 {view.row_version} · {view.status}</p><Evidence view={view} principal={principal}/>
    <p>当前支持的结论：{view.allowed_resolutions.map(code=>resolutions[code]).join('、')||'此复核没有新的可执行结论'}。</p>
    <p>当前不支持：关联其他 Journey。</p>
    <form onSubmit={event=>{event.preventDefault();if(!canSubmit||!capture||!value.choice)return;void send(Object.freeze({client_command_id:crypto.randomUUID(),expected_row_version:capture.row_version,
      expected_material_basis:capture.material_basis,resolution_code:value.choice,resolution_reason_code:value.reason}));}}>
      <label>复核结论 <select aria-label="复核结论" value={value.choice} disabled={busy||unresolved||view.status!=='PENDING'} onChange={event=>setValue(value=>({...value,choice:event.target.value as ReviewInput['choice']}))}><option value="">请选择结论</option>
        {Object.entries(resolutions).map(([code,label])=><option key={code} value={code} disabled={!view.allowed_resolutions.includes(code as keyof typeof resolutions)}>{label}{view.allowed_resolutions.includes(code as keyof typeof resolutions)?'':'（当前不可用）'}</option>)}
        <option disabled>关联其他 Journey（不支持）</option></select></label>
      <label>复核原因 <select aria-label="复核原因" value={value.reason} disabled={busy||unresolved||view.status!=='PENDING'} onChange={event=>setValue(value=>({...value,reason:event.target.value}))}><option value="">请选择原因</option>{Object.entries(reasons).map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label>
      <p>捕获版本：<span data-captured-review-version>{capture?.row_version??'尚未捕获'}</span><span data-captured-material-basis={capture?.material_basis??''}/></p>
      {changed?<p role="alert">当前材料或版本已变化；原选择和捕获内容保持不变。请明确采用当前材料后再操作。</p>:null}
      {draft.enabled?<p data-review-draft-status role="status">{draft.message}</p>:null}
      <ReviewStartControls principal={principal} reviewId={reviewId} value={value} available={allowed&&!changed} request={request} onBlockedChange={setStartNavigationBlocked} onBusyChange={setStartBlocked}
        onRestoreReview={restored=>{setValue(restored);setState('idle');}} readCurrentReview={async signal=>{const current=await reviewApi.detail(reviewId,signal);client.setQueryData(key,current);return {...latest.current,capture:{row_version:current.row_version,material_basis:current.material_basis.current_hash,canonical_item:current.canonical_item}};}}
        onRefresh={refresh} onStarted={()=>{setPending(null);setValue(emptyReviewInput(reviewId));setState('succeeded');setMessage('已确认明确故障并开始处理。');void draft.discard();refresh();}}/>
      <div className="review-controls"><button type="submit" data-action="submit-review" disabled={!canSubmit}>记录复核结论</button>
        <button type="button" data-action="refresh-review" disabled={busy} onClick={()=>{void context.refetch();}}>重新读取复核</button>
        <button type="button" data-action="capture-review" disabled={busy||unresolved||view.status!=='PENDING'||state==='succeeded'} onClick={()=>{setValue(value=>({...value,capture:{row_version:view.row_version,material_basis:view.material_basis.current_hash,canonical_item:view.canonical_item}}));setState('idle');setMessage('已明确采用当前材料与版本；原选择和原因保留。');}}>采用当前材料与版本</button>
        {state==='unknown'&&pending?<button type="button" data-action="reconcile-review" onClick={()=>{void send(pending,true);}}>核对原命令结果</button>:null}
        {draft.operationId?<button type="button" data-action="check-review-receipt" disabled={busy} onClick={check}>只读核对原操作</button>:null}
        {draft.enabled&&hasReviewInput(value)?<button type="button" data-action="discard-review-draft" disabled={busy} onClick={()=>{void draft.discard();}}>丢弃草稿内容</button>:null}
      </div>
    </form>
    {message?<p data-review-result role={state==='unknown'||state==='conflict'||state==='denied'?'alert':'status'}>{message}</p>:null}
    {!sameItem(item,view.canonical_item)||view.status!=='PENDING'?<p><Link to={'/items/'+view.canonical_item.kind+'/'+view.canonical_item.id+'?detail=page'} onClick={event=>{if(navigationBlocked)event.preventDefault();}}>查看当前事项</Link></p>:null}
  </div>;
}
