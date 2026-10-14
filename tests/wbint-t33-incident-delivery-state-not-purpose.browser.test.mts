import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {t33IncidentBrowser} from './helpers/t33-incident-delivery-browser-fixture.mjs';

function record(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function records(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(record);}
function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
function count(value:unknown):number{assert.equal(typeof value,'number');assert.ok(Number.isSafeInteger(value));const result=value as number;assert.ok(result>=0&&result<=2147483647);return result;}
function closed(value:unknown,keys:readonly string[]):Record<string,unknown>{const row=record(value);assert.deepEqual(Object.keys(row).sort(),[...keys].sort());return row;}
const observerSource=String.raw`(()=>{
 const config=__T33_STALE_CONFIG__,previousFetch=globalThis.fetch;
 const state={requests:[],blockedAttempts:0,quietStart:0};globalThis.__t33StateNotPurpose=state;
 globalThis.fetch=async(input,options)=>{
  const url=new URL(String(input),location.href),path=url.pathname,method=String(options?.method??'GET').toUpperCase(),parts=path.split('/');
  const controlPost=method==='POST'&&parts.length===7&&parts[1]==='api'&&parts[2]==='incidents'&&parts[4]==='notifications'&&(parts[6]==='retry'||parts[6]==='reconcile');
  const watched=controlPost||method==='GET'&&(path===config.bootstrap||path===config.incident||path===config.notifications||path===config.control||path.startsWith(config.receiptPrefix));
  const headers=new Headers(options?.headers);
  const row=watched?{sequence:state.requests.length,path,query:url.search,method,controlPost,body:typeof options?.body==='string'?options.body:null,headers:{idempotency_key:headers.get('idempotency-key'),if_match:headers.get('if-match'),csrf:headers.get('x-csrf-token'),content_type:headers.get('content-type'),accept:headers.get('accept')},previous_fetch_called:false,response_status:null,response:null,client_returned:false,pre_accept_disconnect:false}:null;
  if(row)state.requests.push(row);
  if(controlPost&&path===config.command&&state.blockedAttempts===0){
   state.blockedAttempts++;row.pre_accept_disconnect=true;row.error='T33_DISCONNECT_BEFORE_SERVER_ACCEPT';
   throw new TypeError('T33_DISCONNECT_BEFORE_SERVER_ACCEPT');
  }
  try{
   if(row)row.previous_fetch_called=true;
   const response=await previousFetch(input,options);
   if(row){row.response_status=response.status;row.response=await response.clone().json();row.client_returned=true;}
   return response;
  }catch(error){if(row)row.error=error instanceof Error?error.message:String(error);throw error;}
 };
 return true;
})()`;

test('T33 current SENT state preserves an original unaccepted UNKNOWN v2 intent and explicitly replays its exact UUID/body to the real stable FAILED CAS receipt while purpose grants remain',{timeout:240000},async()=>{
 await t33IncidentBrowser(async({browser,incidentId,deliveryId,siblingId,adminId,grants,get,post,getLifecycleRows,senderCalls,capture})=>{
  const root='[data-control-purpose="INCIDENT_LIFECYCLE"]',command='/api/incidents/'+incidentId+'/notifications/'+deliveryId+'/reconcile';
  const endpoints={bootstrap:'/api/lifecycle/bootstrap',incident:'/api/incidents/'+incidentId,notifications:'/api/incidents/'+incidentId+'/notifications',control:'/api/incidents/'+incidentId+'/notifications/'+deliveryId+'/control',command,receiptPrefix:'/api/incidents/'+incidentId+'/notification-commands/'};
  const trace=async()=>record(await browser.evaluate('globalThis.__t33StateNotPurpose'));
  const events=async()=>records((await trace()).requests);
  const attempts=(rows:readonly Record<string,unknown>[])=>rows.filter(row=>row.controlPost===true);
  const receiptReads=(rows:readonly Record<string,unknown>[])=>rows.filter(row=>row.method==='GET'&&text(row.path).startsWith(endpoints.receiptPrefix));
  const choose=async(label:string,value:string)=>{
   const selector=root+' select[aria-label="'+label+'"]';
   await browser.evaluate('(()=>{const field=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(field,'+JSON.stringify(value)+');field.dispatchEvent(new Event("change",{bubbles:true}));})()');
  };
  const input=async(label:string)=>browser.evaluate('document.querySelector('+JSON.stringify(root+' select[aria-label="'+label+'"]')+')?.value??null');
  const content=async()=>text(await browser.evaluate('document.querySelector('+JSON.stringify(root)+').textContent'));
  const quiet=async()=>{await browser.evaluate('globalThis.__t33StateNotPurpose.quietStart=performance.now()');await browser.waitFor('performance.now()-globalThis.__t33StateNotPurpose.quietStart>=400');};
  let phase='initial-real-worker-unknown',refreshMode='not-reached',originalId:string|null=null,originalBodyHash:string|null=null,currentCapability:Record<string,unknown>|null=null,initialPreviousFetchCalled:boolean|null=null,nodeOtherPostAttempted=false,nodeOtherAckObserved=false,uiReplayHttp409Observed=false;
  try{
   await browser.waitFor('Boolean(document.querySelector('+JSON.stringify(root+'[data-incident-delivery-controls]')+'))');
   const actor=await get(endpoints.bootstrap);assert.equal(actor.status,200);assert.equal(actor.body.principal_id,adminId);
   assert.ok(Array.isArray(actor.body.roles)&&actor.body.roles.includes('ADMIN'));
   assert.equal(actor.body.incident_delivery_control_enabled,true);assert.notEqual(actor.body.incident_delivery_control_draft_recovery_enabled,true);
   assert.equal(await get(endpoints.incident).then(response=>response.status),200);
   assert.ok(grants.has(adminId+'|'+incidentId+'|INCIDENT_DELIVERY_RETRY'));assert.ok(grants.has(adminId+'|'+incidentId+'|INCIDENT_DELIVERY_RECONCILE'));
   const rows=await getLifecycleRows(),initial=rows.find(row=>row.delivery_id===deliveryId);
   assert.equal(initial?.status,'RECONCILIATION_REQUIRED');assert.equal(initial?.side_effect_state,'UNKNOWN');assert.equal(initial?.attempt_count,1);assert.equal(senderCalls(),1);
   assert.equal(await browser.evaluate(observerSource.replace('__T33_STALE_CONFIG__',JSON.stringify(endpoints))),true);
   await choose('选择通知路',deliveryId);
   await browser.waitFor('document.querySelector('+JSON.stringify(root+' option[value="RECONCILE"]')+')?.disabled===false');
   await choose('投递控制操作','RECONCILE');await choose('投递操作原因','OPERATOR_VERIFIED_DELIVERY');await choose('未知发送核对结论','CONFIRMED_SENT');
   const submit=root+' [data-action="submit-incident-delivery-control"]',confirmation=root+' input[aria-label="确认本路投递操作"]',outcome=root+' [data-incident-delivery-outcome]';
   assert.equal(await browser.evaluate('document.querySelector('+JSON.stringify(submit)+').disabled'),true);
   await browser.evaluate('document.querySelector('+JSON.stringify(confirmation)+').click()');
   await browser.waitFor('document.querySelector('+JSON.stringify(submit)+')?.disabled===false');
   await browser.evaluate('document.querySelector('+JSON.stringify(submit)+').click()');
   await browser.waitFor('document.querySelector('+JSON.stringify(outcome)+')?.dataset.incidentDeliveryState==="unknown"');
   const firstEvents=await events(),firstAttempts=attempts(firstEvents);assert.equal(firstAttempts.length,1);
   const blocked=firstAttempts[0];assert.ok(blocked);
   initialPreviousFetchCalled=blocked.previous_fetch_called===true;
   assert.equal(blocked.path,command);assert.equal(blocked.previous_fetch_called,false);assert.equal(blocked.pre_accept_disconnect,true);
   assert.equal(blocked.response_status,null);assert.equal(blocked.response,null);assert.equal(blocked.client_returned,false);
   assert.equal(blocked.error,'T33_DISCONNECT_BEFORE_SERVER_ACCEPT');
   const rawBody=text(blocked.body),body=closed(JSON.parse(rawBody),['client_command_id','expected_row_version','expected_status','expected_side_effect_state','expected_delivery_attempt_count','reason_code','resolution']);
   const uuid=text(body.client_command_id),version=text(body.expected_row_version);originalId=uuid;
   assert.match(uuid,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
   assert.match(version,/^[1-9][0-9]{0,18}$/u);assert.ok(BigInt(version)<=9223372036854775807n);
   assert.equal(body.expected_delivery_attempt_count,1);assert.equal(body.expected_status,'RECONCILIATION_REQUIRED');assert.equal(body.expected_side_effect_state,'UNKNOWN');
   assert.equal(body.reason_code,'OPERATOR_VERIFIED_DELIVERY');assert.equal(body.resolution,'CONFIRMED_SENT');
   const originalHeaders=record(blocked.headers);assert.equal(originalHeaders.idempotency_key,uuid);assert.equal(originalHeaders.if_match,'"'+version+'"');
   assert.equal(originalHeaders.content_type,'application/json');assert.equal(originalHeaders.accept,'application/json');
   const initialAuth=firstEvents.filter(row=>row.path===endpoints.bootstrap&&row.method==='GET'&&row.response_status===200&&count(row.sequence)<count(blocked.sequence)).at(-1);
   const initialCap=firstEvents.filter(row=>row.path===endpoints.control&&row.method==='GET'&&row.response_status===200&&count(row.sequence)<count(blocked.sequence)).at(-1);
   assert.ok(initialAuth&&initialCap);assert.equal(record(initialAuth.response).principal_id,adminId);assert.equal(originalHeaders.csrf,text(record(initialAuth.response).csrf_token));
   assert.equal(record(initialCap.response).attempt_count,1);assert.equal(record(initialCap.response).receipt_read,true);assert.equal(record(initialCap.response).reconcile,true);
   originalBodyHash=createHash('sha256').update(rawBody,'utf8').digest('hex');
   const receiptPath=endpoints.receiptPrefix+uuid;
   const unaccepted=await get(receiptPath);assert.equal(unaccepted.status,200);
   const unknown=closed(unaccepted.body,['state','incident_id','client_command_id']);assert.equal(unknown.state,'UNKNOWN');assert.equal(unknown.incident_id,incidentId);assert.equal(unknown.client_command_id,uuid);
   assert.equal((await getLifecycleRows()).find(row=>row.delivery_id===deliveryId)?.attempt_count,1);
   await quiet();assert.equal(attempts(await events()).length,1);assert.equal(receiptReads(await events()).length,0);assert.equal(senderCalls(),1);
   assert.ok((await content()).includes('原通知操作 UUID：'+uuid));
   phase='client-attempt-blocked-before-server-no-original-receipt';
   await capture('state-not-purpose-unaccepted-original-uuid');

   // This is a separate real Cookie command using a different UUID, not an ACK
   // for the blocked page attempt. It records SENT/ACK without a second Sender.
   const updateMark=(await events()).length,otherId=randomUUID();assert.notEqual(otherId,uuid);
   const otherCommand={...body,client_command_id:otherId};
   nodeOtherPostAttempted=true;const changed=await post(command,otherCommand);assert.equal(changed.status,200);
   const otherAck=closed(changed.body,['ok','incident_id','delivery_id','client_command_id','status','side_effect_state','attempt_count','replayed']);
   assert.equal(otherAck.ok,true);assert.equal(otherAck.incident_id,incidentId);assert.equal(otherAck.delivery_id,deliveryId);assert.equal(otherAck.client_command_id,otherId);
   assert.equal(otherAck.status,'SENT');assert.equal(otherAck.side_effect_state,'ACKNOWLEDGED');assert.equal(otherAck.attempt_count,2);assert.equal(otherAck.replayed,false);nodeOtherAckObserved=true;
   const otherReceipt=await get(endpoints.receiptPrefix+otherId);assert.equal(otherReceipt.status,200);assert.equal(otherReceipt.body.state,'COMMITTED');assert.deepEqual(otherReceipt.body.result,otherAck);
   const stillUnknown=await get(receiptPath);assert.equal(stillUnknown.status,200);assert.deepEqual(stillUnknown.body,unknown);
   const currentActor=await get(endpoints.bootstrap),currentParent=await get(endpoints.incident),currentControl=await get(endpoints.control);
   assert.equal(currentActor.status,200);assert.equal(currentParent.status,200);assert.equal(currentControl.status,200);
   assert.equal(currentActor.body.principal_id,adminId);assert.deepEqual(currentActor.body.roles,actor.body.roles);assert.equal(currentActor.body.authorization_revision,actor.body.authorization_revision);
   assert.equal(currentActor.body.incident_delivery_control_enabled,true);assert.notEqual(currentActor.body.incident_delivery_control_draft_recovery_enabled,true);
   assert.ok(grants.has(adminId+'|'+incidentId+'|INCIDENT_DELIVERY_RETRY'));assert.ok(grants.has(adminId+'|'+incidentId+'|INCIDENT_DELIVERY_RECONCILE'));
   currentCapability=closed(currentControl.body,['incident_id','delivery_id','purpose','retry','reconcile','receipt_read','disabled','attempt_count']);
   assert.equal(currentCapability.incident_id,incidentId);assert.equal(currentCapability.delivery_id,deliveryId);assert.equal(currentCapability.purpose,'INCIDENT_LIFECYCLE');
   assert.equal(currentCapability.receipt_read,true);assert.equal(currentCapability.disabled,false);assert.equal(currentCapability.attempt_count,2);
   assert.equal(typeof currentCapability.retry,'boolean');assert.equal(typeof currentCapability.reconcile,'boolean');
   const refresh=root+' [data-action="refresh-incident-delivery-current"]';
   if(await browser.evaluate('Boolean(document.querySelector('+JSON.stringify(refresh)+')&&!document.querySelector('+JSON.stringify(refresh)+').disabled)')){
    refreshMode='explicit-existing-readonly-refresh';await browser.evaluate('document.querySelector('+JSON.stringify(refresh)+').click()');
   }else refreshMode='real-sse-or-poll-get';
   const currentRoute='[aria-label="各路通知投递"] [data-delivery-id="'+deliveryId+'"]';
   await browser.waitFor('(()=>{const row=document.querySelector('+JSON.stringify(currentRoute)+');return Boolean(row&&row.textContent.includes("已发送")&&row.textContent.includes("尝试 2 次"));})()');
   const afterChange=await events();
   const actualList=afterChange.filter(row=>count(row.sequence)>=updateMark&&row.method==='GET'&&row.path===endpoints.notifications&&row.response_status===200&&row.client_returned===true).find(row=>records(record(row.response).items).some(item=>item.delivery_id===deliveryId&&item.status==='SENT'&&item.side_effect_state==='ACKNOWLEDGED'&&item.attempt_count===2));
   assert.ok(actualList,'current SENT/ACK/attempt2 must be driven by an actual notification GET, not injected DOM/cache state');
   phase='real-current-route-sent-purpose-permissions-retained';
   assert.equal(await input('选择通知路'),deliveryId);assert.equal(await input('投递控制操作'),'RECONCILE');
   assert.equal(await input('投递操作原因'),body.reason_code);assert.equal(await input('未知发送核对结论'),body.resolution);
   const retainedText=await content();assert.ok(retainedText.includes('原通知操作 UUID：'+uuid));assert.ok(retainedText.includes('原版本：'+version));
   assert.ok(retainedText.includes('捕获公共故障版本 '+version+'；'));assert.ok(retainedText.includes('捕获尝试 1，'));
   assert.equal(await browser.evaluate('document.querySelector('+JSON.stringify(outcome)+')?.dataset.incidentDeliveryState'), 'unknown','a different command changed state; it did not revoke original purpose authority');
   assert.equal(await browser.evaluate('Boolean(document.querySelector('+JSON.stringify(root+' [data-incident-delivery-receipt]')+'))'),false);
   await quiet();assert.equal(attempts(await events()).length,1);assert.equal(receiptReads(await events()).length,0);assert.equal(senderCalls(),1);
   await capture('state-not-purpose-original-body-retained-against-sent');

   const check=root+' [data-action="check-incident-delivery-operation"]';
   await browser.waitFor('document.querySelector('+JSON.stringify(check)+')?.disabled===false');
   await browser.evaluate('document.querySelector('+JSON.stringify(check)+').click()');
   await browser.waitFor('(()=>{const reads=globalThis.__t33StateNotPurpose.requests.filter(row=>row.path==='+JSON.stringify(receiptPath)+'&&row.method==="GET"&&row.client_returned);return reads.length===1&&reads[0].response?.state==="UNKNOWN"&&document.querySelector('+JSON.stringify(check)+')?.disabled===false;})()');
   const checked=await events(),originalReads=receiptReads(checked);assert.equal(originalReads.length,1);
   assert.deepEqual(originalReads[0]?.response,unknown);assert.equal(attempts(checked).length,1);
   assert.equal(await input('投递操作原因'),body.reason_code);assert.ok((await content()).includes('捕获尝试 1，'));
   const replay=root+' [data-action="replay-incident-delivery-operation"]';
   assert.equal(await browser.evaluate('Boolean(document.querySelector('+JSON.stringify(replay)+'))'),true,'existing exact replay control requires preserved full original body; UNKNOWN is not failure');
   if(await browser.evaluate('document.querySelector('+JSON.stringify(confirmation)+')?.checked===true'))await browser.evaluate('document.querySelector('+JSON.stringify(confirmation)+').click()');
   assert.equal(await browser.evaluate('document.querySelector('+JSON.stringify(confirmation)+')?.checked'),false);
   await browser.evaluate('document.querySelector('+JSON.stringify(confirmation)+').click()');
   await browser.waitFor('document.querySelector('+JSON.stringify(replay)+')?.disabled===false');
   phase='explicit-unknown-read-and-new-user-confirmation';
   await capture('state-not-purpose-exact-old-replay-confirmed');
   await browser.evaluate('document.querySelector('+JSON.stringify(replay)+').click()');
   await browser.waitFor('globalThis.__t33StateNotPurpose.requests.some(row=>row.controlPost&&row.previous_fetch_called&&row.response_status===409&&row.client_returned)');
   await browser.waitFor('document.querySelector('+JSON.stringify(outcome)+')?.dataset.incidentDeliveryState==="failed"');
   const completed=await events(),allAttempts=attempts(completed);assert.equal(allAttempts.length,2);
   const real=allAttempts.filter(row=>row.previous_fetch_called===true);assert.equal(real.length,1);
   const replayed=real[0];assert.ok(replayed);assert.equal(replayed.path,command);assert.equal(replayed.pre_accept_disconnect,false);assert.equal(replayed.response_status,409);uiReplayHttp409Observed=true;
   const replayBody=text(replayed.body);assert.equal(replayBody,rawBody,'explicit replay keeps the original serialized body bytes, not current state/count');
   assert.equal(Buffer.byteLength(replayBody,'utf8'),Buffer.byteLength(rawBody,'utf8'));
   assert.equal(createHash('sha256').update(replayBody,'utf8').digest('hex'),originalBodyHash);
   assert.deepEqual(closed(JSON.parse(replayBody),Object.keys(body)),body);
   const replayHeaders=record(replayed.headers);assert.equal(replayHeaders.idempotency_key,originalHeaders.idempotency_key);assert.equal(replayHeaders.if_match,originalHeaders.if_match);
   assert.equal(replayHeaders.content_type,originalHeaders.content_type);assert.equal(replayHeaders.accept,originalHeaders.accept);
   const replayAuth=completed.filter(row=>row.path===endpoints.bootstrap&&row.method==='GET'&&row.response_status===200&&count(row.sequence)<count(replayed.sequence)).at(-1);
   assert.ok(replayAuth);assert.equal(record(replayAuth.response).principal_id,adminId);assert.equal(replayHeaders.csrf,text(record(replayAuth.response).csrf_token),'authorization header comes from actual current bootstrap, while intent headers stay original');
   const refusal=closed(replayed.response,['ok','error','replayed']),error=closed(refusal.error,['code','retryable']);
   assert.equal(refusal.ok,false);assert.equal(refusal.replayed,false);assert.match(text(error.code),/^P2_012_[A-Z0-9_]{1,96}$/u);assert.equal(error.retryable,false);
   const failed=await get(receiptPath);assert.equal(failed.status,200);
   const failure=closed(failed.body,['state','incident_id','client_command_id','error']);
   assert.equal(failure.state,'FAILED');assert.equal(failure.incident_id,incidentId);assert.equal(failure.client_command_id,uuid);assert.deepEqual(failure.error,error);
   assert.deepEqual((await get(receiptPath)).body,failure,'the failed CAS receipt is stable across real authorized reads');
   await quiet();assert.equal(attempts(await events()).length,2);assert.equal((await trace()).blockedAttempts,1);
   assert.equal(receiptReads(await events()).length,1,'no automatic original-receipt GET was added');
   assert.equal(senderCalls(),1);
   const finalRows=await getLifecycleRows(),selected=finalRows.find(row=>row.delivery_id===deliveryId),sibling=finalRows.find(row=>row.delivery_id===siblingId);
   assert.equal(selected?.status,'SENT');assert.equal(selected?.side_effect_state,'ACKNOWLEDGED');assert.equal(selected?.attempt_count,2);
   assert.equal(sibling?.status,'PENDING');assert.equal(sibling?.side_effect_state,'NOT_ATTEMPTED');
   assert.ok(grants.has(adminId+'|'+incidentId+'|INCIDENT_DELIVERY_RECONCILE'));assert.equal((await get(endpoints.incident)).status,200);
   phase='exact-old-body-real-cas409-original-failed';
   await capture('state-not-purpose-original-failed-cas-sent-current-unchanged');
  }finally{
   console.log('T33_STATE_NOT_PURPOSE_REQUESTS '+JSON.stringify((await events()).filter(row=>row.controlPost===true||text(row.path).startsWith(endpoints.receiptPrefix)).map(row=>({...row,headers:{...record(row.headers),csrf:record(row.headers).csrf===null?null:'PRESENT'}}))));

   console.log('T33_STATE_NOT_PURPOSE_BOUNDARY '+JSON.stringify({phase,refreshMode,originalId,originalBodyHash,currentCapability,clientAttemptCountsKnownOnlyWithinPage:true,initialPreviousFetchCalled,nodeOtherPostAttempted,nodeOtherAckObserved,uiReplayHttp409Observed}));
  }
 });
});
