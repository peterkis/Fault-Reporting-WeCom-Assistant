import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {t33WholeHttp} from './t33-whole-fixture.mjs';
import type {Browser} from './wbint-t27-browser-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './p2-006-browser-harness.mjs';

type Http=Parameters<Parameters<typeof t33WholeHttp>[0]>[0];
interface Context extends Http {browser:Browser;deliveryId:string;siblingId:string;capture:(label:string)=>Promise<void>}
function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
export async function t33IncidentBrowser(run:(context:Context)=>Promise<void>,options:{draftRecovery?:boolean;publicProgress?:boolean}={}):Promise<void>{
 await t33WholeHttp(async context=>{
  const rows=await context.getLifecycleRows();
  const first=rows.find(row=>row.status==='PENDING'&&row.side_effect_state==='NOT_ATTEMPTED');
  assert.ok(first,'real original lifecycle route must exist before browser entry');
  const deliveryId=text(first.delivery_id),sibling=rows.find(row=>row.delivery_id!==deliveryId&&row.status==='PENDING');
  assert.ok(sibling,'a separate original lifecycle route must remain unchanged');
  const siblingId=text(sibling.delivery_id);
  await context.deliver(deliveryId);
  const actual=await context.getLifecycleRows(),unknown=actual.find(row=>row.delivery_id===deliveryId);
  assert.equal(unknown?.status,'RECONCILIATION_REQUIRED');assert.equal(unknown?.side_effect_state,'UNKNOWN');
  assert.equal(context.senderCalls(),1,'one real original Worker invocation reaches the synthetic Sender');
  const cookie=context.cookies[0];assert.ok(cookie);
  let browser:Browser|undefined,primaryError:unknown;
  const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];
  const capture=async(label:string)=>{
   assert.ok(browser);
   await browser.evaluate('document.querySelector("[data-incident-delivery-controls]")?.scrollIntoView({block:"start"})');
   const png=await browser.screenshot();assert.equal(typeof png,'string');
   const bytes=Buffer.from(text(png),'base64'),directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
   const file=join(directory,'new-detail-'+bytes.readUInt32BE(16)+'.png');await writeFile(file,bytes);
   const saved={file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')};
   screenshots.push(saved);console.log('T33_BROWSER_PNG '+JSON.stringify({label,...saved}));
  };
  try{
   browser=await launchSystemBrowser({url:context.origin+'/workbench/app/',width:900,height:1080,cookies:[{name:cookie.name,value:cookie.value,url:context.origin+'/'}]});
   assert.ok(browser);await browser.command('Page.enable');
   await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:'(()=>{const original=fetch;globalThis.__t33ControlPosts=[];globalThis.fetch=async(path,options)=>{const response=await original(path,options);if(options?.method==="POST"&&/^\\/api\\/incidents\\/[^/]+\\/notifications\\/[^/]+\\/(retry|reconcile)$/.test(String(path))){let body=null;try{body=JSON.parse(options.body);}catch{}globalThis.__t33ControlPosts.push({path:String(path),status:response.status,body});}return response;};})()'});
   await browser.command('Page.navigate',{url:context.origin+'/workbench/app/incidents/'+context.incidentId});
   await browser.waitFor('Boolean(document.querySelector('+JSON.stringify('[data-incident-id="'+context.incidentId+'"]')+'))');
   await run({...context,browser,deliveryId,siblingId,capture});
   assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
   await capture('final');
  }catch(error){primaryError=error;if(browser)try{await capture('failure');}catch(captureError){primaryError=new AggregateError([error,captureError],'T33_FAILURE_CAPTURE_FAILED');}}
  try{await closeBrowserTestResources([async()=>{try{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}catch(error){console.log('T33_BROWSER_CLOSURE_FAILURE '+JSON.stringify({owned:browser?.ownedResourceState(),errors:(error instanceof AggregateError?error.errors:[error]).map(value=>value instanceof Error?{name:value.name,message:value.message}:{name:'NON_ERROR',message:String(value)})}));throw error;}}],primaryError);}
  finally{console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',purpose:'t33-incident-delivery-first',screenshots}));}
 },options);
}
