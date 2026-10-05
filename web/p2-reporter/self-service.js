const ROOT='/wecom/yixiaoxiu/';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RECOVERY_SCOPE=/^[a-f0-9]{64}$/u;
const REQUEST_REF=/^[A-Za-z0-9_-]{32}$/u;
const INTAKE_NO=/^INT-[0-9]{8}-[0-9]{4,}$/u;
const LOCAL_TIME=/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/u;
const refs={home:'/wecom/yixiaoxiu/',new:'/wecom/yixiaoxiu/reports/new',list:'/wecom/yixiaoxiu/reports'};
const $=id=>document.getElementById(id);
const state={supplementFeedback:null,sessionCheckDue:false,revalidationFocus:null,generation:0,controller:null,busy:false,stopped:false,loggedOut:false,storageBlocked:false,recoveryScope:null,pendingCommandId:null,pendingScope:null,pendingLegacy:false,pendingAttempts:0,pendingTimer:null,sessionTimer:null,listCursor:null,reportItems:[],detail:null,detailEtag:null,timelineItems:[],timelineCursor:null,timelineExpanded:false,hidden:false,hiddenDraft:null};
const pendingKey='yxx.self_service.pending_command';
const durablePrefix=`${pendingKey}.`;
const durableLimit=20;
const pendingDelays=[1000,2000,4000,5000];
const latestTimelineBoundary=String(Number.MAX_SAFE_INTEGER);
const requestDeadlineMs=15000;
const sessionRevalidationMs=5000;
const ticketStatuses=Object.freeze({NEW:'等待受理',QUEUED:'等待受理',ACCEPTED:'已受理',IN_PROGRESS:'处理中',WAITING_REQUESTER:'待您补充',WAITING_VENDOR:'处理中',RESOLVED:'已处理，待确认',CLOSED:'已关闭',REOPENED:'重新处理中',CANCELLED:'已撤销',DUPLICATE_LINKED:'已关联公共故障'});
const logoutStorageKey='yxx.self_service.logout_signal';
const logoutStorageValue='v1';
const logoutSignal=Object.freeze({v:1,type:'logout'});
let logoutChannel=null;
function node(tag,textValue,className){const value=document.createElement(tag);if(textValue!==undefined)value.textContent=String(textValue);if(className)value.className=className;return value;}
function clear(element){while(element.firstChild)element.removeChild(element.firstChild);}
function validGeneration(g){return g===state.generation&&!state.stopped;}
function messageFor(status){return ({400:'输入格式有误，请检查后重试。',401:'认证已失效，请重新认证。',403:'当前账号没有此项权限。',404:'报修不存在、已撤销或已过期。',409:'版本或状态已变化，请刷新后重试。',413:'内容超过允许大小。',415:'请求格式不受支持。',429:'操作太频繁，请稍后再试。',503:'服务暂时不可用，请稍后刷新。'})[status]??'网络暂不可用，请稍后重试。';}
function setStatus(textValue,kind=''){const value=$('app-status');value.textContent=textValue;value.className=`status ${kind}`;}
function setView(view,title){for(const id of ['logged-out-view','home-view','new-view','reports-view','detail-view'])$(id).hidden=id!==view;$('page-title').textContent=title;}
function resetReportSource(){state.reportSource='';state.listLoading=false;$('report-source').value='';$('load-more-reports').hidden=true;$('load-more-reports').disabled=false;}
function cancelPendingRecovery(resetAttempts=false){clearTimeout(state.pendingTimer);state.pendingTimer=null;if(resetAttempts)state.pendingAttempts=0;$('retry-pending').hidden=true;}
function syncPendingButtons(){const blocked=state.pendingCommandId!==null||state.storageBlocked||state.readOnly===true;$('submit-report').disabled=blocked;$('submit-supplement').disabled=blocked;}
function durableKey(id){return `${durablePrefix}${id}`;}
function durableKeys(){const keys=[];for(let index=0;index<localStorage.length;index+=1){const key=localStorage.key(index);if(key?.startsWith(durablePrefix))keys.push(key);}return keys;}
function durableRecords(){const records=[];for(const key of durableKeys()){let value;try{value=JSON.parse(localStorage.getItem(key)??'null');}catch{continue;}if(value?.v!==3||!scopedRecord(value)||key!==durableKey(value.id))continue;records.push({key,value});}return records;}
function scopedRecord(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='id,scope,v'&&(value.v===2||value.v===3)&&typeof value.id==='string'&&UUID.test(value.id)&&typeof value.scope==='string'&&RECOVERY_SCOPE.test(value.scope);}
function pointTab(value){const record=JSON.stringify(value);sessionStorage.setItem(pendingKey,record);if(sessionStorage.getItem(pendingKey)!==record)throw new Error('storage verification');}
function writeDurable(id,scope,{allowExisting=false}={}){
 const key=durableKey(id),record=JSON.stringify({v:3,id,scope});let created=false;
 try{
  const existing=localStorage.getItem(key);
  if(existing!==null)return allowExisting&&existing===record;
  if(durableRecords().length>=durableLimit)return false;
  localStorage.setItem(key,record);created=true;
  if(localStorage.getItem(key)!==record)throw new Error('storage verification');
  if(durableRecords().length>durableLimit){localStorage.removeItem(key);return false;}
  return true;
 }catch{if(created){try{if(localStorage.getItem(key)===record)localStorage.removeItem(key);}catch{/* durable storage remains unavailable */}}return false;}
}
function removeDurable(id,expected=null){
 if(!UUID.test(id??''))return;
 try{const key=durableKey(id);if(expected===null||localStorage.getItem(key)===expected)localStorage.removeItem(key);}catch{/* retain an unresolved durable record */}
}
function setPending(value,{legacy=false}={}){const scope=legacy?null:value.scope;if(state.pendingCommandId!==value.id||state.pendingScope!==scope||state.pendingLegacy!==legacy)cancelPendingRecovery(true);state.pendingCommandId=value.id;state.pendingScope=scope;state.pendingLegacy=legacy;syncPendingButtons();return value.id;}
function releaseTabPending(){cancelPendingRecovery(true);state.pendingCommandId=null;state.pendingScope=null;state.pendingLegacy=false;try{sessionStorage.removeItem(pendingKey);}catch{/* tab storage is optional after recovery */}syncPendingButtons();}
function remember(id){
 if(state.storageBlocked||!UUID.test(id)||!RECOVERY_SCOPE.test(state.recoveryScope??''))return false;
 const value={v:3,id,scope:state.recoveryScope},record=JSON.stringify(value);
 if(!writeDurable(id,value.scope))return false;
 try{pointTab(value);}
 catch{removeDurable(id,record);releaseTabPending();return false;}
 setPending(value);return true;
}
function forget(){const id=state.pendingCommandId;releaseTabPending();removeDurable(id);}
function clearClientDom(message='认证已失效，请重新认证。',{preserveContext=false}={}){
 resetReportSource();
 $('protected-views').hidden=true;state.revalidationFocus=null;state.sessionCheckDue=false;state.supplementFeedback=null;
 cancelPendingRecovery(true);clearTimeout(state.sessionTimer);state.sessionTimer=null;state.generation+=1;state.stopped=true;state.busy=false;state.controller?.abort();state.controller=null;state.hiddenDraft=null;if(!preserveContext){window.__yxx_csrf=undefined;state.recoveryScope=null;}state.detail=null;state.detailEtag=null;state.timelineItems=[];state.timelineCursor=null;state.timelineExpanded=false;state.listCursor=null;state.reportItems=[];
 readPending();
 for(const id of ['description','location-text','service-code','department','extension','supplement-text']){const value=$(id);if(value)value.value='';}
 $('location-unknown').checked=false;$('impact-scope').value='UNKNOWN';clear($('report-list'));clear($('detail-facts'));clear($('detail-supplements'));clear($('detail-timeline'));$('detail-description').textContent='';renderGuidance();$('detail-source').textContent='';$('detail-status').textContent='';$('timeline-window-note').textContent='';$('load-older-timeline').hidden=true;$('supplement-form').hidden=true;setView('home-view','自助报修');setStatus(message,'error');
}
function showLoggedOut(message,kind='error',signInReady=true){
 state.loggedOut=true;state.stopped=true;state.hidden=document.hidden;cancelPendingRecovery(true);clearTimeout(state.sessionTimer);state.sessionTimer=null;
 setView('logged-out-view','会话已结束');setStatus(message,kind);$('brand-link').hidden=true;$('logout').hidden=true;$('sign-in-link').hidden=!signInReady;
}
function invalidateFromPeer(){
 if(state.loggedOut)return;
 clearClientDom('会话已在其他窗口退出，请重新登录。');
 showLoggedOut('会话已在其他窗口退出，请重新登录。');
}
function receiveLogoutSignal(value){if(value?.v===1&&value.type==='logout')invalidateFromPeer();}
function broadcastLogout(){
 try{logoutChannel?.postMessage(logoutSignal);}catch{/* channel is an optional transport */}
 try{localStorage.setItem(logoutStorageKey,logoutStorageValue);localStorage.removeItem(logoutStorageKey);}catch{/* storage is an optional transport */}
}
function captureDraft(){return Object.freeze({path:location.pathname,description:$('description').value,locationText:$('location-text').value,locationUnknown:$('location-unknown').checked,impactScope:$('impact-scope').value,serviceCode:$('service-code').value,department:$('department').value,extension:$('extension').value,supplement:$('supplement-text').value});}
function draftHasInput(draft){return Boolean(draft?.description||draft?.locationText||draft?.locationUnknown||draft?.impactScope!=='UNKNOWN'||draft?.serviceCode||draft?.department||draft?.extension||draft?.supplement);}
function restoreDraft(draft){if(!draft||draft.path!==location.pathname)return;$('description').value=draft.description;$('location-text').value=draft.locationText;$('location-unknown').checked=draft.locationUnknown;$('impact-scope').value=draft.impactScope;$('service-code').value=draft.serviceCode;$('department').value=draft.department;$('extension').value=draft.extension;$('supplement-text').value=draft.supplement;}
function prepareBootstrap(){
 resetReportSource();
 $('protected-views').hidden=true;state.revalidationFocus=null;state.sessionCheckDue=false;state.supplementFeedback=null;
 clearTimeout(state.sessionTimer);state.sessionTimer=null;state.detail=null;state.detailEtag=null;state.timelineItems=[];state.timelineCursor=null;state.timelineExpanded=false;state.listCursor=null;state.reportItems=[];state.recoveryScope=null;window.__yxx_csrf=undefined;
 for(const id of ['description','location-text','service-code','department','extension','supplement-text']){const value=$(id);if(value)value.value='';}
 $('location-unknown').checked=false;$('impact-scope').value='UNKNOWN';clear($('report-list'));clear($('detail-facts'));clear($('detail-supplements'));clear($('detail-timeline'));$('detail-description').textContent='';renderGuidance();$('detail-source').textContent='';$('detail-status').textContent='';$('timeline-window-note').textContent='';$('load-more-reports').hidden=true;$('load-older-timeline').hidden=true;$('supplement-form').hidden=true;
 for(const id of ['home-view','new-view','reports-view','detail-view'])$(id).hidden=true;
 setStatus('正在验证成员会话…');
}
function readPending(){
 try{
  const value=JSON.parse(sessionStorage.getItem(pendingKey)??'null');
  if(scopedRecord(value))return setPending(value);
  if(value?.v===1&&UUID.test(value.id??'')&&value.scope===undefined)return setPending(value,{legacy:true});
  return state.pendingCommandId;
 }catch{return state.pendingCommandId;}
}
function migratePending(scope){
 if(!state.pendingCommandId||state.pendingLegacy||state.pendingScope!==scope)return;
 const value={v:3,id:state.pendingCommandId,scope};
 if(!writeDurable(value.id,scope,{allowExisting:true}))return;
 try{pointTab(value);setPending(value);}catch{/* keep the existing in-memory and durable recovery fence */}
}
function claimDurable(scope){
 try{
  for(const key of durableKeys().sort()){
   const stored=localStorage.getItem(key);let value;try{value=JSON.parse(stored??'null');}catch{continue;}
   if(value?.v!==3||!scopedRecord(value)||key!==durableKey(value.id)||value.scope!==scope)continue;
   try{pointTab(value);}catch{/* the durable fence remains authoritative */}
   state.storageBlocked=false;return setPending(value);
  }
  state.storageBlocked=false;syncPendingButtons();
 }catch{state.storageBlocked=true;syncPendingButtons();throw ambiguousResult();}
 return null;
}
function ambiguousResult(){const error=new Error('YXX_AMBIGUOUS_RESULT');error.code='YXX_AMBIGUOUS_RESULT';return error;}
function acceptedReceipt(value,commandId,expectedRef=null){const strings=[value?.client_command_id,value?.request_ref,value?.intake_no,value?.accepted_revision,value?.accepted_at,value?.accepted_epoch_ms];if(!value||typeof value!=='object'||Array.isArray(value)||!strings.every(item=>typeof item==='string')||value.client_command_id!==commandId||value.status!=='ACCEPTED'||!REQUEST_REF.test(value.request_ref)||expectedRef!==null&&value.request_ref!==expectedRef||!INTAKE_NO.test(value.intake_no)||!/^[1-9][0-9]*$/u.test(value.accepted_revision)||!LOCAL_TIME.test(value.accepted_at)||!/^[0-9]+$/u.test(value.accepted_epoch_ms))throw ambiguousResult();return value;}
function acceptedResponse(value,commandId,expectedRef=null){if(!value||typeof value!=='object'||Array.isArray(value)||value.ok!==true||typeof value.replayed!=='boolean')throw ambiguousResult();const receipt=acceptedReceipt(value.receipt,commandId,expectedRef);if(typeof value.location!=='string')throw ambiguousResult();let target;try{target=new URL(value.location,location.origin);}catch{throw ambiguousResult();}const path=`${ROOT}reports/${receipt.request_ref}`;if(target.origin!==location.origin||target.pathname!==path||target.search||target.hash)throw ambiguousResult();return {receipt,replayed:value.replayed,path};}
async function fetchJson(path,options={},signal){
 const controller=new AbortController();let deadlineReached=false;
 const cancel=()=>controller.abort(signal?.reason);
 if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
 const timer=setTimeout(()=>{deadlineReached=true;controller.abort();},requestDeadlineMs);
 try{
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,signal:controller.signal});
  if(response.status===304)return {status:304,body:null,etag:response.headers.get('etag')};
  const currentOperation=Boolean(signal&&signal===state.controller?.signal&&!signal.aborted);
  if((response.status===401||response.status===403)&&currentOperation){clearClientDom(messageFor(response.status));const error=new Error(messageFor(response.status));error.status=response.status;error.code=response.status===401?'YXX_AUTH_REQUIRED':'YXX_FORBIDDEN';error.current_operation=true;throw error;}
  let body={},parsed=true;try{body=await response.json();}catch(error){if(deadlineReached&&!signal?.aborted)throw ambiguousResult();if(controller.signal.aborted)throw error;parsed=false;}
  if(!response.ok){const error=new Error(messageFor(response.status));error.status=response.status;error.code=body?.error?.code;error.current_operation=currentOperation;throw error;}
  if(!parsed)throw ambiguousResult();return {status:response.status,body,etag:response.headers.get('etag')};
 }catch(error){if(deadlineReached&&!signal?.aborted)throw ambiguousResult();throw error;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
function beginOperation({busy=false}={}){state.controller?.abort();const controller=new AbortController();state.controller=controller;if(busy)state.busy=true;return {controller,signal:controller.signal,generation:state.generation};}
function ownsOperation(operation){return state.controller===operation.controller&&state.generation===operation.generation&&!state.stopped;}
function finishOperation(operation){if(!ownsOperation(operation))return false;state.controller=null;state.busy=false;if(state.sessionCheckDue)scheduleSessionRevalidation();return true;}
function scheduleSessionRevalidation(){
 if(state.hidden||state.loggedOut||state.stopped||!RECOVERY_SCOPE.test(state.recoveryScope??'')){clearTimeout(state.sessionTimer);state.sessionTimer=null;return;}
 if(state.sessionTimer!==null&&!state.sessionCheckDue)return;
 clearTimeout(state.sessionTimer);
 state.sessionTimer=setTimeout(revalidateVisibleSession,state.sessionCheckDue&&!state.busy&&!state.controller?0:sessionRevalidationMs);
}
function concealProtectedViews(){
 const container=$('protected-views');
 if(!container.hidden){
  const active=document.activeElement,focused=container.contains(active)?active:null;
  state.revalidationFocus={focused,selection:focused&&typeof focused.selectionStart==='number'?[focused.selectionStart,focused.selectionEnd,focused.selectionDirection]:null};
 }
 container.hidden=true;
}
async function revalidateVisibleSession(){
 state.sessionTimer=null;
 if(state.hidden||state.loggedOut||state.stopped)return;
  state.sessionCheckDue=true;
  if(state.controller||state.busy){
   setTimeout(()=>{if(state.sessionCheckDue&&!state.stopped){concealProtectedViews();setStatus('正在验证成员会话…');}},250);
   scheduleSessionRevalidation();return;
  }
  const operation=beginOperation({busy:true}),expectedScope=state.recoveryScope;
  const views=['home-view','new-view','reports-view','detail-view'].map(id=>({element:$(id),hidden:$(id).hidden}));
  const status={text:$('app-status').textContent,className:$('app-status').className};
  const {focused,selection}=state.revalidationFocus??{};
  const concealTimer=setTimeout(()=>{
   if(!state.sessionCheckDue||state.stopped)return;
   concealProtectedViews();for(const {element} of views)element.hidden=true;setStatus('正在验证成员会话…');
  },250);
  try{
  const result=await fetchJson('/api/yixiaoxiu/bootstrap',{},operation.signal);
  if(!ownsOperation(operation))return;
  const nextScope=result.body.recovery_scope;
  if(!RECOVERY_SCOPE.test(nextScope??''))throw Object.assign(new Error(messageFor(503)),{status:503});
   if(expectedScope!==nextScope){finishOperation(operation);clearClientDom('正在验证成员会话…');for(const {element} of views)element.hidden=true;void bootstrap();return;}
  window.__yxx_csrf=result.body.csrf_token;
   clearTimeout(concealTimer);for(const {element,hidden} of views)element.hidden=hidden;
   $('protected-views').hidden=false;state.revalidationFocus=null;state.sessionCheckDue=false;
   $('app-status').textContent=status.text;$('app-status').className=status.className;
   if(focused?.isConnected&&(document.activeElement===document.body||document.activeElement===focused)){
    focused.focus({preventScroll:true});if(selection)focused.setSelectionRange(...selection);
   }
  }catch(error){clearTimeout(concealTimer);if(ownsOperation(operation)){clearClientDom(messageFor(error.status??503));for(const {element} of views)element.hidden=true;}}
  finally{clearTimeout(concealTimer);if(finishOperation(operation)&&state.detail)void loadDetail();scheduleSessionRevalidation();}
}
function jsonHeaders(id,csrf){return {'content-type':'application/json','idempotency-key':id,'x-csrf-token':csrf,'sec-fetch-site':'same-origin'};}
function statusText(value){return ({RECEIVED_PROCESSING:'已收到，正在处理',WAITING_FOR_DETAILS:'等待补充说明',UNDER_REVIEW:'人工审核中',TICKET_CREATED:'已生成工单',NOT_SERVICE:'非报修事项'})[value]??String(value??'状态未知');}
function ticketStatusText(value){return ticketStatuses[value]??'状态未知';}
function ticketSummary(ticket){return ticket?.ticket_no?`工单 ${ticket.ticket_no} · ${ticketStatusText(ticket.status)}`:'尚未生成工单';}
function renderGuidance(detail={}){for(const [id,key,label] of [['detail-needs-action','needs_action','需要您处理：'],['detail-clarification','safe_clarification','补充提示：']]){const value=typeof detail[key]==='string'?detail[key]:'';$(id).textContent=value?label+value:'';$(id).hidden=!value;}}
function renderList(items){
 const list=$('report-list');clear(list);
 if(!items.length){list.append(node('li',({WEB:'暂时没有本人网页报修记录。',BOT:'暂时没有本人企业微信工单。'})[state.reportSource]??'暂时没有本人报修记录。','quiet'));return;}
 for(const item of items){
  const li=node('li'),link=node('a',undefined,'report-link'),web=item.kind==='WEB_REQUEST';
  link.href=web?`${ROOT}reports/${item.ref}`:`${ROOT}tickets/${item.ref}`;
  const top=node('div',undefined,'report-top');
  top.append(node('strong',web?'网页报修':'企业微信工单','report-source'),node('span',statusText(item.display_status),'state'));link.append(top);
  if(web){
   const summary=typeof item.safe_summary==='string'?Array.from(item.safe_summary).slice(0,120).join(''):'';
   const locationText=typeof item.safe_location==='string'?Array.from(item.safe_location).slice(0,80).join(''):'';
   link.append(node('div',summary||'故障描述暂不可用','report-preview'),node('div',locationText?`位置：${locationText}`:'位置未提供或暂不可用','report-location report-meta'));
  }
  link.append(node('span',item.ref,'report-ref'),node('div',ticketSummary(item.ticket),'report-meta'),node('div',item.created_at,'report-meta'));li.append(link);list.append(li);
 }
}
async function loadReports(append=false){
 if(state.busy&&(!state.listLoading||append)||append&&!state.listCursor)return;
 const operation=beginOperation({busy:true});
 state.listLoading=true;
 if(!append){state.reportItems=[];state.listCursor=null;clear($('report-list'));$('load-more-reports').hidden=true;}
 $('load-more-reports').disabled=true;setStatus('正在加载本人报修…');
 const query=new URLSearchParams({limit:'20'});
 if(state.reportSource)query.set('source',state.reportSource);
 if(append&&state.listCursor)query.set('cursor',state.listCursor);
 try{
  const result=await fetchJson(`/api/yixiaoxiu/my-reports?${query}`,{},operation.signal);
  if(!ownsOperation(operation))return;
  state.reportItems=append?[...state.reportItems,...result.body.items]:result.body.items;
  renderList(state.reportItems);state.listCursor=result.body.next_cursor;$('load-more-reports').hidden=!state.listCursor;setStatus('已加载本人报修。','success');
 }catch(error){if(error.name!=='AbortError'&&ownsOperation(operation))setStatus(error.status?messageFor(error.status):messageFor(503),'error');}
 finally{if(finishOperation(operation)){state.listLoading=false;$('load-more-reports').disabled=false;}}
}
function renderTimeline(timeline,{older=false}={}){
 const items=Array.isArray(timeline?.items)?timeline.items:[];
 state.timelineItems=older?[...items,...state.timelineItems]:items;
 state.timelineCursor=timeline?.next_cursor??null;
 state.timelineExpanded=older||false;
 clear($('detail-timeline'));
 for(const item of state.timelineItems){const li=node('li');li.append(node('span',item.summary??item.event_type));if(item.ticket?.ticket_no)li.append(node('span',ticketSummary(item.ticket),'report-meta'));li.append(node('time',item.occurred_at));$('detail-timeline').append(li);}
 $('load-older-timeline').hidden=!state.timelineCursor;$('load-older-timeline').disabled=false;
 $('timeline-window-note').textContent=state.timelineExpanded?'已加载较早记录；下次状态刷新会回到最近100条。':'显示最近100条处理记录；可按需加载更早记录。';
}
function renderDetail(detail,timeline){state.detail=detail;renderGuidance(detail);clear($('detail-facts'));$('detail-source').textContent='网页报修 · '+detail.intake_no;$('detail-status').textContent=statusText(detail.display_status);for(const [term,value] of [['位置',detail.safe_location||'未提供位置'],['输入版本',detail.input_revision],['已处理版本',detail.processed_revision],['最近更新',detail.updated_at]])$('detail-facts').append(node('dt',term),node('dd',value));$('detail-description').textContent=detail.safe_description||'（未提供）';clear($('detail-supplements'));for(const item of detail.supplements??[]){const li=node('li',`版本 ${item.input_revision}：${item.text??''}`);$('detail-supplements').append(li);}renderTimeline(timeline);$('detail-status').append(node('span',` · ${detail.ticket?.ticket_no?ticketSummary(detail.ticket):'尚未生成工单'}`));$('supplement-form').hidden=!detail.can_supplement;}
function clearDetailState(){state.supplementFeedback=null;state.detail=null;state.detailEtag=null;state.timelineItems=[];state.timelineCursor=null;state.timelineExpanded=false;clear($('detail-facts'));clear($('detail-supplements'));clear($('detail-timeline'));$('detail-description').textContent='';renderGuidance();$('detail-source').textContent='';$('detail-status').textContent='';$('timeline-window-note').textContent='';$('load-older-timeline').hidden=true;$('supplement-form').hidden=true;setView('home-view','自助报修');}
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
  renderDetail(body,timeline);if(detail.etag)state.detailEtag=detail.etag;if(!state.pendingCommandId)setStatus(state.supplementFeedback??'已更新报修状态。',state.supplementFeedback?'error':'success');
 }catch(error){if(error.name!=='AbortError'&&ownsOperation(operation)){if(error.status===404)clearDetailState();setStatus(error.status?messageFor(error.status):messageFor(503),'error');}}
 finally{if(finishOperation(operation))schedule();}
}
function schedule(){scheduleSessionRevalidation();}
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
function schedulePendingRecovery(id,generation){
 clearTimeout(state.pendingTimer);
 if(state.pendingAttempts>=5){$('retry-pending').hidden=false;setStatus(state.pendingLegacy?'这是一条旧版恢复记录，归属范围未知。仍未查到结果，可稍后继续查询；不会自动重交。':'仍未查到上次提交结果。请稍后继续查询；为避免重复报修，暂不能重新提交。','error');return;}
 const delay=pendingDelays[Math.max(0,state.pendingAttempts-1)];
 const recoveryScope=state.recoveryScope;
 const retry=()=>{
  state.pendingTimer=null;
  if(state.pendingCommandId!==id||state.generation!==generation||state.hidden||state.stopped||state.recoveryScope!==recoveryScope)return;
  if(state.busy){state.pendingTimer=setTimeout(retry,250);return;}
  void recoverPending();
 };
 state.pendingTimer=setTimeout(retry,delay);
}
async function recoverPending({restart=false}={}){
 const id=readPending();if(!id)return;
 if(!RECOVERY_SCOPE.test(state.recoveryScope??''))return;
 if(state.pendingScope&&state.pendingScope!==state.recoveryScope){releaseTabPending();return;}
 if(restart)cancelPendingRecovery(true);
 if(state.busy)return;
 cancelPendingRecovery(false);
 const operation=beginOperation({busy:true});
 state.pendingAttempts+=1;let unresolved=false;
 try{
  const result=await fetchJson(`/api/yixiaoxiu/commands/${id}`,{},operation.signal);
  if(!ownsOperation(operation))return;
  const receipt=acceptedReceipt(result.body,id);forget();location.assign(`${ROOT}reports/${receipt.request_ref}`);return;
 }catch(error){if(error.name==='AbortError')return;if(ownsOperation(operation)){unresolved=true;if(error.status===404)setStatus('上次命令尚未可查询，正在有限重查；不会重复提交。','error');else setStatus('上次命令尚未确认，正在有限重查；不会重复提交。','error');}}
 finally{if(finishOperation(operation)){syncPendingButtons();schedule();if(unresolved) schedulePendingRecovery(id,operation.generation);}}
}
async function submitNew(event){
 event.preventDefault();if(state.busy)return;
 const pending=state.pendingCommandId??readPending();
 if(pending){state.pendingCommandId=pending;syncPendingButtons();setStatus('上次报修结果尚未确认，正在查询；不会重复提交。','error');void recoverPending();return;}
 const description=$('description').value.trim(),locationText=$('location-text').value.trim(),unknown=$('location-unknown').checked;
 if(!description){setStatus('请先填写故障现象。','error');$('description').focus();return;}
 if(!locationText&&!unknown){setStatus('请填写位置，或勾选“位置暂不清楚”。','error');$('location-text').focus();return;}
  const extension=$('extension').value.trim();
  if(extension&&!/^[0-9][0-9 -]{0,19}$/u.test(extension)){setStatus('分机仅支持数字、空格和短横线。','error');$('extension').focus();return;}
  const id=crypto.randomUUID(),serviceValue=$('service-code').value.trim().toUpperCase(),serviceCode=/^[A-Z][A-Z0-9_]{0,63}$/u.test(serviceValue)?serviceValue:null;
  const payload=Object.freeze({schema_version:1,client_command_id:id,description,location:{text:locationText||null,unknown},service_code:serviceCode,impact_scope:$('impact-scope').value,reported_department_text:$('department').value.trim()||null,extension:extension||null});
 if(!remember(id)){setStatus(messageFor(503),'error');return;}const operation=beginOperation({busy:true});
 try{
  const result=await fetchJson('/api/yixiaoxiu/requests',{method:'POST',headers:jsonHeaders(id,window.__yxx_csrf),body:JSON.stringify(payload)},operation.signal);
  if(!ownsOperation(operation))return;
  const accepted=acceptedResponse(result.body,id);forget();setStatus(accepted.replayed?'已恢复原受理结果。':'报修已收到，正在处理。','success');location.assign(accepted.path);
 }catch(error){
  if(error.name==='AbortError')return;
  if(error.status&&error.status<500&&(ownsOperation(operation)||error.current_operation))forget();
  if(ownsOperation(operation))setStatus(error.status?messageFor(error.status):'结果未知，请保留本次命令并稍后查询。','error');
  if((!error.status||error.status>=500)&&ownsOperation(operation))schedulePendingRecovery(id,operation.generation);
 }finally{if(finishOperation(operation))syncPendingButtons();}
}
async function submitSupplement(event){
 event.preventDefault();if(state.busy||!state.detail)return;state.supplementFeedback=null;
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
  if(error.status&&error.status<500&&ownsOperation(operation))state.supplementFeedback=error.status===409?'版本已变化，已刷新到最新版本；请确认草稿后重新提交。':messageFor(error.status);
  if(error.status===409&&ownsOperation(operation)){state.detailEtag=null;refresh=true;conflictRefresh=true;}
  if(ownsOperation(operation))setStatus(error.status===409?'版本已变化，正在刷新；草稿已保留。':error.status?messageFor(error.status):'结果未知，请保留本次命令并稍后查询。');
  if((!error.status||error.status>=500)&&ownsOperation(operation))schedulePendingRecovery(id,operation.generation);
 }finally{if(finishOperation(operation)){syncPendingButtons();if(state.detail&&validGeneration(operation.generation))schedule();}}
 if(refresh&&validGeneration(operation.generation)){await loadDetail();if(conflictRefresh&&validGeneration(operation.generation))setStatus('版本已变化，已刷新到最新版本；请确认草稿后重新提交。','error');}
}
async function bootstrap(){
 if(state.loggedOut)return;
 const previousCsrf=window.__yxx_csrf,previousScope=state.recoveryScope,currentDraft=captureDraft(),draft=draftHasInput(currentDraft)?currentDraft:(state.hiddenDraft??currentDraft);state.hiddenDraft=null;
 cancelPendingRecovery(true);state.generation+=1;state.stopped=false;state.busy=false;state.hidden=document.hidden;prepareBootstrap();
 const operation=beginOperation();
 try{
  const result=await fetchJson('/api/yixiaoxiu/bootstrap',{},operation.signal);
  if(!ownsOperation(operation))return;
  const nextScope=result.body.recovery_scope;
  if(!RECOVERY_SCOPE.test(nextScope??''))throw Object.assign(new Error(messageFor(503)),{status:503});
  readPending();
  if(previousScope&&previousScope!==nextScope||state.pendingScope&&state.pendingScope!==nextScope)releaseTabPending();
  state.recoveryScope=nextScope;window.__yxx_csrf=result.body.csrf_token;
  state.readOnly=result.body.read_only===true;
  for(const link of document.querySelectorAll('a[href="/wecom/yixiaoxiu/reports/new"]'))link.hidden=!result.body.can_submit;
  $('submit-report').disabled=!result.body.can_submit;
  if(state.pendingCommandId)migratePending(nextScope);else claimDurable(nextScope);
  const sameMemberScope=Boolean(previousScope&&previousScope===nextScope);
  if(sameMemberScope)restoreDraft(draft);
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
  if(validGeneration(operation.generation)&&!state.sessionCheckDue)$('protected-views').hidden=false;
 }catch(error){if(error.name!=='AbortError'&&validGeneration(operation.generation))setStatus(error.status?messageFor(error.status):messageFor(503),'error');}
 finally{finishOperation(operation);scheduleSessionRevalidation();}
}
document.addEventListener('visibilitychange',()=>{
 state.hidden=document.hidden;
 if(state.loggedOut)return;
 if(state.hidden){const draft=state.hiddenDraft??captureDraft();clearClientDom('',{preserveContext:true});state.hiddenDraft=draft;return;}
 void bootstrap();
});
window.addEventListener('pagehide',()=>{if(!state.loggedOut)clearClientDom('');});
window.addEventListener('pageshow',event=>{if(event.persisted&&!state.loggedOut){clearClientDom('正在验证成员会话…');void bootstrap();}});
$('new-report-form').addEventListener('submit',submitNew);
$('supplement-form').addEventListener('submit',submitSupplement);
$('load-more-reports').addEventListener('click',()=>loadReports(true));
$('report-source').addEventListener('change',()=>{
 if(state.stopped||state.hidden||state.loggedOut||state.busy&&!state.listLoading||$('protected-views').hidden){$('report-source').value=state.reportSource;return;}
 state.reportSource=$('report-source').value;void loadReports();
});
$('load-older-timeline').addEventListener('click',loadOlderTimeline);
$('retry-pending').addEventListener('click',()=>void recoverPending({restart:true}));
$('logout').addEventListener('click',async()=>{
 clearClientDom('正在退出当前会话…');showLoggedOut('正在退出当前会话…','',false);broadcastLogout();
 const generation=state.generation,controller=new AbortController();
 try{
  const result=await fetchJson(`${ROOT}logout`,{method:'POST',headers:{'content-type':'application/json','sec-fetch-site':'same-origin'},body:'{}'},controller.signal);
  if(state.loggedOut&&state.generation===generation)showLoggedOut(result.body?.logged_out===true?'已退出当前会话。':'未能确认服务端退出，请重新登录后确认会话。',result.body?.logged_out===true?'success':'error');
 }catch{
  if(state.loggedOut&&state.generation===generation)showLoggedOut('未能确认服务端退出，请重新登录后确认会话。');
 }
});
window.addEventListener('storage',event=>{if(event.key===logoutStorageKey&&event.newValue===logoutStorageValue)receiveLogoutSignal(logoutSignal);});
if(typeof BroadcastChannel==='function'){
 try{logoutChannel=new BroadcastChannel('yxx.self_service.session');logoutChannel.addEventListener('message',event=>receiveLogoutSignal(event.data));}catch{/* BroadcastChannel is an optional transport */}
}
void bootstrap();
