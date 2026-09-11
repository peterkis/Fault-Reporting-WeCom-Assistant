import test from 'node:test';
import assert from 'node:assert/strict';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';
import { launchSystemBrowser } from './helpers/p2-006-browser-harness.mjs';

test('G2-E07 the actual high-risk inbound Review is visible and resolved in the browser while its original Decision and Ticket survive',async t=>{
  await withG2Runtime(async f=>{
    await f.inbound('急诊唯一叫号终端坏了。',{chatType:'single'});await f.pump();
    const review=(await f.pool.query('SELECT id,decision_id FROM intake.manual_review_item')).rows;
    assert.equal(review.length,1);const id=review[0].id,original=await f.get('/api/manual-reviews/'+id);
    const ticket=(await f.pool.query('SELECT id FROM pilot_ticket.ticket')).rows;assert.equal(ticket.length,1);
    const cut=f.cookie.indexOf('='),browser=await launchSystemBrowser({url:f.origin+'/workbench/lifecycle#queue=reviews&selected='+id,
      width:1440,height:1000,cookies:[{name:f.cookie.slice(0,cut),value:f.cookie.slice(cut+1),url:f.origin}]});
    try{
      await browser.waitFor("document.querySelector('#lc-detail')?.textContent.includes('人工判断与安全处理')");
      assert.equal(await browser.evaluate(`document.querySelector('[data-resource-id="${id}"]')!==null`),true);
      await browser.evaluate("const s=Array.from(document.querySelectorAll('#lc-detail select')).find(s=>Array.from(s.options).some(o=>o.value==='REQUEST_DESCRIPTION'));s.value='REQUEST_DESCRIPTION';s.dispatchEvent(new Event('change'))");
      await browser.evaluate("Array.from(document.querySelectorAll('#lc-detail button')).find(b=>b.textContent==='确认：保存人工结论并执行安全动作').click()");
      await browser.waitFor("document.querySelector('#lc-detail')?.textContent.includes('该审核已完成')");
      const resolved=await f.get('/api/manual-reviews/'+id);assert.equal(resolved.status,'RESOLVED');assert.deepEqual(resolved.safe_result,original.safe_result);
      assert.deepEqual((await f.pool.query('SELECT id FROM pilot_ticket.ticket')).rows,ticket);
      assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.deterministic_decision WHERE id=$1',[review[0].decision_id])).rows[0].n,1);
      t.diagnostic(JSON.stringify({scenario_id:'G2-E07',actual_source_review_resolved_via_browser:true,original_decision_preserved:true,ticket_delta:0,seeded_business_facts:false}));
    }finally{await browser.close();}
  });
});
