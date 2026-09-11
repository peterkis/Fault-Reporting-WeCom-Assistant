import test from 'node:test';
import assert from 'node:assert/strict';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';
import { launchSystemBrowser } from './helpers/p2-006-browser-harness.mjs';

test('G2-T01/I01/I02/I03 actual browser controls complete a normal-source service loop without shared Ticket ownership', {timeout:120000},async t=>{
  await withG2Runtime(async f=>{
    for(const reporter of f.reporters){await f.inbound('测试诊室断网。',{chatType:'single',reporter});await f.pump();}
    await f.runtime.incidentExtension.runOnce();
    const candidate=(await f.pool.query('SELECT id FROM incident.candidate_review')).rows;
    assert.equal(candidate.length,1);assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM incident.incident')).rows[0].n,0);
    const tickets=(await f.pool.query('SELECT id,status FROM pilot_ticket.ticket ORDER BY ticket_no')).rows;assert.equal(tickets.length,3);
    const cut=f.cookie.indexOf('='),browser=await launchSystemBrowser({url:f.origin+'/workbench/incidents#mode=candidates&selected='+candidate[0].id,
      width:1440,height:1000,cookies:[{name:f.cookie.slice(0,cut),value:f.cookie.slice(cut+1),url:f.origin}]});
    const click=async(label,index=0)=>{
      try { await browser.waitFor(`Array.from(document.querySelectorAll('#lc-detail button, #detail button')).filter(b=>b.textContent===${JSON.stringify(label)}&&!b.disabled).length>${index}`); } catch(error) {
        t.diagnostic(JSON.stringify({waiting_for:label,buttons:await browser.evaluate("Array.from(document.querySelectorAll('button')).map(b=>({text:b.textContent,disabled:b.disabled}))"),
          status:await browser.evaluate("document.querySelector('#lc-status')?.textContent??document.querySelector('#status')?.textContent")}));throw error;
      }
      await browser.evaluate(`Array.from(document.querySelectorAll('#lc-detail button, #detail button')).filter(b=>b.textContent===${JSON.stringify(label)})[${index}].click()`);
    };
    const incidentAction=async(label,fill=null,index=0)=>{
      await click(label,index);await browser.waitFor("!!document.querySelector('#detail form')");
      if(fill)await browser.evaluate(fill);
      await browser.evaluate("document.querySelector('#detail form select[name=reason_code]').value='OPERATOR_REVIEWED'");
      await click('确认：'+label);await browser.waitFor("!document.querySelector('#detail form')&&document.querySelector('#status').textContent.includes('已提交')");
    };
    try{
      await browser.waitFor("document.querySelector('#detail')?.textContent.includes('冻结的候选证据')");
      await incidentAction('开始审核');
      assert.equal((await f.pool.query('SELECT status FROM incident.candidate_review')).rows[0].status,'UNDER_REVIEW');
      await incidentAction('确认公共故障',`const form=document.querySelector('#detail form');form.querySelector('[name=confirmed_scope]').value='LOCAL';
        form.querySelectorAll('select')[1].value=${JSON.stringify(f.admin.id)};form.querySelector('[name=primary_ticket_id]').value='__NONE__';
        Array.from(form.querySelectorAll('input[type=checkbox]')).forEach((box,i)=>{box.checked=i<2;});`);
      const incident=(await f.pool.query('SELECT id,status,primary_ticket_id FROM incident.incident')).rows[0];
      assert.equal(incident.status,'CONFIRMED_LOCAL');assert.equal(incident.primary_ticket_id,null);
      assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM incident.incident_report WHERE link_state='LINKED'")).rows[0].n,2);
      await browser.evaluate(`location.href=${JSON.stringify(f.origin+'/workbench/incidents?g2view=active#mode=active&selected='+incident.id)}`);
      await browser.waitFor("document.querySelector('#detail')?.textContent.includes('个人上报与恢复')");
      await incidentAction('关联个人报告');
      assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM incident.incident_report WHERE link_state='LINKED'")).rows[0].n,3);
      const prior=(await f.pool.query('SELECT id,impact_state FROM incident.incident_report ORDER BY id')).rows;
      await incidentAction('记录该上报人已恢复');
      const after=(await f.pool.query('SELECT id,impact_state FROM incident.incident_report ORDER BY id')).rows;
      assert.equal(after.filter((row,i)=>row.impact_state!==prior[i].impact_state).length,1);
      assert.equal(after.filter(row=>row.impact_state==='RECOVERED').length,1);
      assert.equal((await f.pool.query('SELECT status FROM incident.incident WHERE id=$1',[incident.id])).rows[0].status,'CONFIRMED_LOCAL');
      assert.deepEqual((await f.pool.query('SELECT id,status FROM pilot_ticket.ticket ORDER BY ticket_no')).rows,tickets);
      await incidentAction('设置主参考工单',"const select=document.querySelector('#detail form select');select.selectedIndex=1");
      const selectedPrimary=(await f.pool.query('SELECT primary_ticket_id FROM incident.incident WHERE id=$1',[incident.id])).rows[0].primary_ticket_id;
      assert.ok(selectedPrimary);
      const primaryTicket=(await f.pool.query('SELECT ticket_no FROM pilot_ticket.ticket WHERE id=$1',[selectedPrimary])).rows[0].ticket_no;
      await browser.waitFor(`Array.from(document.querySelectorAll('#detail .delivery')).some(box=>box.textContent.includes(${JSON.stringify(primaryTicket)})&&box.querySelectorAll('button').length>1)`);
      await browser.evaluate(`Array.from(document.querySelectorAll('#detail .delivery')).find(box=>box.textContent.includes(${JSON.stringify(primaryTicket)}))
        .querySelectorAll('button')[1].click()`);
      await browser.evaluate("document.querySelector('#detail form select[name=reason_code]').value='INCORRECT_ASSOCIATION'");
      await click('确认：解除错误关联');
      await browser.waitFor("!document.querySelector('#detail form')&&document.querySelector('#status').textContent.includes('版本或状态')");
      assert.equal((await f.pool.query("SELECT link_state FROM incident.incident_report WHERE incident_id=$1 AND ticket_id=$2",[incident.id,selectedPrimary])).rows[0].link_state,'LINKED');
      await incidentAction('设置主参考工单',"document.querySelector('#detail form select').value=''");
      await incidentAction('解除错误关联');
      assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM incident.incident_report WHERE link_state='LINKED'")).rows[0].n,2);
      assert.deepEqual((await f.pool.query('SELECT id,status FROM pilot_ticket.ticket ORDER BY ticket_no')).rows,tickets);
      await browser.evaluate(`location.href=${JSON.stringify(f.origin+'/workbench/lifecycle#queue=queued&selected='+tickets[0].id)}`);
      await browser.waitFor("document.querySelector('#lc-detail')?.textContent.includes('工单操作')");
      const steps=[['接单','ACCEPTED'],['开始处理','IN_PROGRESS'],['请上报人补充','WAITING_REQUESTER'],['恢复处理','IN_PROGRESS'],
        ['等待厂商','WAITING_VENDOR'],['恢复处理','IN_PROGRESS'],['登记解决','RESOLVED'],['确认关闭','CLOSED'],
        ['重新打开','REOPENED'],['开始处理','IN_PROGRESS'],['登记解决','RESOLVED'],['确认关闭','CLOSED']];
      if(tickets[0].status==='NEW')steps.unshift(['进入待分配','QUEUED']);
      const beforeEvents=(await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket_event WHERE ticket_id=$1',[tickets[0].id])).rows[0].n;
      for(const [label,status] of steps){
        await click(label);await click('确认：'+label);
        await browser.waitFor("!document.querySelector('#lc-detail form')&&document.querySelector('#lc-status').textContent.includes('已提交')");
        assert.equal((await f.pool.query('SELECT status FROM pilot_ticket.ticket WHERE id=$1',[tickets[0].id])).rows[0].status,status);
        if(status==='RESOLVED'){
          await f.inbound('谢谢',{chatType:'single',reporter:f.reporters[0]});await f.pump();
          assert.equal((await f.pool.query('SELECT status FROM pilot_ticket.ticket WHERE id=$1',[tickets[0].id])).rows[0].status,'RESOLVED');
        }
      }
      assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket_event WHERE ticket_id=$1',[tickets[0].id])).rows[0].n,beforeEvents+steps.length);
      assert.deepEqual((await f.pool.query('SELECT id,status FROM pilot_ticket.ticket WHERE id<>$1 ORDER BY ticket_no',[tickets[0].id])).rows,tickets.slice(1));
      assert.equal(f.providerCalls.length,0);
      t.diagnostic(JSON.stringify({scenario_ids:['G2-T01','G2-I01','G2-I02','G2-I03'],source_case_ids:['D12-050','D12-052'],
        seeded_business_facts:false,surface:'NORMAL_FRAME_POSTGRES_ACTUAL_BROWSER',normal_reports:3,candidates:1,human_confirmed_incidents:1,
        individual_recoveries:1,ticket_state_actions:steps.length,provider_calls:0}));
    }finally{await browser.close();}
  },{extraAgents:true});
});
