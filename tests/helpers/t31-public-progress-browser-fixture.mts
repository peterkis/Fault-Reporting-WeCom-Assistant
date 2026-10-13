import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {t31Http,text} from './t31-public-progress-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './p2-006-browser-harness.mjs';
import type {Browser} from './wbint-t27-browser-fixture.mjs';
type Http=Parameters<Parameters<typeof t31Http>[1]>[0];
export const inspectT31Drafts="(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('wecom-workbench-drafts-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise((resolve,reject)=>{const t=db.transaction(['drafts','operations'],'readonly'),r=t.objectStore('drafts').getAll(),o=t.objectStore('operations').getAll();t.oncomplete=()=>resolve({drafts:r.result.map(row=>({kind:row.kind,id:row.id,purpose:row.purpose,firstSavedAt:row.firstSavedAt,expiresAt:row.expiresAt,extractable:row.key.extractable,algorithm:row.key.algorithm.name,keys:Object.keys(row)})),operations:o.result});t.onabort=()=>reject(t.error);});}finally{db.close();}})()";
export async function t31Browser(purpose:string,run:(context:Http&{browser:Browser;incidentId:string;put:(text:string)=>Promise<void>;capture:(label:string)=>Promise<void>})=>Promise<void>,options:{recovery?:boolean}={}){
  const recovery=options.recovery??true;
  await t31Http({purpose,recovery},async context=>{
    const incidentId=await context.confirm(),cookie=context.cookies[0];assert.ok(cookie);let browser:Browser|undefined,error:unknown;const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];
    const capture=async(label:string)=>{assert.ok(browser);await browser.evaluate('document.querySelector("[aria-label=公开进展摘要]")?.scrollIntoView({block:"start"})');const png=await browser.screenshot();if(typeof png!=='string')throw Error('T31_PNG_REQUIRED');const snapshotDirectory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(snapshotDirectory);const bytes=Buffer.from(png,'base64'),file=join(snapshotDirectory,'new-detail-'+bytes.readUInt32BE(16)+'.png');await writeFile(file,bytes);const saved={file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')};screenshots.push(saved);console.log('T31_BROWSER_PNG '+JSON.stringify(saved));};
    try{
      browser=await launchSystemBrowser({url:context.origin+'/workbench/app/incidents/'+incidentId,width:900,height:1080,cookies:[{name:text(cookie.name),value:text(cookie.value),url:text(cookie.url)}]});assert.ok(browser);await browser.command('Page.enable');await browser.waitFor(`Boolean(document.querySelector('[data-incident-id="${incidentId}"]'))`);await browser.waitFor('Boolean(document.querySelector("textarea[aria-label=公开进展摘要]"))');
      if(recovery)await browser.waitFor('document.querySelector("[data-public-progress-draft]")?.textContent.includes("最长24小时")');
      const active=browser,put=async(text:string)=>{await active.evaluate(`(()=>{const field=document.querySelector('textarea[aria-label="公开进展摘要"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,${JSON.stringify(text)});field.dispatchEvent(new Event('input',{bubbles:true}));})()`);};
      await run({...context,browser,incidentId,put,capture});assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);await capture('final');
    }catch(failure){error=failure;if(browser)try{await capture('failure');await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({url:location.href,text:document.body.innerText})')));}catch(savedError){error=new AggregateError([failure,savedError]);}}
    try{await closeBrowserTestResources([async()=>{try{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}catch(cleanup){console.log('T31_BROWSER_CLOSURE_FAILURE '+JSON.stringify({owned:browser?.ownedResourceState(),errors:(cleanup instanceof AggregateError?cleanup.errors:[cleanup]).map(value=>value instanceof Error?{name:value.name,message:value.message}:{name:'NON_ERROR',message:String(value)})}));throw cleanup;}}],error);}finally{console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',purpose,screenshots}));}
  });
}
