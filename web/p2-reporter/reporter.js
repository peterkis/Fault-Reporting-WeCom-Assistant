const el=id=>document.getElementById(id);
const member=document.documentElement.dataset.identityMode==='MEMBER_REQUIRED';
let ref=null,cursor=null,etag=null,timer=null,stopped=false,busy=false,generation=0,controller=null,channel=null;
const valid=g=>g===generation&&!stopped;
function line(tag,text){const node=document.createElement(tag);node.textContent=text;return node;}
function clearView(){
  el('ticket').hidden=true;for(const id of ['title','number','state','times','timeline'])el(id).replaceChildren();
  document.getElementById('incident-milestones')?.remove();cursor=null;etag=null;el('more').hidden=true;
}
function cancel(stop=true){generation++;stopped=stop;clearInterval(timer);controller?.abort();clearView();}
function statusError(status){
  if(status===401)return member?'认证已失效，请重新认证。':'访问已失效，请重新点击企业微信中的最新通知。';
  if(status===403||status===404)return '您无权查看此工单，或工单已不可用。';
  return '服务暂时不可用，请稍后刷新重试。';
}
async function request(path,options={},signal=controller?.signal){
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',signal,...options});
  if(response.status===304)return null;
  if(!response.ok)throw Object.assign(new Error(statusError(response.status)),{status:response.status});
  return {body:await response.json(),etag:response.headers.get('etag')};
}
function failed(error,g){
  if(!valid(g)||error.name==='AbortError')return;
  el('status').textContent=error.status?error.message:'网络暂不可用，请稍后刷新重试。';
  if([401,403,404].includes(error.status)){clearView();stopped=true;clearInterval(timer);el('reauth').hidden=!member;}
}
function schedule(){clearInterval(timer);if(!stopped&&!document.hidden&&ref)timer=setInterval(refresh,5000);}
function renderTimeline(body,append=false){
  if(!append)el('timeline').replaceChildren();
  for(const item of body.items){const li=line('li',item.text);li.append(line('time',item.occurred_at));el('timeline').append(li);}
  while(el('timeline').children.length>100)el('timeline').firstElementChild.remove();
  cursor=body.next_cursor;el('more').hidden=!cursor;
}
function renderDetail(t){
  el('title').textContent=t.title;el('number').textContent=t.ticket_no+' · 尾号 '+t.suffix;el('state').textContent=t.external_status;
  el('times').replaceChildren(line('dt','上报时间'),line('dd',t.created_at),line('dt','最近更新'),line('dd',t.updated_at));
  document.getElementById('incident-milestones')?.remove();
  if(t.incident_milestones?.length){const section=line('section','');section.id='incident-milestones';section.append(line('h3','关联公共故障'));
    for(const item of t.incident_milestones)section.append(line('p',item.text),line('time',item.occurred_at));el('timeline').after(section);}
}
async function refresh(){
  if(busy||stopped||document.hidden||!ref)return;busy=true;controller=new AbortController();const g=generation,currentRef=ref;
  el('refresh').disabled=true;
  try{
    const result=await request('/api/reporter/tickets/'+currentRef,{headers:etag?{'If-None-Match':etag}:{}});
    if(!valid(g))return;
    if(result){
      if(result.body.public_ref&&result.body.public_ref!==currentRef)throw Object.assign(new Error(statusError(404)),{status:404});
      const timeline=await request('/api/reporter/tickets/'+currentRef+'/timeline');
      if(!valid(g))return;
      renderDetail(result.body);renderTimeline(timeline.body);etag=result.etag;
    }
    el('status').textContent=member?'已核验工单归属；页面每 5 秒检查进度。':'已验证绑定访问会话；页面每 5 秒检查进度。';
    if(!el('timeline').children.length)el('status').textContent+=' 暂无处理记录。';
    el('ticket').hidden=false;el('reauth').hidden=true;
  }catch(error){failed(error,g);}finally{busy=false;el('refresh').disabled=false;schedule();}
}
el('more').addEventListener('click',async()=>{
  if(busy||stopped||!cursor)return;busy=true;controller=new AbortController();const g=generation;el('more').disabled=true;
  try{const result=await request('/api/reporter/tickets/'+ref+'/timeline?cursor='+encodeURIComponent(cursor));if(valid(g))renderTimeline(result.body,true);}
  catch(error){failed(error,g);}finally{busy=false;el('more').disabled=false;schedule();}
});
el('refresh').addEventListener('click',()=>{if(!ref||busy)return;stopped=false;void refresh();});
el('logout').addEventListener('click',async()=>{
  cancel();channel?.postMessage('revalidate');el('status').textContent='正在退出…';
  try{await request('/api/reporter/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},null);el('status').textContent='已退出访问。';}
  catch{el('status').textContent='退出尚未确认，请恢复网络后重试。';}
  el('reauth').hidden=!member;
});
function connectChannel(){
  if(member&&typeof BroadcastChannel==='function'&&!channel){channel=new BroadcastChannel('yixiaoxiu-auth');channel.onmessage=()=>{
    cancel(false);el('status').textContent='正在重新验证访问…';schedule();
  };}
}
async function initialize({fragment=true}={}){
  cancel(false);controller=new AbortController();const g=generation;connectChannel();
  try{
    let grant=fragment?new URLSearchParams(location.hash.slice(1)).get('grant'):null;
    history.replaceState(null,'',member?location.pathname:'/reporter/');
    if(member){
      const match=/^\/wecom\/yixiaoxiu\/tickets\/([A-Za-z0-9_-]{32})$/u.exec(location.pathname);ref=match?.[1]??null;
      el('reauth').href=ref?'/wecom/yixiaoxiu/tickets/'+ref:'/wecom/yixiaoxiu/login';
      if(grant){
        let result;try{result=await request('/api/reporter/member-entry/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant})});}finally{grant=null;}
        if(valid(g)&&/^\/wecom\/yixiaoxiu\/continue\/[a-f0-9]{64}$/u.test(result.body.entry_path)){location.assign(result.body.entry_path);return;}
        throw new Error('入口已失效，请重新点击原工单卡片。');
      }
      if(!ref){el('status').textContent='请从机器人发给您的工单卡片进入。';return;}
      await request('/api/reporter/member/session');
    }else{
      if(grant){try{await request('/api/reporter/access/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant})});}finally{grant=null;}}
      const bootstrap=await request('/api/reporter/bootstrap');if(!valid(g))return;ref=bootstrap.body.public_ref;
    }
    if(!valid(g))return;el('status').textContent='正在加载处理进度…';channel?.postMessage('revalidate');await refresh();schedule();
  }catch(error){failed(error,g);}
}
window.addEventListener('pagehide',()=>{cancel();channel?.close();channel=null;});
window.addEventListener('pageshow',event=>{if(event.persisted)void initialize({fragment:false});});
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancel(stopped);}else if(!stopped){void refresh();schedule();}});
void initialize();
