import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {T11Fixture} from './t11-completion-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './p2-006-browser-harness.mjs';
export type T10Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
export async function withT10Browser(context:T11Fixture,ticketId:string,index:number,purpose:string,run:(browser:T10Browser,capture:(name:string)=>Promise<void>)=>Promise<void>){
  const cookie=context.browserCookies[index];assert.ok(cookie);const url=cookie.url;assert.ok(url);
  const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
  const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];let browser:T10Browser|undefined,error:unknown;
  try{
    browser=await launchSystemBrowser({url:context.origin+'/workbench/app/items/ticket/'+ticketId,width:1920,height:1080,cookies:[{...cookie,url}]});assert.ok(browser);
    await browser.command('Page.enable');await browser.waitFor("Boolean(document.querySelector('#detail-title'))");
    const active=browser;await run(active,async name=>{const bytes=Buffer.from(await active.screenshot(),'base64'),file=join(directory,name);await writeFile(file,bytes);screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});});
  }catch(failure){error=failure;if(browser)try{await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,posts:globalThis.__t10Posts,reads:globalThis.__t10Reads,revocations:globalThis.__t10Revocations})')));console.log('T10_BROWSER_FAILURE '+JSON.stringify({directory}));}catch(captureError){error=new AggregateError([failure,captureError]);}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',purpose,screenshots}));
}
export const fillWaiting=(selector:string,text:string)=>`(()=>{const row=document.querySelector(${JSON.stringify(selector)});if(!(row instanceof HTMLTextAreaElement))throw Error('T10_REAL_INPUT_REQUIRED');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(row,${JSON.stringify(text)});row.dispatchEvent(new Event('input',{bubbles:true}));})()`;
