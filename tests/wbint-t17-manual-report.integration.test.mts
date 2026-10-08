import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
interface Fixture {origin:string;cookies:string[]}
function object(value:unknown):Record<string,unknown>{assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}

test('authorized staff admits a telephone fault with unknown location and an unverified real reporter while directory is unavailable',async()=>{
  await withWeb01Fixture(async({origin,cookies}:Fixture)=>{
    const bootstrap=await (await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie:cookies[0]}})).json() as {csrf_token:string};
    const command={schema_version:1,client_command_id:randomUUID(),source:'PHONE',description:'合成电话报修：打印机无法打印',location:{text:null,unknown:true},reporter:{verification:'UNVERIFIED',name:'合成报修人',contact:'内线1234',department:'合成科室'}};
    const response=await fetch(origin+'/api/workbench/reports',{method:'POST',headers:{cookie:cookies[0],origin,'content-type':'application/json','idempotency-key':command.client_command_id,'x-csrf-token':bootstrap.csrf_token},body:JSON.stringify(command)});
    assert.equal(response.status,202);const result=object(await response.json());
    assert.equal(result.manual_contact_required,true);assert.equal(result.external_notification,false);
    assert.equal(result.reporter_verification,'UNVERIFIED');assert.equal(result.source,'PHONE');assert.equal(object(result.ticket).status,'QUEUED');
  },{workbenchManualReportsEnabled:true});
});
