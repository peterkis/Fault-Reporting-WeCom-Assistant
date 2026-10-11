// Independent member capability; the existing Reporter page owns progress display.
import {openDraft,saveDraft,settleDraft,removeSensitiveDraft,hasExistingDraft,subscribeDrafts,matchesDraft} from './features/drafts/encrypted-drafts';
import type {DraftHandle,DraftScope} from './features/drafts/encrypted-drafts';
const ref=/^\/wecom\/yixiaoxiu\/tickets\/([A-Za-z0-9_-]{32})$/u.exec(location.pathname)?.[1];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
interface Context{completed_round_ref:string;completed_round_no:number;ticket_version:number}
interface Command{schema_version:1;client_command_id:string;feedback:'STILL_UNRESOLVED';completed_round_ref:string;expected_ticket_version:number}
interface Pending{command:Command|null;commandId:string;ticketNo:string;round:number|null}
interface Journal{scope:DraftScope;handle:DraftHandle;unsubscribe:()=>void}
class HttpError extends Error{constructor(readonly status:number){super(String(status));}}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_RESPONSE');return value as Record<string,unknown>;}
function exact(value:Record<string,unknown>,keys:string[]){if(Object.keys(value).sort().join(',')!==keys.sort().join(','))throw Error('INVALID_RESPONSE');}
function integer(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<=2147483647;}
function eligible(detail:Record<string,unknown>):Context|null{
 if(detail.public_ref!==ref)throw Error('INVALID_RESPONSE');const c=object(detail.feedback_context);
 exact(c,['schema_version','can_feedback','completed_round_ref','completed_round_no','ticket_version','rejection']);
 if(c.schema_version!==1||c.can_feedback!==true)return null;
 if(c.rejection!==null||typeof c.completed_round_ref!=='string'||!/^[A-Za-z0-9_-]{32}$/u.test(c.completed_round_ref)||!integer(c.completed_round_no)||!integer(c.ticket_version)||c.ticket_version!==detail.version)throw Error('INVALID_RESPONSE');
 return {completed_round_ref:c.completed_round_ref,completed_round_no:c.completed_round_no,ticket_version:c.ticket_version};
}
if(ref&&document.documentElement.dataset.identityMode==='MEMBER_REQUIRED'){
 const publicRef=ref,path='/api/reporter/tickets/'+publicRef,section=document.createElement('section'),message=document.createElement('p'),controls=document.createElement('div');
 section.id='bot-feedback-panel';message.dataset.feedbackState='';message.setAttribute('role','status');section.hidden=true;section.append(message,controls);document.querySelector('#ticket')?.append(section);
 let context:Context|null=null,detail:Record<string,unknown>|null=null,csrf:string|null=null,pending:Pending|null=null,busy=false,stopped=false,generation=0,controller:AbortController|null=null,journal:Journal|null=null,rawEnabled=false,expiry:ReturnType<typeof setTimeout>|undefined,settling=false;
 const opaque=(p:Pending):Pending=>({...p,command:null,round:null});
 async function request(url:string,options:RequestInit={}):Promise<Record<string,unknown>>{
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:controller?.signal??null,...options});if(!response.ok)throw new HttpError(response.status);return object(await response.json());
 }
 function render(){
  section.hidden=stopped||document.hidden||!context&&!pending&&!message.textContent;controls.replaceChildren();
  if(context){const button=document.createElement('button');button.type='button';button.textContent='仍未解决，重开此工单';button.dataset.action='submit-bot-feedback';button.disabled=busy||Boolean(pending)||!csrf;button.onclick=()=>void submit();controls.append(button);}
  if(pending){const button=document.createElement('button');button.type='button';button.textContent='只读核对原反馈操作';button.dataset.action='check-bot-feedback-command';button.disabled=busy;button.onclick=()=>void check();controls.append(button);}
 }
 function committed(raw:unknown,p:Pending){
  const value=object(raw);exact(value,['ok','replayed','public_ref','completed_round_ref','reopened_round_no','ticket']);const ticket=object(value.ticket);exact(ticket,['ticket_no','status','version']);
  if(value.ok!==true||typeof value.replayed!=='boolean'||value.public_ref!==publicRef||typeof value.completed_round_ref!=='string'||!/^[A-Za-z0-9_-]{32}$/u.test(value.completed_round_ref)||!integer(value.reopened_round_no)||value.reopened_round_no<2||ticket.ticket_no!==p.ticketNo||ticket.status!=='REOPENED'||!integer(ticket.version)||ticket.version<2)throw Error('INVALID_RESPONSE');
  if(p.command&&(value.completed_round_ref!==p.command.completed_round_ref||value.reopened_round_no!==(p.round??0)+1||ticket.version!==p.command.expected_ticket_version+1))throw Error('INVALID_RESPONSE');
 }
 async function strip(reason:'expired'|'revoked'|'logout'='revoked'){
  clearTimeout(expiry);if(pending)pending=opaque(pending);const current=journal;if(current?.handle.record)await removeSensitiveDraft(current.handle,reason);
 }
 function armExpiry(){
  clearTimeout(expiry);const saved=journal?.handle.record;if(!saved)return;
  expiry=setTimeout(()=>{void strip('expired').then(()=>{message.textContent='恢复副本已到期；原反馈仍须只读核对，不会再次发送。';render();}).catch(()=>{message.textContent='恢复副本清理未确认；只读核对原结果。';render();});},Math.max(0,saved.expiresAt-Date.now()));
 }
 async function restore(current:Record<string,unknown>,g:number){
  const bootstrap=await request('/api/yixiaoxiu/bootstrap');if(g!==generation)return;
  if(bootstrap.authenticated!==true||bootstrap.identity_mode!=='MEMBER_SELF_SERVICE'||typeof bootstrap.recovery_scope!=='string'||!/^[a-f0-9]{64}$/u.test(bootstrap.recovery_scope)||typeof current.ticket_no!=='string')throw Error('INVALID_RESPONSE');
  rawEnabled=bootstrap.feedback_draft_recovery_enabled===true;
  const scope:DraftScope={principal:bootstrap.recovery_scope,kind:'web-feedback',id:publicRef,purpose:'bot-reporter-feedback'};
  // The storage kind denotes browser feedback. Bot source, ref and purpose are
  // independent; this never reads Web request data or grants Ticket authority.
  if(!rawEnabled&&!await hasExistingDraft(scope))return;
  const copy=await openDraft(scope,{restore:false});if(g!==generation)return;
  if(journal&&(journal.scope.principal!==scope.principal||journal.scope.id!==scope.id)){journal.unsubscribe();journal=null;pending=null;}
  if(!journal){const next:Journal={scope,handle:copy.handle,unsubscribe:()=>{}};journal=next;next.unsubscribe=subscribeDrafts(event=>{
   if(journal!==next||!matchesDraft(event,scope)||settling)return;
   if(pending)pending=opaque(pending);
   if(event.reason==='logout'||event.reason==='logout-unknown'||event.reason==='revoked'){generation++;controller?.abort();stopped=true;context=null;csrf=null;busy=false;}
   message.textContent='敏感恢复副本已清理；原反馈仍须当前权限下只读核对。';render();
  });}else journal.handle=copy.handle;
  if(copy.handle.operation){pending={command:null,commandId:copy.handle.operation.commandId,ticketNo:current.ticket_no,round:null};message.textContent=copy.expired?'恢复副本已过期；原操作仍待只读核对。':'已恢复原反馈操作；只读核对，不会再次发送。';}
  if(!rawEnabled||!context)await strip('expired');else armExpiry();
 }
 async function settle(id:string){
  const current=journal;if(!current)return;settling=true;try{await settleDraft(current.handle,id,current.handle.record?.revision);if(current.handle.operation?.commandId===id)throw Error('CLEANUP_UNCONFIRMED');clearTimeout(expiry);}finally{settling=false;}
 }
 async function load(){
  if(busy||stopped||document.hidden)return;busy=true;const g=generation;controller=new AbortController();
  try{const [current,bootstrap]=await Promise.all([request(path),request('/api/reporter/feedback/bootstrap')]);if(g!==generation)return;
   exact(bootstrap,['schema_version','write_enabled','csrf_token']);if(bootstrap.schema_version!==1||typeof bootstrap.write_enabled!=='boolean'||bootstrap.csrf_token!==null&&(typeof bootstrap.csrf_token!=='string'||!/^[a-f0-9]{64}$/u.test(bootstrap.csrf_token)))throw Error('INVALID_RESPONSE');
   detail=current;context=Object.hasOwn(current,'feedback_context')?eligible(current):null;csrf=bootstrap.write_enabled&&typeof bootstrap.csrf_token==='string'?bootstrap.csrf_token:null;
   const hint=document.querySelector('#ticket .hint'),header=document.querySelector('header span');if(context){if(hint)hint.textContent='同一故障仍未解决时，可明确提交反馈；新故障请另行报修。';if(header)header.textContent='上海时间 · 本人进度与明确反馈';}else if(header)header.textContent='上海时间 · 只读进度';
   await restore(current,g);
  }catch(error){context=null;csrf=null;if(error instanceof HttpError&&[401,403,404].includes(error.status)){stopped=true;await strip();message.textContent='当前访问权限需重新核验；原操作不会再次发送。';}}
  finally{if(g===generation){busy=false;render();}}
 }
 async function submit(){
  if(busy||stopped||document.hidden||pending||!context||!csrf||!detail||typeof detail.ticket_no!=='string')return;
  const id=crypto.randomUUID(),p:Pending={ticketNo:detail.ticket_no,round:context.completed_round_no,commandId:id,command:{schema_version:1,client_command_id:id,feedback:'STILL_UNRESOLVED',completed_round_ref:context.completed_round_ref,expected_ticket_version:context.ticket_version}};
  const command=p.command;if(!command)return;pending=p;busy=true;const g=generation;controller=new AbortController();message.textContent='正在提交本轮未解决反馈…';render();
  try{if(rawEnabled){if(!journal)throw Error('RECOVERY_UNAVAILABLE');await saveDraft(journal.handle,JSON.stringify({schema:1,public_ref:publicRef,pending:p}),{commandId:id});armExpiry();}if(g!==generation)return;
   const result=await request(path+'/feedback',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':id,'if-match':'"'+command.expected_ticket_version+'"'},body:JSON.stringify(command)});if(g!==generation)return;committed(result,p);await settle(id);if(g!==generation)return;
   pending=null;context=null;message.textContent='已重开原工单，本轮等待工作人员重新承接。';document.querySelector<HTMLButtonElement>('#refresh')?.click();
  }catch(error){if(g!==generation)return;message.textContent='结果未知：保留原操作，只读核对，不会再次发送。';if(error instanceof HttpError&&[401,403,404].includes(error.status))await strip();}
  finally{if(g===generation){busy=false;render();}}
 }
 async function check(){
  const p=pending;if(!p||!UUID.test(p.commandId)||busy||stopped||document.hidden)return;busy=true;const g=generation;controller=new AbortController();render();
  try{const receipt=await request(path+'/feedback/commands/'+p.commandId);if(g!==generation)return;
   if(receipt.public_ref!==publicRef||receipt.client_command_id!==p.commandId)throw Error('INVALID_RESPONSE');
   if(receipt.state==='UNKNOWN'){exact(receipt,['client_command_id','public_ref','state']);message.textContent='结果未知：尚无可确认终态，保留原操作，不会再次发送。';}
   else{exact(receipt,['client_command_id','public_ref','state','result']);if(receipt.state!=='COMMITTED'||object(receipt.result).replayed!==true)throw Error('INVALID_RESPONSE');committed(receipt.result,p);await settle(p.commandId);if(g!==generation)return;pending=null;context=null;message.textContent='已核对：原反馈已重开同一工单。';document.querySelector<HTMLButtonElement>('#refresh')?.click();}
  }catch(error){if(g===generation){message.textContent='结果未知：只读核对尚未完成，不会再次发送。';if(error instanceof HttpError&&[401,403,404].includes(error.status)){await strip();stopped=true;context=null;csrf=null;}}}finally{if(g===generation){busy=false;render();}}
 }
 function clear(logout=false){generation++;stopped=true;controller?.abort();if(pending)pending=opaque(pending);context=null;csrf=null;busy=false;message.textContent='';render();if(logout)void strip('logout').catch(()=>{});else{clearTimeout(expiry);journal?.unsubscribe();journal=null;}}
 const channel=new BroadcastChannel('yixiaoxiu-auth');channel.onmessage=()=>{generation++;controller?.abort();busy=false;stopped=false;void load();};
 document.querySelector('#logout')?.addEventListener('click',()=>clear(true));window.addEventListener('pagehide',()=>{clear();channel.close();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!stopped)void load();render();});document.querySelector('#refresh')?.addEventListener('click',()=>void load());
 const timer=setInterval(()=>void load(),5000);window.addEventListener('pagehide',()=>clearInterval(timer));void load();
}
