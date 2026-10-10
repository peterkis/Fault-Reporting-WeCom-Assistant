// Registered original production-bundle tracer; initially NOT_RUN. Future location: tests/t08-draft-revision-race.browser.test.mts.
// One frozen production-browser R1/R2 case; no caller/store fix or test-owned POST result.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {withT08Fixture,object,rows,text} from './helpers/t08-fixture.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {yxxTab,pollYxx} from './helpers/p2-g2-yixiaoxiu-browser.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type Tab=Awaited<ReturnType<typeof yxxTab>>;
type Surface=Pick<Browser,'evaluate'|'waitFor'>;
const reasonInput="document.querySelector('.ticket-unassign textarea')";
const targetInput="document.querySelector('.ticket-unassign select')";
const draftStatus="document.querySelector('[data-unassign-draft-status]')";
const ready=`Boolean(${reasonInput})&&(${reasonInput}).disabled===false&&(${draftStatus})?.textContent.includes('草稿仅在当前浏览器')`;
const input=(value:string)=>`(()=>{const input=${reasonInput};Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`;
async function choose(surface:Surface,target:string){
 await surface.waitFor(`Boolean(${targetInput})&&(${targetInput}).disabled===false&&Array.from((${targetInput}).options).some(option=>option.value===${JSON.stringify(target)})`);
 await surface.evaluate(`(()=>{const input=${targetInput};Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,${JSON.stringify(target)});input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await surface.waitFor(`(${targetInput})?.value===${JSON.stringify(target)}&&(${targetInput}).disabled===false`);
}
function snapshot(principal:string,ticketId:string){
 const scope=JSON.stringify([principal,'ticket',ticketId,'ticket-unassign']);
 return `new Promise((resolve,reject)=>{const open=indexedDB.open('wecom-workbench-drafts-v1',2);open.onerror=()=>reject(open.error);open.onsuccess=()=>{
  const db=open.result,tx=db.transaction(['drafts','operations','control'],'readonly'),record=tx.objectStore('drafts').get(${JSON.stringify(scope)}),operation=tx.objectStore('operations').get(${JSON.stringify(scope)}),epoch=tx.objectStore('control').get('epoch');
  tx.onerror=()=>reject(tx.error);tx.onabort=()=>{db.close();reject(tx.error);};tx.oncomplete=()=>{db.close();const row=record.result;
   Promise.resolve(row?crypto.subtle.digest('SHA-256',row.ciphertext):null).then(digest=>resolve({revision:row?.revision??null,operation:operation.result?.commandId??null,epoch:epoch.result??null,
    ciphertext_sha256:digest?Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join(''):null})).catch(reject);
  };};})`;
}
const holdEncryption=`(()=>{const original=crypto.subtle.encrypt.bind(crypto.subtle);const held=[];globalThis.__t08EncryptionHeld=0;
 crypto.subtle.encrypt=(...args)=>new Promise((resolve,reject)=>{globalThis.__t08EncryptionHeld++;held.push(()=>original(...args).then(resolve,reject));});
 globalThis.__t08ReleaseEncryption=()=>{crypto.subtle.encrypt=original;for(const send of held.splice(0))send();globalThis.__t08EncryptionHeld=0;};})()`;
const failure=(value:unknown)=>value instanceof Error?{name:value.name,message:value.message,stack:value.stack}:String(value);

test('a stale R1 target refusal cannot revoke another tab current valid R2 revision or erase its new unsaved internal reason',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),handler=await fixture.http(2),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
  const targetPath=path+'/unassign/communication-targets',page=fixture.origin+'/workbench/app/items/ticket/'+ticketId;
  const oldTarget=fixture.otherHandler,newTarget=fixture.dispatcher;
  const reasonR1='T08 R1 原目标 X 的内部草稿 '+randomUUID(),reasonR2='T08 R2 当前有效目标 Y 的内部草稿 '+randomUUID(),unsaved=reasonR2+'；尚未保存的新输入必须保留';
  const bootstrap=await admin.get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);
  assert.equal(bootstrap.value.ticket_unassign_enabled,true);assert.equal(bootstrap.value.ticket_unassign_draft_recovery_enabled,true);
  assert.equal(bootstrap.value.ticket_assignment_enabled,false);assert.equal(bootstrap.value.ticket_conversation_self_handling_enabled,false);assert.equal(bootstrap.value.realtime_sse_enabled,false);
  assert.equal((await handler.post(path+'/accept',{client_command_id:randomUUID(),expected_version:1,reason_code:'T08_RACE_REAL_ACCEPT'})).status,200);
  await fixture.runtime.coordinator.runOnce();const source=rows((await handler.get(path+'/responsibility')).value.conversations)[0];assert.ok(source);
  const sessionId=text(source.session_id);assert.equal((await handler.post('/api/conversations/'+sessionId+'/takeover',{client_command_id:randomUUID(),expected_row_version:Number(source.session_row_version),reason_code:'T08_RACE_REAL_COMMUNICATOR'})).status,200);
  const before=await admin.get(path);assert.equal(before.status,200);assert.equal(before.value.status,'ACCEPTED');assert.equal(before.value.assignee_id,fixture.handler);assert.equal(before.value.version,2);
  assert.ok(Array.isArray(before.value.allowed_actions)&&before.value.allowed_actions.includes('unassign'));
  const events=(await admin.get(path+'/events?limit=200')).value,delivery=(await admin.get(path+'/deliveries')).value,responsibility=(await admin.get(path+'/responsibility')).value;
  const cookie=fixture.runtime.authenticate.browserCookies?.()[0];assert.ok(cookie);
  const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
  const requests:{method:string;path:string;target:string|null;status:number|null}[]=[],held=new Map<ServerResponse,()=>void>();
  let holdOldTarget=false,heldResponses=0,releasedResponses=0,writer:Browser|undefined,stale:Tab|undefined,primary:unknown;
  let r1:Record<string,unknown>|undefined,r2:Record<string,unknown>|undefined;
  // Buffer only actual 403 response.end calls for this real GET. Auth handler/body/status run unchanged.
  const observe=(request:IncomingMessage,response:ServerResponse)=>{
   if(!request.headers.cookie?.split(';').some(part=>part.trim()===admin.cookie))return;
   const url=new URL(request.url??'/',fixture.origin);if(!url.pathname.startsWith('/api/'))return;
   const fact={method:request.method??'',path:url.pathname,target:url.searchParams.get('target_principal_id'),status:null as number|null};requests.push(fact);
   response.once('finish',()=>{fact.status=response.statusCode;});
   if(!holdOldTarget||fact.method!=='GET'||fact.path!==targetPath||fact.target!==oldTarget)return;
   const end=response.end.bind(response);
   response.end=((...args:Parameters<ServerResponse['end']>)=>{
    if(response.statusCode!==403||!holdOldTarget)return end(...args);
    heldResponses++;let released=false;
    const send=()=>{if(released)return;released=true;held.delete(response);releasedResponses++;response.end=end;end(...args);};
    held.set(response,send);response.once('close',()=>{if(!released){released=true;held.delete(response);releasedResponses++;response.end=end;}});
    return response;
   }) as ServerResponse['end'];
  };
  const releaseTargets=()=>{holdOldTarget=false;for(const send of [...held.values()])send();};
  fixture.runtime.server.on('request',observe);
  try{
   writer=await launchSystemBrowser({url:page,width:600,height:1080,cookies:[{...cookie,url:fixture.origin+'/'}]});assert.ok(writer);
   await writer.waitFor(ready);await writer.evaluate(input(reasonR1));
   await writer.evaluate("document.querySelector('.ticket-unassign input[value=TRANSFER_SELECTED]').click()");await choose(writer,oldTarget);
   await writer.waitFor(`Boolean(document.querySelector('[data-session-choice="${sessionId}"]'))&&document.querySelector('[data-session-choice="${sessionId}"]').disabled===false`);
   await writer.evaluate(`document.querySelector('[data-session-choice="${sessionId}"]').click()`);
   await writer.waitFor(`(${draftStatus})?.textContent.includes('已保存恢复副本')&&(${reasonInput})?.value===${JSON.stringify(reasonR1)}&&document.querySelector('[data-session-choice="${sessionId}"]').checked`);
   r1=object(await writer.evaluate(snapshot(fixture.admin,ticketId)));assert.ok(r1.revision);assert.equal(r1.operation,null);
   // Writer B itself completes a real authorized R1 restore while X is still valid.
   const timeOrigin=await writer.evaluate('performance.timeOrigin');await writer.command('Page.reload');
   await writer.waitFor(`performance.timeOrigin!==${timeOrigin}&&(${reasonInput})?.value===${JSON.stringify(reasonR1)}&&(${reasonInput}).disabled===false&&(${targetInput})?.value===${JSON.stringify(oldTarget)}&&(${targetInput}).disabled===false&&document.querySelector('[data-session-choice="${sessionId}"]')?.checked&&document.querySelector('[data-action=unassign]')?.disabled===false`);
   assert.deepEqual(await writer.evaluate(snapshot(fixture.admin,ticketId)),r1);
   await writer.evaluate(`(()=>{globalThis.__t08Revocations=0;globalThis.__t08RaceBarrier=null;const channel=new BroadcastChannel('wecom-workbench-drafts-v1');channel.onmessage=event=>{const value=event.data;if(typeof value?.t08RaceBarrier==='string')globalThis.__t08RaceBarrier=value.t08RaceBarrier;if(value?.principal===${JSON.stringify(fixture.admin)}&&value.kind==='ticket'&&value.id===${JSON.stringify(ticketId)}&&value.purpose==='ticket-unassign'&&value.reason==='revoked')globalThis.__t08Revocations++;};globalThis.__t08CloseObserver=()=>channel.close();})()`);
   // Synthetic directory identity readback, followed by its existing public Access Port; no SQL role/ownership write.
   const identity=(await fixture.pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[oldTarget])).rows[0];assert.ok(identity);
   const revoked=await createPilotAccessService({pool:fixture.pool}).upsertPrincipal({wecomUserId:identity.wecom_user_id,displayName:identity.display_name,roles:['REPORTER'],resolverTeamIds:[]});assert.equal(revoked.id,oldTarget);
   assert.equal((await admin.get(targetPath+'?target_principal_id='+oldTarget)).status,403,'X really is no longer an internal communication target');
   const lawful=await admin.get(targetPath+'?target_principal_id='+newTarget);assert.equal(lawful.status,200);assert.ok(rows(lawful.value.items).some(row=>row.principal_id===newTarget));
   assert.deepEqual((await admin.get(path)).value,before.value,'the actor and Ticket READ/unassign action remain current');
   holdOldTarget=true;
   // Exactly one native browser/profile. The existing helper creates/attaches the second CDP target.
   stale=await yxxTab(writer,'about:blank');await stale.command('Page.enable');await stale.command('Emulation.setDeviceMetricsOverride',{width:600,height:1080,deviceScaleFactor:1,mobile:false});
   await stale.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const original=fetch;globalThis.__t08TargetReplies=[];globalThis.fetch=(input,init)=>original(input,init).then(response=>{const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.pathname===${JSON.stringify(targetPath)}&&url.searchParams.get('target_principal_id')===${JSON.stringify(oldTarget)})globalThis.__t08TargetReplies.push(response.status);return response;});})()`});
   await stale.command('Page.navigate',{url:page});await pollYxx(()=>held.size>0);
   assert.equal(await stale.evaluate(`(${reasonInput})?.value??null`),'','R1 restore has not exposed its selected body before the held target authorization');
   assert.equal(await writer.evaluate(`(${reasonInput})?.value`),reasonR1);
   await choose(writer,newTarget);await writer.evaluate(input(reasonR2));
   await writer.waitFor(`(${draftStatus})?.textContent.includes('已保存恢复副本')&&(${reasonInput})?.value===${JSON.stringify(reasonR2)}&&(${targetInput})?.value===${JSON.stringify(newTarget)}`);
   r2=object(await writer.evaluate(snapshot(fixture.admin,ticketId)));assert.ok(r2.revision);assert.notEqual(r2.revision,r1.revision);assert.equal(r2.operation,null);assert.equal(r2.epoch,r1.epoch);
   // Same existing T22 seam: hold actual encryption so new public UI text remains demonstrably unsaved.
   await writer.evaluate(holdEncryption);await writer.evaluate(input(unsaved));await writer.waitFor('globalThis.__t08EncryptionHeld===1');
   assert.equal(await writer.evaluate(`(${reasonInput})?.value`),unsaved);assert.deepEqual(await writer.evaluate(snapshot(fixture.admin,ticketId)),r2);
   releaseTargets();await pollYxx(()=>held.size===0);
   // Both original and minimally fixed code have a public completion state. No assertion requires the buggy broadcast.
   await stale.waitFor(`globalThis.__t08TargetReplies?.includes(403)&&Boolean(${draftStatus})&&((${draftStatus}).textContent.includes('恢复核验暂时不可用')||(${draftStatus}).textContent.includes('恢复副本已清理')||(${reasonInput})?.value===${JSON.stringify(reasonR2)}&&(${targetInput})?.value===${JSON.stringify(newTarget)}&&(${reasonInput}).disabled===false)`);
   // An observation marker has no principal/reason and is rejected by production invalidation().
   // It drains the same native cross-tab channel after the old restore completed, without creating a revoked message.
   const barrier=randomUUID();await stale.evaluate(`(()=>{const channel=new BroadcastChannel('wecom-workbench-drafts-v1');channel.postMessage({t08RaceBarrier:${JSON.stringify(barrier)}});channel.close();})()`);
   await writer.waitFor(`globalThis.__t08RaceBarrier===${JSON.stringify(barrier)}`);
   assert.ok(heldResponses>=1);assert.equal(releasedResponses,heldResponses);
   assert.equal(requests.filter(row=>row.method==='POST'&&row.path===path+'/unassign').length,0);
   assert.deepEqual(await writer.evaluate(snapshot(fixture.admin,ticketId)),r2,'R1 CAS must not delete or change the current R2 encrypted revision');
   assert.equal(await writer.evaluate(`(${reasonInput})?.value`),unsaved,'a stale R1 refusal must not erase valid Y input typed after R2 was saved');
   assert.equal(await writer.evaluate(`(${targetInput})?.value`),newTarget);assert.equal(await writer.evaluate(`document.querySelector('[data-session-choice="${sessionId}"]')?.checked`),true);
   assert.deepEqual((await admin.get(path)).value,before.value);assert.deepEqual((await admin.get(path+'/events?limit=200')).value,events);
   assert.deepEqual((await admin.get(path+'/deliveries')).value,delivery);assert.deepEqual((await admin.get(path+'/responsibility')).value,responsibility);
  }catch(error){primary=error;}
  await closeBrowserTestResources([
   async()=>{releaseTargets();assert.equal(held.size,0);assert.equal(releasedResponses,heldResponses);},
   async()=>{if(!writer)return;const bytes=Buffer.from(text(await writer.screenshot()),'base64'),file=join(directory,'new-detail-600.png');assert.equal(bytes.readUInt32BE(16),600);assert.equal(bytes.readUInt32BE(20),1080);await writeFile(file,bytes);
    const diagnostic=join(tmpdir(),'t08-draft-revision-race-diagnostic-'+randomUUID()+'.json');await writeFile(diagnostic,JSON.stringify({primary:primary?failure(primary):null,requests,heldResponses,releasedResponses,R1_revision:r1?.revision??null,R2_revision:r2?.revision??null,
     writer:await writer.evaluate(`({reason:(${reasonInput})?.value??null,target:(${targetInput})?.value??null,revocations:globalThis.__t08Revocations??0,status:(${draftStatus})?.textContent??null})`),
     screenshots:[{file:file.replaceAll('\\','/'),width:600,height:1080,sha256:createHash('sha256').update(bytes).digest('hex')}]},null,2));
    console.log('T08_DRAFT_REVISION_RACE_DIAGNOSTIC '+JSON.stringify({file:diagnostic.replaceAll('\\','/')}));
    console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',status:primary?'FAIL':'BROWSER_SLICE_COMPLETE',revision_race:true,screenshots:[{file:file.replaceAll('\\','/'),width:600,height:1080,sha256:createHash('sha256').update(bytes).digest('hex')}]}));
   },
   async()=>{if(writer)await writer.evaluate("globalThis.__t08ReleaseEncryption?.();globalThis.__t08CloseObserver?.()");},
   async()=>{await stale?.close();},
   async()=>{await writer?.close();if(writer)assert.deepEqual(writer.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},
   async()=>{fixture.runtime.server.removeListener('request',observe);assert.equal(held.size,0);assert.equal((await fixture.runtime.observability.metrics()).sse_clients,0);},
  ],primary);
 },{ticketUnassignEnabled:true,ticketAssignmentEnabled:false,ticketConversationSelfHandlingEnabled:false,workbenchDraftRecoveryEnabled:true,workbenchRealtimeEnabled:false});
});
