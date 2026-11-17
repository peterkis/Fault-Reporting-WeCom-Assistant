import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {t30Browser,inspectT30Drafts} from './helpers/t30-internal-note-browser-fixture.mjs';
import {record,text} from './helpers/t30-internal-note-fixture.mjs';
import {yxxTab} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
test('T30 lost acknowledgement restores the original encrypted intent and explicit receipt lookup confirms exactly one event',async()=>{
  await t30Browser('t30lost',async({browser,incidentId,get,put,post})=>{
    await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:"globalThis.__t30Posts=[];(()=>{const send=fetch;globalThis.fetch=async(path,options)=>{if(options?.method==='POST')globalThis.__t30Posts.push({path:String(path),body:options.body});return send(path,options);};})()"});
    await browser.evaluate("(()=>{const send=fetch;globalThis.__t30LostPost=null;globalThis.fetch=async(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes')){globalThis.__t30LostPost={path:String(path),body:options.body};const response=await send(path,options);await response.arrayBuffer();throw new TypeError('SYNTHETIC_ACK_LOSS_AFTER_REAL_COMMIT');}return send(path,options);};})()");
    await put('合成丢失响应之后仍仅内部');await browser.waitFor('document.querySelector("[data-action=submit-internal-note]")?.disabled===false');await browser.evaluate('document.querySelector("[data-action=submit-internal-note]").click()');await browser.waitFor('document.querySelector("[data-internal-note-outcome]")?.textContent.includes("结果未确认")');
    const posted=record(await browser.evaluate('globalThis.__t30LostPost')),body=record(JSON.parse(text(posted.body))),before=record(await browser.evaluate(inspectT30Drafts));assert.ok(Array.isArray(before.operations));assert.equal(before.operations.length,1);assert.equal(record(before.operations[0]).commandId,body.client_command_id);
    await browser.command('Page.reload');await browser.waitFor('document.querySelector("[data-internal-note-outcome]")?.textContent.includes("已找回上次的内容")');assert.equal(await browser.evaluate('document.querySelector("textarea[aria-label=内部处置记录]")?.value'),body.text);assert.equal(await browser.evaluate('document.querySelector("[data-action=submit-internal-note]")?.disabled'),true);assert.deepEqual(await browser.evaluate('globalThis.__t30Posts'),[]);
    await browser.evaluate('document.querySelector("[data-action=check-internal-note-operation]").click()');await browser.waitFor('document.querySelector("[data-internal-note-outcome]")?.textContent.includes("已提交")');const page=(await get('/api/incidents/'+incidentId+'/internal-notes')).body;assert.ok(Array.isArray(page.items));assert.equal(page.items.length,1);assert.equal(record(page.items[0]).text,body.text);assert.equal(record(page.items[0]).incident_row_version,'2');const after=record(await browser.evaluate(inspectT30Drafts));assert.deepEqual(after.drafts,[]);assert.deepEqual(after.operations,[]);assert.deepEqual(await browser.evaluate('globalThis.__t30Posts'),[]);
    await browser.waitFor('Boolean(document.querySelector("[data-action=new-internal-note-intent]"))');await browser.evaluate('document.querySelector("[data-action=new-internal-note-intent]").click()');
    await browser.evaluate("(()=>{const send=fetch;globalThis.__t30LostSecond=null;globalThis.fetch=async(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes')){globalThis.__t30LostSecond=JSON.parse(options.body);const response=await send(path,options);await response.arrayBuffer();throw new TypeError('SYNTHETIC_ACK_LOSS_AFTER_REAL_COMMIT');}return send(path,options);};})()");await put('合成第二次明确意图，随后失去写用途');await browser.waitFor('document.querySelector("[data-action=submit-internal-note]")?.disabled===false');await browser.evaluate('document.querySelector("[data-action=submit-internal-note]").click()');await browser.waitFor('document.querySelector("[data-internal-note-outcome]")?.textContent.includes("结果未确认")');const second=record(await browser.evaluate('globalThis.__t30LostSecond'));assert.notEqual(second.client_command_id,body.client_command_id);
    for(const [action,version,reason] of [['start-investigating','3','OPERATOR_REVIEWED'],['resolve','4','RECOVERY_CONFIRMED'],['close','5','RECOVERY_CONFIRMED']])assert.equal((await post('/api/incidents/'+incidentId+'/'+action,{client_command_id:randomUUID(),expected_row_version:version,reason_code:reason})).status,200);
    await browser.evaluate('document.querySelector("[data-action=refresh-incident]").click()');await browser.waitFor(`document.querySelector('[data-incident-id="${incidentId}"] dl dd')?.textContent==='已关闭'`);await browser.waitFor(inspectT30Drafts+'.then(copy=>copy.drafts.length===0)');const purged=record(await browser.evaluate(inspectT30Drafts));assert.deepEqual(purged.drafts,[]);assert.ok(Array.isArray(purged.operations));assert.equal(purged.operations.length,1,'write-purpose loss clears content while retaining the original unknown-operation identifier');assert.equal(record(purged.operations[0]).commandId,second.client_command_id);
    await browser.evaluate('document.querySelector("[data-action=check-internal-note-operation]").click()');await browser.waitFor('document.querySelector("[data-internal-note-outcome]")?.textContent.includes("已提交")');const completed=record(await browser.evaluate(inspectT30Drafts));assert.deepEqual(completed.operations,[]);const final=(await get('/api/incidents/'+incidentId+'/internal-notes')).body;assert.ok(Array.isArray(final.items));assert.equal(final.items.length,2);assert.equal(record(final.items[0]).incident_row_version,'2');assert.equal(record(final.items[1]).incident_row_version,'3');
  });
});
test('T30 expiry removes only the private encrypted draft at its original 24h without creating a command',async()=>{
  await t30Browser('t30expiry',async({browser,put})=>{
    await put('合成待恢复正文');await browser.waitFor('document.querySelector("[data-internal-note-draft]")?.textContent.includes("草稿已保存")');const saved=record(await browser.evaluate(inspectT30Drafts));assert.ok(Array.isArray(saved.drafts));const draft=record(saved.drafts[0]);assert.equal(draft.kind,'incident');assert.equal(draft.purpose,'incident-internal-note');assert.equal(draft.extractable,false);assert.equal(draft.algorithm,'AES-GCM');assert.equal(Number(draft.expiresAt)-Number(draft.firstSavedAt),86400000);assert.ok(Array.isArray(draft.keys));assert.equal(draft.keys.some(k=>['value','body','text'].includes(String(k))),false);
    const originalDocument=await browser.evaluate('performance.timeOrigin');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`Date.now=()=>${Number(draft.expiresAt)+1};`});await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${originalDocument}`);const clock=await browser.evaluate('Date.now()');console.log('T30_EXPIRY_CLOCK '+JSON.stringify({originalDocument,newDocument:await browser.evaluate('performance.timeOrigin'),expected:Number(draft.expiresAt)+1,clock}));assert.equal(clock,Number(draft.expiresAt)+1,'the expiry behavior requires a confirmed synthetic browser clock on the new document');await browser.waitFor('document.querySelector("[data-internal-note-draft]")?.textContent.includes("草稿仅在当前浏览器恢复")');assert.equal(await browser.evaluate('document.querySelector("textarea[aria-label=内部处置记录]")?.value'),'');const expired=record(await browser.evaluate(inspectT30Drafts));assert.deepEqual(expired.drafts,[]);assert.deepEqual(expired.operations,[]);
  });
});
test('T30 failed receipt without recovered text clears the operation without claiming the text remains',async()=>{
  await t30Browser('t30opaqfail',async({browser,incidentId,put})=>{
    await browser.evaluate("(()=>{const send=fetch;fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes')){globalThis.__opaqueCommand=JSON.parse(options.body);throw new TypeError('SYNTHETIC_LOST_REQUEST');}return send(path,options);};})()");
    await put('合成暂存的内部正文');await browser.waitFor('document.querySelector("[data-action=submit-internal-note]")?.disabled===false');
    await browser.evaluate('document.querySelector("[data-action=submit-internal-note]").click()');
    await browser.waitFor('document.querySelector("[data-internal-note-outcome]")?.textContent.includes("结果未确认")');
    const command=record(await browser.evaluate('globalThis.__opaqueCommand')),commandId=text(command.client_command_id);
    await browser.evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),rows=store.getAll();rows.onsuccess=()=>{for(const row of rows.result)if(row.purpose==='incident-internal-note')store.delete(row.scope);};tx.oncomplete=()=>{db.close();resolve();};};})`);
    const originalDocument=await browser.evaluate('performance.timeOrigin');
    await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${originalDocument}&&Boolean(document.querySelector("[data-action=check-internal-note-operation]"))&&Boolean(document.querySelector("textarea[aria-label=内部处置记录]"))`);
    assert.equal(await browser.evaluate('document.querySelector("textarea[aria-label=内部处置记录]")?.value'),'');
    await browser.evaluate(`(()=>{const read=fetch;fetch=(path,options)=>String(path).endsWith('/commands/${commandId}')?Promise.resolve(Response.json({incident_id:${JSON.stringify(incidentId)},client_command_id:${JSON.stringify(commandId)},state:'FAILED',error:{code:'P2_012_VERSION_CONFLICT',retryable:false}})):read(path,options);})()`);
    await browser.evaluate('document.querySelector("[data-action=check-internal-note-operation]").click()');
    await browser.waitFor('document.querySelector("[data-internal-note-outcome]")?.textContent.includes("上次提交没有成功")');
    assert.equal(await browser.evaluate('document.querySelector("[data-internal-note-outcome]")?.textContent.includes("内容还在")'),false);
    const after=record(await browser.evaluate(inspectT30Drafts));assert.deepEqual(after.drafts,[]);assert.deepEqual(after.operations,[]);
  });
});
test('T30 opaque failed receipt switches to a newer shared operation without waiting for a notification',async()=>{
  await t30Browser('t30newop',async({browser,incidentId,put})=>{
    await browser.evaluate("(()=>{const send=fetch;fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes')){globalThis.__opaqueCommand=JSON.parse(options.body);throw new TypeError('SYNTHETIC_LOST_REQUEST');}return send(path,options);};})()");
    await put('合成旧操作正文');await browser.waitFor('document.querySelector("[data-action=submit-internal-note]")?.disabled===false');await browser.evaluate('document.querySelector("[data-action=submit-internal-note]").click()');
    await browser.waitFor('document.querySelector("[data-internal-note-outcome]")?.textContent.includes("结果未确认")');
    const oldId=text(record(await browser.evaluate('globalThis.__opaqueCommand')).client_command_id),nextId=randomUUID();
    await browser.evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),rows=store.getAll();rows.onsuccess=()=>{for(const row of rows.result)if(row.purpose==='incident-internal-note')store.delete(row.scope);};tx.oncomplete=()=>{db.close();resolve();};};})`);
    const previousDocument=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${previousDocument}&&Boolean(document.querySelector("[data-action=check-internal-note-operation]"))`);
    await browser.evaluate(`(()=>{const read=fetch;fetch=(path,options)=>{const url=String(path);if(url.endsWith('/commands/${oldId}'))return new Promise(resolve=>{globalThis.__releaseOldReceipt=()=>resolve(Response.json({incident_id:${JSON.stringify(incidentId)},client_command_id:${JSON.stringify(oldId)},state:'FAILED',error:{code:'P2_012_VERSION_CONFLICT',retryable:false}}));});if(url.endsWith('/commands/${nextId}')){globalThis.__checkedNew=true;return Promise.resolve(Response.json({incident_id:${JSON.stringify(incidentId)},client_command_id:${JSON.stringify(nextId)},state:'UNKNOWN'}));}return read(path,options);};})()`);
    await browser.evaluate('document.querySelector("[data-action=check-internal-note-operation]").click()');await browser.waitFor('typeof globalThis.__releaseOldReceipt==="function"');
    await browser.evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('operations','readwrite'),store=tx.objectStore('operations'),rows=store.getAll();rows.onsuccess=()=>{for(const row of rows.result)if(row.commandId===${JSON.stringify(oldId)})store.put({...row,commandId:${JSON.stringify(nextId)}});};tx.oncomplete=()=>{db.close();resolve();};};})`);
    await browser.evaluate('globalThis.__releaseOldReceipt()');await browser.waitFor(`JSON.parse(document.querySelector('[aria-label="内部处置记录"] [data-diagnostics]')?.dataset.diagnostics??'{}').operation_id===${JSON.stringify(nextId)}`);
    assert.equal(await browser.evaluate('document.querySelector("[data-internal-note-outcome]")?.textContent.includes("另一个页面已开始新的操作")'),true);
    await browser.evaluate('document.querySelector("[data-action=check-internal-note-operation]").click()');await browser.waitFor('globalThis.__checkedNew===true');
  });
});
test('T30 peer failure and discard leave the independent local input available',async()=>{
  await t30Browser('t30peerfail',async({browser,incidentId,origin,put})=>{
    let tab:Awaited<ReturnType<typeof yxxTab>>|undefined;
    try{
      await put('合成对方内部记录');await browser.waitFor('document.querySelector("[data-internal-note-draft]")?.textContent.includes("草稿已保存")');
      tab=await yxxTab(browser,origin+'/workbench/app/incidents/'+incidentId);await tab.waitFor('document.querySelector("textarea[aria-label=内部处置记录]")?.value==="合成对方内部记录"&&document.querySelector("[data-action=submit-internal-note]")?.disabled===false');
      await browser.evaluate("(()=>{const timer=window.setTimeout;globalThis.__restoreTimer=()=>{window.setTimeout=timer;};window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);})()");
      await put('合成本页独立内部输入');
      await tab.evaluate("(()=>{const send=fetch;fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes'))return new Promise(resolve=>{globalThis.__rejectNote=()=>resolve(Response.json({ok:false,error:{code:'P2_012_VERSION_CONFLICT',retryable:false},replayed:false},{status:409}));});return send(path,options);};})()");
      await tab.evaluate('document.querySelector("[data-action=submit-internal-note]").click()');await browser.waitFor('Boolean(document.querySelector("[data-action=check-internal-note-operation]"))');
      await tab.waitFor('typeof globalThis.__rejectNote==="function"');await tab.evaluate('globalThis.__rejectNote()');
      await browser.waitFor('document.querySelector("[data-internal-note-draft]")?.textContent.includes("另一页面仍有草稿")');
      assert.equal(await browser.evaluate('document.querySelector("textarea[aria-label=内部处置记录]")?.value'),'合成本页独立内部输入');
      assert.equal(await browser.evaluate('document.querySelector("textarea[aria-label=内部处置记录]")?.disabled'),false);
      assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-action=check-internal-note-operation]"))'),false);
      await browser.evaluate('globalThis.__restoreTimer()');await tab.evaluate('document.querySelector("[data-action=discard-internal-note-draft]").click()');
      await browser.waitFor('document.querySelector("textarea[aria-label=内部处置记录]")?.value==="合成本页独立内部输入"&&document.querySelector("[data-internal-note-draft]")?.textContent.includes("草稿已保存")');
    }finally{await tab?.close();}
  });
});

