import {withWeb01Fixture,seedCard28Board} from './helpers/web01-workbench-fixture.mjs';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import type {PostgresPoolClient} from '../app/server/src/platform/postgres-pool.mjs';
import {closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
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

interface SearchJitSettings {jit:string;above_cost:string;inline_cost:string;optimize_cost:string;statement_timeout_ms:number;read_only:string;timezone:string}
const searchJitSettingsSql=`SELECT current_setting('jit') AS jit,current_setting('jit_above_cost') AS above_cost,
 current_setting('jit_inline_above_cost') AS inline_cost,current_setting('jit_optimize_above_cost') AS optimize_cost,
 (SELECT setting::integer FROM pg_settings WHERE name='statement_timeout') AS statement_timeout_ms,
 current_setting('transaction_read_only') AS read_only,current_setting('TimeZone') AS timezone`;
async function searchJitSettings(client:PostgresPoolClient){const value=(await client.query<SearchJitSettings>(searchJitSettingsSql)).rows[0];assert.ok(value);return value;}
async function restoreSearchJit(client:PostgresPoolClient,value:SearchJitSettings){
 await client.query("SELECT set_config('jit',$1,false),set_config('jit_above_cost',$2,false),set_config('jit_inline_above_cost',$3,false),set_config('jit_optimize_above_cost',$4,false)",[value.jit,value.above_cost,value.inline_cost,value.optimize_cost]);
}

test('T41 bounded Card28 dismissal and unassigned searches survive session JIT with forced low compilation thresholds',{timeout:240000},async()=>{
 await withWeb01Fixture(async(f:T11Fixture)=>{
  const seeded=await seedCard28Board(f),originalConnect=f.pool.connect;
  const providerAvailability:boolean[]=[],observed:{query:string;phase:string;guc:SearchJitSettings}[]=[],afterTransactions:SearchJitSettings[]=[];
  let currentQuery='',failure:unknown;
  // The actual borrowed query sessions enter with JIT enabled and low thresholds.
  // Only transaction consumers are wrapped; ordinary public projection reads retain their baseline settings.
  f.pool.connect=new Proxy(originalConnect,{apply(target,receiver,args:unknown[]){
   if(args.length)return Reflect.apply(target,receiver,args);
   return Reflect.apply(target,receiver,args).then(async(client:PostgresPoolClient)=>{
    let baseline:SearchJitSettings;
    try{baseline=await searchJitSettings(client);}catch(error){client.release();throw error;}
    let readQuery=false;
    try{
     await client.query("SELECT set_config('jit','on',false),set_config('jit_above_cost','0',false),set_config('jit_inline_above_cost','0',false),set_config('jit_optimize_above_cost','0',false)");
     const provider=(await client.query<{available:boolean}>('SELECT pg_jit_available() AS available')).rows[0];assert.ok(provider);assert.equal(typeof provider.available,'boolean');providerAvailability.push(provider.available);
    }catch(error){try{await restoreSearchJit(client,baseline);}finally{client.release();}throw error;}
    return new Proxy(client,{get(value,key){
     if(key==='query')return new Proxy(client.query,{apply:async(execute,_this,queryArgs:unknown[])=>{
      const sql=typeof queryArgs[0]==='string'?queryArgs[0].trim():'';
      if(sql.startsWith('WITH cards AS MATERIALIZED')&&sql.includes('matched AS MATERIALIZED')){
       readQuery=true;observed.push({query:currentQuery,phase:sql.includes('AS session_valid')?'final':'prepare',guc:await searchJitSettings(client)});
      }
      const result:unknown=await Reflect.apply(execute,client,queryArgs);
      if(sql==='COMMIT'||sql==='ROLLBACK'){
       try{if(readQuery)afterTransactions.push(await searchJitSettings(client));}finally{await restoreSearchJit(client,baseline);}
      }
      return result;
     }});
     const property:unknown=Reflect.get(value,key);return typeof property==='function'?property.bind(value):property;
    }});
   });
  }});
  try{
   const cookie=f.cookies[0];assert.ok(cookie);
   const cases=[
    {name:'dismissed-all',query:'column=closed&range=all&closure_kind=dismissed&limit=100',ids:[seeded.manual,seeded.duplicate,seeded.unknown,seeded.historical,seeded.system,seeded.duplicateWith]},
    {name:'pending-unassigned',query:'column=pending&range=all&responsibility=unassigned&limit=100',ids:seeded.pending},
   ];
   for(const sample of cases){
    currentQuery=sample.name;const start=observed.length;
    const response=await fetch(f.origin+'/api/workbench/search?'+sample.query,{headers:{cookie,connection:'close'},signal:AbortSignal.timeout(15000)});
    assert.equal(response.status,200,await response.clone().text());const page=object(await response.json()),found=rows(page.items);
    assert.deepEqual(found.map(item=>String(item.id)).sort(),[...sample.ids].sort());assert.equal(page.next_cursor,null);
    assert.equal(Object.hasOwn(page,'total'),false);assert.equal(Object.hasOwn(page,'hidden_count'),false);
    if(sample.name==='dismissed-all')assert.ok(found.every(item=>object(item.closure).kind==='DISMISSED'));
    else assert.ok(found.every(item=>item.kind==='ticket'&&item.column==='pending'));
    assert.deepEqual(observed.slice(start).map(item=>item.phase),['prepare','final'],'both real bounded data phases execute for each HTTP shape');
   }
   assert.equal(afterTransactions.length,4);
  }catch(error){failure=error;}
  await closeBrowserTestResources([
   ()=>{f.pool.connect=originalConnect;seeded.restore();},
   ()=>console.log('T41_JIT_BOUNDED_SEARCH '+JSON.stringify({provider_available_with_session_jit_on:providerAvailability,node_timezone:process.env.TZ??null,observed,after_transactions:afterTransactions,original_business_assertions_preserved:true,live_provider_calls:0})),
  ],failure);
 },{manualProjection:true,precisionV212:true,ticketSelfHandlingEnabled:true,workbenchSearchEnabled:true,workbenchBoardActionsEnabled:true});
});
