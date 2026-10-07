import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
test('WEB01 real HTTP: scope, duplicate review, natural-day completion range, keyset and protected static',async()=>{
  await withWeb01Fixture(async({origin,cookies,tickets,waiting,pool,principals})=>{
    const get=(path,index=0)=>fetch(origin+path,{headers:{cookie:cookies[index]}});
    assert.equal((await fetch(origin+'/api/workbench/board')).status,401);
    assert.equal((await fetch(origin+'/workbench/app/')).status,401);
    assert.equal((await fetch(origin+'/api/workbench/board',{headers:{cookie:'yxx_member_session=synthetic-reporter'}})).status,401);
    const read=async path=>{const response=await get(path);assert.equal(response.status,200,await response.clone().text());return response.json();};
    const bootstrap=await read('/api/lifecycle/bootstrap');assert.equal(bootstrap.principal_id,principals[0].id);
    const pending=await read('/api/workbench/board?column=pending');
    assert.equal(pending.items.length,7);assert.equal(pending.items.filter(i=>i.intake_id===tickets[0].intake.intakeId).length,1);
    assert.ok(pending.items.some(i=>i.kind==='intake'&&i.id===waiting.intakeId&&i.status==='WAITING_DESCRIPTION'));
    assert.equal(pending.items.find(i=>i.id===waiting.intakeId).priority,null);
    assert.equal((await get('/api/workbench/items/intake/'+waiting.intakeId,1)).status,404);
    assert.ok((await read('/api/workbench/items/intake/'+waiting.intakeId)).records.some(r=>r.audience==='REPORT'));
    assert.equal(pending.items.find(i=>i.id===tickets[0].ticket.id).kind,'ticket');assert.ok(pending.items.some(i=>i.kind==='review'));
    assert.ok(pending.items.filter(i=>i.kind==='ticket').every(i=>i.created_at<pending.range.from)); // Old nonterminal Tickets remain visible.
    const first=await read('/api/workbench/board?column=pending&limit=2');assert.ok(first.next_cursor);
    const second=await read('/api/workbench/board?column=pending&limit=2&cursor='+first.next_cursor);
    assert.equal(new Set([...first.items,...second.items].map(i=>i.kind+i.id)).size,4);
    assert.equal((await get('/api/workbench/board?column=active&cursor='+first.next_cursor)).status,400);
    assert.equal((await get('/api/workbench/board?column=pending&limit=101')).status,400);
    const closed=await read('/api/workbench/board?column=closed');assert.equal(closed.items.length,4);
    const resolved=closed.items.find(i=>i.status==='RESOLVED');assert.ok(resolved);assert.equal(resolved.completed_at,null);
    await pool.query("UPDATE pilot_ticket.ticket_event SET created_at=date_trunc('day',platform.local_now())-interval '2 days' WHERE ticket_id=$1::uuid AND event_type='ticket.closed'",[tickets[9].ticket.id]);
    assert.equal((await read('/api/workbench/board?column=closed')).items.length,3);
    assert.equal((await read('/api/workbench/board?column=closed&range=all')).items.length,4);
    const outsider=await get('/api/workbench/board?column=pending',1);assert.equal(outsider.status,200);assert.equal((await outsider.json()).items.length,0);
    const path='/api/workbench/items/ticket/'+tickets[5].ticket.id;
    assert.equal((await get(path,1)).status,404);
    const detail=await read(path);assert.ok(detail.records.some(r=>r.text==='仅供内部的合成处理记录'&&r.audience==='INTERNAL'));assert.ok(detail.records.some(r=>r.audience==='REPORT'));assert.equal(detail.item.title,'住院部西区无线网络频繁断开');
    const shell=await get('/workbench/app/items/ticket/'+tickets[5].ticket.id);assert.equal(shell.status,200);assert.match(shell.headers.get('content-security-policy'),/script-src 'self'; style-src 'self'/u);
    assert.equal((await get('/workbench/app?view=list')).status,200);
    assert.equal((await fetch(origin+'/workbench/app?view=list')).status,401);
    const html=await shell.text(),asset=html.match(/src="([^"]+\.js)"/u)?.[1];assert.ok(asset);assert.equal((await get(asset)).status,200);
    assert.equal((await get('/workbench/app/assets/unknown.js')).status,404);
    assert.equal((await get('/workbench/app/src/main.tsx')).status,404);
    const unknown=await get('/api/unknown-web01');assert.equal(unknown.status,404);assert.match(unknown.headers.get('content-type'),/application\/json/u);
    assert.equal((await get('/workbench')).status,200);assert.equal((await get('/workbench/lifecycle')).status,200);
    assert.equal((await get('/api/reporter/bootstrap')).status,503); // Existing member closed flag is unchanged.
    await pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[principals[0].id]);
    assert.equal((await get(path)).status,401);assert.equal((await get('/workbench/app/')).status,401);
  });
});
