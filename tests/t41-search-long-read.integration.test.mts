import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {object,rows} from './helpers/t41-search-risk-fixture.mjs';
import {parseSearchRequest,searchParameters} from '../shared/workbench-search-contracts.mjs';
import type {WorkbenchSearchRequest} from '../contracts/workbench_search_contracts.js';
interface Fixture {origin:string;cookies:string[];tickets:{ticket:{id:string}}[]}
test('T41 bounded read POST preserves GET criteria/results and rejects altered, illegal and oversize bodies',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const cookie=f.cookies[0];assert.ok(cookie);
  const bootstrap=await fetch(f.origin+'/api/lifecycle/bootstrap',{headers:{cookie}});assert.equal(bootstrap.status,200);
  const csrf=object(await bootstrap.json()).csrf_token;assert.ok(typeof csrf==='string');
  const post=(body:unknown,options:{csrf?:string;origin?:string}={})=>fetch(f.origin+'/api/workbench/search',{
   method:'POST',headers:{cookie,origin:options.origin??f.origin,'content-type':'application/json','x-csrf-token':options.csrf??csrf},
   body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const input=parseSearchRequest(new URLSearchParams('column=pending&limit=1'));
  const get=await fetch(f.origin+'/api/workbench/search?'+searchParameters(input.criteria)+'&limit=1',{headers:{cookie}});
  assert.equal(get.status,200);const original=object(await get.json());
  const response=await post(input);assert.equal(response.status,200,await response.clone().text());const same=object(await response.json());
  assert.deepEqual(rows(same.items),rows(original.items));assert.deepEqual(same.criteria,original.criteria);
  assert.ok(typeof original.next_cursor==='string');
  const cursor=original.next_cursor,continued:WorkbenchSearchRequest={...input,cursor};
  const nextGet=await fetch(f.origin+'/api/workbench/search?'+searchParameters(input.criteria)+'&limit=1&cursor='+encodeURIComponent(cursor),{headers:{cookie}});
  const nextPost=await post(continued);assert.equal(nextGet.status,200);assert.equal(nextPost.status,200);
  assert.deepEqual(rows(object(await nextPost.json()).items),rows(object(await nextGet.json()).items));
  assert.equal((await post({...continued,criteria:{...input.criteria,q:'changed'}})).status,400);
  assert.equal((await post({...input,unknown:true})).status,400);
  assert.equal((await post({...input,limit:101})).status,400);
  assert.equal((await post({...input,criteria:{...input.criteria,q:'x'.repeat(129)}})).status,400);
  assert.equal((await post({...input,criteria:{...input.criteria,q:'x'.repeat(33000)}})).status,413);
  assert.equal((await post(input,{csrf:'invalid'})).status,403);
  assert.equal((await post(input,{origin:'https://unrelated.invalid'})).status,403);
  assert.equal((await fetch(f.origin+'/api/workbench/search?extra=1',{method:'POST',headers:{cookie,origin:f.origin,'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(input)})).status,400);
 },{manualProjection:true,workbenchSearchEnabled:true});
});
