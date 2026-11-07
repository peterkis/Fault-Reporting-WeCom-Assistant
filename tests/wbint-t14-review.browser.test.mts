import {openWorkbenchStep} from './helpers/heroui-workbench-controls.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {appendReviewMaterial} from './helpers/wbint-t14-review-material.mjs';
import {clickWorkbenchControl,chooseWorkbenchSelect} from './helpers/heroui-workbench-controls.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface Fixture {origin:string;cookies:string[];browserCookies:{name:string;value:string}[];pool:PostgresPool;principals:{id:string}[];processReviewIntake:(id:string)=>Promise<unknown>;tickets:{ticket:{id:string}}[]}
async function reload(browser:Browser){const previous=await browser.evaluate('performance.timeOrigin');assert.equal(typeof previous,'number');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'`);}
async function choose(browser:Browser,choice:string,reason:string){await browser.evaluate(`(()=>{const set=(label,value)=>{const input=document.querySelector('.workbench-select[data-field-label="'+label+'"] select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('change',{bubbles:true}));};set('复核结论',${JSON.stringify(choice)});set('复核原因',${JSON.stringify(reason)});})()`);}
const traceCommands="(()=>{globalThis.__t14Commands=[];const original=globalThis.fetch;globalThis.fetch=(path,options)=>{if(String(path).endsWith('/resolve'))globalThis.__t14Commands.push(JSON.parse(options.body));return original(path,options);};})()";
const draftCounts="new Promise(resolve=>{const open=indexedDB.open('wecom-workbench-drafts-v1');open.onsuccess=()=>{const db=open.result,tx=db.transaction(['drafts','operations']),drafts=tx.objectStore('drafts').getAll(),operations=tx.objectStore('operations').getAll();tx.oncomplete=()=>{db.close();resolve({drafts:drafts.result.map(row=>({id:row.id,purpose:row.purpose})),operations:operations.result.map(row=>({id:row.id,commandId:row.commandId}))});};};})";

test('Card 27B existing out-of-scope reasons use pointer and keyboard radios with the original authorized command',{timeout:240000},async()=>{
  await withWeb01Fixture(async({origin,cookies,browserCookies,pool}:Fixture)=>{
    const cookie=browserCookies[0];assert.ok(cookie);const get=(path:string,index=0)=>fetch(origin+path,{headers:{cookie:cookies[index]}});
    const boardResponse=await get('/api/workbench/board?column=pending');assert.equal(boardResponse.status,200);
    const board=await boardResponse.json() as {items:{id:string;kind:string;intake_id:string}[]},selected=board.items.find(item=>item.kind==='review');assert.ok(selected);
    const originalResponse=await get('/api/manual-reviews/'+selected.id);assert.equal(originalResponse.status,200);
    const original=await originalResponse.json() as {row_version:string;material_basis:{current_hash:string};safe_result:unknown;allowed_resolutions:string[]};
    assert.ok(original.allowed_resolutions.includes('MARK_OUT_OF_SCOPE'));assert.equal((await get('/api/manual-reviews/'+selected.id,2)).status,404,'the unlinked Review remains unavailable to an ordinary Handler');
    assert.equal((await pool.query<{pilot_ticket_id:string|null}>('SELECT pilot_ticket_id::text FROM intake.service_intake WHERE id=$1::uuid',[selected.intake_id])).rows[0]?.pilot_ticket_id,null);
    const ticketCount=(await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM pilot_ticket.ticket')).rows[0]?.count;
    const beforeEvents=(await pool.query<{count:number}>("SELECT count(*)::integer AS count FROM intake.service_intake_event WHERE intake_id=$1::uuid AND event_type='intake.rule_decision_applied'",[selected.intake_id])).rows[0]?.count;assert.ok(typeof beforeEvents==='number');
    let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/review/'+selected.id+'?detail=page',width:1440,height:1060,cookies:[{...cookie,url:origin+'/'}]});assert.ok(browser);
      await browser.command('Page.bringToFront');await browser.waitFor("document.querySelector('[data-review-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");await openWorkbenchStep(browser,'[data-review-id]');
      assert.equal(await browser.evaluate("document.querySelector('[data-action=submit-review]').disabled"),true,'an explicit conclusion and reason are still required');
      const closureBeforeResponse=await get('/api/intakes/'+selected.intake_id+'/closure-context');assert.equal(closureBeforeResponse.status,200);const closureBefore=await closureBeforeResponse.json() as {version:number};
      await browser.evaluate("(()=>{globalThis.__card27ReviewCommands=[];globalThis.__card27ReviewResponses=[];const original=globalThis.fetch;globalThis.fetch=async(path,options)=>{const resolving=options?.method==='POST'&&(String(path).endsWith('/resolve')||String(path).endsWith('/close'));if(resolving)globalThis.__card27ReviewCommands.push({body:JSON.parse(options.body),ifMatch:options.headers['if-match'],idempotency:options.headers['idempotency-key']});const response=await original(path,options);if(resolving)globalThis.__card27ReviewResponses.push(response.status);return response;};})()");
      await clickWorkbenchControl(browser,'.workbench-select[data-field-label=复核结论] [data-slot=select-trigger]');await clickWorkbenchControl(browser,'[role=option][data-key=MARK_OUT_OF_SCOPE]');
      await browser.waitFor("document.querySelector('.detail-cancel-dialog')?.checkVisibility()===true");
      assert.equal(await browser.evaluate("document.querySelector('.detail-cancel-dialog fieldset[aria-label=关闭原因] input:checked').value"),'NOT_IT_SCOPE');
      await clickWorkbenchControl(browser,'.detail-cancel-dialog input[value=OTHER]');await browser.evaluate("(()=>{const input=document.querySelector('.detail-cancel-dialog textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'切换入口保留说明（合成）');input.dispatchEvent(new Event('input',{bubbles:true}));})()");await clickWorkbenchControl(browser,'[aria-label="关闭取消窗口"]');await browser.waitFor("!document.querySelector('.detail-cancel-dialog')");
      await clickWorkbenchControl(browser,'.workbench-select[data-field-label=复核结论] [data-slot=select-trigger]');await clickWorkbenchControl(browser,'[role=option][data-key=MARK_OUT_OF_SCOPE]');await browser.waitFor("document.querySelector('.detail-cancel-dialog input[value=NOT_IT_SCOPE]')?.checked===true&&document.querySelector('.detail-cancel-dialog textarea')?.value==='切换入口保留说明（合成）'");
      await clickWorkbenchControl(browser,'[data-action=discard-cancel-draft]');await browser.waitFor("document.querySelector('.detail-cancel-dialog textarea')?.value===''&&!document.querySelector('.detail-cancel-dialog fieldset[aria-label=关闭原因] input:checked')");await clickWorkbenchControl(browser,'.detail-cancel-dialog input[value=NOT_IT_SCOPE]');

      const expected=[['HUMAN_CONFIRMED','人工核对确认'],['INFORMATION_INSUFFICIENT','描述不足，需要补充'],['BUSINESS_CONSULTATION_CONFIRMED','已核对为业务咨询'],['ACKNOWLEDGED','确认收到'],['OUT_OF_SCOPE_CONFIRMED','已核对为范围外诉求'],['SERVICE_REQUEST_CONFIRMED','已核对为服务请求'],['INCIDENT_REVIEW_PENDING','待公共故障审核'],['STALE_REVIEW_CANCELLED','明确取消旧复核']];
      const secondary='.detail-cancel-dialog fieldset[aria-label=二级原因]';
      assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll(${JSON.stringify(secondary+' input[type=radio]')})].map(n=>[n.value,n.closest('label').textContent])`),expected);
      assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(secondary+' input:checked')})`),null);
      assert.equal(await browser.evaluate("document.querySelector('.workbench-select[data-field-label=复核原因] select')!==null"),true,'the original reason selector and attributes remain mounted');
      await clickWorkbenchControl(browser,secondary+' input[value=BUSINESS_CONSULTATION_CONFIRMED]');
      await browser.evaluate(`document.querySelector(${JSON.stringify(secondary+' input:checked')}).focus()`);
      await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown'});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown'});
      await browser.waitFor(`document.querySelector(${JSON.stringify(secondary+' input:checked')}).value==='ACKNOWLEDGED'`);
      assert.equal(await browser.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(secondary+' input[value=ACKNOWLEDGED]')})`),true,'native radio keyboard navigation retains focus on its selected reason');
      await clickWorkbenchControl(browser,secondary+' input[value=HUMAN_CONFIRMED]');
      await browser.waitFor("document.querySelector('.detail-cancel-dialog button[type=submit]')?.disabled===false");
      assert.deepEqual(await browser.evaluate('globalThis.__card27ReviewCommands'),[],'changing the reason never submits');
      await clickWorkbenchControl(browser,'.detail-cancel-dialog button[type=submit]');await browser.waitFor('globalThis.__card27ReviewResponses.length===1&&globalThis.__card27ReviewResponses[0]===200');
      const sent=await browser.evaluate('globalThis.__card27ReviewCommands') as {body:{client_command_id:string;expected_version:number;expected_review_version:string;expected_material_basis:string;reason_code:string;secondary_reason_code:string;notify_reporter:boolean};ifMatch:string;idempotency:string}[];assert.equal(sent.length,1);const command=sent[0];assert.ok(command);
      assert.match(command.body.client_command_id,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
      assert.deepEqual(command.body,{client_command_id:command.body.client_command_id,expected_version:closureBefore.version,expected_review_version:original.row_version,expected_material_basis:original.material_basis.current_hash,reason_code:'NOT_IT_SCOPE',secondary_reason_code:'HUMAN_CONFIRMED',notify_reporter:true});
      assert.equal(command.ifMatch,'"'+closureBefore.version+'"');assert.equal(command.idempotency,command.body.client_command_id);
      const currentResponse=await get('/api/manual-reviews/'+selected.id);assert.equal(currentResponse.status,200);const current=await currentResponse.json() as {status:string;safe_result:unknown;allowed_resolutions:unknown[]};assert.equal(current.status,'RESOLVED');assert.deepEqual(current.safe_result,original.safe_result);assert.deepEqual(current.allowed_resolutions,[]);
      const intake=(await pool.query<{status:string;pilot_ticket_id:string|null}>('SELECT status,pilot_ticket_id::text FROM intake.service_intake WHERE id=$1::uuid',[selected.intake_id])).rows[0];assert.deepEqual(intake,{status:'IGNORED',pilot_ticket_id:null});
      assert.equal((await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM pilot_ticket.ticket')).rows[0]?.count,ticketCount);assert.equal((await pool.query<{count:number}>("SELECT count(*)::integer AS count FROM intake.service_intake_event WHERE intake_id=$1::uuid AND event_type='intake.rule_decision_applied'",[selected.intake_id])).rows[0]?.count,beforeEvents+1);
      await clickWorkbenchControl(browser,'[aria-label="关闭详情"]');await browser.waitFor("!document.querySelector('#detail-title')&&Boolean(document.querySelector('.board'))");
      await browser.evaluate("(()=>{const trigger=document.querySelector('[data-board-group=已关闭] button[aria-expanded]');if(trigger?.getAttribute('aria-expanded')==='false')trigger.click();})()");
      const closedCard='[data-kind=intake][data-item-id="'+selected.intake_id+'"]';await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(closedCard+' [data-action=restore-closed]')}))`);await clickWorkbenchControl(browser,closedCard+' [data-action=restore-closed]');
      await browser.waitFor("document.querySelector('[data-restore-confirmation]')?.textContent.includes('待判断')");await clickWorkbenchControl(browser,'[data-action=confirm-restore-closed]');
      const restoredCard='[data-kind=review][data-item-id="'+selected.id+'"]';await browser.waitFor(`document.querySelector(${JSON.stringify(restoredCard)})?.getAttribute('data-closure-highlight')==='true'`);
      const restoredReview=await (await get('/api/manual-reviews/'+selected.id)).json() as {status:string};assert.equal(restoredReview.status,'PENDING');assert.equal((await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM pilot_ticket.ticket')).rows[0]?.count,ticketCount);

    }catch(failure){error=failure;try{console.log('CARD27B_REVIEW_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText,commands:globalThis.__card27ReviewCommands})'):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchManualReviewEnabled:true,workbenchDraftRecoveryEnabled:true});
});

