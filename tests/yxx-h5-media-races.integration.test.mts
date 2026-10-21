import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {setImmediate as nextTurn} from 'node:timers/promises';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import type {YxxMemberScope} from '../src/yxx-self-service-authorization.mjs';
import type {H5MediaLease,H5MediaPrivateStore} from '../contracts/yxx_h5_media_contracts.js';
import {withP2015IsolatedDatabase} from './helpers/p2-015-postgres-harness.mjs';
import {testRoots} from './helpers/migration-roots.mjs';
import {createYxxH5Media} from '../src/yxx-h5-media.mjs';
import type {YxxH5Media} from '../src/yxx-h5-media.mjs';
import {createYxxH5MediaPrivateStore} from '../src/yxx-h5-media-store.mjs';
import {createYxxSelfServiceStore} from '../src/yxx-self-service-store.mjs';

const databaseUrl=process.env.PILOT_DATABASE_URL;
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==','base64');
const scope:YxxMemberScope={scopeHash:'d'.repeat(64) as YxxMemberScope['scopeHash'],sourceCorpScope:'synthetic-media-race-corp',sourceAppScope:'synthetic-media-race-app',proofRef:'synthetic-media-race-proof'};
const allow=async()=>{};
const zeroBudget={disk_operations:0,read_leases:0,plaintext_reserved_bytes:0,waiting:0};
function latch(){let release=()=>{};const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
async function within<T>(promise:Promise<T>,reason:string,ms=3000):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([promise,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error(reason)),ms);})]);}
 finally{if(timer)clearTimeout(timer);}
}
interface Observation {plaintext:Buffer|null}
interface MetadataGate {armed:boolean;entered:ReturnType<typeof latch>;release:ReturnType<typeof latch>;finished:ReturnType<typeof latch>}
function metadataGate():MetadataGate{return {armed:false,entered:latch(),release:latch(),finished:latch()};}

/** Execute real SQL, then hold its completion at the metadata await boundary. */
function gatedPool(pool:PostgresPool,gate:MetadataGate,observation:Observation):PostgresPool{
 const query=new Proxy(pool.query,{apply(target,_receiver,args){
  const sql:unknown=args[0],pending:unknown=Reflect.apply(target,pool,args);
  if(!gate.armed||observation.plaintext===null||typeof sql!=='string'||!sql.startsWith('SELECT m.* FROM intake.web_media_upload m '))return pending;
  gate.armed=false;
  return Promise.resolve(pending).then(async result=>{
   gate.entered.release();
   try{await gate.release.promise;return result;}finally{gate.finished.release();}
  });
 }});
 return new Proxy(pool,{get(target,key,receiver){return key==='query'?query:Reflect.get(target,key,receiver);}});
}
async function fixture(run:(input:{pool:PostgresPool;media:YxxH5Media;root:string;observation:Observation;gate:MetadataGate})=>Promise<void>){
 assert.ok(databaseUrl,'owned loopback PostgreSQL 18 is required');
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(databaseUrl).hostname));
 const sourceRoot=testRoots().sourceRoot,tempParent=join(sourceRoot,'tmp');await mkdir(tempParent,{recursive:true});
 const root=await mkdtemp(join(tempParent,'yxx-h5-media-races-')),key=randomBytes(32);
 let media:YxxH5Media|undefined;
 try{
  await withP2015IsolatedDatabase({databaseUrl,purpose:'h5races',max:4,run:async({pool}:{pool:PostgresPool})=>{
   assert.ok(Number((await pool.query<{server_version_num:string}>('SHOW server_version_num')).rows[0]?.server_version_num)>=180000);
   const migrations=join(sourceRoot,'database/migrations');
   for(const file of (await readdir(migrations)).filter(name=>/^\d{3}_.+\.sql$/u.test(name)&&Number(name.slice(0,3))<=66).sort())await pool.query(await readFile(join(migrations,file),'utf8'));
   const observation:Observation={plaintext:null},gate=metadataGate(),backing=createYxxH5MediaPrivateStore({root,key});
   const store:H5MediaPrivateStore={...backing,async read(asset,signal){const bytes=await backing.read(asset,signal);observation.plaintext=bytes;return bytes;}};
   media=createYxxH5Media({pool:gatedPool(pool,gate,observation),store,enabled:true,performanceEnabled:true});
   try{await run({pool,media,root,observation,gate});}
   finally{gate.release.release();await media.close();assert.deepEqual(media.ownedResourceState(),{active:0,plaintext_bytes:0});assert.deepEqual(media.resourceBudgetState(),zeroBudget);assert.deepEqual(store.ownedResourceState(),{active:0,handles:0,plaintext_bytes:0});}
  }});
 }finally{
  await media?.close();key.fill(0);assert.equal(dirname(root),tempParent);await rm(root,{recursive:true,force:true});
 }
}
async function upload(media:YxxH5Media){
 const reserved=await media.reserve({scope,input:{schema_version:1,client_command_id:randomUUID(),kind:'IMAGE',mime_type:'image/png',byte_size:PNG.length,duration_ms:null},verifyCurrentWrite:allow});
 await media.upload({scope,ref:reserved.media_ref,body:Readable.from([PNG]),verifyCurrentWrite:allow});return reserved.media_ref;
}
async function bind(pool:PostgresPool,media:YxxH5Media,ref:string,onClaimed?:()=>Promise<void>){
 return createYxxSelfServiceStore({pool}).accept({scope,input:{schema_version:1,client_command_id:randomUUID(),description:'synthetic claim and cancellation race',location:{text:null,unknown:true},service_code:null,impact_scope:'UNKNOWN',reported_department_text:null,extension:null},onBeforeCommit:async({transaction,receipt,replayed})=>{
  if(replayed)return true;assert.ok(receipt);
  const row=(await transaction.query<{intake_id:string;submission_id:string;retention:string}>('SELECT b.intake_id::text,i.primary_web_submission_id::text AS submission_id,b.retention_until_epoch_ms::text AS retention FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id WHERE b.request_ref=$1',[receipt.request_ref])).rows[0];assert.ok(row);
  await media.claimInTransaction({transaction,scope,refs:[ref],intakeId:row.intake_id,submissionId:row.submission_id,requestRef:receipt.request_ref,retentionUntilEpochMs:row.retention});
  assert.equal((await transaction.query<{state:string}>('SELECT state FROM intake.web_media_upload WHERE media_ref=$1::uuid',[ref])).rows[0]?.state,'BOUND');
  await onClaimed?.();return true;
 }});
}
async function content(lease:H5MediaLease){const chunks:Buffer[]=[];try{for await(const part of lease.stream)chunks.push(Buffer.from(part));return Buffer.concat(chunks);}finally{await lease.close();}}
async function waitForCancellationLock(pool:PostgresPool){
 const deadline=performance.now()+10_000;
 for(;;){
  const waiting=await pool.query<{query:string}>(`SELECT query FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
   AND wait_event_type='Lock' AND query LIKE '%intake.web_media_upload%' AND query LIKE '%FOR UPDATE%'`);
  if(waiting.rowCount)return;
  assert.ok(performance.now()<deadline,'cancel must observably wait on the uncommitted media claim lock');await nextTurn();
 }
}

