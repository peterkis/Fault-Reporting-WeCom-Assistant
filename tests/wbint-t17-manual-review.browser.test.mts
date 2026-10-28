import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface Fixture {origin:string;backendOrigin:string;pool:PostgresPool;principals:{id:string;display_name:string}[];certificateSpki:string;browserCookies:{name:string;value:string;url:string}[];cookies:string[]}
function object(value:unknown):Record<string,unknown>{assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function string(value:unknown):string{assert.equal(typeof value,'string');assert.ok(value);return value as string;}
async function counts(pool:PostgresPool){return (await pool.query(`SELECT
  (SELECT count(*)::integer FROM pilot_ticket.ticket) AS tickets,(SELECT count(*)::integer FROM channel.message_inbox) AS messages,
  (SELECT count(*)::integer FROM conversation.session) AS conversations,(SELECT count(*)::integer FROM communication.message) AS communications,
  (SELECT count(*)::integer FROM communication.outbox) AS outbox,(SELECT count(*)::integer FROM communication.delivery) AS deliveries,
  (SELECT count(*)::integer FROM notification.outbox) AS notifications,(SELECT count(*)::integer FROM notification.delivery) AS notification_deliveries`)).rows[0];}
test('the actual production Review workspace reads an on-site unverified reporter separately from its authenticated operator and lawfully acknowledges without messaging or forced Ticket',async()=>{
  await withWeb01Fixture(async({origin,backendOrigin,pool,principals,certificateSpki,browserCookies,cookies}:Fixture)=>{
    const principal=principals[0];assert.ok(principal);let browser:Browser|undefined,error:unknown;const get=(path:string)=>fetch(backendOrigin+path,{headers:{cookie:cookies[0]}});
    const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=string(object(await bootstrap.json()).csrf_token),before=await counts(pool);
    const command={schema_version:1,client_command_id:randomUUID(),source:'ON_SITE',description:'T17 real on-site Review：打印机情况不明',location:{text:null,unknown:true},reporter:{verification:'UNVERIFIED',name:'T17 actual on-site reporter',contact:'现场人工联系1122',department:'合成现场科室'}};
    const admitted=await fetch(backendOrigin+'/api/workbench/reports',{method:'POST',headers:{cookie:cookies[0],origin,'content-type':'application/json','idempotency-key':command.client_command_id,'x-csrf-token':csrf},body:JSON.stringify(command)});
    assert.equal(admitted.status,202);const admission=object(await admitted.json());assert.equal(admission.ticket,null);assert.equal(admission.result_code,'NEEDS_DESCRIPTION');const reviewId=string(object(admission.review).id),intakeId=string(admission.intake_id);
    const original=await get('/api/manual-reviews/'+reviewId);assert.equal(original.status,200);const detail=object(await original.json());assert.equal(object(detail.material_basis).source_kind,'MANUAL');
    assert.equal(object(detail.manual_report).actor_principal_id,principal.id);assert.deepEqual(object(detail.manual_report).reporter,command.reporter);
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/review/'+reviewId+'?detail=page',width:900,height:900,cookies:browserCookies,certificateSpki});assert.ok(browser);
      await browser.waitFor("Boolean(document.querySelector('[data-review-original]'))&&Boolean(document.querySelector('[data-review-materials]'))");
      const material=string(await browser.evaluate("document.querySelector('[data-review-materials]').textContent"));assert.ok(material.includes('原始报修'));assert.equal(material.includes('manual:'+intakeId),false);assert.ok(material.includes(command.description));
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-review-manual-report]'))"),true);
      const source=string(await browser.evaluate("document.querySelector('[data-review-manual-report]').textContent"));for(const text of ['现场代录','资料由人工填写','按联系方式核实','不会自动通知',command.reporter.name,command.reporter.contact,command.reporter.department,'代录人：'+principal.display_name])assert.ok(source.includes(text),text);
      await browser.waitFor("document.querySelector('[data-review-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");
      const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);const image=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-detail-900.png');await writeFile(file,image);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',manual_report_review:true,screenshots:[{file,width:image.readUInt32BE(16),height:image.readUInt32BE(20),sha256:createHash('sha256').update(image).digest('hex')}]}));
      await browser.evaluate("(()=>{globalThis.__t17ReviewPosts=[];const original=fetch;globalThis.fetch=(path,init)=>{if(init?.method==='POST')globalThis.__t17ReviewPosts.push({path:String(path),body:JSON.parse(init.body)});return original(path,init);};for(const [label,value] of [['复核结论','ACKNOWLEDGE'],['复核原因','ACKNOWLEDGED']]){const input=document.querySelector('.workbench-select[data-field-label=\"'+label+'\"] select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('change',{bubbles:true}));}})()");
      await browser.evaluate("document.querySelector('[data-action=submit-review]').click()");await browser.waitFor("document.querySelector('[data-review-result]')?.textContent.includes('已记录人工结论')");
      const posts=await browser.evaluate('globalThis.__t17ReviewPosts');assert.ok(Array.isArray(posts));assert.equal(posts.length,1);assert.equal(object(posts[0]).path,'/api/manual-reviews/'+reviewId+'/resolve');assert.equal(object(object(posts[0]).body).resolution_code,'ACKNOWLEDGE');
      const current=await get('/api/manual-reviews/'+reviewId);assert.equal(current.status,200);const resolved=object(await current.json());assert.equal(resolved.status,'RESOLVED');assert.deepEqual(resolved.safe_result,detail.safe_result);
      assert.deepEqual(await counts(pool),before);const intake=(await pool.query<{status:string;type:string;ticket:string|null}>('SELECT status,request_type AS type,pilot_ticket_id::text AS ticket FROM intake.service_intake WHERE id=$1::uuid',[intakeId])).rows[0];assert.deepEqual(intake,{status:'COMPLETED',type:'CHATTER',ticket:null});
    }catch(failure){error=failure;try{console.log('T17_MANUAL_REVIEW_BROWSER_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText,requests:globalThis.__t17ReviewPosts})'):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchManualReportsEnabled:true,workbenchManualReviewEnabled:true,workbenchDraftRecoveryEnabled:true,realWorkbenchAuthentication:true});
});
