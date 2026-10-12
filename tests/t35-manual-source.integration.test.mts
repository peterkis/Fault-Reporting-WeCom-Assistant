// T35 MANUAL public HTTP vertical slice. Viewport behavior remains independently tested.
import {test} from 'node:test';
import {withT35Fixture} from './helpers/t35-read-fixture.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export interface T35ManualReadHttpBoundary {
  origin:string;
  firstCookie:string;
  secondCookie:string;
}

function object(value:unknown):Record<string,unknown>{
  assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));
  return value as Record<string,unknown>;
}
function string(value:unknown):string{
  assert.equal(typeof value,'string');
  assert.ok(value);
  return value as string;
}
function manualSource(page:Record<string,unknown>):Record<string,unknown>{
  assert.ok(Array.isArray(page.sources));
  const sources=page.sources.map(object);
  assert.equal(sources.length,1,'the newly admitted independent MANUAL source has one source anchor');
  const source=sources[0];assert.ok(source);
  assert.equal(source.source_kind,'MANUAL');
  assert.match(string(source.source_key),/^[a-f0-9]{64}$/u);
  return source;
}

export async function t35ManualImmutableSourceHttpSlice(f:T35ManualReadHttpBoundary):Promise<void>{
  const read=async(path:string,cookie=f.firstCookie):Promise<Record<string,unknown>>=>{
    const response=await fetch(f.origin+path,{headers:{cookie}});
    assert.equal(response.status,200,await response.clone().text());
    return object(await response.json());
  };
  const csrf=string((await read('/api/lifecycle/bootstrap')).csrf_token);
  const post=async(path:string,body:Record<string,unknown>,status:number):Promise<Record<string,unknown>>=>{
    const response=await fetch(f.origin+path,{method:'POST',headers:{cookie:f.firstCookie,origin:f.origin,
      'content-type':'application/json','idempotency-key':string(body.client_command_id),'x-csrf-token':csrf},
      body:JSON.stringify(body)});
    assert.equal(response.status,status,await response.clone().text());
    return object(await response.json());
  };
  // Literal arrangement already exercised by the existing T17 source test.
  // The public producer creates real Intake/Journey/Leg/Review facts.
  const command={schema_version:1,client_command_id:randomUUID(),source:'ON_SITE',
    description:'合成现场代录：打印机情况不明',location:{text:null,unknown:true},
    reporter:{verification:'UNVERIFIED',name:'合成现场报修人',contact:'现场人工联系',department:null}};
  const admitted=await post('/api/workbench/reports',command,202);
  assert.equal(admitted.result_code,'NEEDS_DESCRIPTION');assert.equal(admitted.ticket,null);
  assert.equal(admitted.external_notification,false);assert.equal(admitted.manual_contact_required,true);
  const reviewId=string(object(admitted.review).id),intakeId=string(admitted.intake_id);
  const reviewPath='/api/manual-reviews/'+reviewId,itemPath='/api/workbench/items/review/'+reviewId;
  const readPath=itemPath+'/read-position';
  const original=await read(reviewPath),beforeItem=await read(itemPath);
  assert.equal(original.status,'PENDING');
  assert.deepEqual(original.canonical_item,{kind:'review',id:reviewId});
  assert.deepEqual(original.materials,[{source_ref:'manual:'+intakeId,revision:'1',text:command.description,in_original_basis:true}]);
  assert.equal(object(original.material_basis).source_kind,'MANUAL');
  assert.equal(object(original.material_basis).current_revision,'1');
  assert.deepEqual((await read(itemPath+'/conversations')).items,[],'manual source has no manufactured Session');

  const firstPage=await read(readPath),a0=manualSource(firstPage);
  const b0=manualSource(await read(readPath,f.secondCookie));
  assert.equal(a0.last_read_position,'0');assert.equal(a0.latest_position,'1');assert.equal(a0.has_unread_material,true);
  assert.equal(b0.last_read_position,'0');assert.equal(b0.latest_position,'1');
  // Ordinary repeated reads must not produce a personal ack or business ack.
  const viewed=await read(reviewPath);await read(itemPath);
  assert.deepEqual(manualSource(await read(readPath)),a0);
  assert.equal(viewed.status,'PENDING');assert.equal(viewed.row_version,original.row_version);
  assert.deepEqual(viewed.allowed_resolutions,original.allowed_resolutions);

  const acknowledgedCommand={client_command_id:randomUUID(),source_ref:'manual:'+intakeId,revision:'1'};
  const ack=await post(readPath,acknowledgedCommand,200);
  assert.equal(ack.ok,true);assert.equal(ack.source_kind,'MANUAL');assert.equal(ack.source_key,a0.source_key);
  assert.equal(ack.last_read_position,'1');assert.equal(ack.replayed,false);
  const replay=await post(readPath,acknowledgedCommand,200);
  assert.equal(replay.replayed,true);assert.equal(replay.source_key,ack.source_key);
  assert.equal(replay.last_read_position,'1');assert.equal(replay.row_version,ack.row_version);
  const a1=manualSource(await read(readPath));
  assert.equal(a1.last_read_position,'1');assert.equal(a1.latest_position,'1');assert.equal(a1.has_unread_material,false);
  assert.equal(a1.source_key,a0.source_key);
  assert.deepEqual(manualSource(await read(readPath,f.secondCookie)),b0,'other lawful reader stays unread');
  const current=await read(reviewPath),afterItem=await read(itemPath);
  assert.equal(current.status,'PENDING');assert.equal(current.row_version,original.row_version);
  assert.deepEqual(current.materials,original.materials);assert.deepEqual(current.safe_result,original.safe_result);
  assert.deepEqual(current.allowed_resolutions,original.allowed_resolutions);
  assert.deepEqual(afterItem.records,beforeItem.records);
  assert.deepEqual(afterItem.responsibility,beforeItem.responsibility);
  assert.deepEqual((await read(itemPath+'/conversations')).items,[]);
}

test('T35 immutable MANUAL material remains distinct and personal reading never resolves its Review',()=>withT35Fixture(t35ManualImmutableSourceHttpSlice));
