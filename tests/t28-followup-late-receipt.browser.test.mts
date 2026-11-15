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

test('T28 a late receipt for A cannot replace a peer operation B',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t28switch',reporters:3,recovery:true},async context=>{
    const {id,path}=await prepareFollowup(context);await navigateFollowup(context,id);await context.browser.waitFor('document.querySelector("[data-incident-draft]")?.textContent.includes("最长24小时")');
    await chooseFollowup(context.browser,'公共故障操作','CORRECT_SCOPE');await chooseFollowup(context.browser,'决定原因','SCOPE_CORRECTION');await chooseFollowup(context.browser,'确认范围','BUILDING');
    await context.browser.evaluate("(()=>{const send=fetch;fetch=async(path,options)=>{const response=await send(path,options),url=String(path);if(options?.method==='POST'&&url.endsWith('/correct-scope'))throw new TypeError('T28_LOST_ACK');if(url.includes('/commands/')&&!globalThis.__heldReceipt){globalThis.__heldReceipt=true;return new Promise(resolve=>{globalThis.__releaseOldReceipt=()=>resolve(response);}).then(value=>{globalThis.__oldReceiptReturned=true;return value;});}return response;};})()");
    await context.browser.waitFor('document.querySelector("[data-action=submit-incident]")?.disabled===false');await context.browser.evaluate('document.querySelector("[data-action=submit-incident]").click()');await context.browser.waitFor('Boolean(document.querySelector("[data-incident-unknown]"))');
    const copy=record(await context.browser.evaluate(candidateCopies)),marker=rows(copy.operations).find(row=>row.kind==='incident'&&row.id===id);assert.ok(marker);const oldId=text(marker.commandId);
    await context.browser.evaluate('document.querySelector("[data-action=check-incident-operation]").click()');await context.browser.waitFor('typeof globalThis.__releaseOldReceipt==="function"');
    const manifest=JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')) as Record<string,{file:string}>,recovery='/workbench/app/'+manifest['src/feedback-recovery.ts']?.file;
    const scope={principal:text(marker.principal),kind:'incident',id,purpose:'incident-followup'},tab=await yxxTab(context.browser,context.origin+'/workbench/app/');
    try{
      const newId=await tab.evaluate('(async()=>{const store=await import('+JSON.stringify(recovery)+'),scope='+JSON.stringify(scope)+',old=await store.openDraft(scope),value=JSON.parse(old.text),post=BroadcastChannel.prototype.postMessage;BroadcastChannel.prototype.postMessage=function(){};try{await store.settleDraft(old.handle,'+JSON.stringify(oldId)+',old.handle.record.revision);const next=await store.openDraft(scope),id=crypto.randomUUID();value.pending.body.client_command_id=id;await store.saveDraft(next.handle,JSON.stringify(value),{commandId:id});return id;}finally{BroadcastChannel.prototype.postMessage=post;}})()') as string;
      await tab.evaluate("(()=>{const channel=new BroadcastChannel('wecom-workbench-drafts-v1');channel.postMessage({..."+JSON.stringify(scope)+",reason:'settled'});channel.close();})()");
      await context.browser.waitFor('JSON.parse(document.querySelector("[data-incident-unknown] + [data-diagnostic-copy] [data-diagnostics]")?.dataset.diagnostics??"{}").operation_id==='+JSON.stringify(newId));
      await context.browser.command('Page.bringToFront');await context.browser.evaluate('globalThis.__releaseOldReceipt()');await context.browser.waitFor('globalThis.__oldReceiptReturned===true');
      await context.browser.waitFor('document.querySelector("[data-action=check-incident-operation]")?.disabled===false');
      assert.equal(await context.browser.evaluate('JSON.parse(document.querySelector("[data-incident-unknown] + [data-diagnostic-copy] [data-diagnostics]")?.dataset.diagnostics??"{}").operation_id'),newId);
      assert.equal(await context.browser.evaluate('document.querySelector("[data-incident-outcome]")?.textContent.includes("原操作已确认提交")'),false);
    }finally{await tab.close();}
  });
});
