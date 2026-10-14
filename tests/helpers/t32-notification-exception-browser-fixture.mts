import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {withT32Fixture,seedT32SessionExceptions,t32Text} from './t32-notification-exception-fixture.mjs';
import type {T32Fixture} from './t32-notification-exception-fixture.mjs';
import type {Browser} from './wbint-t27-browser-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './p2-006-browser-harness.mjs';
interface Context extends T32Fixture {browser:Browser;seed:Awaited<ReturnType<typeof seedT32SessionExceptions>>;capture:(label:string)=>Promise<void>}
export async function t32Browser(purpose:string,run:(f:Context)=>Promise<void>,count=11){
  await withT32Fixture(async f=>{
    const seed=await seedT32SessionExceptions(f,count),cookie=f.browserCookies[0];assert.ok(cookie);let browser:Browser|undefined,primaryError:unknown;
    const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];
    const capture=async(_label:string)=>{assert.ok(browser);await browser.evaluate('document.querySelector("[data-notification-exceptions]")?.scrollIntoView({block:"start"})');const png=await browser.screenshot();assert.equal(typeof png,'string');const bytes=Buffer.from(t32Text(png),'base64'),directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);const file=join(directory,'new-detail-'+bytes.readUInt32BE(16)+'.png');await writeFile(file,bytes);screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
    try{
      browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:900,height:1080,cookies:[{name:cookie.name,value:cookie.value,url:cookie.url??f.origin+'/'}]});assert.ok(browser);
      await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const original=fetch;globalThis.__t32Reads=[];globalThis.__t32Posts=0;globalThis.fetch=async(path,options)=>{if(options?.method==='POST')globalThis.__t32Posts++;const response=await original(path,options);if(String(path).startsWith('/api/notification-exceptions')){let data=null;try{data=await response.clone().json();}catch{}globalThis.__t32Reads.push({path:String(path),status:response.status,items:data?.items?.map(row=>({id:row.delivery_id,status:row.status})),id:data?.delivery_id});}return response;};})()`});
      await browser.command('Page.navigate',{url:f.origin+'/workbench/app/notification-exceptions'});
      await browser.waitFor('document.body.innerText.includes("页面不存在")||Boolean(document.querySelector("[data-notification-exceptions]"))');
      await run({...f,browser,seed,capture});await capture('final');
    }catch(error){primaryError=error;if(browser)try{await capture('failure');}catch(captureError){primaryError=new AggregateError([error,captureError],'T32_FAILURE_CAPTURE_FAILED');}}
    try{await closeBrowserTestResources([async()=>{try{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}catch(error){console.log('T32_BROWSER_CLOSURE_FAILURE '+JSON.stringify({owned:browser?.ownedResourceState(),errors:(error instanceof AggregateError?error.errors:[error]).map(e=>e instanceof Error?{name:e.name,message:e.message}:{name:'NON_ERROR',message:String(e)})}));throw error;}}],primaryError);}
    finally{console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',purpose,screenshots}));}
  });
}
