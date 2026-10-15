import assert from 'node:assert/strict';
import {test} from 'node:test';
import {t30Browser} from './helpers/t30-internal-note-browser-fixture.mjs';
import {t31Browser} from './helpers/t31-public-progress-browser-fixture.mjs';
import {ownerTransferBrowser} from './helpers/t29-owner-transfer-browser-fixture.mjs';
import {record,text} from './helpers/wbint-t27-browser-fixture.mjs';
import type {Browser} from './helpers/wbint-t27-browser-fixture.mjs';

const copies="(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('wecom-workbench-drafts-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise((resolve,reject)=>{const tx=db.transaction(['drafts','operations'],'readonly'),d=tx.objectStore('drafts').getAll(),o=tx.objectStore('operations').getAll();tx.oncomplete=()=>resolve({drafts:d.result.map(row=>({purpose:row.purpose,revision:row.revision,firstSavedAt:row.firstSavedAt,expiresAt:row.expiresAt,ciphertext:Array.from(new Uint8Array(row.ciphertext))})),operations:o.result});tx.onabort=()=>reject(tx.error);});}finally{db.close();}})()";
async function transient(browser:Browser,incidentId:string,purposePath:string,draftSelector:string,inputSelector:string,expected:string){
 await browser.waitFor(`document.querySelector(${JSON.stringify(draftSelector)})?.textContent.includes('已保存恢复副本')`);
 const before=await browser.evaluate(copies);
 // An owned public read fault: all authentication and Incident reads remain real.
 const fault=record(await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const send=fetch;globalThis.__all43Faults=0;globalThis.fetch=(input,options)=>{const path=new URL(input instanceof Request?input.url:String(input),location.href).pathname;if((options?.method??'GET')==='GET'&&path===${JSON.stringify('/api/incidents/'+incidentId+'/'+purposePath)}){globalThis.__all43Faults++;return Promise.resolve(new Response(JSON.stringify({error:{code:'ALL43_TRANSIENT_READ',retryable:true}}),{status:503,headers:{'content-type':'application/json'}}));}return send(input,options);};})()`}));
 try{
  const old=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');
  await browser.waitFor(`performance.timeOrigin!==${old}&&globalThis.__all43Faults>0`);
  await browser.waitFor(`document.querySelector(${JSON.stringify(draftSelector)})?.textContent.includes('恢复不可用')||document.body.innerText.includes('失权')`);
  assert.deepEqual(await browser.evaluate(copies),before,'a transient purpose read cannot destroy an unexpired encrypted original');
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(inputSelector)})?.value??''`),'','unverified recovery is not displayed or submitted');
 }finally{await browser.command('Page.removeScriptToEvaluateOnNewDocument',{identifier:text(fault.identifier)});}
 await browser.command('Page.reload');await browser.waitFor(`document.querySelector(${JSON.stringify(inputSelector)})?.value===${JSON.stringify(expected)}`);
 console.log('ALL43_INCIDENT_TRANSIENT_RECOVERY '+JSON.stringify({purposePath,ciphertext_preserved:true,restored_after_explicit_reload:true}));
}

test('ALL43 internal-note recovery keeps its encrypted original during temporary purpose GET503',{timeout:180000},async()=>{
 await t30Browser('a43notedraft',async({browser,incidentId,put,get})=>{
  const input='合成内部草稿，网络恢复后仍需人工确认';await put(input);
  await transient(browser,incidentId,'internal-notes','[data-internal-note-draft]','textarea[aria-label="内部处置记录"]',input);
  assert.equal((await get('/api/incidents/'+incidentId)).status,200);
 });
});
test('ALL43 public-summary recovery keeps its independent encrypted original during temporary purpose GET503',{timeout:180000},async()=>{
 await t31Browser('a43pubdraft',async({browser,incidentId,put,get})=>{
  const input='合成人工公开摘要，尚未预览确认或发布';await put(input);
  await transient(browser,incidentId,'public-progress','[data-public-progress-draft]','textarea[aria-label="公开进展摘要"]',input);
  assert.equal((await get('/api/incidents/'+incidentId)).status,200);
 });
});
test('ALL43 owner-transfer recovery keeps its original selection during temporary target GET503',{timeout:180000},async()=>{
 await ownerTransferBrowser(async({browser,incidentId,choose,get})=>{
  await choose('交接原因','OPERATOR_REVIEWED');
  await transient(browser,incidentId,'owner-transfer-targets','[data-owner-transfer-draft]','select[aria-label="交接原因"]','OPERATOR_REVIEWED');
  assert.equal((await get('/api/incidents/'+incidentId)).status,200);
 },{recovery:true});
});
