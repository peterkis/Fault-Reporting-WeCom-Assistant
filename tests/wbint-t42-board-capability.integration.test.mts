import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {P2016EnabledRuntime} from '../src/p2-016-runtime.mjs';

test('T42 current bootstrap is default false; explicit opt-in advertises only existing enabled actions and never writes a command',{timeout:240000},async()=>{
  for(const enabled of [false,true]){
    const options={ticketSelfHandlingEnabled:true,ticketSelfHandlingWebSource:true,workbenchBoardActionsEnabled:enabled};
    await withWeb01Fixture(async({origin,cookies,runtime}:{origin:string;cookies:string[];runtime:P2016EnabledRuntime})=>{
      const writes:string[]=[];runtime.server.on('request',request=>{if(request.method==='POST')writes.push(request.url??'');});
      const cookie=cookies[0];assert.ok(cookie);
      const bootstrap=await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie}});assert.equal(bootstrap.status,200);
      const value:unknown=await bootstrap.json();assert.ok(value&&typeof value==='object'&&'board_actions_enabled' in value);assert.equal(value.board_actions_enabled,enabled);
      const board=await fetch(origin+'/api/workbench/board?column=pending',{headers:{cookie}});assert.equal(board.status,200);
      assert.deepEqual(writes,[],'capability and official board reads are not business commands');
    },options);
  }
});
