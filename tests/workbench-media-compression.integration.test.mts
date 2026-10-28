import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import sharp from 'sharp';
import {withDetailRestructureFixture} from './helpers/detail-restructure-fixture.mjs';
import type {DetailRestructureFixture} from './helpers/detail-restructure-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {createYxxH5Media} from '../app/server/src/yxx-h5-media.mjs';
import type {YxxH5Media} from '../app/server/src/yxx-h5-media.mjs';
import {createYxxH5MediaPrivateStore} from '../app/server/src/yxx-h5-media-store.mjs';
import {transactionP2016} from '../app/server/src/p2-016-domain-contracts.mjs';
import {H5_MEDIA_LIMITS} from '../app/server/src/yxx-h5-media-format.mjs';
import type {YxxMemberScope} from '../app/server/src/yxx-self-service-authorization.mjs';
import type {H5MediaLease,H5MediaTranscoder} from '../contracts/yxx_h5_media_contracts.js';
import type {WorkbenchWebReportView} from '../contracts/workbench_web_report_contracts.js';

const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const allow=async()=>{};
const databaseSkip=!process.env.PILOT_DATABASE_URL?'NOT_RUN: own loopback PG18 control URL required':false;
const idleBudget={disk_operations:0,read_leases:0,plaintext_reserved_bytes:0,waiting:0};

async function owner(f:DetailRestructureFixture){
  const first=f.tickets[0];assert.ok(first);
  const row=(await f.pool.query<{scope_hash:string;corp:string;app:string;request_ref:string;submission_id:string;retention:string}>(`SELECT b.canonical_reporter_binding AS scope_hash,b.source_corp_scope AS corp,b.source_app_scope AS app,b.request_ref,
    i.primary_web_submission_id::text AS submission_id,b.retention_until_epoch_ms::text AS retention
    FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id WHERE b.intake_id=$1::uuid`,[first.intake.intakeId])).rows[0];assert.ok(row);
  const scope:YxxMemberScope={scopeHash:row.scope_hash as YxxMemberScope['scopeHash'],sourceCorpScope:row.corp,sourceAppScope:row.app,proofRef:'SYNTHETIC_MEDIA_COMPRESSION_PROOF'};
  return {scope,requestRef:row.request_ref,ticketId:first.ticket.id,intakeId:first.intake.intakeId,submissionId:row.submission_id,retentionUntilEpochMs:row.retention};
}
async function consume(lease:H5MediaLease){const chunks:Buffer[]=[];try{for await(const chunk of lease.stream)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);}finally{await lease.close();}}
async function bind(f:DetailRestructureFixture,media:YxxH5Media,target:Awaited<ReturnType<typeof owner>>,ref:string){await transactionP2016(f.pool,transaction=>media.claimInTransaction({transaction,scope:target.scope,refs:[ref],intakeId:target.intakeId,submissionId:target.submissionId,requestRef:target.requestRef,retentionUntilEpochMs:target.retentionUntilEpochMs}));}
async function row(f:DetailRestructureFixture,ref:string){const result=(await f.pool.query<{state:string;byte_size:string;sha256:string;playback_status:string;playback_sha256:string|null;conversion_error_code:string|null;conversion_error_stage:string|null;transcode_lease:string|null}>(`SELECT state,byte_size::text,sha256,playback_status,playback_sha256,conversion_error_code,conversion_error_stage,transcode_lease::text FROM intake.web_media_upload WHERE media_ref=$1::uuid`,[ref])).rows[0];assert.ok(result);return result;}
async function uploaded(media:YxxH5Media,scope:YxxMemberScope,source:Buffer){const reserved=await media.reserve({scope,input:{schema_version:1,client_command_id:randomUUID(),kind:'IMAGE',mime_type:'image/png',byte_size:source.length,duration_ms:null},verifyCurrentWrite:allow});const result=await media.upload({scope,ref:reserved.media_ref,body:Readable.from([source]),verifyCurrentWrite:allow});assert.equal(result.playback_status,'PENDING');assert.equal((await media.reservation({scope,ref:reserved.media_ref,verifyCurrentRead:allow})).status,'READY');return reserved.media_ref;}