test('T14 formal same Item Review restores explicit choices and records consultation without another fault',async()=>{
  await withWeb01Fixture(async({origin,cookies,browserCookies,tickets,pool}:Fixture)=>{
    const first=tickets[0],cookie=browserCookies[0];assert.ok(first);assert.ok(cookie);
    const get=(path:string)=>fetch(origin+path,{headers:{cookie:cookies[0]}});
    const detail=await (await get('/api/workbench/items/ticket/'+first.ticket.id)).json() as {review_refs:{id:string}[]};
    const selected=detail.review_refs[0];assert.ok(selected);
    const original=await (await get('/api/manual-reviews/'+selected.id)).json() as {row_version:string;material_basis:{current_hash:string};safe_result:unknown};
    let browser:Browser|undefined,error:unknown;
    try{
      const launched=await launchSystemBrowser({url:origin+'/workbench/app/',width:900,height:900,cookies:[{...cookie,url:origin+'/'}]});
      assert.ok(launched);browser=launched;
      await browser.waitFor(`Boolean(document.querySelector('[data-item-id="${first.ticket.id}"] a'))`);
      await browser.evaluate(`document.querySelector('[data-item-id="${first.ticket.id}"] a').click()`);
      await browser.waitFor("Boolean(document.querySelector('.detail-dialog .detail-heading h2'))");
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-review-workspace]'))"),true,'the actual production Item must expose its Review workspace');
      assert.equal(await browser.evaluate("Math.round(document.querySelector('.detail-dialog').getBoundingClientRect().width)"),720);
      await browser.waitFor("document.querySelector('[data-review-materials]')?.textContent.includes('门诊二楼打印机')");
      await openWorkbenchStep(browser,'[data-review-id]');
      await browser.waitFor("document.querySelector('[data-review-workspace]')?.checkVisibility()===true");
      const reviewText=String(await browser.evaluate("document.querySelector('[data-review-workspace]').innerText"));
      for(const label of ['本次报修内容','复核结论'])assert.ok(reviewText.includes(label));
      assert.doesNotMatch(reviewText,/原 Decision|规则版本|[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/iu,'operator copy must show business material without database identifiers');
      await browser.evaluate("document.querySelector('[aria-label=\"展开完整页面\"]').click()");
      await browser.waitFor("Boolean(document.querySelector('.detail-page [data-review-materials]'))");
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth'),true);
      await browser.evaluate("(()=>{const set=(label,value)=>{const input=document.querySelector('.workbench-select[data-field-label=\"'+label+'\"] select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('change',{bubbles:true}));};set('复核结论','CLASSIFY_BUSINESS_CONSULTATION');set('复核原因','BUSINESS_CONSULTATION_CONFIRMED');})()");
      await browser.waitFor("document.querySelector('[data-review-draft-status]')?.textContent.includes('已保存恢复副本')");
      const storage=await browser.evaluate("new Promise((resolve,reject)=>{const open=indexedDB.open('wecom-workbench-drafts-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,read=db.transaction('drafts').objectStore('drafts').getAll();read.onsuccess=()=>{const row=read.result[0];db.close();resolve({kind:row.kind,id:row.id,purpose:row.purpose,ttl:row.expiresAt-row.firstSavedAt,extractable:row.key.extractable,plain:JSON.stringify(row).includes('BUSINESS_CONSULTATION_CONFIRMED')});};};})");
      assert.deepEqual(storage,{kind:'review',id:selected.id,purpose:'manual-review',ttl:86400000,extractable:false,plain:false});
      await reload(browser);
      await browser.waitFor("document.querySelector('.workbench-select[data-field-label=\"复核结论\"] select')?.value==='CLASSIFY_BUSINESS_CONSULTATION'&&document.querySelector('.workbench-select[data-field-label=\"复核原因\"] select')?.value==='BUSINESS_CONSULTATION_CONFIRMED'");
      assert.equal(await browser.evaluate("document.querySelector('[data-captured-review-version]').textContent"),original.row_version);
      assert.equal(await browser.evaluate("document.querySelector('[data-captured-material-basis]').getAttribute('data-captured-material-basis')"),original.material_basis.current_hash);
      await browser.evaluate("(()=>{globalThis.__t14Commands=[];const original=globalThis.fetch;globalThis.fetch=(path,options)=>{if(String(path).endsWith('/resolve'))globalThis.__t14Commands.push({body:JSON.parse(options.body),ifMatch:options.headers['if-match'],idempotency:options.headers['idempotency-key']});return original(path,options);};document.querySelector('[data-action=submit-review]').click();})()");
      await browser.waitFor("document.querySelector('[data-review-result]')?.textContent.includes('已记录人工结论')");
      const sent=await browser.evaluate('globalThis.__t14Commands') as {body:{expected_row_version:string;expected_material_basis:string;resolution_code:string;resolution_reason_code:string;client_command_id:string};ifMatch:string;idempotency:string}[];
      assert.equal(sent.length,1);const command=sent[0];assert.ok(command);assert.equal(command.body.expected_row_version,original.row_version);
      assert.equal(command.body.expected_material_basis,original.material_basis.current_hash);assert.equal(command.body.resolution_code,'CLASSIFY_BUSINESS_CONSULTATION');
      assert.equal(command.body.resolution_reason_code,'BUSINESS_CONSULTATION_CONFIRMED');assert.equal(command.ifMatch,'"'+original.row_version+'"');assert.equal(command.idempotency,command.body.client_command_id);
      const current=await (await get('/api/manual-reviews/'+selected.id)).json() as {status:string;safe_result:unknown};
      assert.equal(current.status,'RESOLVED');assert.deepEqual(current.safe_result,original.safe_result);
      assert.equal((await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM pilot_ticket.ticket')).rows[0]?.count,13);
      const board=await (await get('/api/workbench/board?column=pending')).json() as {items:{id:string}[]};assert.equal(board.items.filter(item=>item.id===first.ticket.id).length,1);
    }catch(failure){error=failure;try{console.log('T14_FORM_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText})'):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchManualReviewEnabled:true,workbenchDraftRecoveryEnabled:true});
});

test('T14 expired UNKNOWN keeps only its original opaque operation and checks a receipt without a POST',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets}:Fixture)=>{
    const first=tickets[0],cookie=browserCookies[0];assert.ok(first);assert.ok(cookie);let browser:Browser|undefined,error:unknown;
    try{
      const launched=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+first.ticket.id+'?detail=page',width:900,height:900,cookies:[{...cookie,url:origin+'/'}]});assert.ok(launched);browser=launched;
      await browser.waitFor("document.querySelector('[data-review-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");await choose(browser,'CLASSIFY_BUSINESS_CONSULTATION','BUSINESS_CONSULTATION_CONFIRMED');
      await browser.waitFor("document.querySelector('[data-review-draft-status]')?.textContent.includes('已保存恢复副本')");await browser.evaluate(traceCommands);await browser.evaluate("document.querySelector('[data-action=submit-review]').click()");
      await browser.waitFor("document.querySelector('[data-review-result]')?.textContent.includes('结果未知')");
      const original=await browser.evaluate('globalThis.__t14Commands[0]') as {client_command_id:string};assert.ok(original.client_command_id);
      await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:traceCommands+";(()=>{const now=Date.now;Date.now=()=>now()+86400001;})()"});await reload(browser);
      await browser.waitFor("document.querySelector('[data-review-draft-status]')?.textContent.includes('草稿已过期')&&Boolean(document.querySelector('[data-action=check-review-receipt]'))");
      assert.equal(await browser.evaluate("document.querySelector('.workbench-select[data-field-label=\"复核结论\"] select').value"),'');assert.equal(await browser.evaluate("document.querySelector('.workbench-select[data-field-label=\"复核原因\"] select').value"),'');
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-action=reconcile-review]'))"),false);assert.equal(await browser.evaluate('globalThis.__t14Commands.length'),0);
      const copies=await browser.evaluate(draftCounts) as {drafts:unknown[];operations:{commandId:string}[]};assert.equal(copies.drafts.length,0);assert.equal(copies.operations.length,1);assert.equal(copies.operations[0]?.commandId,original.client_command_id);
      await browser.evaluate("document.querySelector('[data-action=check-review-receipt]').click()");await browser.waitFor("document.querySelector('[data-review-result]')?.textContent.includes('已核对原操作结果')");
      assert.equal(await browser.evaluate('globalThis.__t14Commands.length'),0);assert.deepEqual(await browser.evaluate(draftCounts),{drafts:[],operations:[]});
    }catch(failure){error=failure;try{console.log('T14_OPAQUE_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText,commands:globalThis.__t14Commands})'):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchManualReviewEnabled:true,workbenchDraftRecoveryEnabled:true,malformedReviewSuccess:true});
});

