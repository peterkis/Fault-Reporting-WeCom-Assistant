import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {candidateBrowser,record,text} from './helpers/wbint-t27-browser-fixture.mjs';
import {candidateCopies} from './helpers/wbint-t27-draft-observation.mjs';
import {prepareFollowup,confirmIncident,navigateFollowup,chooseFollowup,rows,submitFollowup,observeFollowupPosts,personalSnapshots} from './helpers/t28-followup-source-fixture.mjs';

test('T28 purpose-only denial fences a held native encryption and preserves a separate still-authorized Incident draft',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t28latestore',reporters:6,recovery:true},async context=>{
    const {http,id}=await prepareFollowup(context,3),candidateId=text(record(await context.f.newCandidate(3)).id),other=await confirmIncident(http,candidateId,text(record(context.f.handler).id),context.f.reports.slice(3).map(row=>text(record(row).decisionId)));
    await navigateFollowup(context,other);await context.browser.waitFor('document.querySelector("[data-incident-draft]")?.textContent.includes("最长24小时")');await chooseFollowup(context.browser,'公共故障操作','START_INVESTIGATING');await chooseFollowup(context.browser,'决定原因','OPERATOR_REVIEWED');await context.browser.waitFor('document.querySelector("[data-incident-draft]")?.textContent.includes("已保存恢复副本")');const retained=rows(record(await context.browser.evaluate(candidateCopies)).drafts).filter(row=>row.kind==='incident'&&row.id===other);assert.equal(retained.length,1);
    await navigateFollowup(context,id);await context.browser.waitFor('document.querySelector("[data-incident-draft]")?.textContent.includes("最长24小时")');await context.browser.evaluate('(()=>{const encrypt=crypto.subtle.encrypt.bind(crypto.subtle);globalThis.__t28NativeEncrypt=encrypt;let held=false;crypto.subtle.encrypt=(...args)=>{if(held)return encrypt(...args);held=true;return new Promise((resolve,reject)=>{globalThis.__t28ReleaseEncryption=()=>encrypt(...args).then(value=>{globalThis.__t28EncryptionReleased=true;resolve(value);},reject);});};})()');await chooseFollowup(context.browser,'公共故障操作','CORRECT_SCOPE');await chooseFollowup(context.browser,'决定原因','SCOPE_CORRECTION');await chooseFollowup(context.browser,'确认范围','BUILDING');await context.browser.waitFor('typeof globalThis.__t28ReleaseEncryption==="function"');
    await createPilotAccessService({pool:context.pool}).upsertPrincipal({wecomUserId:'synthetic-incident-admin',displayName:'合成管理员',roles:['DISPATCHER'],resolverTeamIds:['PILOT_IT']});await context.browser.evaluate('document.querySelector("[data-action=refresh-incident]").click()');await context.browser.waitFor('document.querySelector("[data-incident-outcome]")?.textContent.includes("权限不可用")');await context.browser.evaluate('globalThis.__t28ReleaseEncryption()');await context.browser.waitFor('globalThis.__t28EncryptionReleased===true');await context.browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const after=record(await context.browser.evaluate(candidateCopies));assert.equal(rows(after.drafts).filter(row=>row.kind==='incident'&&row.id===id).length,0);assert.equal(rows(after.operations).filter(row=>row.kind==='incident'&&row.id===id).length,0);assert.deepEqual(rows(after.drafts).filter(row=>row.kind==='incident'&&row.id===other),retained);assert.equal(await context.browser.evaluate('document.querySelector(".workbench-select[data-field-label=公共故障操作] select").value'),'');assert.equal(rows(await context.browser.evaluate('globalThis.__t27Posts')).length,0);assert.equal((await http.get('/api/incidents/'+id)).row_version,'1');assert.equal((await http.get('/api/incidents/'+other)).row_version,'1');
  });
});

