import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {candidateBrowser,record,text} from './helpers/wbint-t27-browser-fixture.mjs';
import {candidateCopies} from './helpers/wbint-t27-draft-observation.mjs';
import {prepareFollowup,navigateFollowup,chooseFollowup,rows} from './helpers/t28-followup-source-fixture.mjs';
import {readFile} from 'node:fs/promises';
import {yxxTab} from './helpers/p2-g2-yixiaoxiu-browser.mjs';

test('T28 a held original receipt cannot restore sensitive input or UNKNOWN after current scope purpose is revoked',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t28lateread',reporters:3,recovery:true},async context=>{
    const {http,id,path}=await prepareFollowup(context);await navigateFollowup(context,id);await context.browser.waitFor('document.querySelector("[data-incident-draft]")?.textContent.includes("最长24小时")');
    await chooseFollowup(context.browser,'公共故障操作','CORRECT_SCOPE');await chooseFollowup(context.browser,'决定原因','SCOPE_CORRECTION');await chooseFollowup(context.browser,'确认范围','BUILDING');
    await context.browser.evaluate(`(()=>{const send=globalThis.fetch;globalThis.fetch=async(input,options)=>{const response=await send(input,options),target=new URL(String(input),location.href).pathname;if(options?.method==='POST'&&target===${JSON.stringify(path+'/correct-scope')}){globalThis.__t28Lost={status:response.status,body:await response.clone().json()};throw new TypeError('T28_LOST_ACK');}if(!globalThis.__t28HoldUsed&&target.startsWith(${JSON.stringify(path+'/commands/')})){globalThis.__t28HoldUsed=true;globalThis.__t28Held={status:response.status,body:await response.clone().json()};await new Promise(resolve=>{globalThis.__t28Release=resolve;});globalThis.__t28Released=true;}return response;};})()`);
    await context.browser.waitFor('document.querySelector("[data-action=submit-incident]")?.disabled===false');await context.browser.evaluate('document.querySelector("[data-action=submit-incident]").click()');await context.browser.waitFor('Boolean(document.querySelector("[data-incident-unknown]"))');
    assert.equal(record(await context.browser.evaluate('globalThis.__t28Lost')).status,200);const copy=record(await context.browser.evaluate(candidateCopies)),marker=rows(copy.operations).find(row=>row.kind==='incident'&&row.id===id);assert.ok(marker);const commandId=text(marker.commandId);
    await context.browser.evaluate('document.querySelector("[data-action=check-incident-operation]").click()');await context.browser.waitFor('Boolean(globalThis.__t28Held)');const held=record(await context.browser.evaluate('globalThis.__t28Held'));assert.equal(held.status,200);assert.equal(record(held.body).state,'COMMITTED');
    await createPilotAccessService({pool:context.pool}).upsertPrincipal({wecomUserId:'synthetic-incident-admin',displayName:'合成管理员',roles:['DISPATCHER'],resolverTeamIds:['PILOT_IT']});assert.equal((await http.read(path+'/commands/'+commandId)).status,403);
    assert.equal(await context.browser.evaluate('document.querySelector("[data-action=refresh-incident]").disabled'),false,'authority refresh must remain available during a held read-only receipt');
    await context.browser.evaluate('document.querySelector("[data-action=refresh-incident]").click()');await context.browser.waitFor('document.querySelector("[data-incident-outcome]")?.textContent.includes("权限不可用")');
    let cleared:Record<string,unknown>={};for(let i=0;i<100;i++){cleared=record(await context.browser.evaluate(candidateCopies));if(rows(cleared.drafts).filter(row=>row.kind==='incident'&&row.id===id).length===0&&rows(cleared.operations).filter(row=>row.kind==='incident'&&row.id===id).length===0)break;await new Promise<void>(resolve=>setTimeout(resolve,50));}
    assert.equal(rows(cleared.drafts).filter(row=>row.kind==='incident'&&row.id===id).length,0);assert.equal(rows(cleared.operations).filter(row=>row.kind==='incident'&&row.id===id).length,0);
    await context.browser.evaluate('globalThis.__t28Release()');await context.browser.waitFor('globalThis.__t28Released===true');await context.browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.equal(await context.browser.evaluate('Boolean(document.querySelector("[data-incident-unknown]"))'),false);assert.equal(await context.browser.evaluate('document.querySelector(".workbench-select[data-field-label=确认范围] select")?.value??""'),'');assert.equal(await context.browser.evaluate('document.querySelector("[data-incident-outcome]")?.textContent.includes("已确认提交")'),false);
    const after=record(await context.browser.evaluate(candidateCopies));assert.equal(rows(after.drafts).filter(row=>row.kind==='incident'&&row.id===id).length,0);assert.equal(rows(after.operations).filter(row=>row.kind==='incident'&&row.id===id).length,0);assert.equal(rows(await context.browser.evaluate('globalThis.__t27Posts')).filter(row=>String(row.path).startsWith(path+'/')).length,1);assert.equal((await http.get(path)).row_version,'2');
  });
});

