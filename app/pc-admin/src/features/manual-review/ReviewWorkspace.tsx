import {WorkbenchLink as Link} from '../../app/WorkbenchLink';
import {WorkbenchButton as HButton} from '../../app/WorkbenchButton';
import {Form as HForm,ListBox} from "@heroui/react";
import {WorkbenchDisclosure} from "../../app/WorkbenchDisclosure";
import {WorkbenchSelect} from "../../app/WorkbenchSelect";
import {ToastFeedback,DraftStatus,useFeedbackState} from '../../app/ToastFeedback';
import {ReviewStartControls} from './ReviewStartControls';
import {PersonalReadMaterial} from '../personal-read/PersonalReadMaterial';
import {useEffect,useRef,useState} from 'react';

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
const usualReasons:Record<keyof typeof resolutions,keyof typeof reasons>={CONFIRM_TICKET_ELIGIBLE:'HUMAN_CONFIRMED',CLASSIFY_SERVICE_REQUEST:'SERVICE_REQUEST_CONFIRMED',REQUEST_DESCRIPTION:'INFORMATION_INSUFFICIENT',CLASSIFY_BUSINESS_CONSULTATION:'BUSINESS_CONSULTATION_CONFIRMED',ACKNOWLEDGE:'ACKNOWLEDGED',MARK_OUT_OF_SCOPE:'OUT_OF_SCOPE_CONFIRMED',KEEP_INCIDENT_REVIEW_CANDIDATE:'INCIDENT_REVIEW_PENDING',CANCEL_REVIEW:'STALE_REVIEW_CANCELLED'};
const reviewStatuses={PENDING:'待复核',RESOLVED:'已复核',CANCELLED:'已取消'};
const fields:Record<string,string>={selected_service_code:'服务',symptom_codes:'现象',domain_intent:'诉求',transaction_stage:'阶段',scope:'影响范围'};
type State='idle'|'submitting'|'checking'|'unknown'|'succeeded'|'conflict'|'denied';
const sameItem=(a:CanonicalItem,b:CanonicalItem)=>a.kind===b.kind&&a.id===b.id;
function Evidence({view,principal}:{view:ReviewView;principal:Principal}){
  const e=view.evidence;
  return <>
    {view.manual_report?<section data-review-manual-report aria-label="本次代录事实"><h4>{view.manual_report.source==='PHONE'?'电话代录':'现场代录'}</h4>
      <p>{view.manual_report.identity_source==='VERIFIED_DIRECTORY_SELECTION'?'报修人资料已核实。':'报修人资料由人工填写。请按联系方式核实。系统不会自动通知此联系人。'}</p>
      <dl><div><dt>报修人</dt><dd>{view.manual_report.reporter.name}</dd></div>{view.manual_report.reporter.verification==='UNVERIFIED'?<div><dt>联系方式</dt><dd>{view.manual_report.reporter.contact}</dd></div>:null}
        <div><dt>科室</dt><dd>{view.manual_report.reporter.verification==='VERIFIED'?view.manual_report.reporter.departments.join('、')||'未提供':view.manual_report.reporter.department??'未填写'}</dd></div><div><dt>位置</dt><dd>{view.manual_report.location.unknown?'位置暂不清楚':view.manual_report.location.text}</dd></div></dl>
      <p>代录人：{view.manual_report.actor_principal_id===principal.principal_id?principal.display_name:'其他工作人员'}</p>
    </section>:null}
    {!['UNKNOWN','NONE','LOW'].includes(e.risk)?<p role="alert">报修内容有风险提示。请先核实，再处理。</p>:null}
    <section data-review-original aria-label="原判断"><WorkbenchDisclosure title={<>查看系统核对提示</>}><p>{e.missing.length?'信息尚不完整。请核对原始报修内容。':'请人工核对原始报修内容。系统建议不能代替您的判断。'}</p>{e.missing.some(field=>fields[field])?<p>需要核对：{e.missing.flatMap(field=>fields[field]?[fields[field]]:[]).join('、')}。</p>:null}{e.conflicts.length?<p>部分信息不一致。请联系报修人核实。</p>:null}</WorkbenchDisclosure></section>
    <section data-review-materials aria-label="当前来源材料"><h4>本次报修内容</h4>
      {view.material_basis.stale?<p role="alert">报修内容已变化。请取消旧复核，再选择新的待复核记录。</p>:null}
      {view.materials_truncated?<p>以下为本次可查看的材料。部分早期内容未显示。</p>:null}
      <ol>{view.materials.map(item=><li key={item.source_ref}><small>{item.in_original_basis?'原始报修':'后来补充'}</small><PersonalReadMaterial principal={principal} item={{kind:'review',id:view.id}} sourceRef={item.source_ref} revision={item.revision} text={item.text}/></li>)}</ol>
      {!view.materials.length?<p>暂无可查看的报修内容。</p>:null}
    </section>
  </>;
}
export function ReviewWorkspace({principal,item,requested,refs,onBlockedChange}:{principal:Principal;item:CanonicalItem;requested:CanonicalItem;refs:ReviewReference[];onBlockedChange:(blocked:boolean)=>void}){
  const [selected,setSelected]=useState(()=>requested.kind==='review'?requested.id:refs.length===1?refs[0]?.id??'':'');
  const [blocked,setBlocked]=useState(false);
  useEffect(()=>{onBlockedChange(blocked);return()=>onBlockedChange(false);},[blocked,onBlockedChange]);
  if(!refs.length&&!selected)return null;
  return <section data-activity-field="manual-review" className="manual-review" data-review-workspace aria-label="材料与人工复核"><h3>材料与人工复核</h3>
    <WorkbenchSelect label={<>复核项 </>} aria-label="选择复核项" value={selected} isDisabled={blocked} onChange={event=>setSelected(event)}><ListBox.Item id="" textValue={"请选择复核项"}>请选择复核项<ListBox.ItemIndicator/></ListBox.Item>{refs.map((ref,index)=><ListBox.Item key={ref.id} id={ref.id} textValue={"第"+String(index+1)+"次复核 ·"+String(reviewStatuses[ref.status])}>第 {index+1}次复核 · {reviewStatuses[ref.status]}<ListBox.ItemIndicator/></ListBox.Item>)}{selected&&!refs.some(ref=>ref.id===selected)?<ListBox.Item id={selected} textValue={"已选择的复核记录"}>已选择的复核记录<ListBox.ItemIndicator/></ListBox.Item>:null}</WorkbenchSelect>
    {selected?<ReviewForm key={principal.principal_id+':'+selected} principal={principal} item={item} reviewId={selected} onBlockedChange={setBlocked}/>:<p>请选择一条复核记录，再核对报修内容。</p>}
  </section>;
}
function ReviewForm({principal,item,reviewId,onBlockedChange}:{principal:Principal;item:CanonicalItem;reviewId:string;onBlockedChange:(blocked:boolean)=>void}){
  const client=useQueryClient(),request=useRef<AbortController|null>(null),mounted=useRef(true),generation=useRef(0);
  const [value,setValue]=useState<ReviewInput>(()=>emptyReviewInput(reviewId)),[pending,setPending]=useState<ReviewCommand|null>(null),[state,setState]=useState<State>('idle'),[message,setMessage,messageRevision]=useFeedbackState(''),[startBlocked,setStartBlocked]=useState(false),[startNavigationBlocked,setStartNavigationBlocked]=useState(false);
  const latest=useRef(value);latest.current=value;
  const key=['manual-review',principal.principal_id,item.kind,item.id,reviewId] as const;
  const context=useQuery({queryKey:key,queryFn:({signal})=>reviewApi.detail(reviewId,signal)});
  const draft=useReviewDraft({principal,item,reviewId,value,pending,
    onRestore:restored=>{setValue(restored.value);setPending(restored.pending);if(restored.pending){setState('unknown');setMessage('结果未知：已恢复原命令，结论、原因、版本和材料摘要保持不变。');}},
    onOperation:()=>{setState('unknown');setMessage('结果未知：敏感恢复内容不可用，只能核对上次操作。');},
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
      else{setPending(variables.command);setState('unknown');setMessage('结果未知：可能已经记录。请核对上次操作，结论、原因、版本和材料摘要保持不变。');}
    },onSettled:()=>{request.current=null;}});
  const send=async(command:ReviewCommand,checking=false)=>{
    if(request.current)return;const controller=new AbortController(),token=generation.current;request.current=controller;setPending(command);setState(checking?'checking':'submitting');setMessage(checking?'正在核对上次操作…':'正在记录人工结论…');
    try{await draft.prepare(command);}catch{request.current=null;setPending(checking?command:null);setState(checking?'unknown':'denied');setMessage(checking?'原操作仍未知；恢复存储不可用，尚未再次发送。':'恢复副本未保存，本次尚未发送；请保留当前选择。');return;}
    if(controller.signal.aborted||token!==generation.current)return;mutation.mutate({command,signal:controller.signal,generation:token});
  };
  const receipt=useMutation({mutationKey:['manual-review-command',principal.principal_id,item.kind,item.id,reviewId],
    mutationFn:({commandId,signal}:{commandId:string;signal:AbortSignal;generation:number})=>reviewApi.receipt(reviewId,commandId,signal),
    onSuccess:async(result,variables)=>{if(!mounted.current||variables.generation!==generation.current)return;
      if(result.state==='UNKNOWN'){setState('unknown');setMessage('结果仍未知：没有终态收据不代表未提交，请继续只读核对。');refresh();return;}
      if(result.state==='COMMITTED'){await committed(variables.commandId,pending?preserveNewer(pending):hasReviewInput(latest.current),'已记录人工结论：已核对原操作结果。');return;}
      if(pending)await draft.knownFailure(variables.commandId);else await draft.success(variables.commandId,hasReviewInput(latest.current));
      setPending(null);setState('conflict');setMessage('已核对原操作失败；选择已保留，请读取工单信息后明确新的操作。');refresh();
    },onError:error=>{if(error instanceof ApiError&&[401,403,404].includes(error.status)){deny(error);return;}setState('unknown');setMessage('只读核对失败，原操作仍未知，尚未发送新的操作。');},onSettled:()=>{request.current=null;}});
  const check=()=>{if(request.current||!draft.operationId)return;const controller=new AbortController();request.current=controller;setState('checking');receipt.mutate({commandId:draft.operationId,signal:controller.signal,generation:generation.current});};
  if(context.isPending)return <p role="status">正在独立核对复核权限与材料…</p>;
  if(context.isError)return <p role="alert">{errorMessage(context.error)} <HButton type="button" onClick={()=>{void context.refetch();}} variant="secondary">刷新</HButton></p>;
  const view=context.data,capture=value.capture,changed=Boolean(capture&&(capture.row_version!==view.row_version||capture.material_basis!==view.material_basis.current_hash||!sameItem(capture.canonical_item,view.canonical_item)));
  const allowed=view.status==='PENDING'&&Boolean(value.choice)&&view.allowed_resolutions.includes(value.choice as keyof typeof resolutions)&&(!view.material_basis.stale||value.choice==='CANCEL_REVIEW');
  const canSubmit=allowed&&!changed&&!busy&&!unresolved&&state!=='succeeded'&&draft.canSubmit&&Boolean(value.reason)&&Boolean(capture)&&sameItem(item,view.canonical_item);
  // The separate review-start purpose must probe old opaque operations even on a terminal review.
  const folded=view.status!=='PENDING'&&!unresolved&&!hasReviewInput(value)&&!principal.manual_review_draft_recovery_enabled&&!startBlocked&&!startNavigationBlocked;
  return <div data-review-id={reviewId}>{folded?<WorkbenchDisclosure title={<>{reviewStatuses[view.status]}，查看原始材料与判定</>} className="workflow-history"><Evidence view={view} principal={principal}/></WorkbenchDisclosure>:<><p className="review-instruction">{view.material_basis.stale?'原报修内容已变化，请核对新材料。':'请核对报修内容，再确认需要怎样处理。'}</p><Evidence view={view} principal={principal}/></>}
    <HForm hidden={folded} onSubmit={event=>{event.preventDefault();if(!canSubmit||!capture||!value.choice)return;void send(Object.freeze({client_command_id:crypto.randomUUID(),expected_row_version:capture.row_version,
      expected_material_basis:capture.material_basis,resolution_code:value.choice,resolution_reason_code:value.reason}));}}><WorkbenchSelect label={<>复核结论 </>} aria-label="复核结论" value={value.choice} isDisabled={busy||unresolved||view.status!=='PENDING'} onChange={event=>{const choice=event as ReviewInput['choice'];setValue(value=>({...value,choice,reason:choice?usualReasons[choice]:''}));}}><ListBox.Item id="" textValue={"请选择结论"}>请选择结论<ListBox.ItemIndicator/></ListBox.Item>{Object.entries(resolutions).filter(([code])=>code===value.choice||view.allowed_resolutions.includes(code as keyof typeof resolutions)).map(([code,label])=><ListBox.Item key={code} id={code} isDisabled={!view.allowed_resolutions.includes(code as keyof typeof resolutions)} textValue={String(label)+String(view.allowed_resolutions.includes(code as keyof typeof resolutions)?'':'（当前不可用）')}>{label}{view.allowed_resolutions.includes(code as keyof typeof resolutions)?'':'（当前不可用）'}<ListBox.ItemIndicator/></ListBox.Item>)}</WorkbenchSelect>{value.reason?<p>复核依据：{reasons[value.reason as keyof typeof reasons]??value.reason}</p>:null}<WorkbenchDisclosure title={<>修改复核原因</>} className="workflow-history" forceOpen={changed||undefined}><WorkbenchSelect label={<>复核原因 </>} aria-label="复核原因" value={value.reason} isDisabled={busy||unresolved||view.status!=='PENDING'} onChange={event=>setValue(value=>({...value,reason:event}))}><ListBox.Item id="" textValue={"请选择原因"}>请选择原因<ListBox.ItemIndicator/></ListBox.Item>{Object.entries(reasons).map(([code,label])=><ListBox.Item key={code} id={code} textValue={String(label)}>{label}<ListBox.ItemIndicator/></ListBox.Item>)}</WorkbenchSelect><HButton type="button" data-action="capture-review" isDisabled={busy||unresolved||view.status!=='PENDING'||state==='succeeded'} onClick={()=>{setValue(value=>({...value,capture:{row_version:view.row_version,material_basis:view.material_basis.current_hash,canonical_item:view.canonical_item}}));setState('idle');setMessage('已明确使用最新报修内容；原选择和原因保留。');}} variant="secondary">使用最新报修内容</HButton><p hidden><span data-captured-review-version>{capture?.row_version??'尚未捕获'}</span><span data-captured-material-basis={capture?.material_basis??''}/></p></WorkbenchDisclosure>{changed?<p role="alert">报修内容已变化。您的选择已保留。请核对新内容，再点击“使用最新报修内容”。</p>:null}{draft.enabled?<DraftStatus data-review-draft-status role="status">{draft.message}</DraftStatus>:null}<ReviewStartControls principal={principal} reviewId={reviewId} value={value} available={allowed&&!changed} request={request} onBlockedChange={setStartNavigationBlocked} onBusyChange={setStartBlocked}
        onRestoreReview={restored=>{setValue(restored);setState('idle');}} readCurrentReview={async signal=>{const current=await reviewApi.detail(reviewId,signal);client.setQueryData(key,current);return {...latest.current,capture:{row_version:current.row_version,material_basis:current.material_basis.current_hash,canonical_item:current.canonical_item}};}}
        onRefresh={refresh} onStarted={()=>{setPending(null);setValue(emptyReviewInput(reviewId));setState('succeeded');setMessage('已确认故障并开始处理。');void draft.discard();refresh();}}/><div className="review-controls"><HButton type="submit" data-action="submit-review" isDisabled={!canSubmit} variant="secondary">记录复核结论</HButton>
        <HButton type="button" data-action="refresh-review" isDisabled={busy} onClick={()=>{void context.refetch();}} variant="secondary">刷新</HButton>
        {state==='unknown'&&pending?<HButton type="button" data-action="reconcile-review" onClick={()=>{void send(pending,true);}} variant="secondary">核对上次操作</HButton>:null}
        {draft.operationId?<HButton type="button" data-action="check-review-receipt" isDisabled={busy} onClick={check} variant="secondary">核对上次操作</HButton>:null}
        {draft.enabled&&hasReviewInput(value)?<HButton type="button" data-action="discard-review-draft" isDisabled={busy} onClick={()=>{void draft.discard();}} variant="secondary">丢弃草稿内容</HButton>:null}
      </div></HForm>
    {message?<ToastFeedback revision={messageRevision} source="manual-review" state={state} data-review-result role={state==='unknown'||state==='conflict'||state==='denied'?'alert':'status'}>{message}</ToastFeedback>:null}
    {!sameItem(item,view.canonical_item)||view.status!=='PENDING'?<p><Link to={'/items/'+view.canonical_item.kind+'/'+view.canonical_item.id+'?detail=page'} onClick={event=>{if(navigationBlocked)event.preventDefault();}}>查看当前事项</Link></p>:null}
  </div>;
}