test('T28 expiry retains only the original opaque operation; a committed receipt keeps its known result through a real cleanup failure',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t28expired',reporters:3,recovery:true},async context=>{
    const {id,path}=await prepareFollowup(context);await navigateFollowup(context,id);await context.browser.waitFor('document.querySelector("[data-incident-draft]")?.textContent.includes("最长24小时")');await chooseFollowup(context.browser,'公共故障操作','CORRECT_SCOPE');await chooseFollowup(context.browser,'决定原因','SCOPE_CORRECTION');await chooseFollowup(context.browser,'确认范围','BUILDING');
    await context.browser.evaluate(`(()=>{const send=fetch;globalThis.fetch=async(input,options)=>{const response=await send(input,options);if(options?.method==='POST'&&String(input)===${JSON.stringify(path+'/correct-scope')}){globalThis.__t28Actual={status:response.status,body:await response.clone().json()};throw new TypeError('T28_LOST_ACK');}return response;};})()`);await context.browser.waitFor('document.querySelector("[data-action=submit-incident]")?.disabled===false');await context.browser.evaluate('document.querySelector("[data-action=submit-incident]").click()');await context.browser.waitFor('Boolean(document.querySelector("[data-incident-unknown]"))');assert.equal(record(await context.browser.evaluate('globalThis.__t28Actual')).status,200);
    const stored=record(await context.browser.evaluate(candidateCopies)),row=rows(stored.drafts)[0],operation=rows(stored.operations)[0];assert.ok(row&&operation);assert.equal(typeof row.expiresAt,'number');assert.equal(typeof row.firstSavedAt,'number');assert.equal(Number(row.expiresAt)-Number(row.firstSavedAt),86400000);const commandId=text(operation.commandId),previous=await context.browser.evaluate('performance.timeOrigin');await context.browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`Date.now=()=>${Number(row.expiresAt)+1};`});await context.browser.command('Page.reload');await context.browser.waitFor(`performance.timeOrigin!==${previous}&&document.querySelector('[data-incident-draft]')?.textContent.includes('草稿已过期')`);
    const expired=record(await context.browser.evaluate(candidateCopies));assert.deepEqual(expired.drafts,[]);assert.deepEqual(expired.operations,[operation]);assert.equal(await context.browser.evaluate('document.querySelector(".workbench-select[data-field-label=公共故障操作] select").value'),'');assert.equal(rows(await context.browser.evaluate('globalThis.__t27Posts')).length,0);assert.equal(await context.browser.evaluate('Boolean(document.querySelector("[data-action=replay-incident-operation]"))'),false);
    await context.browser.evaluate('(()=>{globalThis.__t28Delete=IDBObjectStore.prototype.delete;IDBObjectStore.prototype.delete=function(...args){if(this.name==="operations")throw new DOMException("T28_CONTROLLED_CLEANUP_FAILURE","UnknownError");return globalThis.__t28Delete.apply(this,args);};})()');await context.browser.evaluate('document.querySelector("[data-action=check-incident-operation]").click()');await context.browser.waitFor('document.querySelector("[data-incident-outcome]")?.textContent.includes("已确认提交")&&document.querySelector("[data-incident-outcome]").textContent.includes("清理失败")');assert.equal(await context.browser.evaluate('document.querySelector("[data-action=submit-incident]").disabled'),true);assert.equal(await context.browser.evaluate('Boolean(document.querySelector("[data-incident-unknown]"))'),false);assert.deepEqual(record(await context.browser.evaluate(candidateCopies)).operations,[operation]);
    await context.browser.evaluate('IDBObjectStore.prototype.delete=globalThis.__t28Delete');await context.browser.evaluate('document.querySelector("[data-action=check-incident-operation]").click()');await context.browser.waitFor('document.querySelector("[data-incident-outcome]")?.textContent.includes("已确认提交")&&!document.querySelector("[data-incident-outcome]").textContent.includes("清理失败")');assert.deepEqual(record(await context.browser.evaluate(candidateCopies)).operations,[]);assert.equal(rows(await context.browser.evaluate('globalThis.__t27Posts')).length,0);assert.equal(await context.browser.evaluate(`globalThis.__t27DomainReads.filter(path=>path===${JSON.stringify(path+'/commands/'+commandId)}).length`),2);
  });
});

