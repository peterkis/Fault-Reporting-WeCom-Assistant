import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createPilotTicketCore} from '../app/server/src/p1-005-pilot-ticket-core.mjs';

type Fixture={tickets:{ticket:{id:string}}[];principals:{id:string}[];origin:string;cookies:string[]};
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
function attention(item:Record<string,unknown>){
  assert.ok(item.attention&&typeof item.attention==='object'&&!Array.isArray(item.attention),'enabled detail exposes the caller follow state before an explicit command');
  const value=object(item.attention);
  assert.deepEqual(Object.keys(value).sort(),['follow_version','following','related_reasons']);
  assert.equal(typeof value.following,'boolean');
  assert.match(text(value.follow_version),/^[a-f0-9]{64}$/u);
  assert.ok(Array.isArray(value.related_reasons));
  return value;
}

test('explicit follow adds a visible unassigned ticket to my related board and replay preserves the same follow version',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    const target=context.tickets[1],principal=context.principals[1],cookie=context.cookies[2];
    assert.ok(target&&principal&&cookie);
    const get=async(path:string)=>{const response=await fetch(context.origin+path,{headers:{cookie}});return {status:response.status,value:object(await response.json())};};
    const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);
    assert.equal(bootstrap.value.principal_id,principal.id);
    const ticketPath='/api/tickets/'+target.ticket.id,detailPath='/api/workbench/items/ticket/'+target.ticket.id;
    const beforeTicket=await get(ticketPath);assert.equal(beforeTicket.status,200);assert.equal(beforeTicket.value.assignee_id,null);
    const team=await get('/api/workbench/board?column=pending');assert.equal(team.status,200);
    assert.ok(rows(team.value.items).some(item=>item.id===target.ticket.id));
    const relatedBefore=await get('/api/workbench/board?column=pending&scope=related');assert.equal(relatedBefore.status,200);
    assert.ok(rows(relatedBefore.value.items).every(item=>item.id!==target.ticket.id));
    const mineBefore=await get('/api/tickets?state=mine');assert.equal(mineBefore.status,200);
    assert.ok(rows(mineBefore.value.items).every(item=>item.id!==target.ticket.id));

    const firstDetail=await get(detailPath);assert.equal(firstDetail.status,200);
    const initialItem=object(firstDetail.value.item);assert.equal(initialItem.kind,'ticket');assert.equal(initialItem.id,target.ticket.id);
    // Prepared next public RED: the query-only slice does not yet expose attention.
    const initialAttention=attention(initialItem);assert.equal(initialAttention.following,false);assert.deepEqual(initialAttention.related_reasons,[]);
    const secondDetail=await get(detailPath);assert.equal(secondDetail.status,200);
    assert.deepEqual(attention(object(secondDetail.value.item)),initialAttention,'reading the same visible item does not create follow state');
    const canonical={kind:text(initialItem.kind),id:text(initialItem.id)};
    const command={client_command_id:randomUUID(),canonical_item:canonical,expected_follow_version:text(initialAttention.follow_version),following:true};
    const headers={cookie,origin:context.origin,'content-type':'application/json','x-csrf-token':text(bootstrap.value.csrf_token),'idempotency-key':command.client_command_id,'if-match':'"'+command.expected_follow_version+'"'};
    const post=async()=>{const response=await fetch(context.origin+detailPath+'/follow',{method:'POST',headers,body:JSON.stringify(command)});return {status:response.status,value:object(await response.json())};};
    const committed=await post();assert.equal(committed.status,200,JSON.stringify(committed.value));
    assert.equal(committed.value.ok,true);assert.equal(committed.value.replayed,false);assert.equal(committed.value.following,true);
    assert.equal(committed.value.client_command_id,command.client_command_id);
    assert.deepEqual(committed.value.requested_item,canonical);assert.deepEqual(committed.value.canonical_item,canonical);
    const committedVersion=text(committed.value.follow_version);assert.match(committedVersion,/^[a-f0-9]{64}$/u);assert.notEqual(committedVersion,initialAttention.follow_version);
    const afterDetail=await get(detailPath);assert.equal(afterDetail.status,200);
    const afterAttention=attention(object(afterDetail.value.item));
    assert.deepEqual(afterAttention,{following:true,follow_version:committedVersion,related_reasons:['FOLLOW']});
    const relatedAfter=await get('/api/workbench/board?column=pending&scope=related');assert.equal(relatedAfter.status,200);
    const selected=rows(relatedAfter.value.items).filter(item=>item.kind==='ticket'&&item.id===target.ticket.id);
    assert.equal(selected.length,1);const selectedItem=selected[0];assert.ok(selectedItem);assert.deepEqual(attention(selectedItem),afterAttention);
    const afterTicket=await get(ticketPath);assert.equal(afterTicket.status,200);
    for(const field of ['assignee_id','status','version'])assert.equal(afterTicket.value[field],beforeTicket.value[field],'follow does not alter Ticket '+field);
    const mineAfter=await get('/api/tickets?state=mine');assert.equal(mineAfter.status,200);
    assert.ok(rows(mineAfter.value.items).every(item=>item.id!==target.ticket.id));

    const replay=await post();assert.equal(replay.status,200,JSON.stringify(replay.value));
    assert.deepEqual(replay.value,{...committed.value,replayed:true},'replay uses the original UUID, payload and If-Match');
    const replayDetail=await get(detailPath);assert.equal(replayDetail.status,200);
    assert.deepEqual(attention(object(replayDetail.value.item)),afterAttention);
    const replayBoard=await get('/api/workbench/board?column=pending&scope=related');assert.equal(replayBoard.status,200);
    assert.equal(rows(replayBoard.value.items).filter(item=>item.kind==='ticket'&&item.id===target.ticket.id).length,1);
  },{workbenchFollowEnabled:true,manualProjection:true,chronologicalTicketEvents:true});
});