test('background compression preserves committed original bytes, READY/BOUND state and upload replay while exposing safe PC diagnostics',{skip:databaseSkip,timeout:120_000},()=>withDetailRestructureFixture(async f=>{
  const target=await owner(f),http=await t11Http(f),source=await sharp({create:{width:120,height:80,channels:4,background:{r:24,g:86,b:142,alpha:0.5}}}).png().toBuffer(),playable=await sharp(source).webp({lossless:true,exact:true}).toBuffer();
  const sourceHash=hash(source),privateBuffers:Buffer[]=[];let fail=false,calls=0,media:YxxH5Media|undefined;
  const store=createYxxH5MediaPrivateStore({root:f.privateRoot,key:f.key}),transcoder:H5MediaTranscoder={
    normalize:async()=>{throw Error('UNEXPECTED_AUDIO_VIDEO_CONVERSION');},
    compressImage:async({bytes,maxOutputBytes})=>{calls++;privateBuffers.push(bytes);assert.equal(hash(bytes),sourceHash);assert.equal(maxOutputBytes,H5_MEDIA_LIMITS.IMAGE);assert.equal(media?.resourceBudgetState().plaintext_reserved_bytes,H5_MEDIA_LIMITS.plaintext);if(fail)throw Error('PRIVATE_CODEC_CANARY file=C:/private/synthetic-input token=secret');return {bytes:Buffer.from(playable),mime_type:'image/webp'};},
    close:async()=>{},ownedResourceState:()=>({active:0,processes:0,temporary_files:0}),
  };
  media=createYxxH5Media({pool:f.pool,store,transcoder,enabled:true,compressionEnabled:true});const service=media;
  try{
    for(const mode of ['SUCCESS_BOUND','FAIL_READY','FAIL_BOUND'] as const){
      fail=mode!=='SUCCESS_BOUND';const callsBefore=calls,ref=await uploaded(service,target.scope,source),originalPath=join(f.privateRoot,ref+'.original.asset'),encryptedBefore=await readFile(originalPath);
      assert.equal(calls,callsBefore,'upload acknowledges reliable source storage before any codec invocation');assert.equal(encryptedBefore.includes(source),false);
      const before=await row(f,ref);assert.equal(before.byte_size,String(source.length));assert.equal(before.sha256,sourceHash);assert.equal(before.state,'READY');assert.equal(before.playback_status,'PENDING');
      assert.deepEqual(await consume(await service.read({scope:target.scope,ref,variant:'ORIGINAL',verifyCurrentRead:allow})),source);
      if(mode!=='FAIL_READY')await bind(f,service,target,ref);
      assert.deepEqual(await service.processNextTranscode(),{processed:true});assert.equal(calls,callsBefore+1);const privateBuffer=privateBuffers.at(-1);assert.ok(privateBuffer);assert.equal(privateBuffer.some(byte=>byte!==0),false,'the codec input is zeroed after the worker attempt');
      const converted=await row(f,ref);assert.equal(converted.state,mode==='FAIL_READY'?'READY':'BOUND');assert.equal(converted.byte_size,before.byte_size);assert.equal(converted.sha256,before.sha256);assert.equal(converted.transcode_lease,null);assert.deepEqual(await readFile(originalPath),encryptedBefore,'conversion never overwrites the encrypted original');
      assert.equal(converted.playback_status,fail?'UNAVAILABLE':'READY');assert.equal(converted.conversion_error_code,fail?'YXX_MEDIA_CONVERSION_UNAVAILABLE':null);assert.equal(converted.conversion_error_stage,fail?'PLAYABLE':null);
      if(mode==='FAIL_READY')await bind(f,service,target,ref);
      assert.equal((await service.reservation({scope:target.scope,ref,verifyCurrentRead:allow})).status,'BOUND');
      let reread=false;const replay=await service.upload({scope:target.scope,ref,body:{async *[Symbol.asyncIterator](){reread=true;throw Error('UPLOAD_REPLAY_MUST_NOT_RECONSUME_SOURCE');}},verifyCurrentWrite:allow});assert.equal(reread,false);assert.equal(replay.byte_size,source.length);assert.equal(calls,callsBefore+1);
      const response=await http.get('/api/workbench/items/ticket/'+target.ticketId+'/web-report');assert.equal(response.status,200);const view=await response.json() as WorkbenchWebReportView,staff=view.media.find(item=>item.media_ref===ref);assert.ok(staff);assert.equal(staff.mime_type,'image/png');assert.equal(staff.byte_size,source.length);
      if(fail){assert.equal(staff.conversion_error?.code,'YXX_MEDIA_CONVERSION_UNAVAILABLE');assert.equal(staff.conversion_error?.stage,'PLAYABLE');assert.match(staff.conversion_error?.at??'',/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);assert.equal(JSON.stringify(view).includes('PRIVATE_CODEC_CANARY'),false);assert.equal((await readdir(f.privateRoot)).includes(ref+'.playable.asset'),false);}
      else{assert.equal(staff.conversion_error,null);assert.equal(staff.playback_mime_type,'image/webp');assert.equal(converted.playback_sha256,hash(playable));const preview=await http.get('/api/workbench/items/ticket/'+target.ticketId+'/web-report/media/'+ref+'?variant=PLAYABLE');assert.equal(preview.status,200);assert.equal(preview.headers.get('content-type'),'image/webp');assert.deepEqual(Buffer.from(await preview.arrayBuffer()),playable);}
      const member=(await service.listForRequest({scope:target.scope,requestRef:target.requestRef,verifyCurrentRead:allow})).find(item=>item.media_ref===ref);assert.ok(member);assert.equal(Object.hasOwn(member,'conversion_error'),false,'diagnostics stay out of the closed member metadata shape');
      const download=await http.get('/api/workbench/items/ticket/'+target.ticketId+'/web-report/media/'+ref+'?variant=ORIGINAL');assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await download.arrayBuffer()),source);
      assert.deepEqual(service.ownedResourceState(),{active:0,plaintext_bytes:0});assert.deepEqual(service.resourceBudgetState(),idleBudget);assert.equal(hash(source),sourceHash);
    }
    assert.deepEqual(await service.processNextTranscode(),{processed:false},'failed conversion does not make users re-upload or hot-loop the worker');
  }finally{await service.close();assert.deepEqual(service.ownedResourceState(),{active:0,plaintext_bytes:0});assert.deepEqual(service.resourceBudgetState(),idleBudget);assert.deepEqual(store.ownedResourceState(),{active:0,handles:0,plaintext_bytes:0});}
},{compressionEnabled:true}));

