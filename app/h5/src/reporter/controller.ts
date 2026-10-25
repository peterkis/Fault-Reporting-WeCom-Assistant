import type {ReporterEntry} from './entry';

type Json=Record<string,unknown>;
type Translator=(key:string)=>string;
class ReporterError extends Error{constructor(readonly status:number){super('Reporter request failed');}}
function object(value:unknown):Json{if(value===null||typeof value!=='object'||Array.isArray(value))throw new ReporterError(502);return value as Json;}
function text(value:unknown,maximum=4000):string{if(typeof value!=='string'||value.length>maximum)throw new ReporterError(502);return value;}
function element<T extends HTMLElement>(id:string,kind:{new():T}):T{const value=document.getElementById(id);if(!(value instanceof kind))throw new Error('Missing Reporter view');return value;}
function line(tag:'li'|'p'|'time'|'dt'|'dd'|'section'|'h3',content:string):HTMLElement{const node=document.createElement(tag);node.textContent=content;return node;}
function timeline(value:unknown):{items:{text:string;occurred_at:string}[];next_cursor:string|null}{
 const raw=object(value);if(!Array.isArray(raw.items)||raw.items.length>100||raw.next_cursor!==null&&typeof raw.next_cursor!=='string')throw new ReporterError(502);
 return{items:raw.items.map(value=>{const item=object(value);return{text:text(item.text),occurred_at:text(item.occurred_at,32)};}),next_cursor:raw.next_cursor};
}
function detail(value:unknown,ref:string):Json{
 const raw=object(value);if(raw.public_ref!==ref)throw new ReporterError(404);
 for(const field of ['ticket_no','suffix','title','external_status','created_at','updated_at','guidance'])text(raw[field]);
 if(!Number.isSafeInteger(raw.version)||Number(raw.version)<1)throw new ReporterError(502);
 if(raw.incident_milestones!==undefined){if(!Array.isArray(raw.incident_milestones)||raw.incident_milestones.length>100)throw new ReporterError(502);for(const value of raw.incident_milestones){const item=object(value);text(item.text);text(item.occurred_at,32);}}
 return raw;
}

/** Display lifecycle only. All identity, ownership and feedback decisions stay
 * with the existing Reporter APIs; this never calls the Web request APIs. */