test('board projection keeps SQL count bounded for 1, 10 and 50 cards and rechecks READ after the page wait',async t=>{
  await withWeb01Fixture(async(context:Fixture&{pool:PostgresPool})=>{
    const pool=context.pool,core=createPilotTicketCore({pool}),cookie=context.cookies[2],principal=context.principals[1];
    assert.ok(cookie&&principal);
    for(let index=0;index<50;index++){
      const intake=await seedPersistedIntake({pool,text:'整页投影的隔离合成报修 '+index,requestType:'INCIDENT',status:'RECEIVED'});
      await core.createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'board-batch-regression'});
    }
    const get=async(limit:number)=>{
      const response=await fetch(context.origin+'/api/workbench/board?column=pending&range=all&scope=team&limit='+limit,{headers:{cookie}});
      return {status:response.status,value:object(await response.json())};
    };
    const original=pool.query,samples:{limit:number;queries:number;http_ms:number}[]=[];
    let count=0,revokeAfterPage=false;
    pool.query=new Proxy(original,{apply(target,thisArg,args:unknown[]){
      count++;const result:unknown=Reflect.apply(target,thisArg,args);
      if(revokeAfterPage&&typeof args[0]==='string'&&args[0].includes(', ordered AS')){
        revokeAfterPage=false;
        return Promise.resolve(result).then(async value=>{
          await pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[principal.id]);
          return value;
        });
      }
      return result;
    }});
    try{
      for(const limit of [1,10,50]){
        count=0;const start=performance.now(),response=await get(limit);
        assert.equal(response.status,200,JSON.stringify(response.value));assert.equal(rows(response.value.items).length,limit);
        for(const item of rows(response.value.items))attention(item);
        samples.push({limit,queries:count,http_ms:performance.now()-start});
      }
      t.diagnostic('BOARD_BATCH_QUERY_COUNTS '+JSON.stringify(samples));
      assert.ok(Math.max(...samples.map(s=>s.queries))<=30,'bounded follow/schema/page queries');
      assert.ok(Math.max(...samples.map(s=>s.queries))-Math.min(...samples.map(s=>s.queries))<=2,'adding cards must not add database round trips');
      revokeAfterPage=true;const denied=await get(50);
      assert.equal(revokeAfterPage,false,'revocation follows the real initial page query');
      assert.equal(denied.status,404,'the final batch must reject cards whose READ was lost during a preceding wait');
      assert.equal(Object.hasOwn(denied.value,'items'),false);
    }finally{pool.query=original;}
  },{workbenchFollowEnabled:true,manualProjection:true,chronologicalTicketEvents:true});
});
