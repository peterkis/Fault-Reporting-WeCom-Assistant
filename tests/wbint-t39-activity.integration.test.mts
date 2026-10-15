import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {WorkbenchActivityCommand} from '../contracts/workbench_activity_contracts.js';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';

interface ActivityFixture {
  origin: string;
  cookies: string[];
  tickets: {ticket: {id: string}}[];
}

test('a currently authorized visible viewing lease is shown to another authorized colleague through real staff HTTP',async()=>{
  await withWeb01Fixture(async({origin,cookies,tickets}:ActivityFixture)=>{
    const ticket=tickets[0]?.ticket;
    assert.ok(ticket);
    const actorCookie=cookies[0],colleagueCookie=cookies[2];
    assert.ok(actorCookie&&colleagueCookie);
    const target={kind:'ticket',id:ticket.id} as const;
    const detailPath='/api/workbench/items/ticket/'+ticket.id;
    // Prove both real object reads before attempting the new behavior. No private authority seam.
    for(const cookie of [actorCookie,colleagueCookie]){
      const detail=await fetch(origin+detailPath,{headers:{cookie}});
      await detail.arrayBuffer();
      assert.equal(detail.status,200,'the activity scenario must begin with two currently authorized real detail reads');
    }
    const bootstrapResponse=await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie:actorCookie}});
    const bootstrap:unknown=await bootstrapResponse.json();
    assert.equal(bootstrapResponse.status,200);
    assert.ok(bootstrap!==null&&typeof bootstrap==='object'&&'csrf_token' in bootstrap);
    assert.equal(typeof bootstrap.csrf_token,'string');
    assert.ok(typeof bootstrap.csrf_token==='string'&&bootstrap.csrf_token.length>0);
    const command:WorkbenchActivityCommand={schema_version:1,browser_id:randomUUID(),action:'RENEW',target,visible:true,active:true,mode:'VIEWING',field:null};
    const renewed=await fetch(origin+'/api/workbench/activity',{
      method:'POST',headers:{cookie:actorCookie,origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token},body:JSON.stringify(command),
    });
    const receipt:unknown=await renewed.json();
    assert.equal(renewed.status,200,'an authorized visible activity must be accepted at the actual staff HTTP boundary');
    assert.ok(receipt!==null&&typeof receipt==='object'&&'expires_epoch_ms' in receipt);
    assert.ok(typeof receipt.expires_epoch_ms==='string');
    assert.match(receipt.expires_epoch_ms,/^[1-9][0-9]*$/u);
    assert.deepEqual(Object.keys(receipt).sort(),['accepted','expires_epoch_ms','schema_version']);
    const colleagueView=await fetch(origin+detailPath+'/activity',{headers:{cookie:colleagueCookie}});
    const view:unknown=await colleagueView.json();
    assert.equal(colleagueView.status,200);
    assert.deepEqual(view,{schema_version:1,people:[{display_name:'林舟',mode:'VIEWING',expires_epoch_ms:receipt.expires_epoch_ms}]},
      'the current authorized activity projection exposes only the safe colleague name, mode and bounded expiry');
  },{workbenchRealtimeEnabled:true,workbenchActivityEnabled:true,manualProjection:true});
});