test('real PG cancel waits for the claim lock, rejects BOUND with 409 and preserves the encrypted original',{timeout:180000},async()=>fixture(async({pool,media,root})=>{
 const ref=await upload(media),original=await readFile(join(root,ref+'.original.asset')),claimed=latch(),commit=latch();
 const claiming=bind(pool,media,ref,async()=>{claimed.release();await commit.promise;});void claiming.catch(()=>{});
 let cancellation:Promise<void>|undefined;
 try{
  await within(claimed.promise,'claim must update BOUND inside its still-open transaction');
  assert.equal((await pool.query<{state:string}>('SELECT state FROM intake.web_media_upload WHERE media_ref=$1::uuid',[ref])).rows[0]?.state,'READY','other transactions still see the prior READY version');
  cancellation=assert.rejects(media.cancel({scope,ref,verifyCurrentWrite:allow}),{code:'YXX_MEDIA_CONFLICT',status:409});
  void cancellation.catch(()=>{});
  await waitForCancellationLock(pool);commit.release();const accepted=await claiming;await cancellation;
  const current=(await pool.query<{state:string;request_ref:string}>('SELECT state,request_ref FROM intake.web_media_upload WHERE media_ref=$1::uuid',[ref])).rows[0];
  assert.deepEqual(current,{state:'BOUND',request_ref:accepted.receipt.request_ref});
  assert.deepEqual(await readFile(join(root,ref+'.original.asset')),original,'cancel must not remove or replace an original bound while it waited');
  assert.deepEqual(await content(await media.read({scope,ref,requestRef:accepted.receipt.request_ref,variant:'ORIGINAL',verifyCurrentRead:allow})),PNG);
 }finally{commit.release();await Promise.allSettled([claiming,...(cancellation?[cancellation]:[])]);}
}));

