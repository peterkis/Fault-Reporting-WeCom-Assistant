import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createWorkbenchActivity} from '../app/server/src/workbench-activity.mjs';
import type {WorkbenchActivityTarget} from '../contracts/workbench_activity_contracts.js';
function service(){
  return createWorkbenchActivity({enabled:true,now:()=>100000,authorize:async auth=>{
    assert.ok(auth&&typeof auth==='object'&&'principal_id'in auth&&typeof auth.principal_id==='string'&&'csrf_token'in auth&&typeof auth.csrf_token==='string');
    return {principal_id:auth.principal_id,display_name:'合成获权同事',binding:auth.principal_id+':'+auth.csrf_token};
  }});
}
const identity=()=>({principal_id:randomUUID(),csrf_token:randomUUID(),session_id:randomUUID()});
const target=():WorkbenchActivityTarget=>({kind:'ticket',id:randomUUID()});
test('one App accepts its bounded64 browsers and128 leases, then rejects additional allocations',async t=>{
  const activity=service();t.after(()=>activity.close());
  let last:ReturnType<typeof identity>|undefined,lastBrowser:string|undefined;
  for(let principal=0;principal<16;principal++){
    const auth=identity();
    for(let tab=0;tab<4;tab++){
      const browser=randomUUID();
      for(let object=0;object<2;object++){
        const result=await activity.perform({authContext:auth,body:{schema_version:1,browser_id:browser,action:'RENEW',target:target(),visible:true,active:true,mode:'VIEWING',field:null}});
        assert.equal(result.expires_epoch_ms,'115000');
      }
      last=auth;lastBrowser=browser;
    }
  }
  await assert.rejects(activity.perform({authContext:identity(),body:{schema_version:1,browser_id:randomUUID(),action:'RENEW',target:target(),visible:true,active:true,mode:'VIEWING',field:null}}),{status:503});
  assert.ok(last&&lastBrowser);
  await assert.rejects(activity.perform({authContext:last,body:{schema_version:1,browser_id:lastBrowser,action:'RENEW',target:target(),visible:true,active:true,mode:'VIEWING',field:null}}),{status:503});
  activity.close();await assert.rejects(activity.view(last,target()),{status:503});
});
test('an object admits16 authorized leases, omits self and never leaks a seventeenth person',async t=>{
  const activity=service(),item=target(),principals:ReturnType<typeof identity>[]=[];t.after(()=>activity.close());
  for(let i=0;i<16;i++){
    const auth=identity();principals.push(auth);
    await activity.perform({authContext:auth,body:{schema_version:1,browser_id:randomUUID(),action:'RENEW',target:item,visible:true,active:true,mode:'VIEWING',field:null}});
  }
  const viewer=identity();assert.equal((await activity.view(viewer,item)).people.length,16);
  const first=principals[0];assert.ok(first);assert.equal((await activity.view(first,item)).people.length,15);
  await assert.rejects(activity.perform({authContext:viewer,body:{schema_version:1,browser_id:randomUUID(),action:'RENEW',target:item,visible:true,active:true,mode:'VIEWING',field:null}}),{status:503});
  assert.equal((await activity.view(viewer,item)).people.length,16);
});
