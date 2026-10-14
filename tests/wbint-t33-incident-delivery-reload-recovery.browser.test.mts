import assert from 'node:assert/strict';
import {test} from 'node:test';
import {t33IncidentBrowser} from './helpers/t33-incident-delivery-browser-fixture.mjs';

function record(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function records(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(record);}
function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
function integer(value:unknown):number{assert.equal(typeof value,'number');assert.ok(Number.isSafeInteger(value));const result=value as number;assert.ok(result>=0);return result;}
function count(value:unknown):number{const result=integer(value);assert.ok(result<=2147483647);return result;}
function closed(value:unknown,keys:readonly string[]):Record<string,unknown>{const row=record(value);assert.deepEqual(Object.keys(row).sort(),[...keys].sort());return row;}

test('T33 production detail reloads its encrypted original v2 command after real COMMIT response loss with fixture recovery opt-in, then explicitly reads the original ACK',{timeout:240000},async()=>{
 await t33IncidentBrowser(async({browser,origin,incidentId,deliveryId,siblingId,adminId,get,getLifecycleRows,senderCalls,capture})=>{
  const root='[data-control-purpose="INCIDENT_LIFECYCLE"]',command='/api/incidents/'+incidentId+'/notifications/'+deliveryId+'/reconcile';
  const endpoints={bootstrap:'/api/lifecycle/bootstrap',incident:'/api/incidents/'+incidentId,control:'/api/incidents/'+incidentId+'/notifications/'+deliveryId+'/control',command,receiptPrefix:'/api/incidents/'+incidentId+'/notification-commands/'};
  const scope=JSON.stringify([adminId,'incident',incidentId,'incident-delivery-lifecycle']);
  const observer=String.raw`(()=>{
 const config=__T33_RELOAD_CONFIG__,endpoints=config.endpoints;
 const previousFetch=globalThis.fetch;
 const state={phase:config.phase,requests:[],lossCount:0,quietStart:0,firstFullRestore:null};
 globalThis.__t33ReloadRecovery=state;
 globalThis.fetch=async(input,options)=>{
  const path=new URL(String(input),location.href).pathname,method=String(options?.method??'GET').toUpperCase(),segments=path.split('/');
  const controlPost=method==='POST'&&segments.length===7&&segments[1]==='api'&&segments[2]==='incidents'&&segments[4]==='notifications'&&(segments[6]==='retry'||segments[6]==='reconcile');
  const watched=controlPost||method==='GET'&&(path===endpoints.bootstrap||path===endpoints.incident||path===endpoints.control||path.startsWith(endpoints.receiptPrefix));
  const headers=new Headers(options?.headers);
  const request=watched?{sequence:state.requests.length,path,method,controlPost,body:typeof options?.body==='string'?options.body:null,headers:{idempotency_key:headers.get('idempotency-key'),if_match:headers.get('if-match'),csrf:headers.get('x-csrf-token'),content_type:headers.get('content-type')},response_status:null,response:null,client_returned:false,loss_injected:false}:null;
  if(request)state.requests.push(request);
  try{
   const response=await previousFetch(input,options);
   if(request){request.response_status=response.status;request.response=await response.clone().json();}
   if(config.dropResponse&&controlPost&&path===endpoints.command&&response.status===200&&state.lossCount===0){state.lossCount++;request.loss_injected=true;throw new TypeError('T33_RELOAD_RESPONSE_LOST_AFTER_REAL_ACK');}
   if(request)request.client_returned=true;
   return response;
  }catch(error){if(request)request.error=error instanceof Error?error.message:String(error);throw error;}
 };
 if(config.expected){
  const expected=config.expected;
  const watch=new MutationObserver(()=>{
   const root=document.querySelector('[data-control-purpose="INCIDENT_LIFECYCLE"]');
   if(!root||state.firstFullRestore)return;
   const selected=label=>root.querySelector('select[aria-label="'+label+'"]')?.value,content=root.textContent??'';
   if(selected('选择通知路')!==expected.deliveryId||selected('投递控制操作')!=='RECONCILE'||selected('投递操作原因')!==expected.body.reason_code||selected('未知发送核对结论')!==expected.body.resolution||!content.includes('捕获公共故障版本 '+expected.body.expected_row_version+'；')||!content.includes('捕获尝试 '+expected.body.expected_delivery_attempt_count+'，'))return;
   state.firstFullRestore={reads:state.requests.filter(row=>row.method==='GET'&&row.response_status===200&&row.client_returned),selected:{deliveryId:selected('选择通知路'),action:selected('投递控制操作'),reason:selected('投递操作原因'),resolution:selected('未知发送核对结论')}};
   watch.disconnect();
  });
  watch.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
 }
 return true;
})()`;
  const vaultReader=String.raw`(async()=>{
 const scope=__T33_VAULT_SCOPE__,name='wecom-workbench-drafts-v1';
 if(!(await indexedDB.databases()).some(row=>row.name===name))return {metadata:null,copy:null,operation:null};
 const actual=await new Promise((resolve,reject)=>{
  const request=indexedDB.open(name);
  request.onupgradeneeded=()=>request.transaction?.abort();
  request.onerror=()=>reject(new Error('T33_VAULT_READ_OPEN_FAILED'));
  request.onblocked=()=>reject(new Error('T33_VAULT_READ_BLOCKED'));
  request.onsuccess=()=>{
   const db=request.result;
   if(!db.objectStoreNames.contains('drafts')||!db.objectStoreNames.contains('operations')){db.close();reject(new Error('T33_VAULT_READ_STORES_MISSING'));return;}
   const tx=db.transaction(['drafts','operations'],'readonly'),draft=tx.objectStore('drafts').get(scope),operation=tx.objectStore('operations').get(scope);
   tx.oncomplete=()=>{db.close();resolve({draft:draft.result??null,operation:operation.result??null});};
   tx.onabort=()=>{db.close();reject(new Error('T33_VAULT_READ_ABORTED'));};tx.onerror=()=>{};
  };
 });
 if(!actual.draft)return {metadata:null,copy:null,operation:actual.operation};
 const row=actual.draft,aad=new TextEncoder().encode(JSON.stringify([row.schema,row.scope,row.firstSavedAt,row.expiresAt,row.revision]));
 const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:row.iv,additionalData:aad,tagLength:128},row.key,row.ciphertext);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',row.ciphertext)),value=>value.toString(16).padStart(2,'0')).join('');
 return {metadata:{schema:row.schema,scope:row.scope,principal:row.principal,kind:row.kind,id:row.id,purpose:row.purpose,firstSavedAt:row.firstSavedAt,expiresAt:row.expiresAt,revision:row.revision,iv_bytes:row.iv.byteLength,ciphertext_bytes:row.ciphertext.byteLength,ciphertext_sha256:hash,key_extractable:row.key.extractable,key_type:row.key.type,key_algorithm:row.key.algorithm.name,key_bits:row.key.algorithm.length},copy:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plaintext)),operation:actual.operation};
})()`;
  const readVault=async()=>record(await browser.evaluate(vaultReader.replace('__T33_VAULT_SCOPE__',JSON.stringify(scope))));
  const trace=async()=>record(await browser.evaluate('globalThis.__t33ReloadRecovery'));
  const events=async()=>records((await trace()).requests);
  const posts=(rows:readonly Record<string,unknown>[])=>rows.filter(row=>row.controlPost===true);
  const receipts=(rows:readonly Record<string,unknown>[])=>rows.filter(row=>row.method==='GET'&&text(row.path).startsWith(endpoints.receiptPrefix));
  const quiet=async()=>{await browser.evaluate('globalThis.__t33ReloadRecovery.quietStart=performance.now()');await browser.waitFor('performance.now()-globalThis.__t33ReloadRecovery.quietStart>=400');};
  const choose=async(label:string,value:string)=>{
   const selector=root+' select[aria-label="'+label+'"]';
   await browser.evaluate('(()=>{const field=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(field,'+JSON.stringify(value)+');field.dispatchEvent(new Event("change",{bubbles:true}));})()');
  };
  const input=async(label:string)=>browser.evaluate('document.querySelector('+JSON.stringify(root+' select[aria-label="'+label+'"]')+').value');
  const content=async()=>text(await browser.evaluate('document.querySelector('+JSON.stringify(root)+').textContent'));
  const status=root+' [data-incident-delivery-draft-status]';
  await browser.waitFor('Boolean(document.querySelector('+JSON.stringify(root+'[data-incident-delivery-controls]')+'))');
  const session=await get(endpoints.bootstrap);assert.equal(session.status,200);
  assert.equal(session.body.principal_id,adminId);
  assert.equal(session.body.incident_delivery_control_enabled,true);
  assert.equal(session.body.incident_delivery_control_draft_recovery_enabled,true,'only this fixture explicitly opts in; production defaults are not changed');
  assert.equal(await browser.evaluate(observer.replace('__T33_RELOAD_CONFIG__',JSON.stringify({phase:'before-reload',endpoints,dropResponse:true,expected:null}))),true);
  await browser.waitFor('["ready","saved"].includes(document.querySelector('+JSON.stringify(status)+')?.dataset.incidentDeliveryDraftStatus)');
  await choose('选择通知路',deliveryId);
  await browser.waitFor('document.querySelector('+JSON.stringify(root+' option[value="RECONCILE"]')+')?.disabled===false');
  await choose('投递控制操作','RECONCILE');
  await choose('投递操作原因','OPERATOR_VERIFIED_DELIVERY');
  await choose('未知发送核对结论','CONFIRMED_SENT');
  await browser.waitFor('document.querySelector('+JSON.stringify(status)+')?.dataset.incidentDeliveryDraftStatus==="saved"');
  const initialVault=await readVault(),initialCopy=closed(initialVault.copy,['schema','value','pending']),initialValue=record(initialCopy.value),initialMetadata=record(initialVault.metadata);
  assert.equal(initialCopy.schema,2);assert.equal(initialCopy.pending,null);assert.equal(initialVault.operation,null);
  assert.equal(initialValue.deliveryId,deliveryId);assert.equal(initialValue.action,'RECONCILE');
  assert.equal(initialValue.reason,'OPERATOR_VERIFIED_DELIVERY');assert.equal(initialValue.resolution,'CONFIRMED_SENT');
  assert.equal(initialMetadata.scope,scope);assert.equal(initialMetadata.principal,adminId);assert.equal(initialMetadata.kind,'incident');
  assert.equal(initialMetadata.id,incidentId);assert.equal(initialMetadata.purpose,'incident-delivery-lifecycle');
  assert.equal(initialMetadata.key_extractable,false);assert.equal(initialMetadata.key_type,'secret');assert.equal(initialMetadata.key_algorithm,'AES-GCM');assert.equal(initialMetadata.key_bits,256);
  assert.equal(integer(initialMetadata.expiresAt)-integer(initialMetadata.firstSavedAt),86400000);
  assert.equal(posts(await events()).length,0,'the existing bounded autosave never sends a business command');
  const submit=root+' [data-action="submit-incident-delivery-control"]';
  assert.equal(await browser.evaluate('document.querySelector('+JSON.stringify(submit)+').disabled'),true);
  await browser.evaluate('document.querySelector('+JSON.stringify(root+' input[aria-label="确认本路投递操作"]')+').click()');
  await browser.waitFor('document.querySelector('+JSON.stringify(submit)+')?.disabled===false');
  await capture('reload-recovery-existing-post-confirmation');
  await browser.evaluate('document.querySelector('+JSON.stringify(submit)+').click()');
  const outcome=root+' [data-incident-delivery-outcome]';
  await browser.waitFor('document.querySelector('+JSON.stringify(outcome)+')?.dataset.incidentDeliveryState==="unknown"');
  await browser.waitFor('document.querySelector('+JSON.stringify(status)+')?.dataset.incidentDeliveryDraftStatus==="saved"');
  const before=await events(),sent=posts(before);assert.equal(sent.length,1);
  const post=sent[0];assert.ok(post);assert.equal(post.path,command);assert.equal(post.response_status,200);
  assert.equal(post.client_returned,false);assert.equal(post.loss_injected,true);assert.equal(post.error,'T33_RELOAD_RESPONSE_LOST_AFTER_REAL_ACK');
  const body=closed(JSON.parse(text(post.body)),['client_command_id','expected_row_version','expected_status','expected_side_effect_state','expected_delivery_attempt_count','reason_code','resolution']);
  const uuid=text(body.client_command_id),version=text(body.expected_row_version),attempt=count(body.expected_delivery_attempt_count);
  assert.match(uuid,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
  assert.match(version,/^[1-9][0-9]{0,18}$/u);assert.ok(BigInt(version)<=9223372036854775807n);
  assert.equal(version,initialValue.version);assert.equal(attempt,count(initialValue.attemptCount));
  assert.equal(body.expected_status,'RECONCILIATION_REQUIRED');assert.equal(body.expected_side_effect_state,'UNKNOWN');
  assert.equal(body.reason_code,'OPERATOR_VERIFIED_DELIVERY');assert.equal(body.resolution,'CONFIRMED_SENT');
  const headers=record(post.headers);assert.equal(headers.idempotency_key,uuid);assert.equal(headers.if_match,'"'+version+'"');
  assert.equal(headers.content_type,'application/json');
  const preflight=before.filter(row=>row.method==='GET'&&integer(row.sequence)<integer(post.sequence)&&row.response_status===200);
  const preAuth=preflight.filter(row=>row.path===endpoints.bootstrap).at(-1),preCap=preflight.filter(row=>row.path===endpoints.control).at(-1);
  assert.ok(preAuth&&preCap);const principal=record(preAuth.response);
  assert.equal(principal.principal_id,adminId);assert.equal(principal.incident_delivery_control_enabled,true);assert.equal(principal.incident_delivery_control_draft_recovery_enabled,true);
  assert.equal(headers.csrf,text(principal.csrf_token));
  assert.equal(record(preCap.response).incident_id,incidentId);assert.equal(record(preCap.response).delivery_id,deliveryId);
  assert.equal(record(preCap.response).reconcile,true);assert.equal(record(preCap.response).receipt_read,true);assert.equal(attempt,count(record(preCap.response).attempt_count));
  const originalAck=closed(post.response,['ok','incident_id','delivery_id','client_command_id','status','side_effect_state','attempt_count','replayed']);
  assert.equal(originalAck.ok,true);assert.equal(originalAck.incident_id,incidentId);assert.equal(originalAck.delivery_id,deliveryId);
  assert.equal(originalAck.client_command_id,uuid);assert.equal(originalAck.status,'SENT');assert.equal(originalAck.side_effect_state,'ACKNOWLEDGED');count(originalAck.attempt_count);
  assert.equal(originalAck.replayed,false);
  const receiptPath=endpoints.receiptPrefix+uuid,server=await get(receiptPath);assert.equal(server.status,200);
  const committed=closed(server.body,['state','incident_id','client_command_id','result']);
  assert.equal(committed.state,'COMMITTED');assert.equal(committed.incident_id,incidentId);assert.equal(committed.client_command_id,uuid);
  assert.deepEqual(committed.result,originalAck,'the authoritative server has COMMITTED while the page saw network failure');
  await quiet();assert.equal(posts(await events()).length,1);assert.equal(receipts(await events()).length,0);
  assert.equal((await trace()).lossCount,1);assert.equal(senderCalls(),1);
  const stored=await readVault(),storedCopy=closed(stored.copy,['schema','value','pending']),storedPending=closed(storedCopy.pending,['incidentId','deliveryId','purpose','action','body']);
  assert.equal(storedCopy.schema,2);assert.deepEqual(storedCopy.value,initialCopy.value);
  assert.equal(storedPending.incidentId,incidentId);assert.equal(storedPending.deliveryId,deliveryId);assert.equal(storedPending.purpose,'INCIDENT_LIFECYCLE');
  assert.equal(storedPending.action,'RECONCILE');assert.deepEqual(storedPending.body,body,'real encrypted storage contains the exact immutable original v2 body');
  const storedOperation=closed(stored.operation,['scope','principal','kind','id','purpose','commandId','createdAt']);
  assert.equal(storedOperation.scope,scope);assert.equal(storedOperation.commandId,uuid);
  assert.equal(record(stored.metadata).firstSavedAt,initialMetadata.firstSavedAt);assert.equal(record(stored.metadata).expiresAt,initialMetadata.expiresAt);
  assert.ok((await content()).includes('原通知操作 UUID：'+uuid));
  await capture('reload-recovery-committed-response-lost');

  const reloadConfig={phase:'after-reload',endpoints,dropResponse:false,expected:{deliveryId,body}};
  await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:observer.replace('__T33_RELOAD_CONFIG__',JSON.stringify(reloadConfig))});
  await browser.command('Page.reload');
  await browser.waitFor('globalThis.__t33ReloadRecovery?.phase==="after-reload"');
  await browser.waitFor('location.href==='+JSON.stringify(origin+'/workbench/app/incidents/'+incidentId));
  await browser.waitFor('Boolean(globalThis.__t33ReloadRecovery.firstFullRestore)');
  await browser.waitFor('document.querySelector('+JSON.stringify(outcome)+')?.dataset.incidentDeliveryState==="unknown"');
  await browser.waitFor('document.querySelector('+JSON.stringify(status)+')?.dataset.incidentDeliveryDraftStatus==="saved"');
  const restoredTrace=await trace(),visible=record(restoredTrace.firstFullRestore),freshReads=records(visible.reads);
  const restoreAuth=freshReads.filter(row=>row.path===endpoints.bootstrap).at(-1),restoreIncident=freshReads.filter(row=>row.path===endpoints.incident).at(-1),restoreCap=freshReads.filter(row=>row.path===endpoints.control).at(-1);
  assert.ok(restoreAuth&&restoreIncident&&restoreCap,'real current READ and exact capability complete before full private body appears');
  const restorePrincipal=record(restoreAuth.response);
  assert.equal(restorePrincipal.principal_id,adminId);assert.equal(restorePrincipal.incident_delivery_control_enabled,true);assert.equal(restorePrincipal.incident_delivery_control_draft_recovery_enabled,true);
  const cap=closed(restoreCap.response,['incident_id','delivery_id','purpose','retry','reconcile','receipt_read','disabled','attempt_count']);
  assert.equal(cap.incident_id,incidentId);assert.equal(cap.delivery_id,deliveryId);assert.equal(cap.purpose,'INCIDENT_LIFECYCLE');assert.equal(cap.receipt_read,true);assert.equal(cap.reconcile,false,'current SENT state forbids a new reconcile; it does not revoke the original UUID purpose');
  assert.equal(await input('选择通知路'),deliveryId);assert.equal(await input('投递控制操作'),'RECONCILE');
  assert.equal(await input('投递操作原因'),body.reason_code);assert.equal(await input('未知发送核对结论'),body.resolution);
  const restoredContent=await content();
  assert.ok(restoredContent.includes('原通知操作 UUID：'+uuid));assert.ok(restoredContent.includes('原版本：'+version));
  assert.ok(restoredContent.includes('捕获公共故障版本 '+version+'；'));assert.ok(restoredContent.includes('捕获尝试 '+attempt+'，'));
  assert.equal(await browser.evaluate('document.querySelector('+JSON.stringify(root+' input[aria-label="确认本路投递操作"]')+').checked'),false,'reload never restores action confirmation');
  assert.equal(await browser.evaluate('document.querySelector('+JSON.stringify(submit)+').disabled'),true);
  assert.equal(await browser.evaluate('Boolean(document.querySelector('+JSON.stringify(root+' [data-incident-delivery-receipt]')+'))'),false);
  const restoredVault=await readVault();assert.deepEqual(restoredVault.copy,stored.copy);assert.deepEqual(restoredVault.operation,stored.operation);
  assert.deepEqual(restoredVault.metadata,stored.metadata,'reload does not rewrite the original cipher, UUID, attempt, version or first-save expiry');
  await quiet();const afterReload=await events();assert.equal(posts(afterReload).length,0);assert.equal(receipts(afterReload).length,0);
  assert.equal((await trace()).lossCount,0);assert.equal(senderCalls(),1);
  await capture('reload-recovery-original-v2-restored-without-receipt-read');

  const check=root+' [data-action="check-incident-delivery-operation"]';
  await browser.waitFor('document.querySelector('+JSON.stringify(check)+')?.disabled===false');
  await browser.evaluate('document.querySelector('+JSON.stringify(check)+').click()');
  await browser.waitFor('document.querySelector('+JSON.stringify(outcome)+')?.dataset.incidentDeliveryState==="committed"');
  await browser.waitFor('Boolean(document.querySelector('+JSON.stringify(root+' [data-incident-delivery-receipt]')+'))');
  await quiet();const completed=await events(),reads=receipts(completed);assert.equal(reads.length,1);
  assert.equal(posts(completed).length+sent.length,1,'explicit original-receipt recovery does not POST or replay across reload');
  const read=reads[0];assert.ok(read);assert.equal(read.path,receiptPath);assert.equal(read.method,'GET');assert.equal(read.body,null);
  assert.equal(read.response_status,200);assert.equal(read.client_returned,true);assert.deepEqual(read.response,server.body);
  const beforeReceipt=completed.filter(row=>row.method==='GET'&&integer(row.sequence)<integer(read.sequence)&&row.response_status===200);
  const receiptAuth=beforeReceipt.filter(row=>row.path===endpoints.bootstrap).at(-1),receiptCap=beforeReceipt.filter(row=>row.path===endpoints.control).at(-1);
  assert.ok(receiptAuth&&receiptCap);assert.equal(record(receiptAuth.response).principal_id,adminId);
  assert.equal(record(receiptCap.response).incident_id,incidentId);assert.equal(record(receiptCap.response).delivery_id,deliveryId);assert.equal(record(receiptCap.response).receipt_read,true);
  const rows=await getLifecycleRows(),selected=rows.find(row=>row.delivery_id===deliveryId),sibling=rows.find(row=>row.delivery_id===siblingId);
  assert.equal(selected?.status,'SENT');assert.equal(selected?.side_effect_state,'ACKNOWLEDGED');assert.equal(selected?.attempt_count,originalAck.attempt_count);
  assert.equal(sibling?.status,'PENDING');assert.equal(sibling?.side_effect_state,'NOT_ATTEMPTED');assert.equal(senderCalls(),1);
  const settled=await readVault();assert.equal(settled.copy,null);assert.equal(settled.metadata,null);assert.equal(settled.operation,null);
  assert.ok((await content()).includes('不代表报修人已读'));
  await capture('reload-recovery-explicit-original-ack-settled');
 },{draftRecovery:true});
});