test('real PG late metadata completion cannot retain plaintext or resurrect an aborted read',{timeout:240000},async t=>{
 for(const stage of ['initialization','chunk'] as const)for(const mode of ['signal','close'] as const)await t.test(stage+' '+mode,async()=>fixture(async({pool,media,observation,gate})=>{
  const ref=await upload(media),accepted=await bind(pool,media,ref),controller=new AbortController();
  let lease:H5MediaLease|undefined,pending:Promise<unknown>|undefined,emitted=false,queryHeld=true;
  try{
   if(stage==='initialization'){
    gate.armed=true;
    pending=media.read({scope,ref,requestRef:accepted.receipt.request_ref,variant:'ORIGINAL',verifyCurrentRead:allow,signal:controller.signal}).then(async value=>{emitted=true;await value.close();throw Error('aborted initialization must never produce a stream');});
   }else{
    lease=await media.read({scope,ref,requestRef:accepted.receipt.request_ref,variant:'ORIGINAL',verifyCurrentRead:allow,signal:controller.signal});
    gate.armed=true;
    pending=lease.stream[Symbol.asyncIterator]().next().then(value=>{if(!value.done)emitted=true;return value;});
   }
   void pending.catch(()=>{});
   await within(gate.entered.promise,'read must reach a real metadata completion gate after store.read');
   const plaintext=observation.plaintext;assert.ok(plaintext);assert.deepEqual(plaintext,PNG);
   assert.equal(media.ownedResourceState().plaintext_bytes,PNG.length);assert.equal(media.resourceBudgetState().read_leases,1);assert.equal(media.resourceBudgetState().disk_operations,0);
   const result=pending.then(value=>({status:'RESOLVED' as const,value}),(error:unknown)=>({status:'REJECTED' as const,error}));
   if(mode==='signal')controller.abort();else await within(media.close(),'media.close must return while metadata completion is still held',1000);
   const outcome=await within(result,'aborted read must settle before the held metadata query completes',1000);
   if(stage==='initialization'){assert.equal(outcome.status,'REJECTED');if(outcome.status==='REJECTED')assert.ok(outcome.error instanceof Error);}
   assert.equal(queryHeld,true);assert.equal(emitted,false);assert.ok(plaintext.every(byte=>byte===0),'the exact buffer returned by the private store is zeroed before metadata resumes');
   assert.deepEqual(media.ownedResourceState(),{active:0,plaintext_bytes:0});assert.deepEqual(media.resourceBudgetState(),zeroBudget);
   gate.release.release();queryHeld=false;await within(gate.finished.promise,'late SQL completion must drain');await nextTurn();
   assert.equal(emitted,false,'late metadata cannot produce a stream or chunk');assert.deepEqual(media.ownedResourceState(),{active:0,plaintext_bytes:0});assert.deepEqual(media.resourceBudgetState(),zeroBudget);
  }finally{
   controller.abort();gate.release.release();queryHeld=false;await lease?.close();if(pending)await Promise.allSettled([pending]);
  }
 }));
});


test('real PG READ revoked during metadata completion cannot expose a stream or output block',{timeout:180000},async t=>{
 for(const stage of ['initialization','chunk'] as const)await t.test(stage,async()=>fixture(async({media,observation,gate,pool})=>{
  const ref=await upload(media),accepted=await bind(pool,media,ref);let allowed=true,emitted=false,lease:H5MediaLease|undefined,pending:Promise<unknown>|undefined;
  const verifyCurrentRead=async()=>{if(!allowed)throw new Error('synthetic READ revoked while metadata waited');};
  try{
   if(stage==='initialization'){
    gate.armed=true;
    pending=media.read({scope,ref,requestRef:accepted.receipt.request_ref,variant:'ORIGINAL',verifyCurrentRead}).then(async value=>{emitted=true;await value.close();throw new Error('revoked initialization exposed a stream');});
   }else{
    lease=await media.read({scope,ref,requestRef:accepted.receipt.request_ref,variant:'ORIGINAL',verifyCurrentRead});gate.armed=true;
    pending=lease.stream[Symbol.asyncIterator]().next().then(value=>{if(!value.done)emitted=true;return value;});
   }
   void pending.catch(()=>{});
   await within(gate.entered.promise,'READ must reach the real metadata completion boundary');assert.ok(observation.plaintext);allowed=false;gate.release.release();
   await assert.rejects(within(pending,'revoked READ must settle without releasing media'),/synthetic READ revoked while metadata waited/u);
   assert.equal(emitted,false);assert.ok(observation.plaintext.every(byte=>byte===0));assert.deepEqual(media.ownedResourceState(),{active:0,plaintext_bytes:0});assert.deepEqual(media.resourceBudgetState(),zeroBudget);
  }finally{gate.release.release();await lease?.close();if(pending)await Promise.allSettled([pending]);}
 }));
});
