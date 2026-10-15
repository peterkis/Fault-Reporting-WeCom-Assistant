import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withT41RiskFixture,object,rows} from './helpers/t41-search-risk-fixture.mjs';

test('T41 searches stable authorized pages, canonicalizes a linked Review once and refuses cursor mixing or a transferred anchor',async()=>{
 await withT41RiskFixture(async f=>{
  const first=await f.get('/api/workbench/search?column=pending&limit=1');assert.equal(first.status,200,await first.clone().text());
  const page=object(await first.json()),initial=rows(page.items);assert.equal(initial.length,1);assert.equal(typeof page.next_cursor,'string');
  const cursor=String(page.next_cursor),ids=new Set<string>(),all:Record<string,unknown>[]=[];let next:string|null=cursor;
  for(const item of initial){ids.add(String(item.kind)+':'+String(item.id));all.push(item);}
  for(let step=0;next!==null;step++){
   assert.ok(step<10,'the finite fixture pages must terminate');
   const response=await f.get('/api/workbench/search?column=pending&limit=1&cursor='+encodeURIComponent(next));assert.equal(response.status,200,await response.clone().text());
   const current=object(await response.json());
   for(const item of rows(current.items)){const id=String(item.kind)+':'+String(item.id);assert.ok(!ids.has(id));ids.add(id);all.push(item);}
   assert.ok(current.next_cursor===null||typeof current.next_cursor==='string');next=current.next_cursor;
  }
  const linked=f.tickets[0];assert.ok(linked);
  assert.equal(all.filter(item=>item.intake_id===linked.intake.intakeId).length,1);
  assert.equal(all.find(item=>item.intake_id===linked.intake.intakeId)?.kind,'ticket');
  assert.equal((await f.get('/api/workbench/search?column=pending&limit=1&q=different&cursor='+encodeURIComponent(cursor))).status,400);
  assert.equal((await f.get('/api/workbench/search?column=pending&limit=1&cursor='+encodeURIComponent(cursor),'admin')).status,400);
  const anchor=initial[0];assert.ok(anchor&&anchor.kind==='ticket');
  await f.pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES('T41_MOVED','T41合成转走组')");
  await f.pool.query("UPDATE pilot_ticket.ticket SET resolver_team_id='T41_MOVED',assignee_id=NULL WHERE id=$1::uuid",[anchor.id]);
  assert.equal((await f.get('/api/tickets/'+String(anchor.id))).status,404);
  const rejected=await f.get('/api/workbench/search?column=pending&limit=1&cursor='+encodeURIComponent(cursor));assert.equal(rejected.status,400);
  assert.equal(object(object(await rejected.json()).error).code,'P2_016_CURSOR_INVALID');
 });
});
test('T41 same-name source groups remain distinct opaque identities before pagination',async()=>{
 await withT41RiskFixture(async f=>{
  const first=f.tickets[0],second=f.tickets[1];assert.ok(first&&second);
  const refs:string[]=[];
  for(const ticket of [first,second]){
   const response=await f.get('/api/workbench/items/ticket/'+ticket.ticket.id);assert.equal(response.status,200);
   const group=object(object(object(await response.json()).item).source_group);assert.ok(typeof group.ref==='string');refs.push(group.ref);
   await f.pool.query('INSERT INTO workbench.source_group_name(ref,display_name,row_version,updated_by) VALUES($1,$2,1,$3::uuid)',[group.ref,'同名合成群',f.staffId]);
  }
  assert.notEqual(refs[0],refs[1]);
  for(const [index,ref]of refs.entries()){
   const response=await f.get('/api/workbench/search?column=pending&source_group_ref='+ref);assert.equal(response.status,200,await response.clone().text());
   const found=rows(object(await response.json()).items);assert.equal(found.length,1);assert.equal(found[0]?.id,[first,second][index]?.ticket.id);
   assert.equal(object(found[0]?.source_group).display_name,'同名合成群');
  }
 },{groups:true});
});
test('T41 closed input is rejected, rate has no unbounded continuation and disabled search retains the original board',async()=>{
 await withT41RiskFixture(async f=>{
  for(const query of ['unknown=x','q=a&q=b','statuses=NEW,NEW','limit=101','q=%ED%A0%80']){
   assert.equal((await f.get('/api/workbench/search?'+query)).status,400);
  }
  let limited=false;const windowStart=performance.now();for(let count=0;count<21;count++){
   assert.ok(performance.now()-windowStart<60000,'rate fixture exceeded the real window before the business assertion');
   const response=await f.get('/api/workbench/search?q=never-matching-synthetic-material');
   if(response.status===429){limited=true;assert.equal(object(object(await response.json()).error).code,'P2_016_SEARCH_RATE_LIMITED');break;}
   assert.equal(response.status,200,await response.clone().text());assert.deepEqual(rows(object(await response.json()).items),[]);
  }
  assert.equal(limited,true);
 });
 await withT41RiskFixture(async f=>{
  assert.equal((await f.get('/api/workbench/search')).status,404);
  assert.equal((await f.get('/api/workbench/board?column=pending')).status,200);
  const response=await f.get('/api/lifecycle/bootstrap');assert.equal(response.status,200);assert.equal(object(await response.json()).workbench_search_enabled,false);
 },{enabled:false});
});