test('T30 peer failure clears the receipt on a blank page',async()=>{
  await t30Browser('t30peerblank',async({browser,incidentId,origin})=>{
    let tab:Awaited<ReturnType<typeof yxxTab>>|undefined;
    try{
      await browser.waitFor('document.querySelector("[data-internal-note-draft]")?.textContent.includes("草稿仅在当前浏览器")');
      tab=await yxxTab(browser,origin+'/workbench/app/incidents/'+incidentId);await tab.waitFor('document.querySelector("[data-internal-note-draft]")?.textContent.includes("草稿仅在当前浏览器")');
      await tab.evaluate('(()=>{const el=document.querySelector("textarea[aria-label=内部处置记录]");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(el,"合成另一页内部记录");el.dispatchEvent(new Event("input",{bubbles:true}));})()');
      await tab.waitFor('document.querySelector("[data-internal-note-draft]")?.textContent.includes("草稿已保存")');
      await tab.evaluate("(()=>{const send=fetch;fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes'))return new Promise(resolve=>{globalThis.__rejectNote=()=>resolve(Response.json({ok:false,error:{code:'P2_012_VERSION_CONFLICT',retryable:false},replayed:false},{status:409}));});return send(path,options);};})()");
      await tab.evaluate('document.querySelector("[data-action=submit-internal-note]").click()');await tab.waitFor('typeof globalThis.__rejectNote==="function"');
      await browser.waitFor('Boolean(document.querySelector("[data-action=check-internal-note-operation]"))');await tab.evaluate('globalThis.__rejectNote()');
      await browser.waitFor('document.querySelector("textarea[aria-label=内部处置记录]")?.disabled===false&&!document.querySelector("[data-action=check-internal-note-operation]")');
      assert.equal(await browser.evaluate('document.querySelector("textarea[aria-label=内部处置记录]").value'),'');
    }finally{await tab?.close();}
  });
});

