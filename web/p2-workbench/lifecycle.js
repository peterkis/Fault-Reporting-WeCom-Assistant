const $=id=>document.getElementById(id);
const queues={reviews:'待人工审核',queued:'待分配工单',mine:'我的工单',accepted:'已接单',in_progress:'处理中',waiting_requester:'等待上报人',waiting_vendor:'等待厂商',resolved:'已解决待确认',closed:'已关闭',reopened:'重新打开',cancelled:'已取消',failed_delivery:'发送失败'};
const statuses={NEW:'待入队',QUEUED:'待分配',ACCEPTED:'已接单',IN_PROGRESS:'处理中',WAITING_REQUESTER:'等待上报人',WAITING_VENDOR:'等待厂商',RESOLVED:'已解决待确认',CLOSED:'已关闭',REOPENED:'重新打开',CANCELLED:'已取消',PENDING:'待处理',SENT:'已发送',SENDING:'发送中',DEAD_LETTER:'发送失败',RECONCILIATION_REQUIRED:'发送结果未知，需核对',NOT_ATTEMPTED:'尚未发送',ACKNOWLEDGED:'已确认',UNKNOWN:'未知',NORMAL:'普通',URGENT:'紧急',HIGH:'高',LOW:'低'};
const actions={queue:'进入待分配',accept:'接单',start:'开始处理','request-information':'请上报人补充','wait-vendor':'等待厂商',resume:'恢复处理',resolve:'登记解决',confirm:'确认关闭',reopen:'重新打开',cancel:'取消工单','add-note':'添加备注','transfer-assignment':'转派处理人'};
const resolutions={CONFIRM_TICKET_ELIGIBLE:'确认为故障报修',CLASSIFY_SERVICE_REQUEST:'归为服务请求',REQUEST_DESCRIPTION:'请求补充描述',CLASSIFY_BUSINESS_CONSULTATION:'归为业务咨询',ACKNOWLEDGE:'礼貌确认',MARK_OUT_OF_SCOPE:'标记非受理范围',KEEP_INCIDENT_REVIEW_CANDIDATE:'保留事件审核候选（不创建 Incident）',CANCEL_REVIEW:'取消本次审核'};
const eventLabels={created:'故障受理',queued:'进入待分配',accepted:'处理人接单',started:'开始处理',waiting_requester:'请求补充信息',waiting_vendor:'等待厂商',resumed:'恢复处理',resolved:'登记解决',closed:'确认关闭',reopened:'重新打开',cancelled:'取消工单',note_added:'记录备注',information_added:'收到补充',assignment_transferred:'转派处理人',auto_close_reminder:'关闭前提醒'};
let queue='queued',selected=null,priority='',next=null,items=[],detail=null,bootstrap=null,eventsCursor=null;
let stopped=false,loading=false,pending=false,editing=false,retryCommand=null,stream=null,timer=null,epoch=0;
const controllers=new Set();
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function button(text,run,cls){const b=node('button',text,cls);b.type='button';b.addEventListener('click',()=>void run());return b;}
function say(text){$('lc-status').textContent=text;}
function title(value){return statuses[value]??value??'未设置';}
function expire(){stopped=true;stream?.close();clearInterval(timer);for(const c of controllers)c.abort();$('lc-detail').replaceChildren();$('lc-list').replaceChildren();$('lc-connection').textContent='认证已失效';say('坐席会话已过期，请重新登录；未提交内容不再发送。');}
async function api(path,options={}){
  const c=new AbortController();controllers.add(c);const timeout=setTimeout(()=>c.abort(),15000);
  try{
    const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,signal:c.signal});
    const body=await response.json().catch(()=>({}));
    if(response.status===401){expire();const e=new Error('AUTH_EXPIRED');e.status=401;throw e;}
    if(!response.ok||body.ok===false){const e=new Error(body.error?.code??'REQUEST_FAILED');e.status=response.status;throw e;}
    return body;
  }finally{clearTimeout(timeout);controllers.delete(c);}
}
function remember(){const h=new URLSearchParams({queue});if(selected)h.set('selected',selected);if(priority)h.set('priority',priority);history.replaceState(null,'','#'+h);}
function navigation(){
  $('lc-navigation').replaceChildren();for(const [id,label] of Object.entries(queues)){
    const b=button(label,async()=>{if(pending)return;editing=false;queue=id;selected=null;detail=null;retryCommand=null;$('lc-retry-command').hidden=true;epoch++;remember();navigation();$('lc-detail').replaceChildren(node('p','选择列表中的项目以查看详情。','placeholder'));await refresh();});
    b.dataset.queue=id;b.setAttribute('aria-pressed',String(id===queue));$('lc-navigation').append(b);
  }$('lc-queue-title').textContent=queues[queue];$('lc-priority-label').hidden=queue!=='reviews';
}
async function list(append=false){
  const version=epoch,params=new URLSearchParams({limit:'30',state:queue});
  if(queue==='reviews'){params.delete('state');params.set('status','PENDING');if(priority)params.set('priority',priority);}
  if(append&&next)params.set('cursor',next);
  const page=await api((queue==='reviews'?'/api/manual-reviews':'/api/tickets')+'?'+params);
  if(version!==epoch)return;items=(append?[...items,...page.items]:page.items).slice(-100);next=page.next_cursor;
  $('lc-list').replaceChildren();
  if(!items.length)$('lc-list').append(node('li','当前队列没有待处理项目。','quiet'));
  for(const item of items){
    const li=node('li'),b=button('',()=>select(item.id));b.dataset.resourceId=item.id;b.setAttribute('aria-current',String(item.id===selected));
    b.append(node('strong',queue==='reviews'?'需要人工判断':item.ticket_no),node('span',queue==='reviews'?title(item.priority):title(item.status),'badge'),
      node('small',queue==='reviews'?item.review_reason_code:'优先级 '+title(item.priority)),node('small',item.updated_at??item.created_at));li.append(b);$('lc-list').append(li);
  }$('lc-more').hidden=!next;
}
function section(label){const s=node('section',undefined,'detail-section');s.append(node('h3',label));$('lc-detail').append(s);return s;}
function facts(parent,values){const dl=node('dl');for(const [key,val] of values)dl.append(node('dt',key),node('dd',String(val??'未设置')));parent.append(dl);}
function dataView(parent,label,value){const d=node('details');d.append(node('summary',label),node('pre',JSON.stringify(value,null,2)));parent.append(d);}
function field(parent,label,control){const l=node('label',label,'field');l.append(control);parent.append(l);return control;}
function choice(parent,label,options){const s=node('select');for(const [value,text] of options){const o=node('option',text);o.value=value;s.append(o);}return field(parent,label,s);}
function commandForm(parent,label,makePayload,{note=false,options=null,holdUpdates=true,hint='确认后提交；外部通知经可靠投递队列发送。'}={}){
  if(holdUpdates)editing=true;
  const form=node('form');form.append(node('p',hint,'hint'));
  let selection=null,text=null,external=null;
  if(options)selection=choice(form,'目标处理人',options);
  if(note){text=node('textarea');text.maxLength=2000;text.rows=3;text.required=true;field(form,'备注内容（默认仅内部可见）',text);
    external=node('input');external.type='checkbox';field(form,'此备注允许记为外部可见（不自动发送自由文本）',external);}
  const submit=node('button','确认：'+label,'primary');submit.type='submit';form.append(submit);
  if(holdUpdates)form.append(button('取消本次操作',()=>{editing=false;parent.replaceChildren();detail=null;void refresh();}));
  form.addEventListener('submit',async event=>{event.preventDefault();if(pending||stopped)return;
    const data=makePayload({selection:selection?.value,note:text?.value,external:external?.checked??false});await execute(data);});parent.append(form);
}
async function execute(command){
  if(pending||stopped)return;pending=true;const id=command.id??crypto.randomUUID();command={...command,id};
  const body={...command.body,client_command_id:id};const headers={'Content-Type':'application/json','Idempotency-Key':id,'X-CSRF-Token':bootstrap.csrf_token??''};
  if(command.version!==undefined)headers['If-Match']='"'+command.version+'"';
  const controls=[...$('lc-detail').querySelectorAll('button,textarea,select,input')].map(n=>[n,n.disabled]);controls.forEach(([n])=>n.disabled=true);
  try{await api(command.path,{method:'POST',headers,body:JSON.stringify(body)});retryCommand=null;$('lc-retry-command').hidden=true;say('已提交。状态与通知以服务端持久记录为准。');}
  catch(error){
    if(error.status===401)return;
    if(!error.status){retryCommand=command;$('lc-retry-command').hidden=false;say('连接中断，结果尚未确认。请使用同一命令核对重试，不要重复创建操作。');}
    else{retryCommand=null;$('lc-retry-command').hidden=true;say(error.status===409?'状态已变化或操作不适用，已刷新。请重新检查后操作。':error.status===403?'当前坐席无权执行该操作。':'本次操作未完成，请检查状态后重试。');}
  }finally{pending=false;editing=false;controls.forEach(([n,disabled])=>n.disabled=disabled);if(!stopped){detail=null;await refresh().catch(()=>{});}}
}
function eventList(parent,rows,append=false){
  let ol=parent.querySelector('ol');if(!ol||!append){ol=node('ol',undefined,'events');parent.append(ol);}
  for(const e of rows){const li=node('li',(eventLabels[e.event_type.replace('ticket.','')]??'工单事件')+' · '+title(e.new_status));
    li.append(node('time',e.created_at));if(e.has_internal_note)li.append(node('small','含内部备注（不会进入 Reporter 时间线）'));ol.append(li);}
  while(ol.children.length>200)ol.firstElementChild.remove();
}
async function renderTicket(ticket,version){
  const [responsibility,events,deliveries,eligible]=await Promise.all(['responsibility','events','deliveries','eligible-principals'].map(p=>api('/api/tickets/'+ticket.id+'/'+p)));
  if(version!==epoch||editing||pending)return;
  $('lc-detail').replaceChildren();const head=node('div',undefined,'detail-header');head.append(node('h2',ticket.ticket_no,'ticket-number'),node('span',title(ticket.status),'badge'));$('lc-detail').append(head);
  facts($('lc-detail'),[['优先级',title(ticket.priority)],['建立时间',ticket.created_at],['更新 / 版本',ticket.updated_at+' / '+ticket.version]]);
  const owners=section('双责任 · 沟通与解决相互独立'),grid=node('div',undefined,'responsibilities'),conversation=node('div'),resolver=node('div');
  conversation.append(node('strong','沟通负责人'));for(const c of responsibility.conversations)conversation.append(node('p',c.conversation_principal_name??'未分配沟通坐席'));
  if(!responsibility.conversations.length)conversation.append(node('p','尚无关联会话'));resolver.append(node('strong','故障处理人'),node('p',responsibility.ticket_assignee_name??'待接单'),node('p',responsibility.resolver_team_name??responsibility.resolver_team_id));grid.append(conversation,resolver);owners.append(grid);
  owners.append(button('进入会话与人工回复',()=>{location.href='/workbench/';}));
  const actionSection=section('工单操作'),bar=node('div',undefined,'actions'),confirm=node('div');actionSection.append(bar,confirm);
  for(const action of ticket.allowed_actions){
    const label=actions[action];if(!label)continue;
    bar.append(button(label,()=>{confirm.replaceChildren();
      const route=action==='add-note'?'notes':action==='transfer-assignment'?'transfer':action;
      commandForm(confirm,label,values=>({path:'/api/tickets/'+ticket.id+'/'+route,version:ticket.version,
        body:{expected_version:ticket.version,reason_code:'WORKBENCH_'+action.toUpperCase().replaceAll('-','_'),
          ...(action==='add-note'?{note:values.note,external_visible:values.external}:{}),
          ...(action==='transfer-assignment'?{target_principal_id:values.selection}:{})}}),
      {note:action==='add-note',options:action==='transfer-assignment'?eligible.items.map(p=>[p.principal_id,p.display_name]):null,
        hint:action==='transfer-assignment'?'仅转移工单处理责任；沟通负责人保持不变。':'当前版本 '+ticket.version+'。确认后提交该动作。'});
      confirm.querySelector('textarea,select,button')?.focus();
    }));
  }
  if(!ticket.allowed_actions.length)actionSection.append(node('p','当前状态下无可执行动作。','hint'));
  if(ticket.allowed_actions.includes('accept'))for(const c of responsibility.conversations.filter(c=>c.combined_accept_allowed&&c.conversation_principal_id!==bootstrap.principal_id)){
    bar.append(button('接管会话并接单',()=>{confirm.replaceChildren();commandForm(confirm,'接管会话并接单',()=>({
      path:'/api/conversations/'+c.session_id+'/takeover-and-accept-ticket',version:c.session_row_version,
      body:{ticket_id:ticket.id,expected_ticket_version:ticket.version,expected_session_row_version:Number(c.session_row_version),reason_code:'WORKBENCH_COMBINED_ACCEPT'}}),
    {hint:'会话版本 '+c.session_row_version+' / 工单版本 '+ticket.version+'；两个动作同事务提交，失败则全部撤销。'});}));
  }
  const notifications=section('外部通知 · 投递状态');
  if(!deliveries.items.length)notifications.append(node('p','暂无外部通知。','hint'));
  for(const d of deliveries.items){const box=node('div',undefined,'delivery');box.append(node('strong',title(d.status)),node('p',(d.destination_type==='GROUP'?'群内安全回执':'上报人单聊')+' · 尝试 '+d.attempt_count),node('small',d.created_at));
    const admin=bootstrap.roles.includes('ADMIN'),canRetry=admin||bootstrap.roles.includes('DISPATCHER')||ticket.assignee_id===bootstrap.principal_id;
    const confirmDelivery=(label,action,resolution)=>{const form=node('div');box.append(form);commandForm(form,label,()=>({path:'/api/tickets/'+ticket.id+'/deliveries/'+d.delivery_id+'/'+action,body:{reason_code:'OPERATOR_VERIFIED',...(resolution?{resolution}:{})}}),{hint:'仅在核对实际发送结果后确认。结果未知时不可直接重试。'});};
    if(d.status==='DEAD_LETTER'&&d.side_effect_state==='NOT_ATTEMPTED'&&canRetry)box.append(button('授权重试',()=>confirmDelivery('重试','retry')));
    if(d.status==='RECONCILIATION_REQUIRED'){
      box.append(node('p','UNKNOWN：需管理员在企业微信核对，不会自动重发。','danger'));
      if(admin)for(const [resolution,label] of [['CONFIRMED_SENT','已核实发送成功'],['CONFIRMED_NOT_SENT_REQUEUE','已核实未发送，重新入队'],['CANCEL','停止该通知']])box.append(button(label,()=>confirmDelivery(label,'reconcile',resolution)));
    }notifications.append(box);
  }
  const eventSection=section('追加式工单事件');eventList(eventSection,events.items);eventsCursor=events.next_cursor;
  const more=button('加载更多事件',async()=>{if(!eventsCursor)return;more.disabled=true;try{const page=await api('/api/tickets/'+ticket.id+'/events?cursor='+encodeURIComponent(eventsCursor));if(version!==epoch)return;eventList(eventSection,page.items,true);eventsCursor=page.next_cursor;more.hidden=!eventsCursor;}finally{more.disabled=false;}});more.hidden=!eventsCursor;eventSection.append(more);
}
async function renderReview(review,version){
  const [journey,legs,decisions]=await Promise.all(['','/legs','/decisions'].map(p=>api('/api/contact-journeys/'+review.journey_id+p)));
  if(version!==epoch||editing||pending)return;$('lc-detail').replaceChildren(node('h2','人工判断与安全处理'),node('p','原始规则判定保持不变；人工结论以新版本追加。','hint'));
  facts($('lc-detail'),[['审核原因',review.review_reason_code],['优先级 / 状态',title(review.priority)+' / '+title(review.status)],['创建时间',review.created_at],['审核版本',review.row_version]]);
  const source=section('来源与 Contact Journey');facts(source,[['入口',journey.origin_channel],['当前渠道',journey.current_channel],['链路状态',journey.status]]);
  dataView(source,'安全引用与渠道轨迹', {journey,legs});
  const result=section('规则判定、已知 / 缺失字段与 Provenance');dataView(result,'查看原始安全判定',review.safe_result);dataView(result,'原 Decision 与追加版本',decisions);
  const action=section('人工结论');
  if(review.status!=='PENDING'){action.append(node('p','该审核已完成。'));return;}
  const selectResolution=choice(action,'选择明确的处理结论',review.allowed_resolutions.map(code=>[code,resolutions[code]??code]));
  commandForm(action,'保存人工结论并执行安全动作',()=>({path:'/api/manual-reviews/'+review.id+'/resolve',version:review.row_version,
    body:{expected_row_version:review.row_version,resolution_code:selectResolution.value,resolution_reason_code:'OPERATOR_REVIEWED'}}),
  {holdUpdates:false,hint:'故障确认将受理并生成最小工单；请求补充仅发送固定文案。业务咨询不会变成故障工单。'});
  selectResolution.addEventListener('change',()=>{editing=true;});
  const unsupported=button('链接已有 Journey（当前 Contract 未开放）',()=>{});unsupported.disabled=true;action.append(unsupported);
  action.append(node('p','Incident 候选仅保留给后续审核，不创建 Incident，也不批量通知。','hint'));
}
async function select(id){if(pending)return;editing=false;selected=id;detail=null;epoch++;remember();await refresh();if(innerWidth<1200)$('lc-detail').scrollIntoView({block:'start',behavior:'instant'});}
async function refresh(){
  if(stopped||pending||loading)return;loading=true;const version=epoch;
  try{await list();if(selected&&!editing&&!pending){const nextDetail=await api((queue==='reviews'?'/api/manual-reviews/':'/api/tickets/')+selected);
    if(version!==epoch||editing||pending)return;
    const revision=nextDetail.row_version??nextDetail.version;
    if(!detail||detail.id!==nextDetail.id||(detail.row_version??detail.version)!==revision){detail=nextDetail;
      if(queue==='reviews')await renderReview(detail,version);else await renderTicket(detail,version);
    }else if(queue!=='reviews'&&!$('lc-detail').contains(document.activeElement))await renderTicket(detail,version);
  }}catch(error){if(error.status!==401)say(error.status===404?'所选内容已不可见或已移出权限范围。':'暂时无法刷新，轮询将在网络恢复后继续。');}
  finally{loading=false;if(version!==epoch&&!stopped)void refresh();}
}
function connect(){
  stream=new EventSource('/api/realtime/events');
  stream.onopen=()=>{$('lc-connection').textContent='实时连接 · 5 秒轮询校验';};
  stream.onerror=()=>{$('lc-connection').textContent='连接恢复中 · 5 秒轮询';};
  const refreshEvent=()=>{if(!document.hidden)void refresh();};stream.onmessage=refreshEvent;
  for(const type of ['manual_review.created','manual_review.resolved','ticket.command.committed','ticket.status.changed','ticket.assignment.changed','ticket.notification.created','ticket.notification.delivery_changed','ticket.updated','communication.delivery.changed','conversation.assigned'])stream.addEventListener(type,refreshEvent);
  stream.addEventListener('replay_gap',()=>{detail=null;void refresh();});
}
$('lc-refresh').addEventListener('click',()=>{if(pending)return;editing=false;detail=null;void refresh();});
$('lc-more').addEventListener('click',async()=>{if(loading)return;loading=true;try{await list(true);}catch{say('加载失败，请重试。');}finally{loading=false;}});
$('lc-priority').addEventListener('change',()=>{priority=$('lc-priority').value;selected=null;epoch++;remember();void refresh();});
$('lc-retry-command').addEventListener('click',()=>{if(retryCommand)void execute(retryCommand);});
window.addEventListener('pagehide',()=>{stopped=true;stream?.close();clearInterval(timer);for(const c of controllers)c.abort();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
try{
  const saved=new URLSearchParams(location.hash.slice(1));if(Object.hasOwn(queues,saved.get('queue')))queue=saved.get('queue');
  if(/^[0-9a-f-]{36}$/iu.test(saved.get('selected')??''))selected=saved.get('selected');
  if(['URGENT','HIGH','NORMAL','LOW'].includes(saved.get('priority')))priority=saved.get('priority');$('lc-priority').value=priority;
  bootstrap=await api('/api/lifecycle/bootstrap');$('lc-agent').textContent=bootstrap.display_name+' · 内部坐席';navigation();await refresh();
  if(!stopped){connect();timer=setInterval(()=>{if(!document.hidden)void refresh();},5000);say('服务数据已加载；请选择队列与处理项目。');}
}catch{if(!stopped){$('lc-connection').textContent='工作台不可用';say('P2-016 未启用或坐席访问不可用。');}}
