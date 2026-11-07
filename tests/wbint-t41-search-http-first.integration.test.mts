import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT41SearchFixture} from './helpers/t41-search-fixture.mjs';
import {withWeb01Fixture,seedCard27Board} from './helpers/web01-workbench-fixture.mjs';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import type {WorkbenchSearchCriteria} from '../contracts/workbench_search_contracts.js';

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

test('B5 custom closure dates use inclusive Shanghai days before READ-safe pagination and bind both dates to the original cursor',{timeout:240000},()=>withWeb01Fixture(async(f:T11Fixture)=>{
 const seeded=await seedCard27Board(f),lower=f.tickets[9],lastDay=f.tickets[10],upper=f.tickets[11],resolved=f.tickets[12];
 assert.ok(lower&&lastDay&&upper&&resolved);
 const from='2026-02-28',to='2026-03-01',until='2026-03-02 00:00:00';
 // The existing fixture's events supply the only synthetic closing facts.
 const closingEvents:readonly (readonly [string,string])[]=[[seeded.manual,from+' 00:00:00'],[seeded.duplicate,to+' 23:59:59'],[seeded.historical,'2026-02-27 23:59:59'],
  [lower.ticket.id,from+' 00:00:00'],[lastDay.ticket.id,to+' 23:59:59'],[upper.ticket.id,until]];
 for(const [id,at]of closingEvents){
  await f.pool.query("UPDATE pilot_ticket.ticket_event SET created_at=$2::timestamp WHERE ticket_id=$1::uuid AND event_type IN ('ticket.closed','ticket.cancelled','ticket.duplicate_linked')",[id,at]);
 }
 await f.pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES('B5_DATES_HIDDEN','B5日期不可读组（合成）')");
 await f.pool.query("UPDATE pilot_ticket.ticket SET resolver_team_id='B5_DATES_HIDDEN',assignee_id=NULL WHERE id=$1::uuid",[lower.ticket.id]);
 const facts=async()=>({tickets:(await f.pool.query('SELECT id::text,status,version,resolver_team_id,assignee_id::text FROM pilot_ticket.ticket ORDER BY id')).rows,
  ticketEvents:(await f.pool.query('SELECT count(*)::integer AS count FROM pilot_ticket.ticket_event')).rows,
  intakes:(await f.pool.query('SELECT id::text,status,pilot_ticket_id::text FROM intake.service_intake ORDER BY id')).rows,
  intakeEvents:(await f.pool.query('SELECT count(*)::integer AS count FROM intake.service_intake_event')).rows});
 const before=await facts();
 const get=(path:string,index=0)=>{const cookie=f.cookies[index];assert.ok(cookie);return fetch(f.origin+path,{headers:{cookie}});};
 const bootstrapResponse=await get('/api/lifecycle/bootstrap');assert.equal(bootstrapResponse.status,200);
 const csrf=object(await bootstrapResponse.json()).csrf_token;assert.ok(typeof csrf==='string');
 const post=(criteria:unknown,cursor:string|null=null,limit=100)=>fetch(f.origin+'/api/workbench/search',{method:'POST',headers:{cookie:f.cookies[0]??'',origin:f.origin,'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({criteria,cursor,limit})});
 const path=(extra:Record<string,string>={})=>'/api/workbench/search?'+new URLSearchParams({column:'closed',range:'custom',closed_from:from,closed_to:to,limit:'100',...extra});
 let ratedRequests=0;
 const read=async(url:string,index=0)=>{const response=await get(url,index);assert.equal(response.status,200,await response.clone().text());if(index===0)ratedRequests++;return object(await response.json());};
 const ids=(page:Record<string,unknown>)=>items(page.items).map(item=>{assert.ok(typeof item.id==='string');return item.id;}).sort();
 const expectedCompleted=[lower.ticket.id,lastDay.ticket.id,resolved.ticket.id].sort(),expectedDismissed=[seeded.manual,seeded.duplicate].sort();
 const all=await read(path());assert.deepEqual(ids(all),[...expectedCompleted,...expectedDismissed].sort());
 assert.deepEqual(all.range,{mode:'custom',from:from+' 00:00:00',until,timezone:'Asia/Shanghai'});
 assert.equal(all.next_cursor,null);
 const completed=await read(path({closure_kind:'completed'}));assert.deepEqual(ids(completed),expectedCompleted);
 const resolvedItem=items(completed.items).find(item=>item.id===resolved.ticket.id);assert.ok(resolvedItem);assert.equal(resolvedItem.status,'RESOLVED');assert.equal(resolvedItem.completed_at,null,'custom dates preserve the existing unresolved-confirmation exception');
 const dismissed=await read(path({closure_kind:'dismissed'}));assert.deepEqual(ids(dismissed),expectedDismissed);
 assert.ok(items(dismissed.items).every(item=>object(item.closure).kind==='DISMISSED'));
 const criteria:WorkbenchSearchCriteria={q:'',column:'closed',range:'custom',scope:'team',responsibility:'any',resolver_team_id:null,assignee_id:null,
  sources:[],source_group_ref:null,statuses:[],supplement:'any',schedule:'any',closure_kind:'dismissed',closed_from:from,closed_to:to};
 assert.deepEqual(dismissed.criteria,criteria);
 const posted=await post(criteria);assert.equal(posted.status,200,await posted.clone().text());ratedRequests++;assert.deepEqual(await posted.json(),dismissed,'GET and read-only POST have the same exact date and closure result');
 const first=await read(path({closure_kind:'dismissed',limit:'1'}));assert.equal(items(first.items).length,1);assert.ok(typeof first.next_cursor==='string');
 const cursor=first.next_cursor,second=await read(path({closure_kind:'dismissed',limit:'1',cursor}));assert.equal(items(second.items).length,1);assert.equal(second.next_cursor,null);
 const paged=[...ids(first),...ids(second)];assert.equal(new Set(paged).size,2);assert.deepEqual(paged.sort(),expectedDismissed);
 const cursorChanges:Record<string,string>[]=[{closed_from:'2026-02-27'},{closed_to:'2026-03-02'},{closure_kind:'completed'}];
 for(const change of cursorChanges){
  const response=await get(path({closure_kind:'dismissed',limit:'1',cursor,...change}));ratedRequests++;assert.equal(response.status,400,await response.clone().text());
  const denied=object(await response.json());assert.equal(object(denied.error).code,'P2_016_CURSOR_INVALID');assert.equal(Object.hasOwn(denied,'items'),false);
 }
 const changedRange=await get('/api/workbench/search?'+new URLSearchParams({column:'closed',range:'all',closure_kind:'dismissed',cursor,limit:'1'}));ratedRequests++;
 assert.equal(changedRange.status,400,await changedRange.clone().text());assert.equal(object(object(await changedRange.json()).error).code,'P2_016_CURSOR_INVALID');
 const unrestricted=await read('/api/workbench/search?column=all&range=all&closure_kind=dismissed&limit=100');
 const unknown=items(unrestricted.items).find(item=>item.id===seeded.unknown);assert.ok(unknown);assert.equal(object(unknown.closure).closed_at,null);
 const currentCriteria=object(unrestricted.criteria);assert.equal(Object.hasOwn(currentCriteria,'closed_from'),false);assert.equal(Object.hasOwn(currentCriteria,'closed_to'),false);
 const mixed=await read(path({column:'all',closure_kind:'dismissed'}));
 const unfinished=(page:Record<string,unknown>)=>items(page.items).filter(item=>item.column!=='closed').map(item=>String(item.kind)+':'+String(item.id)).sort();
 assert.deepEqual(unfinished(mixed),unfinished(unrestricted),'only the processed column is restricted by dates and closure kind');
 assert.deepEqual(items(mixed.items).filter(item=>item.column==='closed').map(item=>String(item.id)).sort(),expectedDismissed);
 const leap=await read(path({closed_from:'2024-02-29',closed_to:'2024-02-29',closure_kind:'completed'}));
 assert.deepEqual(leap.range,{mode:'custom',from:'2024-02-29 00:00:00',until:'2024-03-01 00:00:00',timezone:'Asia/Shanghai'});assert.deepEqual(ids(leap),[resolved.ticket.id]);
 const hiddenDetail=await get('/api/workbench/items/ticket/'+lower.ticket.id,2);assert.equal(hiddenDetail.status,404);
 const hiddenNumber=items(all.items).find(item=>item.id===lower.ticket.id)?.number;assert.ok(typeof hiddenNumber==='string');
 const hidden=await read(path({q:hiddenNumber,closure_kind:'completed'}),2);assert.deepEqual(hidden.items,[]);assert.equal(hidden.next_cursor,null);assert.ok(!JSON.stringify(hidden).includes(lower.ticket.id));
 const invalid=[
  'column=closed&range=custom',
  'range=custom&closed_from=2026-02-28',
  'range=custom&closed_to=2026-03-01',
  'range=custom&closed_from=2026-02-29&closed_to=2026-03-01',
  'range=custom&closed_from=2026-2-28&closed_to=2026-03-01',
  'range=custom&closed_from=0000-01-01&closed_to=2026-03-01',
  'range=custom&closed_from=2026-03-02&closed_to=2026-03-01',
  'range=custom&closed_from=9999-12-30&closed_to=9999-12-31',
  'range=custom&closed_from=2026-02-28&closed_from=2026-02-27&closed_to=2026-03-01',
  'range=all&closed_from=2026-02-28&closed_to=2026-03-01',
  'range=recent&closed_from=',
  'range=cancelled',
 ];
 for(const query of invalid){const response=await get('/api/workbench/search?'+query);assert.equal(response.status,400,query);const body=object(await response.json());assert.equal(Object.hasOwn(body,'items'),false);}
 const {closed_from:omittedFrom,closed_to:omittedTo,...withoutDates}=criteria;assert.equal(omittedFrom,from);assert.equal(omittedTo,to);
 for(const body of [{...withoutDates},{...criteria,closed_from:null},{...criteria,closed_to:'2026-02-27'},{...criteria,range:'all'},
  {...withoutDates,range:'all',closed_from:null},{...criteria,closed_until:until}]){
  const response=await post(body);assert.equal(response.status,400,JSON.stringify(body));assert.equal(Object.hasOwn(object(await response.json()),'items'),false);
 }
 assert.ok(ratedRequests<20,'the synthetic scenario stays below the unchanged search rate budget');
 assert.deepEqual(await facts(),before,'GET and search POST preserve all Ticket and Intake business facts');
 console.log('B5_CUSTOM_SEARCH '+JSON.stringify({from,to,until,completed:expectedCompleted.length,dismissed:expectedDismissed.length,paged:2,ratedRequests,hiddenItems:0,writeChanges:0}));
},{precisionV212:true,ticketSelfHandlingEnabled:true,workbenchSearchEnabled:true}));
