import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {t33IncidentBrowser} from './helpers/t33-incident-delivery-browser-fixture.mjs';

function record(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function records(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(record);}
function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
function count(value:unknown):number{assert.equal(typeof value,'number');assert.ok(Number.isSafeInteger(value));const result=value as number;assert.ok(result>=0&&result<=2147483647);return result;}
function closed(value:unknown,keys:readonly string[]):Record<string,unknown>{const row=record(value);assert.deepEqual(Object.keys(row).sort(),[...keys].sort());return row;}
interface Binding {delivery_id:string;subscription_id:string;template_code:string;audience_type:string;target_type:string;sender_system_code:string}

const observerSource=String.raw`(()=>{
 const config=__T33_PUBLIC_PAUSE_CONFIG__,previousFetch=globalThis.fetch;
 const state={requests:[],quietStart:0};globalThis.__t33PublicPauseControl=state;
 globalThis.fetch=async(input,options)=>{
  const url=new URL(String(input),location.href),path=url.pathname,method=String(options?.method??'GET').toUpperCase(),parts=path.split('/');
  const controlPost=method==='POST'&&parts.length===7&&parts[1]==='api'&&parts[2]==='incidents'&&parts[4]==='notifications'&&(parts[6]==='retry'||parts[6]==='reconcile');
  const watched=controlPost||method==='GET'&&(path===config.bootstrap||path===config.incident||path===config.notifications||path===config.publications||path===config.deliveries||path===config.control||path.startsWith(config.receiptPrefix));
  const headers=new Headers(options?.headers);
  const row=watched?{sequence:state.requests.length,path,query:url.search,method,controlPost,body:typeof options?.body==='string'?options.body:null,headers:{idempotency_key:headers.get('idempotency-key'),if_match:headers.get('if-match'),csrf:headers.get('x-csrf-token'),content_type:headers.get('content-type'),accept:headers.get('accept')},previous_fetch_called:false,response_status:null,response_headers:null,response_raw:null,response:null,client_returned:false}:null;
  if(row)state.requests.push(row);
  try{
   if(row)row.previous_fetch_called=true;
   const response=await previousFetch(input,options);
   if(row){
    row.response_status=response.status;
    row.response_headers={content_type:response.headers.get('content-type'),retry_authorized:response.headers.get('x-incident-delivery-retry-authorized'),reconcile_authorized:response.headers.get('x-incident-delivery-reconcile-authorized')};
    try{row.response_raw=await response.clone().text();row.response=JSON.parse(row.response_raw);}catch(error){row.inspection_error=error instanceof Error?error.message:String(error);}
    row.client_returned=true;
   }
   return response;
  }catch(error){if(row)row.error=error instanceof Error?error.message:String(error);throw error;}
 };
 return true;
})()`;

test('T33 paused PUBLIC_PROGRESS requeue business refusal retains current authority and appears as known failure with selected input and readonly refresh',{timeout:240000},async()=>{
 await t33IncidentBrowser(async({browser,incidentId,deliveryId:legacyId,siblingId:legacySiblingId,adminId,pool,grants,get,post,deliver,getLifecycleRows,senderCalls,capture})=>{
  const parent='/api/incidents/'+incidentId,root='[data-control-purpose="INCIDENT_PUBLIC_PROGRESS"]';
  const receiptPrefix=parent+'/notification-commands/',bootstrapPath='/api/lifecycle/bootstrap';
  const trace=async()=>record(await browser.evaluate('globalThis.__t33PublicPauseControl??{requests:[],quietStart:0}'));
  const events=async()=>records((await trace()).requests);
  const posts=(rows:readonly Record<string,unknown>[])=>rows.filter(row=>row.controlPost===true);
  const choose=async(label:string,value:string)=>{
   const selector=root+' select[aria-label="'+label+'"]';
   await browser.evaluate('(()=>{const field=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(field,'+JSON.stringify(value)+');field.dispatchEvent(new Event("change",{bubbles:true}));})()');
  };
  const input=async(label:string)=>browser.evaluate('document.querySelector('+JSON.stringify(root+' select[aria-label="'+label+'"]')+')?.value??null');
  const content=async()=>text(await browser.evaluate('document.querySelector('+JSON.stringify(root)+')?.textContent??""'));
  const quiet=async()=>{await browser.evaluate('globalThis.__t33PublicPauseControl.quietStart=performance.now()');await browser.waitFor('performance.now()-globalThis.__t33PublicPauseControl.quietStart>=400');};
  const incident=async()=>{const response=await get(parent);assert.equal(response.status,200,JSON.stringify(response.body));return response.body;};
  const progressRows=async(publicationId:string)=>{
   const response=await get(parent+'/public-progress/'+publicationId+'/deliveries?limit=100');
   assert.equal(response.status,200,JSON.stringify(response.body));
   const page=closed(response.body,['incident_id','publication_id','items','next_cursor']);
   assert.equal(page.incident_id,incidentId);assert.equal(page.publication_id,publicationId);assert.equal(page.next_cursor,null);
   return records(page.items).map(value=>closed(value,['id','route','audience','status','attempt_count','side_effect_state','last_error_code','sent_at']));
  };
  const capability=(value:unknown,deliveryId:string)=>{
   const row=closed(value,['incident_id','delivery_id','purpose','retry','reconcile','receipt_read','disabled','attempt_count']);
   assert.equal(row.incident_id,incidentId);assert.equal(row.delivery_id,deliveryId);assert.equal(row.purpose,'INCIDENT_PUBLIC_PROGRESS');
   assert.equal(row.receipt_read,true);assert.equal(row.reconcile,true);assert.equal(row.disabled,false);assert.equal(row.attempt_count,1);
   return row;
  };
  let phase='real-helper-lifecycle-unknown',selectedDeliveryId:string|null=null,selectedSubscriptionId:string|null=null,selectedControlPath:string|null=null,publicationId:string|null=null;
  let originalId:string|null=null,rawBody:string|null=null,bodySha256:string|null=null,bodyBytes:number|null=null,parentVersion:string|null=null;
  let actualHttpStatus:number|null=null,actualErrorCode:string|null=null,observedUiState:unknown=null,officialReceipt:Record<string,unknown>|null=null;
  let setupPublication:Record<string,unknown>|null=null,setupPause:Record<string,unknown>|null=null,currentAuthority:Record<string,unknown>|null=null;
  try{
   // The existing helper already ran one original lifecycle Worker. This is
   // real synthetic Sender activity, not a zero-send publication fixture.
   const initialLifecycle=await getLifecycleRows(),legacy=initialLifecycle.find(row=>row.delivery_id===legacyId),legacySibling=initialLifecycle.find(row=>row.delivery_id===legacySiblingId);
   assert.equal(legacy?.status,'RECONCILIATION_REQUIRED');assert.equal(legacy?.side_effect_state,'UNKNOWN');assert.equal(legacy?.attempt_count,1);
   assert.equal(legacySibling?.status,'PENDING');assert.equal(legacySibling?.side_effect_state,'NOT_ATTEMPTED');assert.equal(senderCalls(),1);
   const grantSnapshot=[...grants].sort(),actor=await get(bootstrapPath);
   assert.equal(actor.status,200);assert.equal(actor.body.principal_id,adminId);assert.ok(Array.isArray(actor.body.roles)&&actor.body.roles.includes('ADMIN'));
   assert.equal(actor.body.incident_public_progress_enabled,true);assert.equal(actor.body.incident_delivery_control_enabled,true);
   assert.notEqual(actor.body.incident_delivery_control_draft_recovery_enabled,true);
   assert.ok(grants.has(adminId+'|'+incidentId+'|INCIDENT_DELIVERY_RETRY'));assert.ok(grants.has(adminId+'|'+incidentId+'|INCIDENT_DELIVERY_RECONCILE'));
   const beforePublications=await get(parent+'/public-progress?limit=30');assert.equal(beforePublications.status,200);assert.deepEqual(records(beforePublications.body.items),[]);

   // Official Cookie HTTP setup uses a separate public summary and the actual
   // explicit preview-confirmed input contract. This case tests the production
   // delivery-control UI, not a second publication UI implementation.
   const publishBody={client_command_id:randomUUID(),expected_row_version:text((await incident()).row_version),reason_code:'WORKBENCH_PUBLIC_PROGRESS',summary:'Synthetic public progress: the service connection is being checked.',preview_confirmed:true};
   const published=await post(parent+'/publish-update',publishBody);assert.equal(published.status,200,JSON.stringify(published.body));
   const publishAck=closed(published.body,['ok','result_ref_type','result_ref_id','result_row_version','result_event_id','replayed']);
   assert.equal(publishAck.ok,true);assert.equal(publishAck.result_ref_type,'INCIDENT');assert.equal(publishAck.result_ref_id,incidentId);assert.equal(publishAck.replayed,false);
   publicationId=text(publishAck.result_event_id);assert.equal(text(publishAck.result_row_version),(BigInt(publishBody.expected_row_version)+1n).toString());
   setupPublication={path:parent+'/publish-update',status:published.status,body:publishBody,response:publishAck};
   const history=await get(parent+'/public-progress?limit=30');assert.equal(history.status,200);
   const actualPublication=records(history.body.items).find(row=>row.id===publicationId);assert.ok(actualPublication);assert.equal(actualPublication.summary,publishBody.summary);
   const initialProgress=await progressRows(publicationId);assert.equal(initialProgress.length,2);
   for(const row of initialProgress){assert.equal(row.route,'BOT_DIRECT');assert.equal(row.audience,'REPORTER_DIRECT');assert.equal(row.status,'PENDING');assert.equal(row.side_effect_state,'NOT_ATTEMPTED');assert.equal(count(row.attempt_count),0);}
   const bindings=(await pool.query<Binding>(
    'SELECT d.id::text AS delivery_id,b.reporter_subscription_id::text AS subscription_id,b.template_code,b.audience_type,d.target_type,m.sender_system_code FROM communication.incident_notification_binding b JOIN communication.message m ON m.id=b.communication_message_id JOIN communication.outbox o ON o.message_id=m.id JOIN communication.delivery d ON d.outbox_id=o.id WHERE b.incident_id=$1::uuid AND b.incident_event_id=$2::uuid ORDER BY d.id',
    [incidentId,publicationId],
   )).rows;
   assert.equal(bindings.length,2);
   for(const binding of bindings){assert.equal(binding.template_code,'INCIDENT_PUBLIC_PROGRESS_DIRECT');assert.equal(binding.audience_type,'REPORTER_DIRECT');assert.equal(binding.target_type,'PERSON');assert.equal(binding.sender_system_code,'INCIDENT_PUBLIC_PROGRESS');}
   const binding=bindings[0];assert.ok(binding);selectedDeliveryId=binding.delivery_id;selectedSubscriptionId=binding.subscription_id;
   assert.notEqual(selectedDeliveryId,legacyId);assert.notEqual(selectedDeliveryId,legacySiblingId);
   const siblingBefore=initialProgress.find(row=>row.id!==selectedDeliveryId);assert.ok(siblingBefore);
   const subscriptions=await get(parent+'/subscriptions?limit=100');assert.equal(subscriptions.status,200);assert.equal(subscriptions.body.next_cursor,null);
   const subscriptionRows=records(subscriptions.body.items);assert.equal(subscriptionRows.length,4);
   assert.deepEqual(subscriptionRows.map(row=>row.status).sort(),['ACTIVE','ACTIVE','PENDING_DESTINATION','PENDING_DESTINATION']);
   const selectedSubscription=subscriptionRows.find(row=>row.id===selectedSubscriptionId);assert.ok(selectedSubscription);assert.equal(selectedSubscription.status,'ACTIVE');

   await deliver(selectedDeliveryId);
   const beforeRefusal=await progressRows(publicationId),unknown=beforeRefusal.find(row=>row.id===selectedDeliveryId);assert.ok(unknown);
   assert.equal(unknown.status,'RECONCILIATION_REQUIRED');assert.equal(unknown.side_effect_state,'UNKNOWN');assert.equal(count(unknown.attempt_count),1);
   assert.deepEqual(beforeRefusal.find(row=>row.id===siblingBefore.id),siblingBefore);
   assert.equal(senderCalls(),2,'one legacy helper attempt plus one actual PUBLIC_PROGRESS DIRECT attempt');
   assert.deepEqual(await getLifecycleRows(),initialLifecycle);
   phase='real-publication-direct-worker-unknown';

   // Pause only the selected ACTIVE subscription through the existing command.
   // Parent version is read after this official write, before any UI selection.
   const beforePauseVersion=text((await incident()).row_version);
   const pauseBody={client_command_id:randomUUID(),expected_row_version:beforePauseVersion,expected_subscription_version:text(selectedSubscription.row_version),reason_code:'SUBSCRIPTION_REQUEST'};
   const pausePath=parent+'/subscriptions/'+selectedSubscriptionId+'/pause',paused=await post(pausePath,pauseBody);
   assert.equal(paused.status,200,JSON.stringify(paused.body));setupPause={path:pausePath,status:paused.status,body:pauseBody,response:paused.body};
   const pausedSubscriptions=await get(parent+'/subscriptions?limit=100');assert.equal(pausedSubscriptions.status,200);
   const currentSubscriptions=records(pausedSubscriptions.body.items),pausedSelected=currentSubscriptions.find(row=>row.id===selectedSubscriptionId);assert.ok(pausedSelected);
   assert.equal(pausedSelected.status,'PAUSED');assert.equal(currentSubscriptions.filter(row=>row.status==='PAUSED').length,1);
   assert.deepEqual(currentSubscriptions.filter(row=>row.id!==selectedSubscriptionId).map(row=>[row.id,row.status,row.row_version]),subscriptionRows.filter(row=>row.id!==selectedSubscriptionId).map(row=>[row.id,row.status,row.row_version]));
   const pausedParent=await incident();parentVersion=text(pausedParent.row_version);assert.ok(BigInt(parentVersion)>BigInt(beforePauseVersion));
   selectedControlPath=parent+'/notifications/'+selectedDeliveryId+'/control';
   const control=await get(selectedControlPath);assert.equal(control.status,200);capability(control.body,selectedDeliveryId);
   assert.deepEqual([...grants].sort(),grantSnapshot);assert.equal(senderCalls(),2);
   phase='official-selected-pause-current-read-and-grants-retained';

   const command=parent+'/notifications/'+selectedDeliveryId+'/reconcile',endpoints={bootstrap:bootstrapPath,incident:parent,notifications:parent+'/notifications',publications:parent+'/public-progress',deliveries:parent+'/public-progress/'+publicationId+'/deliveries',control:selectedControlPath,command,receiptPrefix};
   await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:observerSource.replace('__T33_PUBLIC_PAUSE_CONFIG__',JSON.stringify(endpoints))});
   await browser.command('Page.reload');
   const publicationList='[aria-label="已发布公开进展"] li';
   await browser.waitFor('Boolean(globalThis.__t33PublicPauseControl&&Array.from(document.querySelectorAll('+JSON.stringify(publicationList)+')).some(row=>row.textContent.includes('+JSON.stringify(publishBody.summary)+')&&Array.from(row.querySelectorAll("button")).some(button=>button.textContent.trim()==="查看本次按路结果"&&!button.disabled)))');
   await browser.evaluate('(()=>{const rows=Array.from(document.querySelectorAll('+JSON.stringify(publicationList)+')).filter(row=>row.textContent.includes('+JSON.stringify(publishBody.summary)+'));if(rows.length!==1)throw new Error("T33_UNIQUE_PUBLISHED_SUMMARY_REQUIRED");const button=Array.from(rows[0].querySelectorAll("button")).find(button=>button.textContent.trim()==="查看本次按路结果");if(!button||button.disabled)throw new Error("T33_REAL_PUBLICATION_ROUTE_BUTTON_UNAVAILABLE");button.click();})()');
   await browser.waitFor('Boolean(document.querySelector('+JSON.stringify(root+' [aria-label="选择通知路"] option[value="'+selectedDeliveryId+'"]')+'))');
   await browser.waitFor('globalThis.__t33PublicPauseControl.requests.some(row=>row.path==='+JSON.stringify(parent)+'&&row.method==="GET"&&row.response_status===200&&row.client_returned&&row.response?.row_version==='+JSON.stringify(parentVersion)+')');
   const routeSelector='[data-public-progress-routes][data-publication-id="'+publicationId+'"] [data-delivery-id="'+selectedDeliveryId+'"]';
   await browser.waitFor('document.querySelector('+JSON.stringify(routeSelector)+')?.dataset.deliveryStatus==="RECONCILIATION_REQUIRED"');
   await choose('选择通知路',selectedDeliveryId);
   await browser.waitFor('document.querySelector('+JSON.stringify(root+' option[value="RECONCILE"]')+')?.disabled===false');
   await choose('投递控制操作','RECONCILE');await choose('投递操作原因','OPERATOR_VERIFIED_DELIVERY');await choose('未知发送核对结论','CONFIRMED_NOT_SENT_REQUEUE');
   const submit=root+' [data-action="submit-incident-delivery-control"]',confirmation=root+' input[aria-label="确认本路投递操作"]',outcome=root+' [data-incident-delivery-outcome]';
   assert.ok((await content()).includes('捕获公共故障版本 '+parentVersion+'；'));assert.ok((await content()).includes('捕获尝试 1，'));
   assert.equal(await browser.evaluate('document.querySelector('+JSON.stringify(confirmation)+')?.checked'),false);
   assert.equal(await browser.evaluate('document.querySelector('+JSON.stringify(submit)+')?.disabled'),true);
   assert.equal(posts(await events()).length,0);
   await browser.evaluate('document.querySelector('+JSON.stringify(confirmation)+').click()');
   await browser.waitFor('document.querySelector('+JSON.stringify(submit)+')?.disabled===false');
   await quiet();assert.equal(posts(await events()).length,0);assert.equal(senderCalls(),2);
   phase='fresh-paused-parent-ui-selection-and-explicit-confirmation';
   await browser.evaluate('document.querySelector('+JSON.stringify(submit)+').click()');
   await browser.waitFor('globalThis.__t33PublicPauseControl.requests.some(row=>row.controlPost&&row.client_returned&&row.response_status!==null)');

   const sentEvents=await events(),controlPosts=posts(sentEvents);assert.equal(controlPosts.length,1);
   const request=controlPosts[0];assert.ok(request);assert.equal(request.path,command);assert.equal(request.method,'POST');assert.equal(request.previous_fetch_called,true);assert.equal(request.client_returned,true);
   rawBody=text(request.body);bodySha256=createHash('sha256').update(rawBody,'utf8').digest('hex');bodyBytes=Buffer.byteLength(rawBody,'utf8');
   const body=closed(JSON.parse(rawBody),['client_command_id','expected_row_version','expected_status','expected_side_effect_state','expected_delivery_attempt_count','reason_code','resolution']);
   originalId=text(body.client_command_id);assert.match(originalId,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
   assert.equal(body.expected_row_version,parentVersion);assert.equal(body.expected_status,'RECONCILIATION_REQUIRED');assert.equal(body.expected_side_effect_state,'UNKNOWN');assert.equal(body.expected_delivery_attempt_count,1);
   assert.equal(body.reason_code,'OPERATOR_VERIFIED_DELIVERY');assert.equal(body.resolution,'CONFIRMED_NOT_SENT_REQUEUE');
   const headers=record(request.headers);assert.equal(headers.idempotency_key,originalId);assert.equal(headers.if_match,'"'+parentVersion+'"');assert.equal(headers.content_type,'application/json');assert.equal(headers.accept,'application/json');
   const preflightActor=sentEvents.filter(row=>row.path===bootstrapPath&&row.method==='GET'&&row.response_status===200&&row.client_returned&&count(row.sequence)<count(request.sequence)).at(-1);
   const preflightControl=sentEvents.filter(row=>row.path===selectedControlPath&&row.method==='GET'&&row.response_status===200&&row.client_returned&&count(row.sequence)<count(request.sequence)).at(-1);
   const preflightParent=sentEvents.filter(row=>row.path===parent&&row.method==='GET'&&row.response_status===200&&row.client_returned&&count(row.sequence)<count(request.sequence)).at(-1);
   assert.ok(preflightActor&&preflightControl&&preflightParent);
   const authorizedActor=record(preflightActor.response);assert.equal(authorizedActor.principal_id,adminId);assert.deepEqual(authorizedActor.roles,actor.body.roles);assert.equal(authorizedActor.authorization_revision,actor.body.authorization_revision);
   assert.equal(headers.csrf,text(authorizedActor.csrf_token));assert.equal(record(preflightParent.response).row_version,parentVersion);
   const currentCap=capability(preflightControl.response,selectedDeliveryId),authorityHeaders=record(preflightControl.response_headers);
   assert.equal(authorityHeaders.retry_authorized,'1');assert.equal(authorityHeaders.reconcile_authorized,'1');
   currentAuthority={principal_id:authorizedActor.principal_id,roles:authorizedActor.roles,authorization_revision:authorizedActor.authorization_revision,capability:currentCap,headers:authorityHeaders};

   // Exact current contract accepts a real business refusal here. The frozen
   // implementation reports403; an existing STATE_CONFLICT409 classification
   // can satisfy the same safety case. Neither status grants actor authority.
   const response={status:count(request.response_status),body:record(request.response)};
   actualHttpStatus=response.status;assert.ok([403,409].includes(response.status),JSON.stringify(response));
   const refusal=closed(response.body,['error']),error=closed(refusal.error,['code','retryable']);
   actualErrorCode=text(error.code);assert.match(actualErrorCode,/^P2_012_[A-Z0-9_]{1,96}$/u);assert.equal(error.retryable,false);
   const receiptPath=receiptPrefix+originalId,receipt=await get(receiptPath);assert.equal(receipt.status,200,JSON.stringify(receipt.body));
   officialReceipt=closed(receipt.body,['state','incident_id','client_command_id','error']);
   assert.equal(officialReceipt.state,'FAILED');assert.equal(officialReceipt.incident_id,incidentId);assert.equal(officialReceipt.client_command_id,originalId);assert.deepEqual(officialReceipt.error,error);
   assert.deepEqual((await get(receiptPath)).body,officialReceipt,'the actual original UUID has a stable authorized FAILED receipt');
   const afterActor=await get(bootstrapPath),afterParent=await get(parent),afterControl=await get(selectedControlPath);
   assert.equal(afterActor.status,200);assert.equal(afterParent.status,200);assert.equal(afterControl.status,200);
   assert.equal(afterActor.body.principal_id,adminId);assert.deepEqual(afterActor.body.roles,actor.body.roles);assert.equal(afterActor.body.authorization_revision,actor.body.authorization_revision);
   assert.equal(afterActor.body.incident_delivery_control_enabled,true);assert.notEqual(afterActor.body.incident_delivery_control_draft_recovery_enabled,true);
   assert.equal(afterParent.body.row_version,parentVersion);capability(afterControl.body,selectedDeliveryId);
   assert.deepEqual([...grants].sort(),grantSnapshot);
   assert.deepEqual(await progressRows(publicationId),beforeRefusal);assert.deepEqual(await getLifecycleRows(),initialLifecycle);
   assert.equal(senderCalls(),2,'the user control refusal did not invoke an additional Sender');
   phase='real-business-refusal-stable-failed-receipt-current-authority';
   console.log('T33_PUBLIC_PAUSE_SERVER_FACTS '+JSON.stringify({publicationId,selectedDeliveryId,selectedSubscriptionId,legacyId,legacyAudience:legacy?.audience_type,parentVersion,originalId,bodyBytes,bodySha256,actualHttpStatus,actualErrorCode,currentAuthority,receipt_http_status:receipt.status,receipt:officialReceipt,sender_calls:senderCalls(),sibling:siblingBefore}));

   // Observe the real outcome before asserting it. A successfully cleaned known
   // terminal may release the opaque UUID barrier; no permanent UI UUID display
   // requirement or fabricated ACK is added to this case.
   await browser.waitFor('["failed","denied","unknown","committed"].includes(document.querySelector('+JSON.stringify(outcome)+')?.dataset.incidentDeliveryState)');
   observedUiState=await browser.evaluate('document.querySelector('+JSON.stringify(outcome)+')?.dataset.incidentDeliveryState??null');
   const uiSnapshot={state:observedUiState,selected:await input('选择通知路'),action:await input('投递控制操作'),reason:await input('投递操作原因'),resolution:await input('未知发送核对结论'),text:await content()};
   console.log('T33_PUBLIC_PAUSE_ACTUAL_UI_BEFORE_EXPECTATION '+JSON.stringify(uiSnapshot));
   await capture('public-progress-business-refusal-actual-'+String(observedUiState),root);
   assert.equal(observedUiState,'failed','a current authorized actor must see this actual terminal business refusal as failure');
   assert.equal(await input('选择通知路'),selectedDeliveryId);assert.equal(await input('投递控制操作'),'RECONCILE');
   assert.equal(await input('投递操作原因'),body.reason_code);assert.equal(await input('未知发送核对结论'),body.resolution);
   assert.ok((await content()).includes('捕获公共故障版本 '+parentVersion+'；'));assert.ok((await content()).includes('捕获尝试 1，'));
   assert.equal(await browser.evaluate('document.querySelector('+JSON.stringify(submit)+')?.disabled'),true);
   const refresh=root+' [data-action="refresh-incident-delivery-current"]';
   await browser.waitFor('document.querySelector('+JSON.stringify(refresh)+')?.disabled===false');
   await quiet();assert.equal(posts(await events()).length,1);assert.equal(senderCalls(),2);

   const refreshMark=(await events()).length;
   await browser.evaluate('document.querySelector('+JSON.stringify(refresh)+').click()');
   await browser.waitFor('(()=>{const rows=globalThis.__t33PublicPauseControl.requests.filter(row=>row.sequence>='+refreshMark+'&&row.method==="GET"&&row.response_status===200&&row.client_returned);return rows.some(row=>row.path==='+JSON.stringify(bootstrapPath)+')&&rows.some(row=>row.path==='+JSON.stringify(parent)+')&&rows.some(row=>row.path==='+JSON.stringify(selectedControlPath)+');})()');
   await browser.waitFor('!["reading","preparing","submitting","checking"].includes(document.querySelector('+JSON.stringify(outcome)+')?.dataset.incidentDeliveryState)');
   const refreshed=(await events()).filter(row=>count(row.sequence)>=refreshMark&&row.method==='GET'&&row.response_status===200&&row.client_returned);
   const refreshedControl=refreshed.find(row=>row.path===selectedControlPath);assert.ok(refreshedControl);capability(refreshedControl.response,selectedDeliveryId);
   assert.equal(record(refreshedControl.response_headers).reconcile_authorized,'1');assert.equal(record(refreshedControl.response_headers).retry_authorized,'1');
   assert.notEqual(await browser.evaluate('document.querySelector('+JSON.stringify(outcome)+')?.dataset.incidentDeliveryState'),'denied');
   assert.equal(await input('选择通知路'),selectedDeliveryId);assert.equal(await input('投递操作原因'),body.reason_code);assert.equal(await input('未知发送核对结论'),body.resolution);
   await quiet();assert.equal(posts(await events()).length,1);assert.equal(senderCalls(),2);
   const stable=await get(receiptPath);assert.equal(stable.status,200);assert.deepEqual(stable.body,officialReceipt);
   assert.deepEqual(await progressRows(publicationId),beforeRefusal);assert.deepEqual(await getLifecycleRows(),initialLifecycle);assert.deepEqual([...grants].sort(),grantSnapshot);
   phase='ui-known-failure-retained-input-and-explicit-readonly-refresh';
  }finally{
   const finalUi={state:await browser.evaluate('document.querySelector('+JSON.stringify(root+' [data-incident-delivery-outcome]')+')?.dataset.incidentDeliveryState??null'),selected:await input('选择通知路'),action:await input('投递控制操作'),reason:await input('投递操作原因'),resolution:await input('未知发送核对结论'),text:await content()};
   console.log('T33_PUBLIC_PAUSE_ACTUAL_UI_FINALLY '+JSON.stringify(finalUi));
   const observed=await events();
   console.log('T33_PUBLIC_PAUSE_BROWSER_REQUESTS '+JSON.stringify(observed.filter(row=>row.controlPost===true||row.path===selectedControlPath||text(row.path).startsWith(receiptPrefix)).map(row=>({...row,headers:{...record(row.headers),csrf:record(row.headers).csrf===null?null:'PRESENT'}}))));
   console.log('T33_PUBLIC_PAUSE_BOUNDARY '+JSON.stringify({phase,publicationId,selectedDeliveryId,selectedSubscriptionId,parentVersion,originalId,rawBody,bodyBytes,bodySha256,actualHttpStatus,actualErrorCode,observedUiState,officialReceipt,currentAuthority,setupPublication,setupPause,page_control_posts:posts(observed).length,sender_calls:senderCalls(),simulated_responses:false,request_loss_injected:false,scope_grants_mutated:false}));
   await capture('public-progress-pause-final-'+phase,root);
  }
 },{publicProgress:true,externalSend:true,draftRecovery:false});
});