test('T14 trusted independent Review denial with unreadable body clears its view and copy but preserves another authorized purpose',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets,pool,principals,cookies}:Fixture)=>{
    const first=tickets[0],other=tickets[8],foreign=tickets[5],principal=principals[0],cookie=browserCookies[0];assert.ok(first);assert.ok(other);assert.ok(foreign);assert.ok(principal);assert.ok(cookie);
    const get=(path:string)=>fetch(origin+path,{headers:{cookie:cookies[0]}}),detail=await(await get('/api/workbench/items/ticket/'+first.ticket.id)).json() as {review_refs:{id:string}[]};const selected=detail.review_refs[0];assert.ok(selected);
    let browser:Browser|undefined,error:unknown;
    try{
      const launched=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+other.ticket.id+'?detail=page',width:900,height:900,cookies:[{...cookie,url:origin+'/'}]});assert.ok(launched);browser=launched;
      await browser.waitFor("Boolean(document.querySelector('[aria-label=\"内部备注\"]'))");
      await browser.evaluate("(()=>{const input=document.querySelector('[aria-label=\"内部备注\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'T14 other authorized purpose private text');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('已保存恢复副本')");
      await browser.command('Page.navigate',{url:origin+'/workbench/app/items/ticket/'+first.ticket.id+'?detail=page'});await browser.waitFor("document.querySelector('[data-review-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");
      await choose(browser,'CLASSIFY_BUSINESS_CONSULTATION','BUSINESS_CONSULTATION_CONFIRMED');await browser.waitFor("document.querySelector('[data-review-draft-status]')?.textContent.includes('已保存恢复副本')");
      await pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[principal.id]);await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER')",[principal.id]);
      await pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES('OTHER_TEAM','合成另组')");await pool.query("UPDATE pilot_ticket.ticket SET resolver_team_id='OTHER_TEAM',assignee_id=NULL WHERE id=$1::uuid",[foreign.ticket.id]);
      await pool.query('UPDATE intake.contact_journey SET linked_ticket_id=$2::uuid WHERE id=(SELECT journey_id FROM intake.manual_review_item WHERE id=$1::uuid)',[selected.id,foreign.ticket.id]);
      assert.equal((await get('/api/workbench/items/ticket/'+first.ticket.id)).status,200);assert.equal((await get('/api/manual-reviews/'+selected.id)).status,404);
      await browser.evaluate("document.querySelector('[data-action=refresh-review]').click()");await browser.waitFor("!document.querySelector('[data-review-materials]')");
      await browser.waitFor(`(async()=>!(await (${draftCounts})).drafts.some(row=>row.id===${JSON.stringify(selected.id)}))()`);
      assert.deepEqual(await browser.evaluate(draftCounts),{drafts:[{id:other.ticket.id,purpose:'internal-note'}],operations:[]});
      await browser.command('Page.navigate',{url:origin+'/workbench/app/items/ticket/'+other.ticket.id+'?detail=page'});await browser.waitFor("document.querySelector('[aria-label=\"内部备注\"]')?.value==='T14 other authorized purpose private text'");
    }catch(failure){error=failure;try{console.log('T14_DENIAL_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText})'):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchManualReviewEnabled:true,workbenchDraftRecoveryEnabled:true,workbenchInternalNotesEnabled:true,malformedReviewDenial:true});
});