test('T28 an actual UNKNOWN receipt permits only explicit replay with the original UUID, exact body and version',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t28replay',reporters:3,recovery:true},async context=>{
    const {http,id,path}=await prepareFollowup(context);await navigateFollowup(context,id);await context.browser.waitFor('document.querySelector("[data-incident-draft]")?.textContent.includes("最长24小时")');await chooseFollowup(context.browser,'公共故障操作','CORRECT_SCOPE');await chooseFollowup(context.browser,'决定原因','SCOPE_CORRECTION');await chooseFollowup(context.browser,'确认范围','BUILDING');
    await context.browser.evaluate(`(()=>{const send=fetch;globalThis.__t28Attempts=[];globalThis.fetch=async(input,options)=>{if(options?.method==='POST'&&String(input)===${JSON.stringify(path+'/correct-scope')}){const h=new Headers(options.headers);globalThis.__t28Attempts.push({body:options.body,key:h.get('idempotency-key'),version:h.get('if-match')});if(globalThis.__t28Attempts.length===1)throw new TypeError('T28_CONTROLLED_NO_WIRE');}return send(input,options);};})()`);await context.browser.waitFor('document.querySelector("[data-action=submit-incident]")?.disabled===false');await context.browser.evaluate('document.querySelector("[data-action=submit-incident]").click()');await context.browser.waitFor('Boolean(document.querySelector("[data-incident-unknown]"))');assert.equal((await http.get(path)).row_version,'1');assert.equal(rows(await context.browser.evaluate('globalThis.__t28Attempts')).length,1);
    await context.browser.evaluate('document.querySelector("[data-action=check-incident-operation]").click()');await context.browser.waitFor('Boolean(document.querySelector("[data-action=replay-incident-operation]"))');assert.equal((await http.get(path)).row_version,'1');assert.equal(rows(await context.browser.evaluate('globalThis.__t28Attempts')).length,1);await context.browser.evaluate('document.querySelector("[data-action=replay-incident-operation]").click()');await context.browser.waitFor('document.querySelector("[data-incident-outcome]")?.textContent.includes("已提交")');const attempts=rows(await context.browser.evaluate('globalThis.__t28Attempts'));assert.equal(attempts.length,2);assert.deepEqual(attempts[1],attempts[0]);assert.equal((await http.get(path)).row_version,'2');assert.deepEqual(record(await context.browser.evaluate(candidateCopies)).operations,[]);
  });
});

test('T28 a clean committed result permits an explicit next intent in the same mounted detail with a fresh UUID and current version',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t28next',reporters:3,recovery:true},async context=>{
    const {http,id,path}=await prepareFollowup(context),before=await personalSnapshots(http,context.f.reports);
    await navigateFollowup(context,id);await observeFollowupPosts(context.browser);
    await submitFollowup(context,id,'START_INVESTIGATING','OPERATOR_REVIEWED',[],'2');
    await context.browser.waitFor('document.querySelector("[data-incident-outcome]")?.textContent.includes("已提交")');
    assert.deepEqual(record(await context.browser.evaluate(candidateCopies)).operations,[]);
    assert.equal(await context.browser.evaluate('Boolean(document.querySelector("[data-action=new-incident-intent]"))'),true,'known clean settlement offers an explicit next intent');
    await context.capture();
    for(const [action,reason,version] of [['RESOLVE_INCIDENT','RECOVERY_CONFIRMED','3'],['CLOSE_INCIDENT','RECOVERY_CONFIRMED','4']] as const){
      await context.browser.waitFor('document.querySelector("[data-action=new-incident-intent]")?.disabled===false');
      await context.browser.evaluate('document.querySelector("[data-action=new-incident-intent]").click()');
      assert.equal(await context.browser.evaluate('document.querySelector(".workbench-select[data-field-label=公共故障操作] select").value'),'');
      assert.equal(await context.browser.evaluate('document.querySelector(".workbench-select[data-field-label=决定原因] select").value'),'');
      const count=rows(await context.browser.evaluate('globalThis.__t28Posts')).length;
      await submitFollowup(context,id,action,reason,[],version);
      assert.equal(rows(await context.browser.evaluate('globalThis.__t28Posts')).length,count+1,'new intent does not autoPOST');
      assert.deepEqual(record(await context.browser.evaluate(candidateCopies)).operations,[]);
    }
    const posts=rows(await context.browser.evaluate('globalThis.__t28Posts')),bodies=posts.map(post=>record(JSON.parse(text(post.body))));
    assert.equal(posts.length,3);assert.equal(new Set(bodies.map(body=>body.client_command_id)).size,3);
    assert.deepEqual(bodies.map(body=>body.expected_row_version),['1','2','3']);
    assert.deepEqual(posts.map(post=>post.if_match),['"1"','"2"','"3"']);
    assert.ok(posts.every((post,index)=>post.idempotency_key===bodies[index]?.client_command_id));
    assert.equal((await http.get(path)).status,'CLOSED');assert.deepEqual(await personalSnapshots(http,context.f.reports),before);
    await context.browser.command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  });
});