test('T30 blank observer keeps the other page failed internal note',async()=>{
  await t30Browser('t30obsfail',async({browser,incidentId,origin})=>{
    let tab:Awaited<ReturnType<typeof yxxTab>>|undefined;
    try{
      tab=await yxxTab(browser,origin+'/workbench/app/incidents/'+incidentId);
      await tab.waitFor('document.querySelector("[data-internal-note-draft]")?.textContent.includes("草稿仅在当前浏览器")');
      await tab.evaluate('(()=>{const el=document.querySelector("textarea[aria-label=内部处置记录]");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(el,"T30_FAILED_PEER_TEXT");el.dispatchEvent(new Event("input",{bubbles:true}));})()');
      await tab.waitFor('document.querySelector("[data-internal-note-draft]")?.textContent.includes("草稿已保存")');
      await tab.evaluate("(()=>{const send=fetch;fetch=(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes')){globalThis.__t30PeerCommand=JSON.parse(options.body);return new Promise(()=>{});}return send(path,options);};})()");
      await tab.evaluate('document.querySelector("[data-action=submit-internal-note]").click()');
      await tab.waitFor('Boolean(globalThis.__t30PeerCommand?.client_command_id)');
      await browser.waitFor('Boolean(document.querySelector("[data-action=check-internal-note-operation]"))');
      assert.equal(await browser.evaluate('document.querySelector("textarea[aria-label=内部处置记录]").value'),'');
      const command=record(await tab.evaluate('globalThis.__t30PeerCommand')),id=text(command.client_command_id);
      await browser.evaluate(`(()=>{const read=fetch;fetch=(path,options)=>String(path).endsWith('/commands/${id}')?Promise.resolve(Response.json({incident_id:${JSON.stringify(incidentId)},client_command_id:${JSON.stringify(id)},state:'FAILED',error:{code:'P2_012_VERSION_CONFLICT',retryable:false}})):read(path,options);})()`);
      await browser.evaluate('document.querySelector("[data-action=check-internal-note-operation]").click()');
      await browser.waitFor('document.querySelector("[data-internal-note-outcome]")?.textContent.includes("上次提交没有成功")');
      const saved=record(await browser.evaluate(inspectT30Drafts));assert.ok(Array.isArray(saved.drafts));assert.equal(saved.drafts.length,1,'a FAILED receipt must retain the sender page draft');assert.deepEqual(saved.operations,[]);
      const before=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');
      await browser.waitFor(`performance.timeOrigin!==${JSON.stringify(before)}&&document.querySelector("textarea[aria-label=内部处置记录]")?.value==="T30_FAILED_PEER_TEXT"`);
    }finally{await tab?.close();}
  });
});

