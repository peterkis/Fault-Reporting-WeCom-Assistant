import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {tmpdir} from 'node:os';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {object} from './helpers/t41-search-risk-fixture.mjs';
import type {PostgresPool,PostgresPoolClient} from '../app/server/src/platform/postgres-pool.mjs';

interface Fixture {pool:PostgresPool;origin:string;backendOrigin:string;cookies:string[];
 principals:{id:string;wecom_user_id:string;display_name:string}[];tickets:{ticket:{id:string}}[]}
function request(f:Fixture,path:string){return fetch(f.backendOrigin+path,{headers:{cookie:f.cookies[0]??''},signal:AbortSignal.timeout(15000)});}

test('T41 final schema wait cannot retain a former sole-team READ scope in a real Cookie search',async()=>{
 assert.match(tmpdir(),/^D:[\\/]/iu,'owned TLS fixture requires D temp before creating resources');
 await withWeb01Fixture(async(f:Fixture)=>{
  const actor=f.principals[0],first=f.tickets[0];assert.ok(actor&&first);
  let acquired=0,released=0;
  const trace=(stage:string,details:Record<string,unknown>={})=>console.log('T41_FINAL_SCOPE_STATE '+JSON.stringify({stage,acquired,released,pool:{total:f.pool.totalCount,idle:f.pool.idleCount,waiting:f.pool.waitingCount},...details}));
  trace('FIXTURE_READY');
  const access=createPilotAccessService({pool:f.pool});
  await access.upsertPrincipal({wecomUserId:actor.wecom_user_id,displayName:actor.display_name,roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
  trace('INITIAL_ROLE_COMMITTED');
  const path='/api/workbench/items/ticket/'+first.ticket.id,before=await request(f,path);assert.equal(before.status,200);
  const item=object(object(await before.json()).item);assert.ok(typeof item.number==='string');
  trace('INITIAL_ITEM_VISIBLE');
  const ticketSql='SELECT version::text,updated_at::text,assignee_id::text,resolver_team_id FROM pilot_ticket.ticket WHERE id=$1::uuid';
  const originalTicket=(await f.pool.query(ticketSql,[first.ticket.id])).rows;
  let release:()=>void=()=>{},readinessReached=false,readTransactions=0;
  const held=new Promise<void>(resolve=>{release=resolve;});
  const original=f.pool.connect;
  // Delay only the return of a genuine readiness query in the final READ-only
  // transaction. All authentication, SQL results and public HTTP stay real.
  f.pool.connect=new Proxy(original,{apply(target,thisArg,args:unknown[]){
   if(args.length)return Reflect.apply(target,thisArg,args);
   return Reflect.apply(target,thisArg,args).then((client:PostgresPoolClient)=>{
    const lease=++acquired,rawPid:unknown=Reflect.get(client,'processID'),backendPid=typeof rawPid==='number'?rawPid:null;
    trace('CONNECTION_ACQUIRED',{lease,backend_pid:backendPid});
    let readTransaction=0;
    const query=new Proxy(client.query,{apply(execute,_receiver,queryArgs:unknown[]){
     const sql=typeof queryArgs[0]==='string'?queryArgs[0]:'';
     if(sql==='SET TRANSACTION READ ONLY'){readTransaction=++readTransactions;trace('READ_TRANSACTION_OPEN',{lease,backend_pid:backendPid,read_transaction:readTransaction});}
     const result=Reflect.apply(execute,client,queryArgs);
     if(readTransaction===2&&sql.includes("'042_workbench_manual_reports'"))return Promise.resolve(result).then(value=>{readinessReached=true;trace('SCHEMA_RESULT_HELD',{lease,backend_pid:backendPid,read_transaction:readTransaction});return held.then(()=>value);});
     return result;
    }});
    // The projector validates data properties on the real client, including release.
    // Retain that identity while holding only this lease's genuine query result.
    const originalQuery=client.query,originalRelease=client.release;
    client.query=query;
    client.release=(...releaseArgs:Parameters<PostgresPoolClient['release']>)=>{
     trace('CONNECTION_RELEASE_REQUESTED',{lease,backend_pid:backendPid});
     client.query=originalQuery;client.release=originalRelease;
     const result=Reflect.apply(originalRelease,client,releaseArgs);released++;trace('CONNECTION_RELEASED',{lease,backend_pid:backendPid});return result;
    };
    return client;
   });
  }});
  let pending:Promise<Response>|undefined;
  try{
   pending=request(f,'/api/workbench/search?column=all&range=all&q='+encodeURIComponent(item.number));void pending.catch(()=>undefined);
   const until=performance.now()+5000;while(!readinessReached&&performance.now()<until)await delay(20);
   assert.equal(readinessReached,true,'the final real readiness query was not reached');
   trace('MEMBERSHIP_CHANGE_START');
   await access.upsertPrincipal({wecomUserId:actor.wecom_user_id,displayName:actor.display_name,roles:['HANDLER'],resolverTeamIds:[]});
   trace('MEMBERSHIP_CHANGE_COMMITTED');
   assert.deepEqual((await f.pool.query(ticketSql,[first.ticket.id])).rows,originalTicket,'only current membership changes; the Ticket and projection input remain unchanged');
   const current=await request(f,path);assert.equal(current.status,404,await current.clone().text());await current.arrayBuffer();
   trace('PUBLIC_ITEM_REFUSED');
   release();const denied=await pending;assert.equal(denied.status,400,await denied.clone().text());
   const body=object(await denied.json());assert.equal(object(body.error).code,'P2_016_CURSOR_INVALID');
   assert.equal(Object.hasOwn(body,'items'),false);assert.equal(Object.hasOwn(body,'next_cursor'),false);
   trace('FINAL_SCOPE_REFUSED');
  }finally{release();await pending?.catch(()=>undefined);f.pool.connect=original;trace('TEST_FINALLY_COMPLETED');}
 },{realWorkbenchAuthentication:true,workbenchSearchEnabled:true,workbenchManualReportsEnabled:true});
 console.log('T41_FINAL_SCOPE_STATE '+JSON.stringify({stage:'FIXTURE_CLOSED'}));
});