test('T28 an original UNKNOWN replay reaches the existing ledger after a competing version advance and settles stable FAILED without a new intent',{timeout:240000},async()=>{
  await candidateBrowser({purpose:'t28replayx',reporters:3,recovery:true},async context=>{
    const {http,id,path}=await prepareFollowup(context);await navigateFollowup(context,id);
    await context.browser.waitFor('document.querySelector("[data-incident-draft]")?.textContent.includes("最长24小时")');
    await chooseFollowup(context.browser,'公共故障操作','CORRECT_SCOPE');await chooseFollowup(context.browser,'决定原因','SCOPE_CORRECTION');await chooseFollowup(context.browser,'确认范围','BUILDING');
    await context.browser.evaluate(`(()=>{const send=fetch;globalThis.__t28Attempts=[];globalThis.fetch=async(input,options)=>{if(options?.method==='POST'&&String(input)===${JSON.stringify(path+'/correct-scope')}){const h=new Headers(options.headers);globalThis.__t28Attempts.push({body:options.body,key:h.get('idempotency-key'),version:h.get('if-match')});if(globalThis.__t28Attempts.length===1)throw new TypeError('T28_CONTROLLED_NO_WIRE');}return send(input,options);};})()`);
    await context.browser.waitFor('document.querySelector("[data-action=submit-incident]")?.disabled===false');await context.browser.evaluate('document.querySelector("[data-action=submit-incident]").click()');
    await context.browser.waitFor('Boolean(document.querySelector("[data-incident-unknown]"))');const original=record(rows(await context.browser.evaluate('globalThis.__t28Attempts'))[0]),body=record(JSON.parse(text(original.body)));
    assert.equal(await context.browser.evaluate('Boolean(document.querySelector("[data-action=new-incident-intent]"))'),false,'UNKNOWN cannot start a new intent');
    assert.equal((await http.get(path)).row_version,'1');
    await http.post(path+'/start-investigating',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'});
    const events=rows((await http.get(path+'/events?limit=200')).items);assert.equal((await http.get(path)).row_version,'2');
    assert.equal((await http.get(path+'/commands/'+text(body.client_command_id))).state,'UNKNOWN');
    await context.browser.evaluate('document.querySelector("[data-action=check-incident-operation]").click()');await context.browser.waitFor('Boolean(document.querySelector("[data-action=replay-incident-operation]"))');
    assert.equal(rows(await context.browser.evaluate('globalThis.__t28Attempts')).length,1);
    await context.browser.evaluate('document.querySelector("[data-action=replay-incident-operation]").click()');
    await context.browser.waitFor('(()=>{const text=document.querySelector("[data-incident-outcome]")?.textContent??"";return text.includes("原操作已明确失败")||text.includes("尚未重放");})()');
    const attempts=rows(await context.browser.evaluate('globalThis.__t28Attempts'));assert.equal(attempts.length,2,'explicit original replay reaches the real ledger despite newer parent facts');assert.deepEqual(attempts[1],original);
    assert.deepEqual(await http.get(path+'/commands/'+text(body.client_command_id)),{incident_id:id,client_command_id:body.client_command_id,state:'FAILED',error:{code:'P2_012_VERSION_CONFLICT',retryable:false}});
    assert.deepEqual(record(await context.browser.evaluate(candidateCopies)).operations,[]);assert.equal(await context.browser.evaluate('Boolean(document.querySelector("[data-incident-unknown]"))'),false);
    assert.equal(await context.browser.evaluate('document.querySelector(".workbench-select[data-field-label=确认范围] select").value'),'BUILDING');assert.equal((await http.get(path)).row_version,'2');assert.deepEqual(rows((await http.get(path+'/events?limit=200')).items),events);
  });
});
