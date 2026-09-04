import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:net';
import { createPilotTicketCore } from '../src/p1-005-pilot-ticket-core.mjs';
import { createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { createP2016Runtime } from '../src/p2-016-runtime.mjs';
import { seedPersistedIntake } from './helpers/p2-015-postgres-harness.mjs';
import { withP2016IsolatedDatabase,applyThrough030 } from './helpers/p2-016-postgres-harness.mjs';
import { migrateP2016 } from '../scripts/p2-016-migrate.mjs';
import { launchSystemBrowser } from './helpers/p2-006-browser-harness.mjs';
test('Real DB internal browser traverses every user lifecycle action, transfer and atomic takeover/accept',{timeout:120000},async()=>{
  await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'p2016uibiz',run:async({pool,databaseUrl})=>{
    await applyThrough030({pool,databaseUrl});await migrateP2016({databaseUrl});
    const access=createPilotAccessService({pool}),principal=await access.upsertPrincipal({wecomUserId:'synthetic-ui-admin',displayName:'Z 合成主管',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const other=await access.upsertPrincipal({wecomUserId:'synthetic-ui-handler',displayName:'B 合成处理人',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
    async function seed(){const i=await seedPersistedIntake({pool,text:'合成业务故障',requestType:'INCIDENT',status:'RECEIVED'});return (await createPilotTicketCore({pool}).createForIntake({intakeId:i.intakeId,occurredAt:i.receivedAt,traceId:'synthetic-ui'})).ticket;}
    const ticket=await seed(),cancelled=await seed(),combined=await seed();
    // Exercise the supported NEW -> queue entry with an initial synthetic fixture, before any Ticket Event.
    await pool.query("UPDATE pilot_ticket.ticket SET status='NEW' WHERE id=$1::uuid",[ticket.id]);
    const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const listenPort=probe.address().port;await new Promise(r=>probe.close(r));const origin='http://127.0.0.1:'+listenPort;
    const runtime=createP2016Runtime({pool,principalId:principal.id,publicOrigin:origin,listenPort,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true}});let browser;
    const click=label=>browser.evaluate(`Array.from(document.querySelectorAll('#lc-detail button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);
    async function select(id){const expected=[ticket,cancelled,combined].find(t=>t.id===id).ticket_no;await browser.evaluate(`location.href=${JSON.stringify(origin+'/workbench/lifecycle#queue=queued&selected='+id)}`);await browser.evaluate('location.reload()',{awaitPromise:false});await browser.waitFor(`document.querySelector('.ticket-number')?.textContent===${JSON.stringify(expected)} && document.querySelector('#lc-detail').textContent.includes('双责任')`);}
    async function action(label,expected){try{await click(label);await browser.waitFor(`Array.from(document.querySelectorAll('#lc-detail form button')).some(b=>b.textContent===${JSON.stringify('确认：'+label)})`,{timeoutMs:5000});await click('确认：'+label);await browser.waitFor(`document.querySelector('.detail-header .badge')?.textContent===${JSON.stringify(expected)}`,{timeoutMs:10000});}
      catch{throw new Error('UI action '+label+': '+await browser.evaluate("JSON.stringify({status:document.querySelector('#lc-status').textContent,badge:document.querySelector('.detail-header .badge')?.textContent,forms:Array.from(document.querySelectorAll('#lc-detail form button')).map(b=>b.textContent)})"));}}
    try{
      const started=await runtime.start();assert.equal((await runtime.coordinator.runOnce()).failures,0);
      browser=await launchSystemBrowser({url:origin+'/workbench/lifecycle#queue=queued&selected='+ticket.id,width:1440,height:900,cookies:[started.cookie]});
      await browser.waitFor("document.querySelector('.detail-header .badge')?.textContent==='待入队'");
      for(const [label,state] of [['进入待分配','待分配'],['接单','已接单'],['开始处理','处理中'],['请上报人补充','等待上报人'],['恢复处理','处理中'],['等待厂商','等待厂商'],['恢复处理','处理中'],['登记解决','已解决待确认'],['确认关闭','已关闭'],['重新打开','重新打开'],['开始处理','处理中']])await action(label,state);
      await click('转派处理人');await browser.waitFor("document.querySelector('#lc-detail form select')!==null");
      await browser.evaluate(`document.querySelector('#lc-detail form select').value=${JSON.stringify(other.id)}`);await click('确认：转派处理人');
      await browser.waitFor("document.querySelector('.responsibilities').textContent.includes('B 合成处理人')");
      await click('添加备注');await browser.evaluate("document.querySelector('#lc-detail textarea').value='合成内部备注';document.querySelector('#lc-detail form button').click()");
      await browser.waitFor("document.querySelector('#lc-detail').textContent.includes('含内部备注')");
      assert.equal((await pool.query('SELECT assignee_id::text,status FROM pilot_ticket.ticket WHERE id=$1::uuid',[ticket.id])).rows[0].assignee_id,other.id);
      await select(cancelled.id);await action('取消工单','已取消');
      await select(combined.id);await action('接管会话并接单','已接单');
      const ownership=await runtime.query.responsibility({authContext:{principal_id:principal.id},ticketId:combined.id});assert.equal(ownership.ticket_assignee_id,principal.id);assert.equal(ownership.conversations[0].conversation_principal_id,principal.id);
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM communication.message WHERE content::text LIKE '%合成内部备注%'")).rows[0].n,0);
      assert.equal(await browser.evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('auto-close'))"),false);
    }finally{await browser?.close();await runtime.stop();}
  }});
});
