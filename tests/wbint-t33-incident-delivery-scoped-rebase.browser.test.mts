import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {t33IncidentBrowser} from './helpers/t33-incident-delivery-browser-fixture.mjs';

function record(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function records(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(record);}
function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
function number(value:unknown):number{assert.equal(typeof value,'number');assert.ok(Number.isSafeInteger(value));return value as number;}
function closed(value:unknown,keys:readonly string[]):Record<string,unknown>{const row=record(value);assert.deepEqual(Object.keys(row).sort(),[...keys].sort());return row;}
const observerSource=String.raw`(()=>{
 const config=__T33_SCOPED_CONFIG__,previousFetch=globalThis.fetch;
 const state={requests:[],vaultEvents:[],quietStart:0};globalThis.__t33ScopedRebase=state;
 globalThis.fetch=async(input,options)=>{
  const path=new URL(String(input),location.href).pathname,method=String(options?.method??'GET').toUpperCase(),parts=path.split('/');
  const controlPost=method==='POST'&&parts.length===7&&parts[1]==='api'&&parts[2]==='incidents'&&parts[4]==='notifications'&&(parts[6]==='retry'||parts[6]==='reconcile');
  const watched=controlPost||method==='GET'&&(path===config.bootstrap||path===config.incident||path.startsWith(config.notificationsPrefix)&&path.endsWith('/control')||path.startsWith(config.receiptPrefix));
  const row=watched?{sequence:state.requests.length,path,method,controlPost,response_status:null,response:null,client_returned:false}:null;
  if(row)state.requests.push(row);
  try{
   const response=await previousFetch(input,options);
   if(row){row.response_status=response.status;row.response=await response.clone().json();row.client_returned=true;}
   return response;
  }catch(error){if(row)row.error=error instanceof Error?error.message:String(error);throw error;}
 };
 const channel=new BroadcastChannel('wecom-workbench-drafts-v1');
 channel.onmessage=event=>state.vaultEvents.push(event.data);
 globalThis.__t33ScopedRebaseVaultObserver=channel;
 return true;
})()`;
const vaultSource=String.raw`(async()=>{
 const config=__T33_SCOPED_VAULT__,name='wecom-workbench-drafts-v1';
 if(!(await indexedDB.databases()).some(value=>value.name===name))return {epoch:null,metadata:null,operation:null,copy:null};
 const actual=await new Promise((resolve,reject)=>{
  const request=indexedDB.open(name);request.onupgradeneeded=()=>request.transaction?.abort();
  request.onerror=()=>reject(new Error('T33_SCOPED_VAULT_OPEN_FAILED'));request.onblocked=()=>reject(new Error('T33_SCOPED_VAULT_BLOCKED'));
  request.onsuccess=()=>{
   const db=request.result;
   if(!['drafts','operations','control'].every(value=>db.objectStoreNames.contains(value))){db.close();reject(new Error('T33_SCOPED_VAULT_STORES_MISSING'));return;}
   const tx=db.transaction(['drafts','operations','control'],'readonly'),draft=tx.objectStore('drafts').get(config.scope),operation=tx.objectStore('operations').get(config.scope),epoch=tx.objectStore('control').get('epoch');
   tx.oncomplete=()=>{db.close();resolve({draft:draft.result??null,operation:operation.result??null,epoch:epoch.result??null});};
   tx.onabort=()=>{db.close();reject(new Error('T33_SCOPED_VAULT_READ_ABORTED'));};tx.onerror=()=>{};
  };
 });
 if(!actual.draft)return {epoch:actual.epoch,metadata:null,operation:actual.operation,copy:null};
 const row=actual.draft,hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',row.ciphertext)),value=>value.toString(16).padStart(2,'0')).join('');
 let copy=null;
 if(config.decrypt){
  const aad=new TextEncoder().encode(JSON.stringify([row.schema,row.scope,row.firstSavedAt,row.expiresAt,row.revision]));
  const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:row.iv,additionalData:aad,tagLength:128},row.key,row.ciphertext);
  copy=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plaintext));
 }
 return {epoch:actual.epoch,metadata:{scope:row.scope,principal:row.principal,kind:row.kind,id:row.id,purpose:row.purpose,revision:row.revision,firstSavedAt:row.firstSavedAt,expiresAt:row.expiresAt,ciphertext_sha256:hash,key_extractable:row.key.extractable},operation:actual.operation,copy};
})()`;

test('T33 current scoped grant revocation is rechecked at real cross-tab DRAFT_CHANGED rebase, without role or parent READ loss, and clears only that saved Incident scope',{timeout:300000},async()=>{
 await t33IncidentBrowser(async({browser,origin,incidentId,deliveryId,adminId,grants,secondIncident,get,getLifecycleRows,senderCalls,capture})=>{
  // Complete all fixture upserts before retaining either private draft. They can
  // affect authorization_revision and must not be confused with grant revocation.
  const otherId=await secondIncident();
  const bootstrap=await get('/api/lifecycle/bootstrap'),primaryRead=await get('/api/incidents/'+incidentId),otherRead=await get('/api/incidents/'+otherId);
  assert.equal(bootstrap.status,200);assert.equal(primaryRead.status,200);assert.equal(otherRead.status,200);
  assert.equal(bootstrap.body.principal_id,adminId);assert.ok(Array.isArray(bootstrap.body.roles)&&bootstrap.body.roles.includes('ADMIN'));
  assert.equal(bootstrap.body.incident_delivery_control_enabled,true);assert.equal(bootstrap.body.incident_delivery_control_draft_recovery_enabled,true);
  const otherRows=await get('/api/incidents/'+otherId+'/notifications?limit=10');assert.equal(otherRows.status,200);
  const otherRoute=records(otherRows.body.items).find(row=>row.status==='PENDING'&&row.side_effect_state==='NOT_ATTEMPTED');assert.ok(otherRoute);
  const otherDeliveryId=text(otherRoute.delivery_id),root='[data-control-purpose="INCIDENT_LIFECYCLE"]';
  const scope=JSON.stringify([adminId,'incident',incidentId,'incident-delivery-lifecycle']),otherScope=JSON.stringify([adminId,'incident',otherId,'incident-delivery-lifecycle']);
  const primaryControl='/api/incidents/'+incidentId+'/notifications/'+deliveryId+'/control',otherControl='/api/incidents/'+otherId+'/notifications/'+otherDeliveryId+'/control';
  const config=(id:string)=>({bootstrap:'/api/lifecycle/bootstrap',incident:'/api/incidents/'+id,notificationsPrefix:'/api/incidents/'+id+'/notifications/',receiptPrefix:'/api/incidents/'+id+'/notification-commands/'});
  await browser.command('Page.reload');
  await browser.waitFor('Boolean(document.querySelector('+JSON.stringify(root+'[data-incident-delivery-controls]')+'))');
  await browser.waitFor('["ready","saved"].includes(document.querySelector('+JSON.stringify(root+' [data-incident-delivery-draft-status]')+')?.dataset.incidentDeliveryDraftStatus)');
  assert.equal(await browser.evaluate(observerSource.replace('__T33_SCOPED_CONFIG__',JSON.stringify(config(incidentId)))),true);
  const observations='t33-native-cdp-observations-'+randomUUID();
  const installReply='(()=>{const channel=new BroadcastChannel('+JSON.stringify(observations)+');globalThis.__t33ScopedReplies=Object.create(null);channel.onmessage=event=>{const message=event.data;if(message?.protocol==="T33_NATIVE_CDP_OBSERVATION_V1"&&Number.isSafeInteger(message.requestId))globalThis.__t33ScopedReplies[message.requestId]=message;};globalThis.__t33ScopedReplyChannel=channel;return true;})()';
  assert.equal(await browser.evaluate(installReply),true);
  let targetId:string|null=null,sessionId:string|null=null,requestId=0,phase='second-target-precondition',grantRevoked=false,epochChanged=false,editIssued=false,primaryError:unknown;
  const ownTargets:string[]=[];const closureErrors:unknown[]=[];let closedTargets=0;
  const first=(expression:string)=>browser.evaluate(expression);
  const second=async(expression:string):Promise<unknown>=>{
   assert.ok(sessionId);
   const id=++requestId;
   // Browser exposes command(method,params). Its harness drops unsolicited CDP
   // events, so actual second-realm results use this separate observation wire.
   // It never posts on the real vault invalidation channel.
   const run='(async()=>{let message;try{const value=await ('+expression+');message={protocol:"T33_NATIVE_CDP_OBSERVATION_V1",requestId:'+id+',completed:true,value};}catch(error){message={protocol:"T33_NATIVE_CDP_OBSERVATION_V1",requestId:'+id+',completed:false,error:error instanceof Error?error.name+": "+error.message:String(error)};}const channel=new BroadcastChannel('+JSON.stringify(observations)+');channel.postMessage(message);channel.close();return true;})()';
   await browser.command('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method:'Runtime.evaluate',params:{expression:run,awaitPromise:true,returnByValue:true}})});
   await browser.waitFor('Boolean(globalThis.__t33ScopedReplies['+id+'])');
   const reply=record(await browser.evaluate('globalThis.__t33ScopedReplies['+id+']'));
   assert.equal(reply.protocol,'T33_NATIVE_CDP_OBSERVATION_V1');assert.equal(reply.requestId,id);
   assert.equal(reply.completed,true,'real second target did not complete: '+String(reply.error??''));
   return reply.value;
  };
  type Evaluate=(expression:string)=>Promise<unknown>;
  const waitIn=async(evaluate:Evaluate,condition:string)=>{
   const code='(async()=>{const end=performance.now()+15000;while(performance.now()<end){if('+condition+')return true;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error("T33_SECOND_TARGET_WAIT_TIMEOUT");})()';
   assert.equal(await evaluate(code),true);
  };
  const choose=async(evaluate:Evaluate,label:string,value:string)=>{
   const selector=root+' select[aria-label="'+label+'"]';
   await evaluate('(()=>{const field=document.querySelector('+JSON.stringify(selector)+');if(!field)throw new Error("T33_SELECT_MISSING");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(field,'+JSON.stringify(value)+');field.dispatchEvent(new Event("change",{bubbles:true}));return true;})()');
  };
  const probe=async(which:string,decrypt:boolean)=>record(await first(vaultSource.replace('__T33_SCOPED_VAULT__',JSON.stringify({scope:which,decrypt}))));
  const trace=async(evaluate:Evaluate)=>record(await evaluate('globalThis.__t33ScopedRebase'));
  const input=async(evaluate:Evaluate,label:string)=>evaluate('document.querySelector('+JSON.stringify(root+' select[aria-label="'+label+'"]')+')?.value??null');
  const saved=root+' [data-incident-delivery-draft-status]';
  try{
   const created=record(await browser.command('Target.createTarget',{url:origin+'/workbench/app/incidents/'+otherId,background:true}));
   targetId=text(created.targetId);assert.ok(targetId);ownTargets.push(targetId);
   const attached=record(await browser.command('Target.attachToTarget',{targetId,flatten:false}));sessionId=text(attached.sessionId);assert.ok(sessionId);
   await waitIn(second,'Boolean(document.querySelector('+JSON.stringify(root+'[data-incident-delivery-controls]')+'))');
   await waitIn(second,'["ready","saved"].includes(document.querySelector('+JSON.stringify(saved)+')?.dataset.incidentDeliveryDraftStatus)');
   assert.equal(await second('location.origin'),origin);assert.equal(await second('location.pathname'),'/workbench/app/incidents/'+otherId);
   assert.equal(await second(observerSource.replace('__T33_SCOPED_CONFIG__',JSON.stringify(config(otherId)))),true);
   const secondBootstrap=record(await second('fetch("/api/lifecycle/bootstrap").then(response=>response.json())'));
   assert.equal(secondBootstrap.principal_id,adminId);assert.deepEqual(secondBootstrap.roles,bootstrap.body.roles);
   assert.equal(secondBootstrap.authorization_revision,bootstrap.body.authorization_revision);
   assert.equal(secondBootstrap.incident_delivery_control_enabled,true);assert.equal(secondBootstrap.incident_delivery_control_draft_recovery_enabled,true);
   const firstBootstrap=record(await first('fetch("/api/lifecycle/bootstrap").then(response=>response.json())'));
   assert.equal(firstBootstrap.principal_id,adminId);assert.deepEqual(firstBootstrap.roles,bootstrap.body.roles);
   assert.equal(firstBootstrap.authorization_revision,bootstrap.body.authorization_revision);
   assert.equal(firstBootstrap.incident_delivery_control_enabled,true);assert.equal(firstBootstrap.incident_delivery_control_draft_recovery_enabled,true);
   phase='two-real-scopes-ready';
   await choose(first,'选择通知路',deliveryId);
   await waitIn(first,'document.querySelector('+JSON.stringify(root+' option[value="RECONCILE"]')+')?.disabled===false');
   await choose(first,'投递控制操作','RECONCILE');await choose(first,'投递操作原因','OPERATOR_VERIFIED_DELIVERY');await choose(first,'未知发送核对结论','CONFIRMED_SENT');
   await waitIn(first,'document.querySelector('+JSON.stringify(saved)+')?.dataset.incidentDeliveryDraftStatus==="saved"');
   await choose(second,'选择通知路',otherDeliveryId);
   await waitIn(second,'document.querySelector('+JSON.stringify(root+' option[value="RETRY"]')+')?.disabled===false');
   await choose(second,'投递控制操作','RETRY');await choose(second,'投递操作原因','OPERATOR_CONFIRMED_NOT_ATTEMPTED');
   await waitIn(second,'document.querySelector('+JSON.stringify(saved)+')?.dataset.incidentDeliveryDraftStatus==="saved"');
   const original=await probe(scope,true),otherInitial=await probe(otherScope,true);
   const originalMeta=record(original.metadata),originalCopy=closed(original.copy,['schema','value','pending']);
   assert.equal(originalCopy.schema,2);assert.equal(originalCopy.pending,null);assert.equal(original.operation,null);
   assert.equal(originalMeta.scope,scope);assert.equal(originalMeta.principal,adminId);assert.equal(originalMeta.id,incidentId);assert.equal(originalMeta.purpose,'incident-delivery-lifecycle');
   assert.equal(record(originalCopy.value).deliveryId,deliveryId);assert.equal(record(originalCopy.value).reason,'OPERATOR_VERIFIED_DELIVERY');
   assert.equal(record(otherInitial.metadata).scope,otherScope);assert.equal(otherInitial.operation,null);
   assert.equal(original.epoch,otherInitial.epoch);
   const initialEvents=records((await trace(first)).requests);
   const cached=initialEvents.filter(row=>row.path===primaryControl&&row.method==='GET'&&row.response_status===200).at(-1);assert.ok(cached);
   assert.equal(record(cached.response).receipt_read,true);assert.equal(record(cached.response).reconcile,true);
   assert.equal(await input(first,'投递操作原因'),'OPERATOR_VERIFIED_DELIVERY');
   phase='saved-with-current-independent-grants';

   const clear=root+' [data-action="clear-incident-delivery-input"]';
   await waitIn(second,'document.querySelector('+JSON.stringify(clear)+')?.disabled===false');
   assert.equal(await second('(()=>{document.querySelector('+JSON.stringify(clear)+').click();return true;})()'),true);
   await waitIn(second,'document.querySelector('+JSON.stringify(root+' select[aria-label="选择通知路"]')+')?.value===""');
   await browser.waitFor('globalThis.__t33ScopedRebase.vaultEvents.some(row=>row.principal==='+JSON.stringify(adminId)+'&&row.kind==="incident"&&row.id==='+JSON.stringify(otherId)+'&&row.purpose==="incident-delivery-lifecycle"&&row.reason==="discard")');
   const afterDiscard=await probe(scope,false),removedOther=await probe(otherScope,false);
   assert.equal(record(afterDiscard.metadata).revision,originalMeta.revision,'real different-scope discard leaves the original target row untouched');
   assert.notEqual(afterDiscard.epoch,original.epoch,'actual vault removal advances the global epoch');epochChanged=true;
   assert.equal(removedOther.metadata,null);assert.equal(removedOther.operation,null);
   assert.equal(await input(first,'投递操作原因'),'OPERATOR_VERIFIED_DELIVERY');
   assert.equal(await first('document.querySelector('+JSON.stringify(root+' option[value="RECONCILE"]')+').disabled'),false);
   phase='real-other-scope-discard-observed';
   // Retain a genuine still-authorized canary; original-scope cleanup must not
   // clear the other Incident's same-purpose draft or use account-wide purge.
   await waitIn(second,'["ready","saved"].includes(document.querySelector('+JSON.stringify(saved)+')?.dataset.incidentDeliveryDraftStatus)');
   await choose(second,'选择通知路',otherDeliveryId);
   await waitIn(second,'document.querySelector('+JSON.stringify(root+' option[value="RETRY"]')+')?.disabled===false');
   await choose(second,'投递控制操作','RETRY');await choose(second,'投递操作原因','OPERATOR_CONFIRMED_NOT_ATTEMPTED');
   await waitIn(second,'document.querySelector('+JSON.stringify(saved)+')?.dataset.incidentDeliveryDraftStatus==="saved"');
   const canary=await probe(otherScope,true),beforeWrite=await probe(scope,false);
   assert.ok(canary.metadata);assert.equal(record(canary.copy).pending,null);
   assert.equal(record(beforeWrite.metadata).revision,originalMeta.revision);assert.equal(beforeWrite.epoch,afterDiscard.epoch);
   assert.equal(await input(first,'投递操作原因'),'OPERATOR_VERIFIED_DELIVERY');
   assert.equal(await first('document.querySelector('+JSON.stringify(root+' option[value="RECONCILE"]')+').disabled'),false);
   assert.equal(grants.delete(adminId+'|'+incidentId+'|INCIDENT_DELIVERY_RETRY'),true);
   assert.equal(grants.delete(adminId+'|'+incidentId+'|INCIDENT_DELIVERY_RECONCILE'),true);grantRevoked=true;
   const currentBootstrap=await get('/api/lifecycle/bootstrap'),stillPrimary=await get('/api/incidents/'+incidentId),stillOther=await get('/api/incidents/'+otherId);
   assert.equal(currentBootstrap.status,200);assert.equal(stillPrimary.status,200);assert.equal(stillOther.status,200);
   assert.equal(currentBootstrap.body.principal_id,adminId);assert.deepEqual(currentBootstrap.body.roles,bootstrap.body.roles);
   assert.equal(currentBootstrap.body.authorization_revision,bootstrap.body.authorization_revision);
   assert.equal(currentBootstrap.body.incident_delivery_control_enabled,true);assert.equal(currentBootstrap.body.incident_delivery_control_draft_recovery_enabled,true);
   const denied=await get(primaryControl),allowedOther=await get(otherControl);assert.equal(denied.status,200);assert.equal(allowedOther.status,200);
   const cap=closed(denied.body,['incident_id','delivery_id','purpose','retry','reconcile','receipt_read','disabled','attempt_count']);
   assert.equal(cap.incident_id,incidentId);assert.equal(cap.delivery_id,deliveryId);assert.equal(cap.purpose,'INCIDENT_LIFECYCLE');
   assert.equal(cap.retry,false);assert.equal(cap.reconcile,false);assert.equal(cap.receipt_read,false);assert.equal(cap.disabled,false);
   assert.equal(allowedOther.body.receipt_read,true);
   // These server-side GETs do not update either browser's React Query cache.
   assert.equal(await first('document.querySelector('+JSON.stringify(root+' option[value="RECONCILE"]')+').disabled'),false,'original cached capability must remain old true until the real rebase entry');
   phase='independent-grants-only-revoked';
   const mark=records((await trace(first)).requests).length;
   await capture('scoped-rebase-real-epoch-change-cached-grant');
   await choose(first,'投递操作原因','OPERATOR_CANCEL_UNKNOWN_DELIVERY');editIssued=true;phase='visible-edit-at-real-stale-epoch';
   const outcome=root+' [data-incident-delivery-outcome]';
   await browser.waitFor('document.querySelector('+JSON.stringify(outcome)+')?.dataset.incidentDeliveryState==="denied"');
   await first('globalThis.__t33ScopedRebase.quietStart=performance.now()');
   await browser.waitFor('performance.now()-globalThis.__t33ScopedRebase.quietStart>=400');
   const finalTrace=await trace(first),finalEvents=records(finalTrace.requests);
   const fresh=finalEvents.filter(row=>number(row.sequence)>=mark&&row.method==='GET'&&row.path===primaryControl&&row.response_status===200&&row.client_returned===true).at(-1);
   assert.ok(fresh,'DRAFT_CHANGED reauthorization must read the exact selected delivery; general Incident READ and old cached receipt_read are insufficient');
   const freshCap=closed(fresh.response,['incident_id','delivery_id','purpose','retry','reconcile','receipt_read','disabled','attempt_count']);
   assert.equal(freshCap.incident_id,incidentId);assert.equal(freshCap.delivery_id,deliveryId);assert.equal(freshCap.purpose,'INCIDENT_LIFECYCLE');
   assert.equal(freshCap.retry,false);assert.equal(freshCap.reconcile,false);assert.equal(freshCap.receipt_read,false);assert.equal(freshCap.disabled,false);
   const privateInput=await input(first,'投递操作原因');assert.ok(privateInput===null||privateInput==='','revoked scope input must stop being displayed');
   const cleared=await probe(scope,false);assert.equal(cleared.metadata,null);assert.equal(cleared.operation,null);
   const retained=await probe(otherScope,true);assert.deepEqual(retained.metadata,canary.metadata);assert.deepEqual(retained.copy,canary.copy);assert.equal(retained.operation,null);
   assert.equal(await input(second,'投递操作原因'),'OPERATOR_CONFIRMED_NOT_ATTEMPTED');
   assert.equal(finalEvents.filter(row=>row.controlPost===true).length,0);
   assert.equal(records((await trace(second)).requests).filter(row=>row.controlPost===true).length,0);
   assert.equal(finalEvents.filter(row=>row.path&&text(row.path).startsWith(config(incidentId).receiptPrefix)).length,0);
   assert.equal(senderCalls(),1,'no control command or second send is part of authorization rebase');
   const rows=await getLifecycleRows(),selected=rows.find(row=>row.delivery_id===deliveryId);
   assert.equal(selected?.status,'RECONCILIATION_REQUIRED');assert.equal(selected?.side_effect_state,'UNKNOWN');
   assert.equal((await get('/api/incidents/'+incidentId)).status,200);assert.equal((await get('/api/incidents/'+otherId)).status,200);
   assert.equal((await get('/api/lifecycle/bootstrap')).body.principal_id,adminId);
   phase='verified-scoped-rebase-denial';
   await capture('scoped-rebase-current-grant-denied-only-original-copy-cleared');
  }catch(error){primaryError=error;}
  finally{
   for(const ownedId of ownTargets){
    try{const closedTarget=record(await browser.command('Target.closeTarget',{targetId:ownedId}));assert.equal(closedTarget.success,true);closedTargets++;}catch(error){closureErrors.push(error);}
   }
   try{await browser.evaluate('(()=>{globalThis.__t33ScopedRebaseVaultObserver?.close();globalThis.__t33ScopedReplyChannel?.close();return true;})()');}catch(error){closureErrors.push(error);}
  }
  console.log('T33_SCOPED_REBASE_BOUNDARY '+JSON.stringify({phase,grantRevoked,actualOtherScopeEpochChanged:epochChanged,visibleReasonEditIssued:editIssued,semanticEntryReached:grantRevoked&&epochChanged&&editIssued,ownedTargets:ownTargets.length,closedTargets,semanticEntryNotReached:!(grantRevoked&&epochChanged&&editIssued)}));
  if(primaryError!==undefined&&closureErrors.length)throw new AggregateError([primaryError,...closureErrors],'T33_SCOPED_REBASE_AND_OWN_TARGET_CLOSURE_FAILED');
  if(primaryError!==undefined)throw primaryError;
  if(closureErrors.length)throw new AggregateError(closureErrors,'T33_SCOPED_REBASE_OWN_TARGET_CLOSURE_FAILED');
 },{draftRecovery:true,externalSend:true});
});