export function mountReporterController(entry:ReporterEntry,t:Translator):()=>void {
 const ticket=element('ticket',HTMLElement),status=element('status',HTMLElement),items=element('timeline',HTMLOListElement),refreshButton=element('refresh',HTMLButtonElement),more=element('more',HTMLButtonElement),reauth=element('reauth',HTMLAnchorElement),logoutButton=element('logout',HTMLButtonElement);
 const member=entry.identityMode==='MEMBER_REQUIRED';
 if(!member)history.replaceState(null,'','/reporter/');
 let ref=entry.publicRef,cursor:string|null=null,etag:string|null=null,timer:ReturnType<typeof setInterval>|undefined,stopped=false,busy=false,generation=0,controller:AbortController|null=null,channel:BroadcastChannel|null=null,logoutRequested=false,disposed=false;
 const valid=(g:number)=>!disposed&&g===generation&&!stopped;
 const clearView=()=>{ticket.hidden=true;for(const id of ['title','number','state','times','timeline'])element(id,HTMLElement).replaceChildren();document.getElementById('incident-milestones')?.remove();cursor=null;etag=null;more.hidden=true;};
 const cancel=(stop=true)=>{generation++;stopped=stop;busy=false;clearInterval(timer);controller?.abort();clearView();};
 function statusError(code:number){return t(code===401?(member?'reporterAuthExpired':'reporterAccessExpired'):code===403||code===404?'reporterDenied':'reporterRetry');}
 async function request(path:string,options:RequestInit={},signal:AbortSignal|null=controller?.signal??null):Promise<{body:unknown;etag:string|null}|null>{
  const response=await fetch(path,{...options,credentials:'same-origin',cache:'no-store',redirect:'error',signal});
  if(response.status===304)return null;if(!response.ok)throw new ReporterError(response.status);
  return{body:await response.json(),etag:response.headers.get('etag')};
 }
 function failed(error:unknown,g:number){
  if(!valid(g)||error instanceof DOMException&&error.name==='AbortError')return;
  const code=error instanceof ReporterError?error.status:0;status.textContent=code?statusError(code):t('networkError');
  if([401,403,404].includes(code)){clearView();stopped=true;clearInterval(timer);reauth.hidden=!member;document.dispatchEvent(new Event('reporter-access-lost'));}
 }
 function schedule(){clearInterval(timer);if(!stopped&&!disposed&&!document.hidden&&ref)timer=setInterval(refresh,5000);}
 function renderTimeline(value:ReturnType<typeof timeline>,append=false){
  if(!append)items.replaceChildren();
  for(const item of value.items){const row=line('li','');row.className='reporter-timeline-item';row.append(line('p',item.text),line('time',item.occurred_at));items.append(row);}
  while(items.children.length>100)items.firstElementChild?.remove();cursor=value.next_cursor;more.disabled=false;more.hidden=!cursor;
 }
 function renderDetail(value:Json){
  element('title',HTMLElement).textContent=text(value.title);element('number',HTMLElement).textContent=text(value.ticket_no)+' · '+text(value.suffix);element('state',HTMLElement).textContent=text(value.external_status);
  element('times',HTMLElement).replaceChildren(line('dt',t('created')),line('dd',text(value.created_at)),line('dt',t('reporterUpdated')),line('dd',text(value.updated_at)));
  element('reporter-guidance',HTMLElement).textContent=text(value.guidance);
  document.getElementById('incident-milestones')?.remove();
  if(Array.isArray(value.incident_milestones)&&value.incident_milestones.length){const section=line('section','');section.id='incident-milestones';section.className='reporter-milestones';section.append(line('h3',t('reporterIncident')));for(const raw of value.incident_milestones){const item=object(raw);section.append(line('p',text(item.text)),line('time',text(item.occurred_at)));}items.after(section);}
 }
 async function refresh(){
  if(busy||stopped||disposed||document.hidden||!ref)return;busy=true;controller=new AbortController();const g=generation,currentRef=ref;refreshButton.disabled=true;
  try{
   const result=await request('/api/reporter/tickets/'+currentRef,{headers:etag?{'If-None-Match':etag}:{}});if(!valid(g))return;
   if(result){const current=detail(result.body,currentRef),history=await request('/api/reporter/tickets/'+currentRef+'/timeline');if(!valid(g)||!history)return;const rows=timeline(history.body);renderDetail(current);renderTimeline(rows);etag=result.etag;}
   status.textContent=t(member?'reporterMemberVerified':'reporterGrantVerified')+(items.children.length?'':' '+t('noProgress'));ticket.hidden=false;reauth.hidden=true;
  }catch(error){failed(error,g);}finally{if(g===generation&&!disposed){busy=false;refreshButton.disabled=false;schedule();}}
 }
 async function moreHistory(){
  if(busy||stopped||disposed||!cursor||!ref)return;busy=true;controller=new AbortController();const g=generation;more.disabled=true;
  try{const result=await request('/api/reporter/tickets/'+ref+'/timeline?cursor='+encodeURIComponent(cursor));if(valid(g)&&result)renderTimeline(timeline(result.body),true);}catch(error){failed(error,g);}finally{if(g===generation&&!disposed){busy=false;more.disabled=false;schedule();}}
 }
 async function logout(){
  logoutRequested=true;cancel();channel?.postMessage('reporter-logout');status.textContent=t('reporterLoggingOut');document.dispatchEvent(new Event('reporter-logout'));
  try{await request('/api/reporter/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},null);if(!disposed)status.textContent=t('reporterLoggedOut');}
  catch{if(!disposed)status.textContent=t('reporterLogoutUnknown');}reauth.hidden=!member;
 }
 async function initialize(withGrant=true,announce=true){
  if(logoutRequested||disposed)return;cancel(false);controller=new AbortController();const g=generation;
  try{
   let grant=withGrant?entry.consumeGrant():null;
   if(member){
    reauth.href=ref?'/wecom/yixiaoxiu/tickets/'+ref:'/wecom/yixiaoxiu/login';
    if(grant){let prepared;try{prepared=await request('/api/reporter/member-entry/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant})});}finally{grant=null;}
     const path=prepared&&object(prepared.body).entry_path;if(valid(g)&&typeof path==='string'&&/^\/wecom\/yixiaoxiu\/continue\/[a-f0-9]{64}$/u.test(path)){location.assign(path);return;}throw new ReporterError(404);}
    if(!ref){status.textContent=t('reporterOpenCard');return;}await request('/api/reporter/member/session');
   }else{
    if(grant){try{await request('/api/reporter/access/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant})});}finally{grant=null;}}
    const result=await request('/api/reporter/bootstrap');if(!valid(g)||!result)return;const selected=object(result.body).public_ref;if(typeof selected!=='string'||!/^[A-Za-z0-9_-]{32}$/u.test(selected))throw new ReporterError(502);ref=selected;
   }
   if(!valid(g))return;status.textContent=t('reporterLoading');if(announce)channel?.postMessage('revalidate');await refresh();schedule();
  }catch(error){failed(error,g);}
 }
 function connect(){if(channel||!member||typeof BroadcastChannel!=='function'||logoutRequested||disposed)return;channel=new BroadcastChannel('yixiaoxiu-auth');channel.onmessage=event=>{if(logoutRequested||disposed)return;if(event.data==='reporter-logout'||event.data==='bot-feedback-logout'){logoutRequested=true;cancel();status.textContent=t('reporterLoggedOut');document.dispatchEvent(new Event('reporter-access-lost'));return;}if(event.data!=='revalidate')return;cancel(false);status.textContent=t('reporterRevalidating');void initialize(false,false);};}
 connect();
 const onRefresh=()=>{if(!ref||busy||logoutRequested)return;stopped=false;void refresh();};
 const onMore=()=>void moreHistory(),onLogout=()=>void logout(),onHidden=()=>{if(document.hidden)cancel(stopped);else if(!stopped){void refresh();schedule();}},onPageHide=()=>{cancel();channel?.close();channel=null;},onPageShow=(event:PageTransitionEvent)=>{if(event.persisted&&!logoutRequested&&!disposed){connect();void initialize(false);}};
 refreshButton.addEventListener('click',onRefresh);more.addEventListener('click',onMore);logoutButton.addEventListener('click',onLogout);document.addEventListener('visibilitychange',onHidden);window.addEventListener('pagehide',onPageHide);window.addEventListener('pageshow',onPageShow);
 void initialize();
 return()=>{disposed=true;cancel();channel?.close();refreshButton.removeEventListener('click',onRefresh);more.removeEventListener('click',onMore);logoutButton.removeEventListener('click',onLogout);document.removeEventListener('visibilitychange',onHidden);window.removeEventListener('pagehide',onPageHide);window.removeEventListener('pageshow',onPageShow);};
}
