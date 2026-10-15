import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT41SearchFixture} from './helpers/t41-search-fixture.mjs';

function object(value:unknown):Record<string,unknown>{
 assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;
}
function items(value:unknown):Record<string,unknown>[]{
 assert.ok(Array.isArray(value));return value.map(object);
}
test('search finds an authorized canonical Ticket beyond the loaded page without exposing an equally matching hidden Ticket',async()=>{
 await withT41SearchFixture(async f=>{
  const target=f.tickets[2],hidden=f.tickets[4];assert.ok(target&&hidden);
  const query='自助机读卡失败';
  // Only synthetic fixture material is changed. READ is checked through the public API below.
  await f.pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES('T41_HIDDEN','T41合成不可读组')");
  await f.pool.query('UPDATE pilot_ticket.ticket SET title=$2,resolver_team_id=$3,assignee_id=NULL WHERE id=$1::uuid',
   [hidden.ticket.id,query+'。不可读的合成报修。','T41_HIDDEN']);
  const bootstrap=await f.get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);
  assert.equal(object(await bootstrap.json()).principal_id,f.principalId);
  const visible=await f.get('/api/tickets/'+target.ticket.id);assert.equal(visible.status,200);
  const denied=await f.get('/api/tickets/'+hidden.ticket.id);assert.equal(denied.status,404);
  assert.equal((await f.get('/api/tickets/'+target.ticket.id,'outsider')).status,404);
  const loaded=await f.get('/api/workbench/board?column=pending&limit=1');assert.equal(loaded.status,200);
  const loadedPage=object(await loaded.json()),loadedItems=items(loadedPage.items);
  assert.equal(loadedItems.length,1);
  assert.ok(loadedItems.every(item=>item.id!==target.ticket.id),'the sought Ticket must not be in the loaded first page');
  assert.equal(typeof loadedPage.next_cursor,'string','the original authorized board must have more than one page');
  // Original public-seam first: no route, query, fake success or runtime was supplied by preparation.
  const response=await f.get('/api/workbench/search?column=pending&limit=1&q='+encodeURIComponent(query));
  assert.equal(response.status,200,await response.clone().text());
  const page=object(await response.json()),result=items(page.items);
  assert.deepEqual(result.map(item=>({kind:item.kind,id:item.id})),[{kind:'ticket',id:target.ticket.id}]);
  assert.equal(page.next_cursor,null,'an equally matching hidden Ticket cannot create a continuation');
  assert.equal(object(page.criteria).q,query);
  assert.ok(!Object.hasOwn(page,'total_count')&&!Object.hasOwn(page,'hidden_count')&&!Object.hasOwn(page,'matches'));
  assert.ok(!JSON.stringify(page).includes(hidden.ticket.id));
 });
});
