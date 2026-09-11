import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';
import { launchSystemBrowser,closeBrowserTestResources } from './helpers/p2-006-browser-harness.mjs';

test('G2-T03 two isolated agent browsers transfer Ticket responsibility while Conversation owner remains independent', {timeout:90000},async t=>{
  await withG2Runtime(async f=>{
    await f.inbound('打印机卡纸了',{chatType:'single'});await f.pump();
    const ticket=(await f.pool.query('SELECT id FROM pilot_ticket.ticket')).rows[0],session=(await f.pool.query('SELECT id FROM conversation.session')).rows[0];
    const d=await f.get('/api/conversations/'+session.id);
    const takeover=await f.post('/api/conversations/'+session.id+'/takeover',{client_command_id:randomUUID(),
      expected_row_version:d.session.row_version,target_principal_id:f.admin.id,reason_code:'WORKBENCH_TAKEOVER'},d.session.row_version);
    assert.equal(takeover.status,200);
    const open=async index=>{const cut=f.cookies[index].indexOf('=');return launchSystemBrowser({url:f.origin+'/workbench/lifecycle#queue=queued&selected='+ticket.id,
      width:1440,height:900,cookies:[{name:f.cookies[index].slice(0,cut),value:f.cookies[index].slice(cut+1),url:f.origin}]});};
    const browser=await open(0);let dispatcher,primaryError=null;
    const click=async(b,label)=>{const expression=`Array.from(document.querySelectorAll('#lc-detail button')).find(n=>n.textContent===${JSON.stringify(label)}&&!n.disabled)`;
      await b.waitFor('!!('+expression+')');await b.evaluate(expression+'.click()');};
    const done=b=>b.waitFor("!document.querySelector('#lc-detail form')&&document.querySelector('#lc-status').textContent.includes('已提交')");
    try{
      await click(browser,'接单');await click(browser,'确认：接单');await done(browser);
      dispatcher=await open(2);await dispatcher.waitFor("document.querySelector('.responsibilities')?.textContent.includes('合成G2坐席')");
      await click(dispatcher,'转派处理人');
      await dispatcher.evaluate(`document.querySelector('#lc-detail form select').value=${JSON.stringify(f.principals[1].id)}`);
      await click(dispatcher,'确认：转派处理人');await done(dispatcher);
      for(const b of [browser,dispatcher]){
        await b.evaluate("Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='刷新').click()");
        await b.waitFor("document.querySelector('.responsibilities')?.children[1]?.textContent.includes('合成G2处理人0')");
        const owners=await b.evaluate("Array.from(document.querySelector('.responsibilities').children).map(n=>n.textContent)");
        assert.ok(owners[0].includes('合成G2坐席'));assert.ok(owners[1].includes('合成G2处理人0'));
      }
      const owners=await f.get('/api/tickets/'+ticket.id+'/responsibility');
      assert.equal(owners.ticket_assignee_name,'合成G2处理人0');assert.equal(owners.conversations[0].conversation_principal_name,'合成G2坐席');
      assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM pilot_ticket.ticket_event WHERE ticket_id=$1 AND event_type='ticket.assignment_transferred'",[ticket.id])).rows[0].n,1);
      assert.equal(f.providerCalls.length,0);
      t.diagnostic(JSON.stringify({scenario_id:'G2-T03',surface:'TWO_ISOLATED_REAL_BROWSERS_WITH_NORMAL_INGRESS',browser_principals:2,
        conversation_takeover_setup:'AUTHORIZED_HTTP',ticket_accept_and_transfer:'ACTUAL_UI',conversation_owner_unchanged:true,provider_calls:0}));
    }catch(error){primaryError=error;}finally{await closeBrowserTestResources([()=>dispatcher?.close(),()=>browser.close()],primaryError);}
  },{extraAgents:true});
});
