import test from 'node:test';
import assert from 'node:assert/strict';
import {withG2Runtime} from './helpers/p2-g2-runtime-harness.mjs';
import {createWeComMemberDirectory} from '../src/p2-015-wecom-member-directory.mjs';
import {launchSystemBrowser} from './helpers/p2-006-browser-harness.mjs';

test('group fault exposes trusted contact only through authorized internal ticket endpoint',async()=>{
  let calls=0;
  const directoryPort=createWeComMemberDirectory({enabled:true,botId:'synthetic-g2-bot',memberIdsConfirmed:true,
    accessTokenProvider:async()=> 'synthetic-token',fetchImpl:async url=>{
      calls++;if(url.pathname.endsWith('/department/get'))return new Response(JSON.stringify({errcode:0,department:{id:17,name:'模拟部门A'}}));
      return new Response(JSON.stringify({errcode:0,userid:url.searchParams.get('userid'),
        name:'模拟联系成员',mobile:'synthetic-private-phone',telephone:'synthetic-private-extension',department:[17],main_department:17,status:1}));
    }});
  await withG2Runtime(async f=>{
    await f.inbound('模拟地点B的打印机有问题');await f.pump();
    const ticket=(await f.get('/api/tickets')).items[0];assert.ok(ticket);assert.equal(calls,2);
    const path='/api/tickets/'+ticket.id+'/reporter-contact',result=await f.get(path);
    assert.equal(result.status,'RESOLVED');assert.equal(result.contact.name,'模拟联系成员');
    assert.equal(result.contact.userid,f.reporters[0]);assert.equal(result.contact.mobile,'synthetic-private-phone');
    const unauth=await fetch(f.origin+path);assert.equal(unauth.status,401);
    assert.equal(result.departments.length,1);assert.equal(result.departments[0].name,'模拟部门A');
    const cut=f.cookie.indexOf('=');
    const browser=await launchSystemBrowser({url:f.origin+'/workbench/lifecycle#queue=queued&selected='+ticket.id,
      width:1440,height:900,cookies:[{name:f.cookie.slice(0,cut),value:f.cookie.slice(cut+1),url:f.origin}]});
    try{await browser.waitFor("document.querySelector('#lc-detail')?.textContent.includes('模拟联系成员')");
      assert.equal(await browser.evaluate("document.querySelector('#lc-detail').textContent.includes('synthetic-private-phone')"),true);
      const department=await browser.evaluate("Array.from(document.querySelectorAll('#lc-detail dt')).find(n=>n.textContent==='所属部门').nextElementSibling.textContent");
      assert.ok(department.includes('模拟部门A'));assert.ok(!department.includes('模拟地点B'));
      assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM channel.message_inbox WHERE raw_text='模拟地点B的打印机有问题'")).rows[0].n,1);
    }finally{await browser.close();}
    await f.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1',[f.admin.id]);
    const revoked=await fetch(f.origin+path,{headers:{cookie:f.cookie}});assert.ok([401,403].includes(revoked.status));
    await f.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=true WHERE id=$1',[f.admin.id]);
    const j=(await f.pool.query('SELECT id FROM intake.contact_journey')).rows[0];
    const ordinary=JSON.stringify([await f.get('/api/tickets/'+ticket.id),await f.get('/api/contact-journeys/'+j.id),
      await f.get('/api/contact-journeys/'+j.id+'/decisions')]);
    for(const secret of ['模拟联系成员','synthetic-private-phone',f.reporters[0]])assert.equal(ordinary.includes(secret),false);
    assert.equal((await f.pool.query("SELECT count(*)::int FROM intake.channel_leg WHERE leg_type IN ('DIRECT_GUIDED','DIRECT_ORGANIC')")).rows[0].count,0);
    assert.equal(f.providerCalls.length,0);
  },{directoryPort});
});

test('unavailable profile leaves admitted fault accessible with explicit missing contact',async()=>{
  await withG2Runtime(async f=>{
    await f.inbound('打印机有问题');await f.pump();const ticket=(await f.get('/api/tickets')).items[0];
    const contact=await f.get('/api/tickets/'+ticket.id+'/reporter-contact');
    assert.equal(contact.status,'DEFERRED');assert.equal(contact.contact,null);assert.deepEqual(contact.departments,[]);
    const cut=f.cookie.indexOf('='),browser=await launchSystemBrowser({url:f.origin+'/workbench/lifecycle#queue=queued&selected='+ticket.id,
      width:1440,height:900,cookies:[{name:f.cookie.slice(0,cut),value:f.cookie.slice(cut+1),url:f.origin}]});
    try{await browser.waitFor("document.querySelector('#lc-detail')?.textContent.includes('联系资料暂不可用，报修已正常受理')");
      assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,1);
    }finally{await browser.close();}
  });
});
