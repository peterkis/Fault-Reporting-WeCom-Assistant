const el=id=>document.getElementById(id);
let ref=null,cursor=null,etag=null,timer=null,stopped=false,busy=false;
async function request(path,options={}){
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
  if(response.status===304)return null;
  if(!response.ok){const error=new Error(response.status===401?'访问已失效，请重新点击企业微信中的最新通知。':'暂时无法加载，将在 5 秒后重试。');error.status=response.status;throw error;}
  return {body:await response.json(),etag:response.headers.get('etag')};
}
function line(tag,text){const node=document.createElement(tag);node.textContent=text;return node;}
async function loadTimeline(append=false){
  const suffix=append&&cursor?'?cursor='+encodeURIComponent(cursor):'';
  const result=await request('/api/reporter/tickets/'+ref+'/timeline'+suffix);
  if(!append)el('timeline').replaceChildren();
  for(const item of result.body.items){const li=line('li',item.text);li.append(line('time',item.occurred_at));el('timeline').append(li);}
  while(el('timeline').children.length>100)el('timeline').firstElementChild.remove();
  cursor=result.body.next_cursor;el('more').hidden=!cursor;
}
async function refresh(){
  if(busy||stopped||document.hidden)return;busy=true;
  try{
    const result=await request('/api/reporter/tickets/'+ref,{headers:etag?{'If-None-Match':etag}:{}});
    if(result){const t=result.body;el('title').textContent=t.title;el('number').textContent=t.ticket_no+' · 尾号 '+t.suffix;
      el('state').textContent=t.external_status;el('times').replaceChildren(line('dt','上报时间'),line('dd',t.created_at),line('dt','最近更新'),line('dd',t.updated_at));await loadTimeline();
      document.getElementById('incident-milestones')?.remove();
      if(t.incident_milestones?.length){const section=line('section','');section.id='incident-milestones';section.append(line('h3','关联公共故障'));for(const item of t.incident_milestones){section.append(line('p',item.text),line('time',item.occurred_at));}el('timeline').after(section);}
      etag=result.etag;
    }
    el('status').textContent='已验证绑定访问会话；页面每 5 秒检查进度。';el('ticket').hidden=false;
  }catch(error){el('status').textContent=error.status?error.message:'网络暂不可用，将在 5 秒后重试。';
    if(error.status===401){el('ticket').hidden=true;stopped=true;clearInterval(timer);}}
  finally{busy=false;}
}
el('more').addEventListener('click',async()=>{if(busy)return;busy=true;el('more').disabled=true;try{await loadTimeline(true);}catch(error){el('status').textContent=error.message;}finally{busy=false;el('more').disabled=false;}});
el('logout').addEventListener('click',async()=>{try{await request('/api/reporter/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  stopped=true;clearInterval(timer);el('ticket').hidden=true;el('status').textContent='已退出访问。';
}catch{el('status').textContent='退出尚未确认，请恢复网络后重试。';}});
window.addEventListener('pagehide',()=>{stopped=true;clearInterval(timer);});
try{
  let grant=new URLSearchParams(location.hash.slice(1)).get('grant');
  history.replaceState(null,'','/reporter/');
  if(grant){try{await request('/api/reporter/access/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant})});}finally{grant=null;}}
  const bootstrap=await request('/api/reporter/bootstrap');ref=bootstrap.body.public_ref;
  await refresh();if(!stopped)timer=setInterval(refresh,5000);
}catch(error){el('status').textContent=error.message;el('ticket').hidden=true;}
