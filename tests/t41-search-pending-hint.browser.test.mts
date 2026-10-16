import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {tmpdir} from 'node:os';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {createP2016TicketCommandFacade} from '../src/p2-016-ticket-command-facade.mjs';
import {object} from './helpers/t41-search-risk-fixture.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import type {P2016EnabledRuntime} from '../src/p2-016-runtime.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface Fixture {pool:PostgresPool;runtime:P2016EnabledRuntime;origin:string;backendOrigin:string;certificateSpki:string;
 cookies:string[];browserCookies:NonNullable<Parameters<typeof launchSystemBrowser>[0]['cookies']>;
 principals:{id:string;wecom_user_id:string;display_name:string}[];tickets:{ticket:{id:string}}[]}
async function read(f:Fixture,path:string){const response=await fetch(f.backendOrigin+path,{headers:{cookie:f.cookies[0]??''},signal:AbortSignal.timeout(15000)});return {status:response.status,body:object(await response.json())};}
async function waitFor(predicate:()=>boolean,message:string){const until=performance.now()+10000;while(!predicate()&&performance.now()<until)await delay(20);assert.ok(predicate(),message);}

for(const scenario of ['initial','reset'] as const)test('T41 real hint fences a held '+scenario+' search with no cached data',{timeout:120000},async()=>{
 assert.match(tmpdir(),/^D:[\\/]/iu,'owned TLS/browser resources require D temp before fixture creation');
 await withWeb01Fixture(async(f:Fixture)=>{
  const actor=f.principals[0],admin=f.principals[1],target=f.principals[3],ticket=f.tickets[5],other=f.tickets[0];assert.ok(actor&&admin&&target&&ticket&&other);
  const access=createPilotAccessService({pool:f.pool});
  await f.pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES('T41_HINT_B','T41 hint target B')");
  for(const [principal,roles,teams]of [[actor,['HANDLER'],['PILOT_IT']],[admin,['ADMIN'],['PILOT_IT']],[target,['HANDLER'],['T41_HINT_B']]] as const)
   await access.upsertPrincipal({wecomUserId:principal.wecom_user_id,displayName:principal.display_name,roles:[...roles],resolverTeamIds:[...teams]});
  const before=await read(f,'/api/lifecycle/bootstrap');assert.equal(before.status,200);
  const initial=await read(f,'/api/workbench/items/ticket/'+ticket.ticket.id);assert.equal(initial.status,200);
  let holdNext=false,release:(()=>void)|undefined,heldContainsTarget=false,hints=0,searches=0,automaticPosts=0;
  const observe=(request:IncomingMessage,response:ServerResponse)=>{
   const path=new URL(request.url??'/',f.origin).pathname;
   if(request.method==='POST')automaticPosts++;
   if(path==='/api/realtime/events')response.write=new Proxy(response.write,{apply(write,receiver,args:unknown[]){
    const chunk=args[0],text=typeof chunk==='string'?chunk:Buffer.isBuffer(chunk)?chunk.toString('utf8'):'';
    if(/event:\s*ticket\.(?:updated|assignment\.changed|command\.committed)/u.test(text))hints++;
    return Reflect.apply(write,receiver,args);
   }});
   if(path!=='/api/workbench/search')return;searches++;
   response.end=new Proxy(response.end,{apply(end,receiver,args:unknown[]){
    if(holdNext&&response.statusCode===200){
     holdNext=false;const raw=args[0],body=typeof raw==='string'?raw:Buffer.isBuffer(raw)?raw.toString('utf8'):'';
     heldContainsTarget=body.includes(ticket.ticket.id);release=()=>{Reflect.apply(end,receiver,args);};return response;
    }return Reflect.apply(end,receiver,args);
   }});
  };f.runtime.server.on('request',observe);
  let browser:Browser|undefined,primary:unknown;
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1280,height:900,cookies:f.browserCookies,certificateSpki:f.certificateSpki});assert.ok(browser);
   await browser.waitFor('document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus==="live"');
   if(scenario==='reset'){
    await browser.evaluate('document.querySelector("a.sidebar-search").click()');
    await browser.waitFor('Boolean(document.querySelector("article[data-item-id=\\"'+ticket.ticket.id+'\\"]"))');
   }
   holdNext=true;
   await browser.evaluate(scenario==='initial'?'document.querySelector("a.sidebar-search").click()':'[...document.querySelectorAll(".toolbar button")].find(button=>button.textContent.trim()==="刷新").click()');
   await waitFor(()=>release!==undefined,'the real successful search response must be held after its final server checks');assert.equal(heldContainsTarget,true);
   await browser.waitFor('new URL(location.href).searchParams.get("search")==="1"&&!document.querySelector("article[data-kind=ticket]")');
   const commands=createP2016TicketCommandFacade({pool:f.pool,enabled:true,realtimeProjector:f.runtime.realtimeProjector.ticket});
   const command={action:'transfer-assignment',ticket_id:ticket.ticket.id,client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_TRANSFER',target_principal_id:target.id,resolver_team_id:'T41_HINT_B'};
   assert.equal((await commands.perform({authContext:{principal_id:admin.id},command})).ok,true);
   const denied=await read(f,'/api/workbench/items/ticket/'+ticket.ticket.id);assert.equal(denied.status,404);
   const current=await read(f,'/api/lifecycle/bootstrap');assert.equal(current.status,200);
   assert.deepEqual([current.body.principal_id,current.body.roles,current.body.authorization_revision],[before.body.principal_id,before.body.roles,before.body.authorization_revision],'item READ loss must not be hidden by a changed identity/role/team epoch');
   const priorHints=hints;
   // A still-readable Ticket supplies an actual durable SSE hint after the
   // transfer. No EventSource event or successful fact response is fabricated.
   assert.equal((await commands.perform({authContext:{principal_id:admin.id},command:{action:'add-note',ticket_id:other.ticket.id,client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_INTERNAL_NOTE',note:'T41 real pending-search hint',external_visible:false}})).ok,true);
   await waitFor(()=>hints>priorHints,'the production stream must actually write the committed authorized hint');
   await browser.waitFor('Boolean(document.querySelector("[data-search-state=error]"))');
   assert.ok(release);release();release=undefined;
   await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
   assert.equal(await browser.evaluate('Boolean(document.querySelector("article[data-item-id=\\"'+ticket.ticket.id+'\\"]"))'),false);
   assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-search-state=error]"))'),true);
   const count=searches,start=await browser.evaluate('performance.now()');assert.ok(typeof start==='number');
   await browser.waitFor('performance.now()-'+start+'>6000',{timeoutMs:10000,intervalMs:50});
   assert.equal(searches,count,'a hint and periodic T38 reads must not automatically restart search');assert.equal(automaticPosts,0);
   console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_TLS_HTTP_PG',pending_search:scenario,real_hint:true,held_get_fenced:true,automatic_posts:0,screenshots:[]}));
  }catch(error){primary=error;}
  finally{release?.();f.runtime.server.off('request',observe);await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],primary);}
 },{realWorkbenchAuthentication:true,workbenchRealtimeEnabled:true,workbenchSearchEnabled:true});
});