for(const notification of ['before','after','denied'] as const)test(`T28 a late receipt for A cannot replace a peer operation B with ${notification} notification`,{timeout:240000},async()=>{
  await candidateBrowser({purpose:notification==='before'?'t28switch':notification==='after'?'t28delay':'t28deny',reporters:3,recovery:true},async context=>{
    const {id,path}=await prepareFollowup(context);await navigateFollowup(context,id);await context.browser.waitFor('document.querySelector("[data-incident-draft]")?.textContent.includes("最长24小时")');
    await chooseFollowup(context.browser,'公共故障操作','CORRECT_SCOPE');await chooseFollowup(context.browser,'决定原因','SCOPE_CORRECTION');await chooseFollowup(context.browser,'确认范围','BUILDING');
    await context.browser.evaluate("(()=>{const send=fetch;fetch=async(path,options)=>{const response=await send(path,options),url=String(path);if(options?.method==='POST'&&url.endsWith('/correct-scope'))throw new TypeError('T28_LOST_ACK');if(url.includes('/commands/')&&!globalThis.__heldReceipt){globalThis.__heldReceipt=true;return new Promise(resolve=>{globalThis.__releaseOldReceipt=()=>resolve("+(notification==='denied'?"new Response(JSON.stringify({error:{code:'P2_012_FORBIDDEN'}}),{status:403,headers:{'content-type':'application/json'}})":"response")+");}).then(value=>{globalThis.__oldReceiptReturned=true;return value;});}return response;};})()");
    await context.browser.waitFor('document.querySelector("[data-action=submit-incident]")?.disabled===false');await context.browser.evaluate('document.querySelector("[data-action=submit-incident]").click()');await context.browser.waitFor('Boolean(document.querySelector("[data-incident-unknown]"))');
    const copy=record(await context.browser.evaluate(candidateCopies)),marker=rows(copy.operations).find(row=>row.kind==='incident'&&row.id===id);assert.ok(marker);const oldId=text(marker.commandId);
    await context.browser.evaluate('document.querySelector("[data-action=check-incident-operation]").click()');await context.browser.waitFor('typeof globalThis.__releaseOldReceipt==="function"');
    const manifest=JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')) as Record<string,{file:string}>,recovery='/workbench/app/'+manifest['src/feedback-recovery.ts']?.file;
    const scope={principal:text(marker.principal),kind:'incident',id,purpose:'incident-followup'},tab=await yxxTab(context.browser,context.origin+'/workbench/app/');
    try{
      const newId=await tab.evaluate('(async()=>{const store=await import('+JSON.stringify(recovery)+'),scope='+JSON.stringify(scope)+',old=await store.openDraft(scope),value=JSON.parse(old.text),post=BroadcastChannel.prototype.postMessage;BroadcastChannel.prototype.postMessage=function(){};try{await store.settleDraft(old.handle,'+JSON.stringify(oldId)+',old.handle.record.revision);const next=await store.openDraft(scope),id=crypto.randomUUID();value.pending.body.client_command_id=id;await store.saveDraft(next.handle,JSON.stringify(value),{commandId:id});return id;}finally{BroadcastChannel.prototype.postMessage=post;}})()') as string;
      const notify=()=>tab.evaluate("(()=>{const channel=new BroadcastChannel('wecom-workbench-drafts-v1');channel.postMessage({..."+JSON.stringify(scope)+",reason:'settled'});channel.close();})()");
      if(notification==='before'){await notify();await context.browser.waitFor('JSON.parse(document.querySelector("[data-incident-unknown] + [data-diagnostic-copy] [data-diagnostics]")?.dataset.diagnostics??"{}").operation_id==='+JSON.stringify(newId));}
      await context.browser.command('Page.bringToFront');await context.browser.evaluate('globalThis.__releaseOldReceipt()');await context.browser.waitFor('globalThis.__oldReceiptReturned===true');
      await context.browser.waitFor('JSON.parse(document.querySelector("[data-incident-unknown] + [data-diagnostic-copy] [data-diagnostics]")?.dataset.diagnostics??"{}").operation_id==='+JSON.stringify(newId));
      if(notification!=='before')await notify();
      await context.browser.waitFor('document.querySelector("[data-action=check-incident-operation]")?.disabled===false');
      assert.equal(await context.browser.evaluate('JSON.parse(document.querySelector("[data-incident-unknown] + [data-diagnostic-copy] [data-diagnostics]")?.dataset.diagnostics??"{}").operation_id'),newId);
      assert.equal(await context.browser.evaluate('document.querySelector("[data-incident-outcome]")?.textContent.includes("原操作已确认提交")'),false);
      const current=record(await context.browser.evaluate(candidateCopies));assert.equal(rows(current.operations).find(row=>row.id===id)?.commandId,newId);assert.equal(rows(current.drafts).filter(row=>row.id===id).length,1);
    }finally{await tab.close();}
  });
});