test('T30 checking a committed peer operation restores the independent local input',async()=>{
  await t30Browser('t30peerack',async({browser,incidentId,origin,put})=>{
    let tab:Awaited<ReturnType<typeof yxxTab>>|undefined;
    try{
      await put('合成对方已提交记录');await browser.waitFor('document.querySelector("[data-internal-note-draft]")?.textContent.includes("草稿已保存")');
      tab=await yxxTab(browser,origin+'/workbench/app/incidents/'+incidentId);await tab.waitFor('document.querySelector("textarea[aria-label=内部处置记录]")?.value==="合成对方已提交记录"&&document.querySelector("[data-action=submit-internal-note]")?.disabled===false');
      await browser.evaluate("(()=>{const timer=window.setTimeout;globalThis.__restoreTimer=()=>{window.setTimeout=timer;};window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);})()");
      await put('合成本页待保存记录');
      await tab.evaluate("(()=>{const send=fetch;fetch=async(path,options)=>{if(options?.method==='POST'&&String(path).endsWith('/internal-notes')){const response=await send(path,options);return new Promise(resolve=>{globalThis.__releaseNote=()=>resolve(response);});}return send(path,options);};})()");
      await tab.evaluate('document.querySelector("[data-action=submit-internal-note]").click()');await tab.waitFor('typeof globalThis.__releaseNote==="function"');
      await browser.waitFor('Boolean(document.querySelector("[data-action=check-internal-note-operation]"))');await browser.evaluate('globalThis.__restoreTimer()');
      await browser.evaluate("(()=>{const read=fetch;let count=0;fetch=(path,options)=>{if(String(path)==='/api/lifecycle/bootstrap'&&++count===3)return new Promise((resolve,reject)=>{globalThis.__releaseRestoreRead=()=>read(path,options).then(resolve,reject);});return read(path,options);};})()");
      await browser.evaluate('document.querySelector("[data-action=check-internal-note-operation]").click()');
      await browser.waitFor('typeof globalThis.__releaseRestoreRead==="function"');
      assert.equal(await browser.evaluate('document.querySelector("textarea[aria-label=内部处置记录]")?.disabled'),true);
      await browser.evaluate('globalThis.__releaseRestoreRead()');
      await browser.waitFor('document.querySelector("textarea[aria-label=内部处置记录]")?.value==="合成本页待保存记录"&&document.querySelector("[data-internal-note-draft]")?.textContent.includes("草稿已保存")');
      assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-action=check-internal-note-operation]"))'),false);
    }finally{await tab?.close();}
  });
});
test('T30 current CLOSED removes a now-ineligible private input while authorized internal history remains readable',async()=>{
  await t30Browser('t30closing',async({browser,incidentId,put,post})=>{
    const path='/api/incidents/'+incidentId;await put('合成关闭前的私有未提交输入');await browser.waitFor('document.querySelector("[data-internal-note-draft]")?.textContent.includes("草稿已保存")');
    for(const [action,version,reason] of [['start-investigating','1','OPERATOR_REVIEWED'],['resolve','2','RECOVERY_CONFIRMED'],['close','3','RECOVERY_CONFIRMED']])assert.equal((await post(path+'/'+action,{client_command_id:randomUUID(),expected_row_version:version,reason_code:reason})).status,200);
    await browser.evaluate('document.querySelector("[data-action=refresh-incident]").click()');await browser.waitFor(`document.querySelector('[data-incident-id="${incidentId}"] dl dd')?.textContent==='已关闭'`);assert.equal(await browser.evaluate('Boolean(document.querySelector("textarea[aria-label=内部处置记录]"))'),false);
    await browser.waitFor(inspectT30Drafts+'.then(copy=>copy.drafts.length===0)');const stored=record(await browser.evaluate(inspectT30Drafts));assert.deepEqual(stored.drafts,[],'loss of the current write purpose must remove sensitive recovery content');assert.equal(await browser.evaluate('Boolean(document.querySelector("[aria-label=内部处置历史]"))'),true);
  });
});
test('T30 a held real private GET cannot repopulate its history section after current purpose revocation',async()=>{
  await t30Browser('t30late',async({browser,incidentId,pool,f,post})=>{
    const path='/api/incidents/'+incidentId,secret='合成晚到私有记录，失权后不展示';assert.equal((await post(path+'/internal-notes',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'WORKBENCH_INTERNAL_DISPOSITION',audience:'INTERNAL',text:secret})).status,200);
    await browser.evaluate("(()=>{const send=fetch;globalThis.__t30Held=[];globalThis.__t30Hold=true;globalThis.fetch=async(path,options)=>{if(globalThis.__t30Hold&&(!options?.method||options.method==='GET')&&String(path).includes('/internal-notes')){const response=await send(path,options),bytes=await response.arrayBuffer(),headers=[...response.headers];return new Promise(resolve=>globalThis.__t30Held.push(()=>resolve(new Response(bytes,{status:response.status,headers}))));}return send(path,options);};})()");
    await browser.evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='回到内部记录起点').click()");await browser.waitFor('globalThis.__t30Held.length>0');
    const admin=text(record(f.admin).id);await pool.query('UPDATE pilot_ticket.ticket SET assignee_id=$1::uuid WHERE id=$2::uuid',[admin,text(record(f.reports[0]).ticketId)]);await pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='ADMIN'",[admin]);await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER')",[admin]);
    await browser.evaluate('document.querySelector("[data-action=refresh-incident]").click()');await browser.waitFor('document.querySelector("[data-internal-note-outcome]")?.textContent.includes("已失权")');await browser.evaluate('globalThis.__t30Hold=false;for(const release of globalThis.__t30Held)release();globalThis.__t30Held=[];');
    assert.equal(await browser.evaluate(`document.querySelector('[aria-label="内部处置历史"]')?.textContent.includes(${JSON.stringify(secret)})`),false);assert.equal(await browser.evaluate('Boolean(document.querySelector("textarea[aria-label=内部处置记录]"))'),false);
  });
});
