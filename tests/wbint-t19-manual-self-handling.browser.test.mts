import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface Fixture {origin:string;backendOrigin:string;certificateSpki:string;browserCookies:{name:string;value:string;url:string}[];cookies:string[];principals:{id:string}[]}
function object(v:unknown):Record<string,unknown>{assert.ok(v&&typeof v==='object'&&!Array.isArray(v));return v as Record<string,unknown>;}
function text(v:unknown):string{assert.equal(typeof v,'string');return v as string;}
const trace="(()=>{globalThis.__t19Posts=[];const original=fetch;globalThis.fetch=(path,init)=>{if(init?.method==='POST')globalThis.__t19Posts.push({path:String(path),body:JSON.parse(init.body)});return original(path,init);};})()";
async function fill(browser:Browser,label:string,value:string){await browser.waitFor(`Boolean(document.querySelector('[aria-label="${label}"]'))&&!document.querySelector('[aria-label="${label}"]').matches(':disabled')`);await browser.evaluate(`(()=>{const e=document.querySelector('[aria-label="${label}"]'),p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement:HTMLInputElement;Object.getOwnPropertyDescriptor(p.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);assert.equal(await browser.evaluate(`document.querySelector('[aria-label="${label}"]').value`),value);}

test('T19 production form explicitly chooses self handling, restores the encrypted original intent and starts one native Ticket in one POST',async()=>{
  await withWeb01Fixture(async({origin,backendOrigin,certificateSpki,browserCookies,cookies,principals}:Fixture)=>{
    let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/reports/new',width:900,height:900,cookies:browserCookies,certificateSpki});
      assert.ok(browser);
      await browser.waitFor("Boolean(document.querySelector('[data-manual-report-form]'))");
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-action=choose-manual-self-handling]'))"),true,'the production manual report form must offer the explicit self handling choice');
      await browser.evaluate("document.querySelector('[data-action=choose-manual-self-handling]').click()");
      await browser.waitFor("Boolean(document.querySelector('[aria-label=\"本人处理组\"]'))");
      assert.equal(await browser.evaluate("document.querySelector('[aria-label=\"本人处理组\"]').value"),'','one actual group still requires an explicit choice');
      await browser.evaluate("(()=>{const e=document.querySelector('[aria-label=\"本人处理组\"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'PILOT_IT');e.dispatchEvent(new Event('change',{bubbles:true}));})()");
      await fill(browser,'报修人姓名','T19 合成电话报修人');await fill(browser,'联系方式','合成人工联系内线9919');await fill(browser,'故障描述','T19 browser original intent：打印机无法打印');
      await browser.evaluate("document.querySelector('[aria-label=\"位置暂不清楚\"]').click()");
      await browser.waitFor("document.querySelector('[data-manual-report-draft-status]')?.textContent.includes('已保存恢复副本')");
      await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:trace});
      const before=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');
      await browser.waitFor(`performance.timeOrigin!==${before}&&document.querySelector('[aria-label="故障描述"]')?.value==='T19 browser original intent：打印机无法打印'`);
      assert.equal(await browser.evaluate("document.querySelector('[aria-label=\"本人处理组\"]').value"),'PILOT_IT');
      assert.equal(await browser.evaluate('globalThis.__t19Posts.length'),0);
      const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];
      for(const width of [900,1920]){
        await browser.command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
        assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth'),true);
        const image=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-detail-'+width+'.png');await writeFile(file,image);screenshots.push({file,width:image.readUInt32BE(16),height:image.readUInt32BE(20),sha256:createHash('sha256').update(image).digest('hex')});
      }
      await browser.evaluate("document.querySelector('[data-action=submit-manual-self-handling]').click()");
      await browser.waitFor("document.querySelector('[data-manual-report-result]')?.textContent.includes('已由本人开始处理')");
      const posts=await browser.evaluate('globalThis.__t19Posts');assert.ok(Array.isArray(posts));assert.equal(posts.length,1);const post=object(posts[0]),command=object(post.body);assert.equal(post.path,'/api/workbench/reports/take-and-start');assert.equal(command.resolver_team_id,'PILOT_IT');assert.equal(object(command.reporter).verification,'UNVERIFIED');
      const cookie=cookies[0];assert.ok(cookie);const receiptResponse=await fetch(backendOrigin+'/api/workbench/reports/commands/'+text(command.client_command_id),{headers:{cookie}});assert.equal(receiptResponse.status,200);
      const result=object(object(await receiptResponse.json()).result),ticket=object(result.ticket);assert.equal(ticket.status,'IN_PROGRESS');assert.equal(result.review,null);
      const detail=await fetch(backendOrigin+'/api/tickets/'+text(ticket.id),{headers:{cookie}});assert.equal(detail.status,200);const actual=object(await detail.json());assert.equal(actual.assignee_id,principals[0]?.id);assert.equal(actual.version,3);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',manual_report_self_handling:true,screenshots}));
    }catch(failure){error=failure;try{console.log('T19_FORM_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText,posts:globalThis.__t19Posts,fields:[...document.querySelectorAll("input,textarea,select")].map(e=>({label:e.getAttribute("aria-label"),value:e.value,disabled:e.matches(":disabled")}))})'):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchManualReportsEnabled:true,ticketSelfHandlingEnabled:true,workbenchDraftRecoveryEnabled:true,realWorkbenchAuthentication:true});
});
