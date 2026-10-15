import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {WorkbenchActivityCommand,WorkbenchActivityView} from '../contracts/workbench_activity_contracts.js';

interface Fixture {origin:string;cookies:string[];tickets:{ticket:{id:string}}[]}
test('current linked Review edit authority belongs to the canonical Ticket and disappears when the Review resolves',async()=>{
  await withWeb01Fixture(async({origin,cookies,tickets}:Fixture)=>{
    const actor=cookies[0],colleague=cookies[2],ticket=tickets[0]?.ticket;assert.ok(actor&&colleague&&ticket);
    const get=(path:string,cookie=actor)=>fetch(origin+path,{headers:{cookie}});
    const path='/api/workbench/items/ticket/'+ticket.id;
    for(const cookie of [actor,colleague]){const response=await get(path,cookie);assert.equal(response.status,200);await response.arrayBuffer();}
    const detailResponse=await get(path),detail=await detailResponse.json() as {review_refs:{id:string;status:string}[]};
    const pending=detail.review_refs.filter(review=>review.status==='PENDING');assert.equal(pending.length,1);
    const selected=pending[0];assert.ok(selected);
    const reviewResponse=await get('/api/manual-reviews/'+selected.id);assert.equal(reviewResponse.status,200);
    const review=await reviewResponse.json() as {status:string;allowed_resolutions:string[];row_version:string;material_basis:{current_hash:string}};
    assert.equal(review.status,'PENDING');assert.ok(review.allowed_resolutions.includes('CLASSIFY_BUSINESS_CONSULTATION'));
    const bootstrapResponse=await get('/api/lifecycle/bootstrap');assert.equal(bootstrapResponse.status,200);
    const bootstrap=await bootstrapResponse.json() as {csrf_token:string};
    const command:WorkbenchActivityCommand={schema_version:1,browser_id:randomUUID(),action:'RENEW',target:{kind:'ticket',id:ticket.id},visible:true,active:true,mode:'EDITING',field:'manual-review'};
    const renew=(body:WorkbenchActivityCommand)=>fetch(origin+'/api/workbench/activity',{method:'POST',headers:{cookie:actor,origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token},body:JSON.stringify(body)});
    const renewed=await renew(command);assert.equal(renewed.status,200,'the real linked Review editor must not be rejected for the canonical Ticket target');await renewed.arrayBuffer();
    const viewResponse=await get(path+'/activity',colleague);assert.equal(viewResponse.status,200);
    const view=await viewResponse.json() as WorkbenchActivityView;
    assert.equal(view.people.length,1);assert.equal(view.people[0]?.display_name,'林舟');assert.equal(view.people[0]?.mode,'EDITING');
    assert.deepEqual(Object.keys(view.people[0]??{}).sort(),['display_name','expires_epoch_ms','mode']);
    const other=tickets[8]?.ticket;assert.ok(other);
    const otherDetail=await get('/api/workbench/items/ticket/'+other.id);assert.equal(otherDetail.status,200);
    const otherView=await otherDetail.json() as {review_refs:{id:string}[]};assert.equal(otherView.review_refs.length,0);
    const denied=await renew({...command,target:{kind:'ticket',id:other.id}});assert.equal(denied.status,403,'canonical READ alone must never grant Review editing');await denied.arrayBuffer();
    const resolution={client_command_id:randomUUID(),expected_row_version:review.row_version,expected_material_basis:review.material_basis.current_hash,resolution_code:'CLASSIFY_BUSINESS_CONSULTATION',resolution_reason_code:'BUSINESS_CONSULTATION_CONFIRMED'};
    const resolved=await fetch(origin+'/api/manual-reviews/'+selected.id+'/resolve',{method:'POST',headers:{cookie:actor,origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':resolution.client_command_id,'if-match':'"'+review.row_version+'"'},body:JSON.stringify(resolution)});
    assert.equal(resolved.status,200);await resolved.arrayBuffer();
    const afterResponse=await get(path+'/activity',colleague);assert.equal(afterResponse.status,200);
    assert.deepEqual(await afterResponse.json(),{schema_version:1,people:[]},'existing EDITING must be reauthorized against the current Review');
    const after=await renew(command);assert.equal(after.status,403);await after.arrayBuffer();
  },{workbenchRealtimeEnabled:true,workbenchActivityEnabled:true,workbenchManualReviewEnabled:true,manualProjection:true});
});
