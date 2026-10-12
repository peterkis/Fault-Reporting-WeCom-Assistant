import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT35Fixture} from './helpers/t35-read-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createContactJourneyStore} from '../src/p2-015-contact-journey.mjs';

test('T35 the real later Leg displayed by an original Review has its own personal position and remains within that Journey',()=>withT35Fixture(async f=>{
  const board=await (await f.get('/api/workbench/board?column=pending')).json() as {items:{kind:string;id:string}[]};
  const selected=board.items.find(item=>item.kind==='review');assert.ok(selected);
  const reviewPath='/api/manual-reviews/'+selected.id,path='/api/workbench/items/review/'+selected.id+'/read-position';
  const original=await (await f.get(reviewPath)).json() as {journey_id:string;row_version:string;materials:unknown[]};
  const text='T35合成后来独立单聊来源，原Review真实显示但不属于原判断';
  const second=await seedPersistedIntake({pool:f.pool,chatType:'single',text});
  const tx=await f.pool.connect();
  try{
    await tx.query('BEGIN');const journey=(await tx.query<{reporter_identity_hash:string}>('SELECT reporter_identity_hash FROM intake.contact_journey WHERE id=$1::uuid FOR UPDATE',[original.journey_id])).rows[0];assert.ok(journey);
    await createContactJourneyStore().ensureLeg({transaction:tx,input:{journey_id:original.journey_id,source_intake_id:second.intakeId,leg_type:'DIRECT_GUIDED',origin_channel_message_id:second.messageId,provider_context_hash:'1'.repeat(64),channel_identity_hash:'2'.repeat(64),reporter_identity_hash:journey.reporter_identity_hash,opened_at:second.receivedAt}});
    await tx.query('COMMIT');
  }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}
  const current=await (await f.get(reviewPath)).json() as {row_version:string;material_basis:{reason:string};materials:{source_ref:string;revision:string;text:string|null;in_original_basis:boolean}[]};
  assert.equal(current.row_version,original.row_version);assert.equal(current.material_basis.reason,'NEW_CHANNEL_LEG');
  const material=current.materials.find(value=>value.text===text);assert.ok(material);assert.equal(material.in_original_basis,false);assert.equal(material.revision,'1');
  const command={client_command_id:randomUUID(),source_ref:material.source_ref,revision:material.revision};
  const response=await f.post(path,command);assert.equal(response.status,200,await response.clone().text());
  const ack=await response.json() as {source_key:string;last_read_position:string};assert.equal(ack.last_read_position,'1');
  const read=async(reader:0|1)=>(await (await f.get(path,reader)).json() as {sources:{source_key:string;last_read_position:string}[]}).sources;
  const a=await read(0),b=await read(1);assert.equal(a.length,2);assert.equal(new Set(a.map(value=>value.source_key)).size,2);assert.equal(a.find(value=>value.source_key===ack.source_key)?.last_read_position,'1');assert.equal(a.find(value=>value.source_key!==ack.source_key)?.last_read_position,'0');assert.ok(b.every(value=>value.last_read_position==='0'));
  const unrelated=f.tickets[2];assert.ok(unrelated);assert.equal((await f.post('/api/workbench/items/ticket/'+unrelated.ticket.id+'/read-position',{...command,client_command_id:randomUUID()})).status,404);
  await f.pool.query("WITH expired AS (SELECT (platform.physical_epoch_ms()/1000)*1000-60000 AS epoch) UPDATE intake.contact_journey SET retention_until_epoch_ms=expired.epoch,retention_until=platform.local_from_epoch_ms(expired.epoch),reported_at=LEAST(reported_at,platform.local_from_epoch_ms(expired.epoch-60000)) FROM expired WHERE id=$1::uuid",[original.journey_id]);
  assert.equal((await f.get(path)).status,404);assert.equal((await f.post(path,command)).status,404);
}));