test('worker shutdown during conversion preserves a bound original and releases its plaintext budget',{skip:databaseSkip,timeout:120_000},()=>withDetailRestructureFixture(async f=>{
  const target=await owner(f),http=await t11Http(f),source=await sharp({create:{width:64,height:48,channels:3,background:'#24568e'}}).png().toBuffer();
  let started=()=>{};const reached=new Promise<void>(resolve=>{started=resolve;});let active=0;
  const store=createYxxH5MediaPrivateStore({root:f.privateRoot,key:f.key}),transcoder:H5MediaTranscoder={normalize:async()=>{throw Error('UNEXPECTED_AUDIO_VIDEO_CONVERSION');},compressImage:async({signal})=>{active++;started();try{await new Promise<never>((_resolve,reject)=>{if(signal.aborted){reject(signal.reason);return;}signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});throw Error('UNREACHABLE_CONVERSION');}finally{active--;}} ,close:async()=>{assert.equal(active,0);},ownedResourceState:()=>({active,processes:0,temporary_files:0})};
  const media=createYxxH5Media({pool:f.pool,store,transcoder,enabled:true,compressionEnabled:true});
  try{const ref=await uploaded(media,target.scope,source);await bind(f,media,target,ref);const encryptedBefore=await readFile(join(f.privateRoot,ref+'.original.asset')),pending=media.processNextTranscode();await reached;await media.close();assert.deepEqual(await pending,{processed:true});
    const stored=await row(f,ref);assert.equal(stored.state,'BOUND');assert.equal(stored.sha256,hash(source));assert.equal(stored.byte_size,String(source.length));assert.equal(stored.playback_status,'UNAVAILABLE');assert.equal(stored.transcode_lease,null);assert.deepEqual(await readFile(join(f.privateRoot,ref+'.original.asset')),encryptedBefore);
    const download=await http.get('/api/workbench/items/ticket/'+target.ticketId+'/web-report/media/'+ref+'?variant=ORIGINAL');assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),source);assert.deepEqual(media.resourceBudgetState(),idleBudget);assert.deepEqual(media.ownedResourceState(),{active:0,plaintext_bytes:0});assert.deepEqual(transcoder.ownedResourceState(),{active:0,processes:0,temporary_files:0});
  }finally{await media.close();}
},{compressionEnabled:true}));
