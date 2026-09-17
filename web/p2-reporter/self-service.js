const ROOT='/wecom/yixiaoxiu/';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RECOVERY_SCOPE=/^[a-f0-9]{64}$/u;
const REQUEST_REF=/^[A-Za-z0-9_-]{32}$/u;
const INTAKE_NO=/^INT-[0-9]{8}-[0-9]{4,}$/u;
const LOCAL_TIME=/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/u;
const refs={home:'/wecom/yixiaoxiu/',new:'/wecom/yixiaoxiu/reports/new',list:'/wecom/yixiaoxiu/reports'};
const $=id=>document.getElementById(id);
const state={generation:0,controller:null,busy:false,stopped:false,recoveryScope:null,pendingCommandId:null,pendingScope:null,pendingLegacy:false,pendingAttempts:0,pendingTimer:null,listCursor:null,reportItems:[],detail:null,detailEtag:null,timelineItems:[],timelineCursor:null,timelineExpanded:false,poll:null,hidden:false};
const pendingKey='yxx.self_service.pending_command';
const pendingDelays=[1000,2000,4000,5000];
const latestTimelineBoundary=String(Number.MAX_SAFE_INTEGER);
function node(tag,textValue,className){const value=document.createElement(tag);if(textValue!==undefined)value.textContent=String(textValue);if(className)value.className=className;return value;}
function clear(element){while(element.firstChild)element.removeChild(element.firstChild);}
function validGeneration(g){return g===state.generation&&!state.stopped;}
function messageFor(status){return ({400:'输入格式有误，请检查后重试。',401:'认证已失效，请重新认证。',403:'当前账号没有此项权限。',404:'报修不存在、已撤销或已过期。',409:'版本或状态已变化，请刷新后重试。',413:'内容超过允许大小。',415:'请求格式不受支持。',429:'操作太频繁，请稍后再试。',503:'服务暂时不可用，请稍后刷新。'})[status]??'网络暂不可用，请稍后重试。';}
function setStatus(textValue,kind=''){const value=$('app-status');value.textContent=textValue;value.className=`status ${kind}`;}
function setView(view,title){for(const id of ['home-view','new-view','reports-view','detail-view'])$(id).hidden=id!==view;$('page-title').textContent=title;}
function cancelPendingRecovery(resetAttempts=false){clearTimeout(state.pendingTimer);state.pendingTimer=null;if(resetAttempts)state.pendingAttempts=0;$('retry-pending').hidden=true;}
function syncPendingButtons(){const pending=state.pendingCommandId!==null;$('submit-report').disabled=pending;$('submit-supplement').disabled=pending;}
function remember(id){
 if(!UUID.test(id)||!RECOVERY_SCOPE.test(state.recoveryScope??''))return false;
 const record=JSON.stringify({v:2,id,scope:state.recoveryScope});
 try{sessionStorage.setItem(pendingKey,record);if(sessionStorage.getItem(pendingKey)!==record)throw new Error('storage verification');}
 catch{try{sessionStorage.removeItem(pendingKey);}catch{/* storage remains unavailable */}state.pendingCommandId=null;state.pendingScope=null;state.pendingLegacy=false;syncPendingButtons();return false;}
 cancelPendingRecovery(true);state.pendingCommandId=id;state.pendingScope=state.recoveryScope;state.pendingLegacy=false;syncPendingButtons();return true;
}
function forget(){cancelPendingRecovery(true);state.pendingCommandId=null;state.pendingScope=null;state.pendingLegacy=false;try{sessionStorage.removeItem(pendingKey);}catch{/* storage is optional */}syncPendingButtons();}
function clearClientDom(message='认证已失效，请重新认证。'){
 cancelPendingRecovery(true);state.generation+=1;state.stopped=true;state.busy=false;state.controller?.abort();clearTimeout(state.poll);state.controller=null;window.__yxx_csrf=undefined;state.recoveryScope=null;state.detail=null;state.detailEtag=null;state.timelineItems=[];state.timelineCursor=null;state.timelineExpanded=false;state.listCursor=null;state.reportItems=[];
 readPending();
 for(const id of ['description','location-text','service-code','department','extension','supplement-text']){const value=$(id);if(value)value.value='';}
 $('location-unknown').checked=false;$('impact-scope').value='UNKNOWN';clear($('report-list'));clear($('detail-facts'));clear($('detail-supplements'));clear($('detail-timeline'));$('detail-description').textContent='';$('detail-source').textContent='';$('detail-status').textContent='';$('timeline-window-note').textContent='';$('load-older-timeline').hidden=true;$('supplement-form').hidden=true;setView('home-view','自助报修');setStatus(message,'error');
}
function captureDraft(){return Object.freeze({path:location.pathname,description:$('description').value,locationText:$('location-text').value,locationUnknown:$('location-unknown').checked,impactScope:$('impact-scope').value,serviceCode:$('service-code').value,department:$('department').value,extension:$('extension').value,supplement:$('supplement-text').value});}
function restoreDraft(draft){if(!draft||draft.path!==location.pathname)return;$('description').value=draft.description;$('location-text').value=draft.locationText;$('location-unknown').checked=draft.locationUnknown;$('impact-scope').value=draft.impactScope;$('service-code').value=draft.serviceCode;$('department').value=draft.department;$('extension').value=draft.extension;$('supplement-text').value=draft.supplement;}
function prepareBootstrap(){
 clearTimeout(state.poll);state.detail=null;state.detailEtag=null;state.timelineItems=[];state.timelineCursor=null;state.timelineExpanded=false;state.listCursor=null;state.reportItems=[];state.recoveryScope=null;window.__yxx_csrf=undefined;
 for(const id of ['description','location-text','service-code','department','extension','supplement-text']){const value=$(id);if(value)value.value='';}
 $('location-unknown').checked=false;$('impact-scope').value='UNKNOWN';clear($('report-list'));clear($('detail-facts'));clear($('detail-supplements'));clear($('detail-timeline'));$('detail-description').textContent='';$('detail-source').textContent='';$('detail-status').textContent='';$('timeline-window-note').textContent='';$('load-more-reports').hidden=true;$('load-older-timeline').hidden=true;$('supplement-form').hidden=true;
 for(const id of ['home-view','new-view','reports-view','detail-view'])$(id).hidden=true;
 setStatus('正在验证成员会话…');
}
function readPending(){try{const value=JSON.parse(sessionStorage.getItem(pendingKey)??'null');if(!UUID.test(value?.id))return null;const v2=value.v===2&&RECOVERY_SCOPE.test(value.scope??'');const v1=value.v===1&&value.scope===undefined;if(!v1&&!v2)return null;state.pendingCommandId=value.id;state.pendingScope=v2?value.scope:null;state.pendingLegacy=v1;syncPendingButtons();return value.id;}catch{return state.pendingCommandId;}}
function ambiguousResult(){const error=new Error('YXX_AMBIGUOUS_RESULT');error.code='YXX_AMBIGUOUS_RESULT';return error;}
function acceptedReceipt(value,commandId,expectedRef=null){const strings=[value?.client_command_id,value?.request_ref,value?.intake_no,value?.accepted_revision,value?.accepted_at,value?.accepted_epoch_ms];if(!value||typeof value!=='object'||Array.isArray(value)||!strings.every(item=>typeof item==='string')||value.client_command_id!==commandId||value.status!=='ACCEPTED'||!REQUEST_REF.test(value.request_ref)||expectedRef!==null&&value.request_ref!==expectedRef||!INTAKE_NO.test(value.intake_no)||!/^[1-9][0-9]*$/u.test(value.accepted_revision)||!LOCAL_TIME.test(value.accepted_at)||!/^[0-9]+$/u.test(value.accepted_epoch_ms))throw ambiguousResult();return value;}
function acceptedResponse(value,commandId,expectedRef=null){if(!value||typeof value!=='object'||Array.isArray(value)||value.ok!==true||typeof value.replayed!=='boolean')throw ambiguousResult();const receipt=acceptedReceipt(value.receipt,commandId,expectedRef);if(typeof value.location!=='string')throw ambiguousResult();let target;try{target=new URL(value.location,location.origin);}catch{throw ambiguousResult();}const path=`${ROOT}reports/${receipt.request_ref}`;if(target.origin!==location.origin||target.pathname!==path||target.search||target.hash)throw ambiguousResult();return {receipt,replayed:value.replayed,path};}
function fetchJson(path,options={},signal){return fetch(path,{credentials:'same-origin',cache:'no-store',signal,...options}).then(async response=>{if(response.status===304)return {status:304,body:null,etag:response.headers.get('etag')};let body={},parsed=true;try{body=await response.json();}catch{parsed=false;}if(!response.ok){const currentOperation=Boolean(signal&&signal===state.controller?.signal&&!signal.aborted);if((response.status===401||response.status===403)&&currentOperation)clearClientDom();const error=new Error(messageFor(response.status));error.status=response.status;error.code=body?.error?.code;error.current_operation=currentOperation;throw error;}if(!parsed)throw ambiguousResult();return {status:response.status,body,etag:response.headers.get('etag')};});}
function beginOperation({busy=false}={}){state.controller?.abort();const controller=new AbortController();state.controller=controller;if(busy)state.busy=true;return {controller,signal:controller.signal,generation:state.generation};}
function ownsOperation(operation){return state.controller===operation.controller&&state.generation===operation.generation&&!state.stopped;}
function finishOperation(operation){if(!ownsOperation(operation))return false;state.controller=null;state.busy=false;return true;}
function jsonHeaders(id,csrf){return {'content-type':'application/json','idempotency-key':id,'x-csrf-token':csrf,'sec-fetch-site':'same-origin'};}
function statusText(value){return ({RECEIVED_PROCESSING:'已收到，正在处理',WAITING_FOR_DETAILS:'等待补充说明',UNDER_REVIEW:'人工审核中',TICKET_CREATED:'已生成工单',NOT_SERVICE:'非报修事项'})[value]??String(value??'状态未知');}
function renderList(items){const list=$('report-list');clear(list);if(!items.length){list.append(node('li','暂时没有本人报修记录。','quiet'));return;}for(const item of items){const li=node('li');const link=node('a',undefined,'report-link');link.href=item.kind==='WEB_REQUEST'?`${ROOT}reports/${item.ref}`:`${ROOT}tickets/${item.ref}`;const top=node('div',undefined,'report-top');top.append(node('strong',item.kind==='WEB_REQUEST'?'网页报修':'原有工单','report-source'),node('span',statusText(item.display_status),'state'));link.append(top,node('span',item.ref,'report-ref'),node('div',item.ticket?.ticket_no?`工单 ${item.ticket.ticket_no}`:'尚未生成工单','report-meta'),node('div',item.created_at,'report-meta'));li.append(link);list.append(li);}}
async function loadReports(append=false){
 if(state.busy)return;
 const operation=beginOperation({busy:true});
 const query=new URLSearchParams({limit:'20'});
 if(append&&state.listCursor)query.set('cursor',state.listCursor);
 try{
  const result=await fetchJson(`/api/yixiaoxiu/my-reports?${query}`,{},operation.signal);
  if(!ownsOperation(operation))return;
  state.reportItems=append?[...state.reportItems,...result.body.items]:result.body.items;
  renderList(state.reportItems);state.listCursor=result.body.next_cursor;$('load-more-reports').hidden=!state.listCursor;setStatus('已加载本人报修。','success');
 }catch(error){if(error.name!=='AbortError'&&ownsOperation(operation))setStatus(error.status?messageFor(error.status):messageFor(503),'error');}
 finally{finishOperation(operation);}
}
function renderTimeline(timeline,{older=false}={}){
 const items=Array.isArray(timeline?.items)?timeline.items:[];
 state.timelineItems=older?[...items,...state.timelineItems]:items;
 state.timelineCursor=timeline?.next_cursor??null;
 state.timelineExpanded=older||false;
 clear($('detail-timeline'));
 for(const item of state.timelineItems){const li=node('li');li.append(node('span',item.summary??item.event_type),node('time',item.occurred_at));$('detail-timeline').append(li);}
 $('load-older-timeline').hidden=!state.timelineCursor;$('load-older-timeline').disabled=false;
 $('timeline-window-note').textContent=state.timelineExpanded?'已加载较早记录；下次状态刷新会回到最近100条。':'显示最近100条处理记录；可按需加载更早记录。';
}
function renderDetail(detail,timeline){state.detail=detail;clear($('detail-facts'));$('detail-source').textContent='网页报修 · '+detail.intake_no;$('detail-status').textContent=statusText(detail.display_status);for(const [term,value] of [['输入版本',detail.input_revision],['已处理版本',detail.processed_revision],['最近更新',detail.updated_at]])$('detail-facts').append(node('dt',term),node('dd',value));$('detail-description').textContent=detail.safe_description||'（未提供）';clear($('detail-supplements'));for(const item of detail.supplements??[]){const li=node('li',`版本 ${item.input_revision}：${item.text??''}`);$('detail-supplements').append(li);}renderTimeline(timeline);const ticket=detail.ticket?.ticket_no?`已生成工单 ${detail.ticket.ticket_no}`:'尚未生成工单';$('detail-status').append(node('span',` · ${ticket}`));$('supplement-form').hidden=!detail.can_supplement;}
function clearDetailState(){clearTimeout(state.poll);state.detail=null;state.detailEtag=null;state.timelineItems=[];state.timelineCursor=null;state.timelineExpanded=false;clear($('detail-facts'));clear($('detail-supplements'));clear($('detail-timeline'));$('detail-description').textContent='';$('detail-source').textContent='';$('detail-status').textContent='';$('timeline-window-note').textContent='';$('load-older-timeline').hidden=true;$('supplement-form').hidden=true;setView('home-view','自助报修');}
async function loadTimeline(ref,operation,{cursor=null}={}){const query=new URLSearchParams({limit:'100'});if(cursor)query.set('cursor',cursor);else query.set('before',latestTimelineBoundary);const result=await fetchJson(`/api/yixiaoxiu/requests/${ref}/timeline?${query}`,{},operation.signal);return ownsOperation(operation)?result.body:null;}
async function loadDetail(){
 if(state.busy||!state.detail)return;
 const operation=beginOperation({busy:true});
 const ref=state.detail.request_ref,headers=state.detailEtag?{'if-none-match':state.detailEtag}:{};
 try{
  const detail=await fetchJson(`/api/yixiaoxiu/requests/${ref}`,{headers},operation.signal);
  if(!ownsOperation(operation))return;
  const timeline=await loadTimeline(ref,operation);
  if(!timeline||!ownsOperation(operation))return;
  const body=detail.status===304&&state.detail?.request_ref===ref&&typeof state.detail?.input_revision==='string'?state.detail:detail.body;
  if(!body)throw Object.assign(new Error(messageFor(503)),{status:503});
  renderDetail(body,timeline);if(detail.etag)state.detailEtag=detail.etag;if(!state.pendingCommandId)setStatus('已更新报修状态。','success');
 }catch(error){if(error.name!=='AbortError'&&ownsOperation(operation)){if(error.status===404)clearDetailState();setStatus(error.status?messageFor(error.status):messageFor(503),'error');}}
 finally{if(finishOperation(operation))schedule();}
}
function schedule(){clearTimeout(state.poll);if(!state.hidden&&!state.stopped&&state.detail)state.poll=setTimeout(loadDetail,5000);}
async function loadOlderTimeline(){
 if(state.busy||!state.detail||!state.timelineCursor)return;
 const operation=beginOperation({busy:true}),cursor=state.timelineCursor,ref=state.detail.request_ref;
 $('load-older-timeline').disabled=true;
 try{
  const timeline=await loadTimeline(ref,operation,{cursor});
  if(!timeline||!ownsOperation(operation))return;
  renderTimeline(timeline,{older:true});setStatus('已加载更早记录。','success');
 }catch(error){if(error.name!=='AbortError'&&ownsOperation(operation)){if(error.status===404)clearDetailState();setStatus(error.status?messageFor(error.status):messageFor(503),'error');}}
 finally{if(finishOperation(operation)){ $('load-older-timeline').disabled=false;schedule(); }}
}
function schedulePendingRecovery(id,generation,csrf){
 clearTimeout(state.pendingTimer);
 if(state.pendingAttempts>=5){$('retry-pending').hidden=false;setStatus(state.pendingLegacy?'这是一条旧版恢复记录，归属范围未知。仍未查到结果，可稍后继续查询；不会自动重交。':'仍未查到上次提交结果。可稍后点击“查询上次提交结果”；不会重复提交。','error');return;}
 const delay=pendingDelays[Math.max(0,state.pendingAttempts-1)];
 const recoveryScope=state.recoveryScope;
 const retry=()=>{
  state.pendingTimer=null;
  if(state.pendingCommandId!==id||state.generation!==generation||state.hidden||state.stopped||window.__yxx_csrf!==csrf||state.recoveryScope!==recoveryScope)return;
  if(state.busy){state.pendingTimer=setTimeout(retry,250);return;}
  void recoverPending();
 };
 state.pendingTimer=setTimeout(retry,delay);
}
async function recoverPending({restart=false}={}){
 const id=readPending();if(!id)return;
 if(!RECOVERY_SCOPE.test(state.recoveryScope??''))return;
 if(state.pendingScope&&state.pendingScope!==state.recoveryScope){forget();return;}
 if(restart)cancelPendingRecovery(true);
 if(state.busy)return;
 cancelPendingRecovery(false);
 const operation=beginOperation({busy:true});
 const csrf=window.__yxx_csrf;state.pendingAttempts+=1;let unresolved=false;
 try{
  const result=await fetchJson(`/api/yixiaoxiu/commands/${id}`,{},operation.signal);
  if(!ownsOperation(operation))return;
  const receipt=acceptedReceipt(result.body,id);forget();location.assign(`${ROOT}reports/${receipt.request_ref}`);return;
 }catch(error){if(error.name==='AbortError')return;if(ownsOperation(operation)){unresolved=true;if(error.status===404)setStatus('上次命令尚未可查询，正在有限重查；不会重复提交。','error');else setStatus('上次命令尚未确认，正在有限重查；不会重复提交。','error');}}
 finally{if(finishOperation(operation)){syncPendingButtons();schedule();if(unresolved) schedulePendingRecovery(id,operation.generation,csrf);}}
}
async function submitNew(event){
 event.preventDefault();if(state.busy)return;
 const pending=state.pendingCommandId??readPending();
 if(pending){state.pendingCommandId=pending;syncPendingButtons();setStatus('上次报修结果尚未确认，正在查询；不会重复提交。','error');void recoverPending();return;}
 const description=$('description').value.trim(),locationText=$('location-text').value.trim(),unknown=$('location-unknown').checked;
 if(!description){setStatus('请先填写故障现象。','error');$('description').focus();return;}
 if(!locationText&&!unknown){setStatus('请填写位置，或勾选“位置暂不清楚”。','error');$('location-text').focus();return;}
 const id=crypto.randomUUID(),serviceValue=$('service-code').value.trim().toUpperCase(),serviceCode=/^[A-Z][A-Z0-9_]{0,63}$/u.test(serviceValue)?serviceValue:null;
 const payload=Object.freeze({schema_version:1,client_command_id:id,description,location:{text:locationText||null,unknown},service_code:serviceCode,impact_scope:$('impact-scope').value,reported_department_text:$('department').value.trim()||null,extension:$('extension').value.trim()||null});
 if(!remember(id)){setStatus(messageFor(503),'error');return;}const operation=beginOperation({busy:true});
 try{
  const result=await fetchJson('/api/yixiaoxiu/requests',{method:'POST',headers:jsonHeaders(id,window.__yxx_csrf),body:JSON.stringify(payload)},operation.signal);
  if(!ownsOperation(operation))return;
  const accepted=acceptedResponse(result.body,id);forget();setStatus(accepted.replayed?'已恢复原受理结果。':'报修已收到，正在处理。','success');location.assign(accepted.path);
 }catch(error){
  if(error.name==='AbortError')return;
  if(error.status&&error.status<500&&(ownsOperation(operation)||error.current_operation))forget();
  if(ownsOperation(operation))setStatus(error.status?messageFor(error.status):'结果未知，请保留本次命令并稍后查询。','error');
  if((!error.status||error.status>=500)&&ownsOperation(operation))schedulePendingRecovery(id,operation.generation,window.__yxx_csrf);
 }finally{if(finishOperation(operation))syncPendingButtons();}
}
async function submitSupplement(event){
 event.preventDefault();if(state.busy||!state.detail)return;
 const pending=state.pendingCommandId??readPending();
 if(pending){state.pendingCommandId=pending;syncPendingButtons();setStatus('上次报修结果尚未确认，正在查询；不会重复提交。','error');void recoverPending();return;}
 const id=crypto.randomUUID(),text=$('supplement-text').value.trim();
 if(!text){setStatus('请填写补充说明。','error');return;}
 const requestRef=state.detail.request_ref,payload=Object.freeze({schema_version:1,client_command_id:id,expected_input_revision:state.detail.input_revision,text});
 if(!remember(id)){setStatus(messageFor(503),'error');return;}const operation=beginOperation({busy:true});let refresh=false,conflictRefresh=false;
 try{
  const result=await fetchJson(`/api/yixiaoxiu/requests/${requestRef}/supplements`,{method:'POST',headers:jsonHeaders(id,window.__yxx_csrf),body:JSON.stringify(payload)},operation.signal);
  if(!ownsOperation(operation))return;
  const accepted=acceptedResponse(result.body,id,requestRef);forget();$('supplement-text').value='';setStatus(accepted.replayed?'已恢复原补充结果。':'补充已收到，正在处理。','success');state.detailEtag=null;refresh=true;
 }catch(error){
  if(error.name==='AbortError')return;
  if(error.status&&error.status<500&&(ownsOperation(operation)||error.current_operation))forget();
  if(error.status===409&&ownsOperation(operation)){state.detailEtag=null;refresh=true;conflictRefresh=true;}
  if(ownsOperation(operation))setStatus(error.status===409?'版本已变化，正在刷新；草稿已保留。':error.status?messageFor(error.status):'结果未知，请保留本次命令并稍后查询。');
  if((!error.status||error.status>=500)&&ownsOperation(operation))schedulePendingRecovery(id,operation.generation,window.__yxx_csrf);
 }finally{if(finishOperation(operation)){syncPendingButtons();if(state.detail&&validGeneration(operation.generation))schedule();}}
 if(refresh&&validGeneration(operation.generation)){await loadDetail();if(conflictRefresh&&validGeneration(operation.generation))setStatus('版本已变化，已刷新到最新版本；请确认草稿后重新提交。','error');}
}
async function bootstrap(){
 const previousCsrf=window.__yxx_csrf,previousScope=state.recoveryScope,draft=captureDraft();
 cancelPendingRecovery(true);state.generation+=1;state.stopped=false;state.busy=false;state.hidden=document.hidden;prepareBootstrap();
 const operation=beginOperation();
 try{
  const result=await fetchJson('/api/yixiaoxiu/bootstrap',{},operation.signal);
  if(!ownsOperation(operation))return;
  const nextScope=result.body.recovery_scope;
  if(!RECOVERY_SCOPE.test(nextScope??''))throw Object.assign(new Error(messageFor(503)),{status:503});
  readPending();
  const scopeChanged=Boolean(previousScope&&previousScope!==nextScope||state.pendingScope&&state.pendingScope!==nextScope);
  if(scopeChanged)forget();
  state.recoveryScope=nextScope;window.__yxx_csrf=result.body.csrf_token;
  const sameContext=Boolean(previousScope&&previousScope===nextScope&&previousCsrf&&previousCsrf===result.body.csrf_token);
  if(sameContext)restoreDraft(draft);
  const path=location.pathname;
  if(path===refs.new){setView('new-view','新建报修');}
  else if(path===refs.list){setView('reports-view','我的报修');await loadReports();}
  else{
   const match=path.match(/^\/wecom\/yixiaoxiu\/reports\/([A-Za-z0-9_-]{32})$/u);
   if(match){
    if(state.detail?.request_ref!==match[1]||typeof state.detail?.input_revision!=='string'){state.detail={request_ref:match[1]};state.detailEtag=null;}
    setView('detail-view','报修详情');await loadDetail();
   }else{setView('home-view','自助报修');setStatus('已验证成员会话，可开始自助报修。','success');}
  }
  await recoverPending();
 }catch(error){if(error.name!=='AbortError'&&validGeneration(operation.generation))setStatus(error.status?messageFor(error.status):messageFor(503),'error');}
}
document.addEventListener('visibilitychange',()=>{
 state.hidden=document.hidden;
 if(state.hidden){cancelPendingRecovery(true);state.generation+=1;clearTimeout(state.poll);state.controller?.abort();state.controller=null;state.busy=false;return;}
 void bootstrap();
});
window.addEventListener('pagehide',()=>{clearClientDom('');});
window.addEventListener('pageshow',event=>{if(event.persisted){clearClientDom('正在验证成员会话…');void bootstrap();}});
$('new-report-form').addEventListener('submit',submitNew);
$('supplement-form').addEventListener('submit',submitSupplement);
$('load-more-reports').addEventListener('click',()=>loadReports(true));
$('load-older-timeline').addEventListener('click',loadOlderTimeline);
$('retry-pending').addEventListener('click',()=>void recoverPending({restart:true}));
$('logout').addEventListener('click',async()=>{clearClientDom('正在退出当前会话…');forget();try{await fetch(`${ROOT}logout`,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','sec-fetch-site':'same-origin'},body:'{}'});}finally{location.assign(ROOT);}});
void bootstrap();