test('T14 real source revision preserves edited input and explicitly selects a new Review without executing material markup',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,pool,processReviewIntake,cookies}:Fixture)=>{
    const cookie=browserCookies[0];assert.ok(cookie);const get=(path:string)=>fetch(origin+path,{headers:{cookie:cookies[0]}});
    const board=await(await get('/api/workbench/board?column=pending')).json() as {items:{id:string;kind:string;intake_id:string}[]};const selected=board.items.find(item=>item.kind==='review');assert.ok(selected);
    let browser:Browser|undefined,error:unknown;
    try{
      const launched=await launchSystemBrowser({url:origin+'/workbench/app/items/review/'+selected.id+'?detail=page',width:900,height:900,cookies:[{...cookie,url:origin+'/'}]});assert.ok(launched);browser=launched;
      await browser.waitFor("document.querySelector('[data-review-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");await choose(browser,'CLASSIFY_BUSINESS_CONSULTATION','BUSINESS_CONSULTATION_CONFIRMED');await browser.waitFor("document.querySelector('[data-review-draft-status]')?.textContent.includes('已保存恢复副本')");
      const originalBasis=await browser.evaluate("document.querySelector('[data-captured-material-basis]').getAttribute('data-captured-material-basis')");
      await appendReviewMaterial(pool,selected.intake_id,'后来咨询补充 <img src=x onerror="globalThis.__t14MarkupExecuted=true">');await processReviewIntake(selected.intake_id);
      await browser.evaluate("document.querySelector('[data-action=refresh-review]').click()");await browser.waitFor("document.querySelector('[data-review-materials]')?.textContent.includes('后来咨询补充')");
      assert.equal(await browser.evaluate("document.querySelector('.workbench-select[data-field-label=\"复核结论\"] select').value"),'CLASSIFY_BUSINESS_CONSULTATION');assert.equal(await browser.evaluate("document.querySelector('[data-captured-material-basis]').getAttribute('data-captured-material-basis')"),originalBasis);
      assert.equal(await browser.evaluate("document.querySelector('[data-action=submit-review]').disabled"),true);assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-review-materials] img'))||globalThis.__t14MarkupExecuted===true"),false);
      await reload(browser);await browser.waitFor("document.querySelector('.workbench-select[data-field-label=\"复核结论\"] select')?.value==='CLASSIFY_BUSINESS_CONSULTATION'");
      assert.equal(await browser.evaluate("document.querySelector('.workbench-select[data-field-label=\"选择复核项\"] select').value"),selected.id);
      const refs=await(await get('/api/workbench/items/review/'+selected.id)).json() as {review_refs:{id:string}[]};const next=refs.review_refs.find(ref=>ref.id!==selected.id);assert.ok(next);
      await browser.evaluate(`(()=>{const input=document.querySelector('.workbench-select[data-field-label="选择复核项"] select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,${JSON.stringify(next.id)});input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await browser.waitFor(`Boolean(document.querySelector('[data-review-id="${next.id}"] [data-review-draft-status]'))`);await choose(browser,'CLASSIFY_BUSINESS_CONSULTATION','BUSINESS_CONSULTATION_CONFIRMED');await browser.waitFor("document.querySelector('[data-review-draft-status]')?.textContent.includes('已保存恢复副本')");
      assert.equal(await browser.evaluate("document.querySelector('[data-action=submit-review]').disabled"),false);await browser.evaluate("document.querySelector('[data-action=submit-review]').click()");await browser.waitFor("document.querySelector('[data-review-result]')?.textContent.includes('已记录人工结论')");
      assert.equal((await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM pilot_ticket.ticket')).rows[0]?.count,13);
    }catch(failure){error=failure;try{console.log('T14_STALE_SELECTOR_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText})'):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchManualReviewEnabled:true,workbenchDraftRecoveryEnabled:true});
});


test('T14 linked Review UNKNOWN survives refresh without replacing its captured command',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets,restoreReviewResponses}:Fixture&{restoreReviewResponses:()=>void})=>{
    const first=tickets[0],cookie=browserCookies[0];assert.ok(first);assert.ok(cookie);
    let browser:Browser|undefined,error:unknown;
    try{
      const launched=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+first.ticket.id+'?detail=page',width:900,height:900,cookies:[{...cookie,url:origin+'/'}]});assert.ok(launched);browser=launched;
      await browser.waitFor("document.querySelector('[data-review-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");
      await browser.evaluate("(()=>{globalThis.__t14Commands=[];const original=globalThis.fetch;globalThis.fetch=(path,options)=>{if(String(path).endsWith('/resolve'))globalThis.__t14Commands.push(JSON.parse(options.body));return original(path,options);};const set=(label,value)=>{const input=document.querySelector('.workbench-select[data-field-label=\"'+label+'\"] select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('change',{bubbles:true}));};set('复核结论','CLASSIFY_BUSINESS_CONSULTATION');set('复核原因','BUSINESS_CONSULTATION_CONFIRMED');})()");
      await browser.waitFor("document.querySelector('[data-review-draft-status]')?.textContent.includes('已保存恢复副本')");
      await browser.evaluate("document.querySelector('[data-action=submit-review]').click()");
      await browser.waitFor("document.querySelector('[data-review-result]')?.textContent.includes('结果未知')");
      const original=await browser.evaluate('globalThis.__t14Commands[0]');assert.ok(original);
      await browser.command('Page.enable');
      await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{globalThis.__t14Commands=[];const original=globalThis.fetch;globalThis.fetch=(path,options)=>{if(String(path).endsWith('/resolve'))globalThis.__t14Commands.push(JSON.parse(options.body));return original(path,options);};})()"});
      await reload(browser);
      await browser.waitFor("Boolean(document.querySelector('.detail-page .detail-heading h2'))");
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-review-workspace]'))"),true,'the committed associated Review must still locate its original UNKNOWN recovery scope');
      await browser.waitFor("document.querySelector('[data-review-result]')?.textContent.includes('结果未知')&&Boolean(document.querySelector('[data-action=reconcile-review]'))");
      assert.equal(await browser.evaluate("document.querySelector('.workbench-select[data-field-label=\"复核结论\"] select').value"),'CLASSIFY_BUSINESS_CONSULTATION');
      assert.equal(await browser.evaluate("document.querySelector('.workbench-select[data-field-label=\"复核原因\"] select').value"),'BUSINESS_CONSULTATION_CONFIRMED');
      assert.equal(await browser.evaluate('globalThis.__t14Commands.length'),0);
      restoreReviewResponses();
      await browser.evaluate("document.querySelector('[data-action=reconcile-review]').click()");
      await browser.waitFor("document.querySelector('[data-review-result]')?.textContent.includes('已记录人工结论')");
      assert.deepEqual(await browser.evaluate('globalThis.__t14Commands'),[original]);
      assert.equal(await browser.evaluate("document.querySelector('.workbench-select[data-field-label=\"复核结论\"] select').value"),'');
    }catch(failure){error=failure;try{console.log('T14_UNKNOWN_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText,commands:globalThis.__t14Commands})'):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchManualReviewEnabled:true,workbenchDraftRecoveryEnabled:true,malformedReviewSuccess:true});
});
