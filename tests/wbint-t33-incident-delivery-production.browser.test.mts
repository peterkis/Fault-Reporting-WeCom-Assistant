import assert from 'node:assert/strict';
import {test} from 'node:test';
import {t33IncidentBrowser} from './helpers/t33-incident-delivery-browser-fixture.mjs';
function record(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
test('T33 production Incident detail requires a reason, an UNKNOWN resolution, and explicit confirmation before recording SENT without sending again',{timeout:240000},async()=>{
 await t33IncidentBrowser(async({browser,get,incidentId,deliveryId,siblingId,senderCalls,capture,getLifecycleRows})=>{
  await browser.waitFor('Boolean(document.querySelector("[data-incident-delivery-controls][data-control-purpose=INCIDENT_LIFECYCLE]"))');
  assert.equal(await browser.evaluate('globalThis.__t33ControlPosts.length'),0,'opening the production detail never sends a control command');
  const select=async(label:string,value:string)=>{
   const selector='[data-control-purpose="INCIDENT_LIFECYCLE"] select[aria-label="'+label+'"]';
   await browser.evaluate('(()=>{const field=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(field,'+JSON.stringify(value)+');field.dispatchEvent(new Event("change",{bubbles:true}));})()');
  };
  await select('选择通知路',deliveryId);
  await browser.waitFor('document.querySelector("[data-control-purpose=INCIDENT_LIFECYCLE] option[value=RECONCILE]")?.disabled===false');
  await select('投递控制操作','RECONCILE');
  await select('投递操作原因','OPERATOR_VERIFIED_DELIVERY');
  await select('未知发送核对结论','CONFIRMED_SENT');
  assert.equal(await browser.evaluate('document.querySelector("[data-control-purpose=INCIDENT_LIFECYCLE] [data-action=submit-incident-delivery-control]").disabled'),true,'an explicit confirmation is required after selecting the conclusion');
  await browser.evaluate('document.querySelector("[data-control-purpose=INCIDENT_LIFECYCLE] input[aria-label=确认本路投递操作]").click()');
  await browser.waitFor('document.querySelector("[data-control-purpose=INCIDENT_LIFECYCLE] [data-action=submit-incident-delivery-control]")?.disabled===false');
  await capture('explicit-confirmation');
  await browser.evaluate('document.querySelector("[data-control-purpose=INCIDENT_LIFECYCLE] [data-action=submit-incident-delivery-control]").click()');
  await browser.waitFor('document.querySelector("[data-control-purpose=INCIDENT_LIFECYCLE] [data-incident-delivery-outcome]")?.dataset.incidentDeliveryState==="committed"');
  await browser.waitFor('document.querySelector('+JSON.stringify('[aria-label="各路通知投递"] [data-delivery-id="'+deliveryId+'"]')+')?.textContent.includes("已发送")');
  const posts:unknown=await browser.evaluate('globalThis.__t33ControlPosts');assert.ok(Array.isArray(posts));assert.equal(posts.length,1);
  const original=record(posts[0]),body=record(original.body);assert.equal(original.status,200);assert.equal(body.resolution,'CONFIRMED_SENT');assert.equal(body.expected_status,'RECONCILIATION_REQUIRED');assert.equal(body.expected_side_effect_state,'UNKNOWN');
  const uuid=text(body.client_command_id),receipt=await get('/api/incidents/'+incidentId+'/notification-commands/'+uuid);
  assert.equal(receipt.status,200);assert.equal(receipt.body.state,'COMMITTED');const result=record(receipt.body.result);
  assert.equal(result.delivery_id,deliveryId);assert.equal(result.status,'SENT');assert.equal(result.side_effect_state,'ACKNOWLEDGED');assert.equal(result.replayed,false);assert.equal(senderCalls(),1,'confirming an observed send must never call Sender again');
  const rows=await getLifecycleRows(),sibling=rows.find(row=>row.delivery_id===siblingId);assert.equal(sibling?.status,'PENDING');assert.equal(sibling?.side_effect_state,'NOT_ATTEMPTED');
  assert.equal(await browser.evaluate('document.querySelector("[data-control-purpose=INCIDENT_LIFECYCLE] [data-incident-delivery-outcome]").textContent.includes("不代表报修人已读")'),true);
 });
});