test('T28 a delayed purpose denial for a failed operation cannot purge a newer peer operation',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t28denial',reporters:3,recovery:true},async context=>{
    const {id,path}=await prepareFollowup(context);await navigateFollowup(context,id);
    await context.browser.waitFor('document.querySelector("[data-incident-draft]")?.textContent.includes("最长24小时")');
    await chooseFollowup(context.browser,'公共故障操作','CORRECT_SCOPE');await chooseFollowup(context.browser,'决定原因','SCOPE_CORRECTION');await chooseFollowup(context.browser,'确认范围','BUILDING');
    await context.browser.waitFor('document.querySelector("[data-incident-draft]")?.textContent.includes("草稿已保存")');
    const manifest=JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')) as Record<string,{file:string}>,recovery='/workbench/app/'+manifest['src/feedback-recovery.ts']?.file;
    const stored=record(await context.browser.evaluate(candidateCopies)),first=rows(stored.drafts).find(row=>row.kind==='incident'&&row.id===id);assert.ok(first);
    const scope={principal:text(record(context.f.admin).id),kind:'incident',id,purpose:'incident-followup'},tab=await yxxTab(context.browser,context.origin+'/workbench/app/');
    try{
      await context.browser.evaluate("(()=>{const timer=window.setTimeout;globalThis.__restoreDraftTimer=()=>{window.setTimeout=timer;};window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);})()");
      await chooseFollowup(context.browser,'公共故障操作','START_INVESTIGATING');await chooseFollowup(context.browser,'决定原因','OPERATOR_REVIEWED');
      const oldId=await tab.evaluate('(async()=>{const store=await import('+JSON.stringify(recovery)+'),copy=await store.openDraft('+JSON.stringify(scope)+'),value=JSON.parse(copy.text),id=crypto.randomUUID();value.pending={incidentId:'+JSON.stringify(id)+',action:"CORRECT_SCOPE",body:{client_command_id:id,expected_row_version:value.value.capturedVersion,reason_code:value.value.reason,confirmed_scope:value.value.scope}};await store.saveDraft(copy.handle,JSON.stringify(value),{commandId:id});globalThis.__oldCopy=copy;return id;})()') as string;
      await context.browser.waitFor('JSON.parse(document.querySelector("[data-incident-unknown] + [data-diagnostic-copy] [data-diagnostics]")?.dataset.diagnostics??"{}").operation_id==='+JSON.stringify(oldId));
      await context.browser.evaluate('globalThis.__restoreDraftTimer()');
      await context.browser.evaluate(`(()=>{const read=fetch;let bootstraps=0;fetch=async(input,options)=>{const target=new URL(typeof input==='string'?input:input.url,location.href).pathname;if(target===${JSON.stringify(path+'/commands/'+oldId)}){globalThis.__failedReceipt=true;return new Response(JSON.stringify({incident_id:${JSON.stringify(id)},client_command_id:${JSON.stringify(oldId)},state:'FAILED',error:{code:'P2_012_VERSION_CONFLICT',retryable:false}}),{status:200,headers:{'content-type':'application/json'}});}const response=await read(input,options);if(globalThis.__failedReceipt&&target==='/api/lifecycle/bootstrap'&&++bootstraps===2){const value=await response.clone().json();value.roles=['DISPATCHER'];return new Promise(resolve=>{globalThis.__releaseDeniedAuthority=()=>resolve(new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}}));});}return response;};})()`);
      await context.browser.evaluate('document.querySelector("[data-action=check-incident-operation]").click()');await context.browser.waitFor('typeof globalThis.__releaseDeniedAuthority==="function"');
      const newId=await tab.evaluate('(async()=>{const store=await import('+JSON.stringify(recovery)+'),scope='+JSON.stringify(scope)+',old=globalThis.__oldCopy,post=BroadcastChannel.prototype.postMessage;BroadcastChannel.prototype.postMessage=function(){};try{await store.settleDraft(old.handle,'+JSON.stringify(oldId)+',old.handle.record.revision);const next=await store.openDraft(scope),value=JSON.parse(old.text),id=crypto.randomUUID();value.value.action="START_INVESTIGATING";value.value.reason="OPERATOR_REVIEWED";value.pending={incidentId:'+JSON.stringify(id)+',action:"START_INVESTIGATING",body:{client_command_id:id,expected_row_version:value.value.capturedVersion,reason_code:"OPERATOR_REVIEWED"}};await store.saveDraft(next.handle,JSON.stringify(value),{commandId:id});return id;}finally{BroadcastChannel.prototype.postMessage=post;}})()') as string;
      await context.browser.command('Page.bringToFront');await context.browser.evaluate('globalThis.__releaseDeniedAuthority()');
      await context.browser.waitFor('JSON.parse(document.querySelector("[data-incident-unknown] + [data-diagnostic-copy] [data-diagnostics]")?.dataset.diagnostics??"{}").operation_id==='+JSON.stringify(newId));
      const after=record(await context.browser.evaluate(candidateCopies)),operations=rows(after.operations).filter(row=>row.kind==='incident'&&row.id===id),drafts=rows(after.drafts).filter(row=>row.kind==='incident'&&row.id===id);
      assert.equal(operations.length,1);assert.equal(operations[0]?.commandId,newId);assert.equal(drafts.length,1,'the newer encrypted draft must remain');
    }finally{await tab.close();}
  });
});

