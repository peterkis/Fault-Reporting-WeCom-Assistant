// Independent member capability; the existing Reporter page owns progress display.
export {};
const ref=/^\/wecom\/yixiaoxiu\/tickets\/([A-Za-z0-9_-]{32})$/u.exec(location.pathname)?.[1];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
interface Context{completed_round_ref:string;completed_round_no:number;ticket_version:number}
interface Command{schema_version:1;client_command_id:string;feedback:'STILL_UNRESOLVED';completed_round_ref:string;expected_ticket_version:number}
interface Pending{command:Command;ticketNo:string;round:number}
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
 const path='/api/reporter/tickets/'+ref,section=document.createElement('section'),message=document.createElement('p'),controls=document.createElement('div');
 section.id='bot-feedback-panel';message.dataset.feedbackState='';message.setAttribute('role','status');section.hidden=true;section.append(message,controls);document.querySelector('#ticket')?.append(section);
 let context:Context|null=null,detail:Record<string,unknown>|null=null,csrf:string|null=null,pending:Pending|null=null,busy=false,stopped=false,generation=0,controller:AbortController|null=null;
 async function request(url:string,options:RequestInit={}):Promise<Record<string,unknown>>{
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:controller?.signal??null,...options});if(!response.ok)throw new HttpError(response.status);return object(await response.json());
 }
 function render(){
  section.hidden=stopped||!context&&!pending&&!message.textContent;controls.replaceChildren();
  if(context){const button=document.createElement('button');button.type='button';button.textContent='仍未解决，重开此工单';button.dataset.action='submit-bot-feedback';button.disabled=busy||Boolean(pending)||!csrf;button.onclick=()=>void submit();controls.append(button);}
  if(pending){const checkButton=document.createElement('button');checkButton.type='button';checkButton.textContent='只读核对原反馈操作';checkButton.dataset.action='check-bot-feedback-command';checkButton.disabled=busy;checkButton.onclick=()=>void check();controls.append(checkButton);}
 }
 function committed(raw:unknown,p:Pending){
  const value=object(raw);exact(value,['ok','replayed','public_ref','completed_round_ref','reopened_round_no','ticket']);const ticket=object(value.ticket);exact(ticket,['ticket_no','status','version']);
  if(value.ok!==true||typeof value.replayed!=='boolean'||value.public_ref!==ref||value.completed_round_ref!==p.command.completed_round_ref||value.reopened_round_no!==p.round+1||ticket.ticket_no!==p.ticketNo||ticket.status!=='REOPENED'||ticket.version!==p.command.expected_ticket_version+1)throw Error('INVALID_RESPONSE');
 }
 async function load(){
  if(busy||stopped||document.hidden)return;busy=true;const g=generation;controller=new AbortController();
  try{const [current,bootstrap]=await Promise.all([request(path),request('/api/reporter/feedback/bootstrap')]);if(g!==generation)return;
   exact(bootstrap,['schema_version','write_enabled','csrf_token']);if(bootstrap.schema_version!==1||typeof bootstrap.write_enabled!=='boolean'||bootstrap.csrf_token!==null&&(typeof bootstrap.csrf_token!=='string'||!/^[a-f0-9]{64}$/u.test(bootstrap.csrf_token)))throw Error('INVALID_RESPONSE');
   detail=current;context=eligible(current);csrf=bootstrap.write_enabled&&typeof bootstrap.csrf_token==='string'?bootstrap.csrf_token:null;
   const hint=document.querySelector('#ticket .hint');if(context&&hint)hint.textContent='同一故障仍未解决时，可明确提交反馈；新故障请另行报修。';
  }catch(error){context=null;csrf=null;if(error instanceof HttpError&&[401,403,404].includes(error.status)){stopped=true;pending=null;message.textContent='当前访问权限需重新核验。';}}
  finally{if(g===generation){busy=false;render();}}
 }
 async function submit(){
  if(busy||stopped||document.hidden||pending||!context||!csrf||!detail||typeof detail.ticket_no!=='string')return;
  const p:Pending={ticketNo:detail.ticket_no,round:context.completed_round_no,command:{schema_version:1,client_command_id:crypto.randomUUID(),feedback:'STILL_UNRESOLVED',completed_round_ref:context.completed_round_ref,expected_ticket_version:context.ticket_version}};
  pending=p;busy=true;const g=generation;controller=new AbortController();message.textContent='正在提交本轮未解决反馈…';render();
  try{const result=await request(path+'/feedback',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':p.command.client_command_id,'if-match':'"'+p.command.expected_ticket_version+'"'},body:JSON.stringify(p.command)});if(g!==generation)return;committed(result,p);pending=null;context=null;message.textContent='已重开原工单，本轮等待工作人员重新承接。';document.querySelector<HTMLButtonElement>('#refresh')?.click();}
  catch(error){if(g!==generation)return;if(error instanceof HttpError&&error.status<500){pending=null;context=null;message.textContent='当前轮次或权限已变化，请刷新核验。';}else message.textContent='结果未知：保留原操作，只读核对，不会再次发送。';}
  finally{if(g===generation){busy=false;render();}}
 }
 async function check(){
  const p=pending;if(!p||!UUID.test(p.command.client_command_id)||busy||stopped||document.hidden)return;busy=true;const g=generation;controller=new AbortController();render();
  try{const receipt=await request(path+'/feedback/commands/'+p.command.client_command_id);if(g!==generation)return;
   if(receipt.public_ref!==ref||receipt.client_command_id!==p.command.client_command_id)throw Error('INVALID_RESPONSE');
   if(receipt.state==='UNKNOWN'){exact(receipt,['client_command_id','public_ref','state']);message.textContent='结果未知：尚无可确认终态，保留原操作，不会再次发送。';}
   else{exact(receipt,['client_command_id','public_ref','state','result']);if(receipt.state!=='COMMITTED'||object(receipt.result).replayed!==true)throw Error('INVALID_RESPONSE');committed(receipt.result,p);pending=null;context=null;message.textContent='已核对：原反馈已重开同一工单。';document.querySelector<HTMLButtonElement>('#refresh')?.click();}
  }catch{if(g===generation)message.textContent='结果未知：只读核对尚未完成，不会再次发送。';}finally{if(g===generation){busy=false;render();}}
 }
 function clear(){generation++;stopped=true;controller?.abort();pending=null;context=null;csrf=null;busy=false;message.textContent='';render();}
 const channel=new BroadcastChannel('yixiaoxiu-auth');channel.onmessage=()=>{clear();stopped=false;void load();};
 document.querySelector('#logout')?.addEventListener('click',clear);window.addEventListener('pagehide',()=>{clear();channel.close();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!stopped)void load();});document.querySelector('#refresh')?.addEventListener('click',()=>void load());
 const timer=setInterval(()=>void load(),5000);window.addEventListener('pagehide',()=>clearInterval(timer));void load();
}
