import assert from 'node:assert/strict';
import {test} from 'node:test';
import {t33IncidentBrowser} from './helpers/t33-incident-delivery-browser-fixture.mjs';

function record(value:unknown):Record<string,unknown>{
 assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;
}
function records(value:unknown):Record<string,unknown>[]{
 assert.ok(Array.isArray(value));return value.map(record);
}
function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
function closed(value:unknown,keys:readonly string[]):Record<string,unknown>{
 const row=record(value);assert.deepEqual(Object.keys(row).sort(),[...keys].sort());return row;
}
function count(value:unknown):number{
 assert.equal(typeof value,'number');assert.ok(Number.isSafeInteger(value));
 const result=value as number;assert.ok(result>=0&&result<=2147483647);return result;
}

test('T33 production detail keeps one committed-but-unacknowledged command and recovers its original ACK through an explicit read only, with draft recovery OFF',{timeout:240000},async()=>{
 await t33IncidentBrowser(async({browser,incidentId,deliveryId,siblingId,adminId,get,getLifecycleRows,senderCalls,capture})=>{
  const root='[data-control-purpose="INCIDENT_LIFECYCLE"]';
  const command='/api/incidents/'+incidentId+'/notifications/'+deliveryId+'/reconcile';
  const endpoints={
   bootstrap:'/api/lifecycle/bootstrap',
   incident:'/api/incidents/'+incidentId,
   control:'/api/incidents/'+incidentId+'/notifications/'+deliveryId+'/control',
   command,
   receiptPrefix:'/api/incidents/'+incidentId+'/notification-commands/'
  };
  await browser.waitFor('Boolean(document.querySelector('+JSON.stringify(root+'[data-incident-delivery-controls]')+'))');
  assert.equal(await browser.evaluate('globalThis.__t33ControlPosts.length'),0);
  const observer=String.raw`(()=>{
 const endpoints=__T33_ENDPOINTS__;
 const previousFetch=globalThis.fetch;
 const state={requests:[],lossCount:0,quietStart:0};
 globalThis.__t33ResponseLoss=state;
 globalThis.fetch=async(input,options)=>{
  const path=new URL(String(input),location.href).pathname;
  const method=String(options?.method??'GET').toUpperCase();
  const segments=path.split('/');
  const controlPost=method==='POST'&&segments.length===7&&segments[1]==='api'&&segments[2]==='incidents'&&segments[4]==='notifications'&&(segments[6]==='retry'||segments[6]==='reconcile');
  const watched=controlPost||method==='GET'&&(path===endpoints.bootstrap||path===endpoints.incident||path===endpoints.control||path.startsWith(endpoints.receiptPrefix));
  const headers=new Headers(options?.headers);
  const request=watched?{
   sequence:state.requests.length,path,method,controlPost,
   body:typeof options?.body==='string'?options.body:null,
   headers:{idempotency_key:headers.get('idempotency-key'),if_match:headers.get('if-match'),csrf:headers.get('x-csrf-token'),content_type:headers.get('content-type')},
   credentials:options?.credentials??null,cache:options?.cache??null,redirect:options?.redirect??null,
   response_status:null,response:null,client_returned:false,loss_injected:false
  }:null;
  if(request)state.requests.push(request);
  try{
   const response=await previousFetch(input,options);
   if(request){
    request.response_status=response.status;
    request.response=await response.clone().json();
   }
   if(controlPost&&path===endpoints.command&&response.status===200&&state.lossCount===0){
    state.lossCount++;request.loss_injected=true;
    throw new TypeError('T33_RESPONSE_LOST_AFTER_REAL_SERVER_ACK');
   }
   if(request)request.client_returned=true;
   return response;
  }catch(error){
   if(request)request.error=error instanceof Error?error.message:String(error);
   throw error;
  }
 };
 return state.lossCount===0&&state.requests.length===0;
})()`;
  assert.equal(await browser.evaluate(observer.replace('__T33_ENDPOINTS__',JSON.stringify(endpoints))),true);

  const trace=async()=>records(record(await browser.evaluate('globalThis.__t33ResponseLoss')).requests);
  const posts=(events:readonly Record<string,unknown>[])=>events.filter(event=>event.controlPost===true);
  const receiptReads=(events:readonly Record<string,unknown>[])=>events.filter(event=>event.method==='GET'&&text(event.path).startsWith(endpoints.receiptPrefix));
  const quiet=async()=>{
   await browser.evaluate('globalThis.__t33ResponseLoss.quietStart=performance.now()');
   await browser.waitFor('performance.now()-globalThis.__t33ResponseLoss.quietStart>=400');
  };
  const choose=async(label:string,value:string)=>{
   const selector=root+' .workbench-select[data-field-label="'+label+'"] select';
   await browser.evaluate('(()=>{const field=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(field,'+JSON.stringify(value)+');field.dispatchEvent(new Event("change",{bubbles:true}));})()');
  };
  const input=async(label:string)=>browser.evaluate('document.querySelector('+JSON.stringify(root+' .workbench-select[data-field-label="'+label+'"] select')+').value');
  const controlText=async()=>text(await browser.evaluate('document.querySelector('+JSON.stringify(root)+').textContent'));

  await choose('选择通知路',deliveryId);
  await browser.waitFor('document.querySelector('+JSON.stringify(root+' option[value="RECONCILE"]')+')?.disabled===false');
  await choose('投递控制操作','RECONCILE');
  await choose('投递操作原因','OPERATOR_VERIFIED_DELIVERY');
  await choose('未知发送核对结论','CONFIRMED_SENT');
  const submit=root+' [data-action="submit-incident-delivery-control"]';
  assert.equal(await browser.evaluate('document.querySelector('+JSON.stringify(submit)+').disabled'),true);
  assert.equal(posts(await trace()).length,0,'selecting route, reason and resolution is never a POST');
  await browser.evaluate('document.querySelector('+JSON.stringify(root+' input[aria-label="确认本路投递操作"]')+').click()');
  await browser.waitFor('document.querySelector('+JSON.stringify(submit)+')?.disabled===false');
  await capture('response-loss-explicit-confirmation');
  await browser.evaluate('document.querySelector('+JSON.stringify(submit)+').click()');
  const outcome='[data-incident-delivery-outcome]';
   await browser.waitFor('document.querySelectorAll('+JSON.stringify(outcome)+').length===1');
  await browser.waitFor('document.querySelector('+JSON.stringify(outcome)+')?.dataset.incidentDeliveryState==="unknown"');

  const lostEvents=await trace(),lostPosts=posts(lostEvents);
  assert.equal(lostPosts.length,1);
  const post=lostPosts[0];assert.ok(post);
  assert.equal(post.path,command);assert.equal(post.method,'POST');
  assert.equal(post.response_status,200,'the real response is received before the test injects network loss');
  assert.equal(post.loss_injected,true);assert.equal(post.client_returned,false);
  assert.equal(post.error,'T33_RESPONSE_LOST_AFTER_REAL_SERVER_ACK');
  assert.equal(post.credentials,'same-origin');assert.equal(post.cache,'no-store');assert.equal(post.redirect,'error');
  const body=closed(JSON.parse(text(post.body)),[
   'client_command_id','expected_row_version','expected_status','expected_side_effect_state',
   'expected_delivery_attempt_count','reason_code','resolution'
  ]);
  const uuid=text(body.client_command_id),version=text(body.expected_row_version),attempt=count(body.expected_delivery_attempt_count);
  assert.match(uuid,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
  assert.match(version,/^[1-9][0-9]{0,18}$/u);assert.ok(BigInt(version)<=9223372036854775807n);
  assert.equal(body.expected_status,'RECONCILIATION_REQUIRED');
  assert.equal(body.expected_side_effect_state,'UNKNOWN');
  assert.equal(body.reason_code,'OPERATOR_VERIFIED_DELIVERY');assert.equal(body.resolution,'CONFIRMED_SENT');
  const headers=record(post.headers);assert.equal(headers.idempotency_key,uuid);
  assert.equal(headers.if_match,'"'+version+'"');assert.equal(headers.content_type,'application/json');
  const priorReads=lostEvents.filter(event=>event.method==='GET'&&count(event.sequence)<count(post.sequence)&&event.response_status===200);
  const beforePostAuth=priorReads.filter(event=>event.path===endpoints.bootstrap).at(-1);
  const beforePostControl=priorReads.filter(event=>event.path===endpoints.control).at(-1);
  assert.ok(beforePostAuth&&beforePostControl,'the user command must read current bootstrap and exact route capability first');
  const auth=record(beforePostAuth.response);
  assert.equal(auth.principal_id,adminId);assert.ok(Array.isArray(auth.roles)&&auth.roles.includes('ADMIN'));
  assert.equal(auth.incident_delivery_control_enabled,true);
  assert.notEqual(auth.incident_delivery_control_draft_recovery_enabled,true,'fixture defaults keep persistent recovery OFF');
  assert.equal(headers.csrf,text(auth.csrf_token),'POST uses the actual current authenticated bootstrap token');
  const capability=closed(beforePostControl.response,['incident_id','delivery_id','purpose','retry','reconcile','receipt_read','disabled','attempt_count']);
  assert.equal(capability.incident_id,incidentId);assert.equal(capability.delivery_id,deliveryId);
  assert.equal(capability.purpose,'INCIDENT_LIFECYCLE');assert.equal(capability.reconcile,true);
  assert.equal(capability.receipt_read,true);assert.equal(capability.disabled,false);
  assert.equal(attempt,count(capability.attempt_count),'POST retains the captured exact route attempt count');

  const originalAck=closed(post.response,['ok','incident_id','delivery_id','client_command_id','status','side_effect_state','attempt_count','replayed']);
  assert.equal(originalAck.ok,true);assert.equal(originalAck.incident_id,incidentId);assert.equal(originalAck.delivery_id,deliveryId);
  assert.equal(originalAck.client_command_id,uuid);assert.equal(originalAck.status,'SENT');
  assert.equal(originalAck.side_effect_state,'ACKNOWLEDGED');count(originalAck.attempt_count);
  assert.equal(originalAck.replayed,false);
  const receiptPath=endpoints.receiptPrefix+uuid;
  const serverReceipt=await get(receiptPath);
  assert.equal(serverReceipt.status,200,'real authenticated HTTP proves COMMIT independently of the lost page response');
  const committed=closed(serverReceipt.body,['state','incident_id','client_command_id','result']);
  assert.equal(committed.state,'COMMITTED');assert.equal(committed.incident_id,incidentId);assert.equal(committed.client_command_id,uuid);
  assert.deepEqual(committed.result,originalAck,'GET returns the original ACK, including replayed:false');
  assert.equal(senderCalls(),1,'recording the observed send never calls Sender again');
  assert.equal(await input('选择通知路'),deliveryId);assert.equal(await input('投递控制操作'),'RECONCILE');
  assert.equal(await input('投递操作原因'),body.reason_code);assert.equal(await input('未知发送核对结论'),body.resolution);
  const preservedText=await controlText();
  assert.ok(preservedText.includes('原通知操作 UUID：'+uuid));
  assert.ok(preservedText.includes('原版本：'+version));
  assert.ok(preservedText.includes('捕获公共故障版本 '+version+'；'));
  assert.ok(preservedText.includes('捕获尝试 '+attempt+'，'));
  assert.equal(await browser.evaluate('document.querySelector('+JSON.stringify(submit)+').disabled'),true);
  assert.equal(await browser.evaluate('Boolean(document.querySelector('+JSON.stringify(root+' [data-incident-delivery-receipt]')+'))'),false,'the page has not invented a known ACK');
  assert.equal(await browser.evaluate('Boolean(document.querySelector('+JSON.stringify(root+' [data-action="replay-incident-delivery-operation"]')+'))'),false);
  await quiet();
  const beforeRead=await trace();assert.equal(posts(beforeRead).length,1);assert.equal(receiptReads(beforeRead).length,0,'UNKNOWN never automatically checks or replays');
  assert.equal(await browser.evaluate('globalThis.__t33ResponseLoss.lossCount'),1);
  assert.equal(senderCalls(),1);
  await capture('response-loss-original-uuid-retained');

  const check=root+' [data-action="check-incident-delivery-operation"]';
  await browser.waitFor('document.querySelector('+JSON.stringify(check)+')?.disabled===false');
  await browser.evaluate('document.querySelector('+JSON.stringify(check)+').click()');
  await browser.waitFor('document.querySelector('+JSON.stringify(outcome)+')?.dataset.incidentDeliveryState==="committed"');
  await browser.waitFor('Boolean(document.querySelector('+JSON.stringify(root+' [data-incident-delivery-receipt]')+'))');
  await quiet();
  const restoredEvents=await trace(),reads=receiptReads(restoredEvents);
  assert.equal(posts(restoredEvents).length,1,'explicit recovery is read only and never creates or replays a second POST');
  assert.equal(reads.length,1);const read=reads[0];assert.ok(read);
  assert.equal(read.path,receiptPath);assert.equal(read.method,'GET');assert.equal(read.body,null);
  assert.equal(read.response_status,200);assert.equal(read.client_returned,true);assert.equal(read.loss_injected,false);
  assert.deepEqual(read.response,serverReceipt.body,'the page receives the actual original committed receipt');
  const currentReads=restoredEvents.filter(event=>event.method==='GET'&&count(event.sequence)>count(post.sequence)&&count(event.sequence)<count(read.sequence)&&event.response_status===200);
  const receiptAuth=currentReads.filter(event=>event.path===endpoints.bootstrap).at(-1);
  const receiptCapability=currentReads.filter(event=>event.path===endpoints.control).at(-1);
  assert.ok(receiptAuth&&receiptCapability,'current original read permission and exact route scope are read before receipt recovery');
  assert.equal(record(receiptAuth.response).principal_id,adminId);
  assert.equal(record(receiptCapability.response).incident_id,incidentId);
  assert.equal(record(receiptCapability.response).delivery_id,deliveryId);
  assert.equal(record(receiptCapability.response).receipt_read,true);
  assert.equal(senderCalls(),1);
  const rows=await getLifecycleRows(),selected=rows.find(row=>row.delivery_id===deliveryId),sibling=rows.find(row=>row.delivery_id===siblingId);
  assert.equal(selected?.status,'SENT');assert.equal(selected?.side_effect_state,'ACKNOWLEDGED');
  assert.equal(selected?.attempt_count,originalAck.attempt_count);
  assert.equal(sibling?.status,'PENDING');assert.equal(sibling?.side_effect_state,'NOT_ATTEMPTED');
  assert.ok((await controlText()).includes('不代表报修人已读'));
  await capture('response-loss-read-only-original-ack-restored');
 });
});