test('T28 a delayed incident-read rejection before sending cannot remove a newer operation',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t28presend',reporters:3,recovery:true},async context=>{
    const {id,path}=await prepareFollowup(context);await navigateFollowup(context,id);
    await context.browser.waitFor('document.querySelector("[data-incident-draft]")?.textContent.includes("最长24小时")');
    await chooseFollowup(context.browser,'公共故障操作','CORRECT_SCOPE');await chooseFollowup(context.browser,'决定原因','SCOPE_CORRECTION');await chooseFollowup(context.browser,'确认范围','BUILDING');
    await context.browser.waitFor('document.querySelector("[data-action=submit-incident]")?.disabled===false');
    await context.browser.evaluate(`(()=>{const read=fetch;let held=false;fetch=async(input,options)=>{const target=new URL(typeof input==='string'?input:input.url,location.href).pathname;if(!held&&target===${JSON.stringify(path)}&&(options?.method??'GET')==='GET'){held=true;return new Promise(resolve=>{globalThis.__releaseT28PreSend=()=>resolve(new Response('{}',{status:403,headers:{'content-type':'application/json'}}));});}return read(input,options);};})()`);
    await context.browser.evaluate('document.querySelector("[data-action=submit-incident]").click()');await context.browser.waitFor('typeof globalThis.__releaseT28PreSend==="function"');
    const stored=record(await context.browser.evaluate(candidateCopies)),marker=rows(stored.operations).find(row=>row.id===id);assert.ok(marker);const oldId=text(marker.commandId),scope={principal:text(marker.principal),kind:'incident',id,purpose:'incident-followup'};
    const manifest=JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')) as Record<string,{file:string}>,recovery='/workbench/app/'+manifest['src/feedback-recovery.ts']?.file,tab=await yxxTab(context.browser,context.origin+'/workbench/app/');
    try{
      const newId=await tab.evaluate('(async()=>{const store=await import('+JSON.stringify(recovery)+'),scope='+JSON.stringify(scope)+',old=await store.openDraft(scope),value=JSON.parse(old.text),post=BroadcastChannel.prototype.postMessage;BroadcastChannel.prototype.postMessage=function(){};try{await store.settleDraft(old.handle,'+JSON.stringify(oldId)+',old.handle.record.revision);const next=await store.openDraft(scope),id=crypto.randomUUID();value.pending.body.client_command_id=id;await store.saveDraft(next.handle,JSON.stringify(value),{commandId:id});return id;}finally{BroadcastChannel.prototype.postMessage=post;}})()') as string;
      await context.browser.command('Page.bringToFront');await context.browser.evaluate('globalThis.__releaseT28PreSend()');
      await context.browser.waitFor('JSON.parse(document.querySelector("[data-incident-unknown] + [data-diagnostic-copy] [data-diagnostics]")?.dataset.diagnostics??"{}").operation_id==='+JSON.stringify(newId));
      const after=record(await context.browser.evaluate(candidateCopies));assert.equal(rows(after.operations).find(row=>row.id===id)?.commandId,newId);assert.equal(rows(after.drafts).filter(row=>row.id===id).length,1);
      assert.equal(rows(await context.browser.evaluate('globalThis.__t27Posts')).filter(row=>String(row.path).startsWith(path+'/')).length,0);
    }finally{await tab.close();}
  });
});
