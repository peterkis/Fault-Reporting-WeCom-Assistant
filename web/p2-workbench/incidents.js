const $=id=>document.getElementById(id),node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const labels={LOW:'低',MEDIUM:'中',HIGH:'高',CRITICAL:'需重点关注',ROOM:'房间',DEPARTMENT:'科室',HIS:'医院信息系统',LIS:'检验信息系统',RIS:'放射信息系统',PACS:'医学影像系统',NETWORK:'网络服务',LOGIN_FAILURE:'登录异常',PRINT_FAILURE:'打印异常',CONNECTION_FAILURE:'连接异常',CANDIDATE:'待审核',UNDER_REVIEW:'审核中',CONFIRMED:'已确认',REJECTED:'已拒绝',EXPIRED:'已到期',CONFIRMED_LOCAL:'已确认局部故障',CONFIRMED_BUILDING:'已确认楼宇故障',CONFIRMED_CAMPUS:'已确认院区故障',CONFIRMED_HOSPITAL_WIDE:'已确认全院故障',INVESTIGATING:'调查处理中',RESOLVED:'已恢复',CLOSED:'已关闭',ACTIVE:'接收通知',PENDING_DESTINATION:'等待可靠单聊渠道',PAUSED:'已暂停',ENDED:'已结束',LINKED:'已关联',UNLINKED:'已解除',IMPACTED:'受影响',RECOVERED:'个人已恢复',UNKNOWN:'待核实',LOCAL:'局部',BUILDING:'楼宇',CAMPUS:'院区',HOSPITAL_WIDE:'全院'};
let mode='candidates',selected=null,next=null,items=[],bootstrap=null,busy=false,loading=false,editing=false,stopped=false,stream=null,timer=null,retry=null,generation=0;
let childCursors={};
const controllers=new Set();const say=s=>$('status').textContent=s;
function button(label,fn){const b=node('button',label);b.type='button';b.onclick=()=>void fn();return b;}
function stop(){generation++;stopped=true;stream?.close();clearInterval(timer);for(const c of controllers)c.abort();$('list').replaceChildren();$('detail').replaceChildren();say('访问已失效，请重新登录。');}
async function api(path,options={}){const c=new AbortController();controllers.add(c);const t=setTimeout(()=>c.abort(),15000);try{
  const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,signal:c.signal}),body=await r.json();
  if(r.status===401||r.status===403)stop();if(!r.ok||body.ok===false){const e=new Error(body.error?.code??'请求失败');e.status=r.status;throw e;}return body;
}finally{clearTimeout(t);controllers.delete(c);}}
const base=()=>mode==='candidates'?'/api/incident-candidates':'/api/incidents';
function remember(){history.replaceState(null,'','#'+new URLSearchParams({mode,...(selected?{selected}:{})}));}
function field(form,label,control){const l=node('label',label);l.className='field';l.append(control);form.append(l);return control;}
function select(form,label,options){const s=node('select');for(const [value,text] of options){const o=node('option',text);o.value=value;s.append(o);}return field(form,label,s);}
function facts(parent,values){const dl=node('dl');for(const [k,v] of values)dl.append(node('dt',k),node('dd',String(labels[v]??v??'来源未提供')));parent.append(dl);}
function section(title){const s=node('section');s.className='detail-section';s.append(node('h3',title));$('detail').append(s);return s;}
async function execute(path,body,id=crypto.randomUUID()){
  if(busy||stopped)return;busy=true;editing=false;
  const controls=[...$('detail').querySelectorAll('button,select,input')];controls.forEach(x=>x.disabled=true);
  try{await api(path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':id,'X-CSRF-Token':bootstrap.csrf_token??'','If-Match':'"'+(body.expected_candidate_version??body.expected_row_version)+'"'},body:JSON.stringify({...body,client_command_id:id})});retry=null;say('已提交；状态与通知以持久记录为准。');}
  catch(e){if(!e.status){retry={path,body,id};say('响应未确认，请核对同一命令，不要重复操作。');}else{retry=null;say(e.status===409?'版本或状态已变化，请刷新后重新核对。':e.status===403?'当前坐席无权执行。':e.status===503?'服务暂时不可用，本次业务未提交。请刷新确认状态后稍后重试。':'操作未完成。');}}
  finally{busy=false;$('retry').hidden=!retry;controls.forEach(x=>x.disabled=false);if(!stopped)await refresh();}
}
const reasonOptions=[['','请选择原因'],['OPERATOR_REVIEWED','已核对并执行'],['CONFIRMED_SHARED_FAULT','确认共享故障'],['INCORRECT_ASSOCIATION','纠正错误关联'],['RECOVERY_CONFIRMED','已确认个人恢复'],['SUBSCRIPTION_REQUEST','订阅人明确请求'],['SCOPE_CORRECTION','纠正影响范围'],['WORKBENCH_CONFIRMED','工作台人工确认']];
function action(parent,label,path,body,build=null){parent.append(button(label,async()=>{
  if(busy)return;editing=true;const form=node('form');form.append(node('p','请核对范围与对象；个人工单状态不会随公共故障改变。'));let values;try{values=await build?.(form)??(()=>({}));}catch{editing=false;say('暂时无法加载可选项，请刷新重试。');return;}
  const reason=select(form,'选择操作原因',reasonOptions);reason.name='reason_code';reason.required=true;
  const submit=node('button','确认：'+label);submit.type='submit';form.append(submit,button('取消',()=>{editing=false;form.remove();}));parent.append(form);
  form.onsubmit=e=>{e.preventDefault();try{void execute(path,{...body,...values(),reason_code:reason.value});}catch{say('请完成所有明确选择后再提交。');}};form.querySelector('select,input,button')?.focus();
}));}
const childPage=(root,part)=>api(root+'/'+part+'?'+new URLSearchParams({limit:part==='events'?'200':'100',...(childCursors[part]?{cursor:childCursors[part]}:{})}));
function pager(parent,part,page){const navigate=after=>{editing=false;childCursors[part]=after;generation++;void detail();};if(childCursors[part])parent.append(button('返回该列表第一页',()=>navigate(null)));if(page.next_cursor)parent.append(button('查看该列表下一页',()=>navigate(page.next_cursor)));}
async function detail(){
  const turn=generation,d=await api(base()+'/'+selected);if(turn!==generation||editing||busy)return;
  $('detail').replaceChildren(node('h2',mode==='candidates'?'公共故障候选':'公共故障 · '+d.incident_no.slice(-6)));
  facts($('detail'),[['状态',d.status],['服务',d.service_family],['症状',d.symptom_family],['范围',d.confirmed_scope??d.scope_candidate],['严重度',d.clinical_severity_candidate??d.severity],['版本',d.row_version],['更新时间',d.updated_at]]);
  const root=base()+'/'+d.id,admin=bootstrap.roles.includes('ADMIN'),manager=admin||bootstrap.roles.includes('DISPATCHER');
  if(mode!=='candidates'&&manager){const refs=section('责任与内部参考');facts(refs,[['负责人',d.owner_display_name],['负责团队',d.owner_team_id],['主参考工单',d.primary_ticket_no??'未设置'],['完整 Incident 编号',d.incident_no]]);}
  const controls=section('人工操作');
  if(mode==='candidates'){
    const evidence=section('冻结的候选证据');facts(evidence,[['安全来源数',d.report_sources.length],['不同上报人',d.distinct_reporters],['不同科室',d.distinct_departments],['不同地点',d.distinct_locations],['最早观察',d.first_seen_at],['最近观察',d.last_seen_at],['规则窗口（毫秒）',d.correlation_window_ms],['原因代码',d.reason_codes.join('、')]]);
    const source=node('details');source.append(node('summary','查看安全 Decision、版本与 Evidence'));
    facts(source,[['P2-007 安全指纹',d.cluster_key_hash],['P2-015 Decision',d.source_decision?.result_code],['Decision 原因',d.source_decision?.reason_code],['Catalog 版本',d.source_decision?.catalog_version],['规则版本',d.source_decision?.rule_set_version],['引擎版本',d.source_decision?.engine_version],['策略版本',d.source_decision?.decision_policy_version],['安全 Evidence refs',d.evidence_fact_ids.join('、')||null],['安全 Source refs',d.source_decision?.source_refs.join('、')||null],['当前 Manual Review',d.manual_review?d.manual_review.status+' · '+d.manual_review.priority:'无关联 Manual Review']]);
    for(const r of d.report_sources){const item=node('p','来源：'+(r.ticket_no??'未建单上报')+' · 已关联 Journey/Intake/Ticket 安全引用');item.className='quiet';source.append(item);}evidence.append(source);
    if(manager&&d.status==='CANDIDATE')action(controls,'开始审核',root+'/start-review',{expected_row_version:d.row_version});
    if(manager&&['CANDIDATE','UNDER_REVIEW'].includes(d.status))action(controls,'拒绝候选',root+'/reject',{expected_row_version:d.row_version});
    if(manager&&d.status==='UNDER_REVIEW')action(controls,'确认公共故障',root+'/confirm',{expected_candidate_version:d.row_version},form=>{
      const scope=select(form,'确认影响范围',[['','请选择'],...(['LOCAL','BUILDING',...(admin?['CAMPUS','HOSPITAL_WIDE']:[])]).map(x=>[x,labels[x]])]);scope.required=true;scope.name='confirmed_scope';
      const owner=select(form,'明确选择负责人',[['','请选择'],...(d.eligible_owners??[{id:bootstrap.principal_id,display_name:bootstrap.display_name}]).map(o=>[o.id,o.display_name])]);owner.required=true;
      const chosen=[];for(const r of d.report_sources){const box=node('input');box.type='checkbox';box.value=r.source_decision_id;field(form,'关联 '+(r.ticket_no??'个人报修'),box);chosen.push(box);}
      const primary=select(form,'明确选择主参考工单（可为空）',[['','请选择'],['__NONE__','不设置主参考'],...d.report_sources.filter(r=>r.ticket_id).map(r=>[r.ticket_id,r.ticket_no??'个人工单'])]);
      primary.required=true;primary.name='primary_ticket_id';return ()=>{const selected=chosen.filter(x=>x.checked).map(x=>x.value);if(!selected.length)throw new Error('REPORT_REQUIRED');return ({confirmed_scope:scope.value,owner_principal_id:owner.value,primary_ticket_id:primary.value==='__NONE__'?null:primary.value,selected_report_refs:selected});};
    });
    return;
  }
  const reports=await childPage(root,'reports');if(turn!==generation)return;
  if(manager&&d.status.startsWith('CONFIRMED_'))action(controls,'开始调查处理',root+'/start-investigating',{expected_row_version:d.row_version});
  if(manager&&d.status==='INVESTIGATING')action(controls,'登记公共故障恢复',root+'/resolve',{expected_row_version:d.row_version});
  if(admin&&d.status==='RESOLVED')action(controls,'关闭公共故障',root+'/close',{expected_row_version:d.row_version});
  if(admin&&d.status!=='CLOSED')action(controls,'修正确认范围',root+'/correct-scope',{expected_row_version:d.row_version},form=>{const scope=select(form,'确认范围',[['','请选择'],...['LOCAL','BUILDING','CAMPUS','HOSPITAL_WIDE'].map(x=>[x,labels[x]])]);scope.required=true;scope.name='confirmed_scope';return ()=>({confirmed_scope:scope.value});});
  if(manager&&d.status!=='CLOSED')action(controls,'设置主参考工单',root+'/primary-ticket',{expected_row_version:d.row_version},form=>{const p=select(form,'内部主参考',[['','清除主参考'],...reports.items.filter(r=>r.link_state==='LINKED'&&r.ticket_id).map(r=>[r.ticket_id,r.ticket_no??'个人工单'])]);return ()=>({primary_ticket_id:p.value||null});});
  if(manager&&d.status!=='CLOSED'&&d.status!=='RESOLVED'){
    const linkable=await childPage(root,'linkable-reports');if(turn!==generation)return;
    action(controls,'关联个人报告',root+'/reports/link',{expected_row_version:d.row_version},form=>{const s=select(form,'明确选择个人工单',linkable.items.map(r=>[r.source_decision_id,r.ticket_no]));s.required=true;return ()=>({source_decision_id:s.value});});pager(controls,'linkable-reports',linkable);
  }
  const reportSection=section('个人上报与恢复');
  for(const r of reports.items){const box=node('div');box.className='delivery';facts(box,[['个人工单',r.ticket_no??'未建单上报'],['关联状态',r.link_state],['影响状态',r.impact_state]]);
    if(r.link_state==='LINKED'&&d.status!=='CLOSED'){
      action(box,'记录该上报人已恢复',root+'/reports/'+r.id+'/mark-recovered',{expected_row_version:d.row_version,expected_report_version:r.row_version});
      if(manager)action(box,'解除错误关联',root+'/reports/'+r.id+'/unlink',{expected_row_version:d.row_version,expected_report_version:r.row_version});
    }reportSection.append(box);
  }
  pager(reportSection,'reports',reports);
  if(manager){const [subs,notices]=await Promise.all([childPage(root,'subscriptions'),childPage(root,'notifications')]);if(turn!==generation)return;
    const subSection=section('个人通知订阅');for(const [i,s] of subs.items.entries()){
      const box=node('div');box.className='delivery';facts(box,[['订阅',i+1],['状态',s.status],['个人影响',s.impact_state]]);
      if(admin&&d.status!=='CLOSED'&&s.status!=='ENDED')action(box,s.status==='ACTIVE'?'暂停通知':'恢复通知',root+'/subscriptions/'+s.id+'/'+(s.status==='ACTIVE'?'pause':'resume'),{expected_row_version:d.row_version,expected_subscription_version:s.row_version},['PENDING_DESTINATION','PAUSED'].includes(s.status)?async form=>{const destinations=await api(root+'/subscriptions/'+s.id+'/direct-destinations?limit=100');const direct=select(form,'选择已验证的本人单聊报修渠道',destinations.items.filter(x=>x.subscription_id===s.id).map(x=>[x.id,x.source_intake_no]));direct.required=true;return ()=>({direct_channel_leg_id:direct.value});}:null);
      subSection.append(box);
    }
    pager(subSection,'subscriptions',subs);
    const noticeSection=section('可靠通知');for(const n of notices.items)noticeSection.append(node('p',(n.audience_type==='GROUP'?'群公共通知':'个人订阅通知')+' · '+(labels[n.status]??n.status)+(n.status==='RECONCILIATION_REQUIRED'?' · 需管理员核对，禁止盲目重发':'')));pager(noticeSection,'notifications',notices);
  }
  const events=await childPage(root,'events');if(turn!==generation)return;const history=section('追加式事件');for(const e of events.items)history.append(node('p',e.event_type+' · '+e.occurred_at));pager(history,'events',events);
}
async function refresh(append=false){if(stopped||busy||editing||loading)return;loading=true;const turn=generation;
  try{const p=new URLSearchParams({limit:'30'});if(mode!=='candidates')p.set('state',mode==='active'?'ACTIVE':'FINISHED');if(append&&next)p.set('cursor',next);
    const page=await api(base()+'?'+p);if(turn!==generation)return;items=(append?[...items,...page.items]:page.items).slice(-100);next=page.next_cursor;$('list').replaceChildren();
    for(const r of items){const li=node('li'),b=button('',async()=>{if(busy)return;selected=r.id;childCursors={};generation++;remember();await refresh();});b.append(node('strong',r.incident_no??(r.service_family+' · '+r.symptom_family)),node('small',(labels[r.status]??r.status)+' · '+(mode==='candidates'?[(labels[r.scope_candidate]??r.scope_candidate),(labels[r.clinical_severity_candidate]??r.clinical_severity_candidate),'上报人 '+(r.distinct_reporters??'未提供'),'科室 '+(r.distinct_departments??'未提供'),'地点 '+(r.distinct_locations??'未提供'),'最早 '+(r.first_seen_at??'未提供'),'最近 '+(r.last_seen_at??'未提供'),'原因 '+(r.reason_codes?.join('、')||'未提供')].join(' · '):r.created_at)));li.append(b);$('list').append(li);}$('more').hidden=!next;
  if(selected&&!stopped&&!editing)await detail();
  }catch(e){if(e.status!==401)say('暂时无法加载，请检查访问状态。');}finally{loading=false;}
}
for(const id of ['candidates','active','finished'])$(id).onclick=()=>{if(busy)return;mode=id;selected=null;childCursors={};editing=false;generation++;remember();$('detail').replaceChildren();$('queue-title').textContent=$(id).textContent;void refresh();};
$('refresh').onclick=()=>{editing=false;void refresh();};$('more').onclick=()=>void refresh(true);$('retry').onclick=()=>retry&&execute(retry.path,retry.body,retry.id);
window.addEventListener('pagehide',()=>{stopped=true;stream?.close();clearInterval(timer);for(const c of controllers)c.abort();});
try{const saved=new URLSearchParams(location.hash.slice(1));if(['candidates','active','finished'].includes(saved.get('mode')))mode=saved.get('mode');if(/^[a-f0-9-]{36}$/iu.test(saved.get('selected')??''))selected=saved.get('selected');
  $('queue-title').textContent=$(mode).textContent;
  bootstrap=await api('/api/lifecycle/bootstrap');$('agent').textContent=bootstrap.display_name;await refresh();
  if(!stopped){stream=new EventSource('/api/realtime/events');stream.onopen=()=>$('connection').textContent='实时连接';stream.onerror=()=>$('connection').textContent='5 秒轮询恢复';
    for(const e of ['incident.candidate.expired','incident.candidate.confirmed','incident.primary_ticket.changed','incident.candidate.review_started','incident.candidate.rejected','incident.confirmed','incident.status.changed','incident.scope.changed','incident.report.linked','incident.report.unlinked','incident.report.recovered','incident.subscription.changed','incident.notification.changed'])stream.addEventListener(e,()=>void refresh());
    timer=setInterval(()=>{if(!document.hidden)void refresh();},5000);say('所有共享故障操作均需人工确认。');}
}catch{if(!stopped)say('Incident 工作台尚未启用或访问不可用。');}
