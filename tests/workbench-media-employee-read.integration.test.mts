import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {withDetailRestructureFixture} from './helpers/detail-restructure-fixture.mjs';
import {seedEmployeeMedia,paddedEmployeePng,observeEmployeeMediaHttp} from './helpers/employee-media-fixture.mjs';
import {migrateWorkbenchDisplayMedia} from '../app/server/scripts/workbench-display-media-migrate.mjs';
import {createYxxH5Media} from '../app/server/src/yxx-h5-media.mjs';
import {createYxxH5MediaPrivateStore} from '../app/server/src/yxx-h5-media-store.mjs';
import type {H5MediaTranscoder} from '../contracts/yxx_h5_media_contracts.js';
import sharp from 'sharp';

const skip=!process.env.PILOT_DATABASE_URL?'NOT_RUN: own loopback PG18 required':false;
const url=(ref:string,variant='ORIGINAL')=>'/api/workbench/media/web/'+ref+'?variant='+variant;

test('employee media uses one row query for 1/10/20 MiB and no database work after body starts',{skip,timeout:180000},()=>withDetailRestructureFixture(async f=>{
 const video=Buffer.alloc(20*1024*1024,0);video.writeUInt32BE(24);video.write('ftyp',4);video.write('isom',8);
 const materials=[{bytes:paddedEmployeePng(1024*1024),kind:'IMAGE' as const,mime:'image/png'},{bytes:paddedEmployeePng(10*1024*1024),kind:'IMAGE' as const,mime:'image/png'},{bytes:video,kind:'VIDEO' as const,mime:'video/mp4',duration:2000}];
 const seeded=await seedEmployeeMedia(f,materials),observation=observeEmployeeMediaHttp(f);
 try{for(const [index,ref] of seeded.refs.entries()){
  const response=await fetch(f.origin+url(ref),{headers:{cookie:f.cookies[0]??''}});assert.equal(response.status,200);
  const bytes=Buffer.from(await response.arrayBuffer());assert.deepEqual(bytes,materials[index]?.bytes);const record=observation.records.at(-1);assert.ok(record);assert.equal(record.sqlAfterHeaders,0);
  const mediaQueries=record.sql.filter(sql=>sql.includes('FROM intake.web_media_upload'));assert.equal(mediaQueries.length,1);assert.ok(!/JOIN|workbenchSearchCards|pilot_ticket\.ticket/u.test(mediaQueries[0]??''));
  assert.ok(record.sql.every(sql=>!sql.includes('FROM cards')),'no workbench card or association query');
 }
 }finally{observation.close();await seeded.media.close();}
},{employeeReadEnabled:true}));

test('known UUID is employee-wide while drafts, expired/purged files, roles and item detail keep their boundaries',{skip,timeout:180000},()=>withDetailRestructureFixture(async f=>{
 const data=paddedEmployeePng(1024*1024),seeded=await seedEmployeeMedia(f,[{bytes:data,kind:'IMAGE',mime:'image/png'}]),ref=seeded.refs[0];assert.ok(ref);
 const employee=f.principals[1];assert.ok(employee);
 try{
  await f.pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[employee.id]);await f.pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER')",[employee.id]);await f.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[employee.id]);
  const get=(path:string,cookie=f.cookies[1]??'')=>fetch(f.origin+path,{headers:{cookie}});
  const detail=await get('/api/tickets/'+seeded.ticketId);assert.ok([403,404].includes(detail.status));await detail.arrayBuffer();
  const response=await get(url(ref));assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),data);
  assert.equal((await get(url(ref),'')).status,401);
  const reserved=await seeded.media.reserve({scope:seeded.scope,input:{schema_version:1,client_command_id:randomUUID(),kind:'IMAGE',mime_type:'image/png',byte_size:data.length,duration_ms:null},verifyCurrentWrite:async()=>{}});
  await seeded.media.upload({scope:seeded.scope,ref:reserved.media_ref,body:Readable.from([data]),verifyCurrentWrite:async()=>{}});
  assert.equal((await get(url(reserved.media_ref))).status,404);
  await f.pool.query('UPDATE intake.web_media_upload SET purged_epoch_ms=platform.physical_epoch_ms() WHERE media_ref=$1::uuid',[ref]);assert.equal((await get(url(ref))).status,404);
  await f.pool.query('UPDATE intake.web_media_upload SET purged_epoch_ms=NULL,expires_epoch_ms=created_epoch_ms+1 WHERE media_ref=$1::uuid',[ref]);assert.equal((await get(url(ref))).status,404);
  await f.pool.query('UPDATE intake.web_media_upload SET expires_epoch_ms=platform.physical_epoch_ms()+60000 WHERE media_ref=$1::uuid',[ref]);
  await f.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[employee.id]);assert.ok([401,403,404].includes((await get(url(ref))).status));
  await f.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=true WHERE id=$1::uuid',[employee.id]);await f.pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[employee.id]);assert.ok([401,403,404].includes((await get(url(ref))).status));
 }finally{await seeded.media.close();}
},{employeeReadEnabled:true}));

test('HEAD and ranges share one snapshot; completed authorization survives mid-stream expiry, while corruption emits no plaintext',{skip,timeout:180000},()=>withDetailRestructureFixture(async f=>{
 const data=paddedEmployeePng(1024*1024),seeded=await seedEmployeeMedia(f,[{bytes:data,kind:'IMAGE',mime:'image/png'}]),ref=seeded.refs[0];assert.ok(ref);
 const file=join(f.privateRoot,ref+'.original.asset');
 try{
  const fetchMedia=(headers:Record<string,string>={},method='GET')=>fetch(f.origin+url(ref),{method,headers:{cookie:f.cookies[0]??'',...headers}});
  await rename(file,file+'.head-probe');try{const head=await fetchMedia({},'HEAD');assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(data.length));assert.equal((await head.arrayBuffer()).byteLength,0);}finally{await rename(file+'.head-probe',file);}
  for(const [range,start,end] of [['bytes=17-100',17,100],['bytes=-9',data.length-9,data.length-1],['bytes=1000-',1000,data.length-1]] as const){const response=await fetchMedia({range});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/${data.length}`);assert.deepEqual(Buffer.from(await response.arrayBuffer()),data.subarray(start,end+1));}
  const invalid=await fetchMedia({range:'bytes='+data.length+'-'});assert.equal(invalid.status,416);assert.equal(invalid.headers.get('content-range'),'bytes */'+data.length);
  const prepared=await seeded.media.prepareEmployeeRead({ref,variant:'ORIGINAL'}),lease=await prepared.open(),iterator=lease.stream[Symbol.asyncIterator]();const first=await iterator.next();assert.equal(first.done,false);
  await f.pool.query('UPDATE intake.web_media_upload SET expires_epoch_ms=created_epoch_ms+1 WHERE media_ref=$1::uuid',[ref]);
  let total=first.value.length;for(;;){const item=await iterator.next();if(item.done)break;total+=item.value.length;}assert.equal(total,data.length);await lease.close();await prepared.close();assert.equal((await fetchMedia()).status,404);
  await f.pool.query('UPDATE intake.web_media_upload SET expires_epoch_ms=platform.physical_epoch_ms()+60000 WHERE media_ref=$1::uuid',[ref]);
  const encrypted=await readFile(file),damaged=Buffer.from(encrypted);damaged[12]=(damaged[12]??0)^1;await writeFile(file,damaged);
  const rejected=await fetchMedia();assert.equal(rejected.status,422);assert.match(rejected.headers.get('content-type')??'',/application\/json/u);assert.equal((await rejected.json() as {error:{code:string}}).error.code,'YXX_MEDIA_INTEGRITY_FAILED');await writeFile(file,encrypted);
  assert.deepEqual(seeded.media.resourceBudgetState(),{disk_operations:0,read_leases:0,plaintext_reserved_bytes:0,waiting:0});
 }finally{await seeded.media.close();}
},{employeeReadEnabled:true}));

test('default-off does not expose employee route and forward preview migration is checked/idempotent',{skip,timeout:180000},()=>withDetailRestructureFixture(async f=>{
 const response=await fetch(f.origin+url(randomUUID()),{headers:{cookie:f.cookies[0]??''}});assert.equal(response.status,404);
 const options={databaseUrl:f.databaseUrl,expectedDatabase:new URL(f.databaseUrl).pathname.slice(1),target:'previews' as const};
 assert.equal((await migrateWorkbenchDisplayMedia({...options,mode:'check'})).status,'PENDING');assert.equal((await migrateWorkbenchDisplayMedia({...options,mode:'apply'})).status,'APPLIED');assert.equal((await migrateWorkbenchDisplayMedia({...options,mode:'check'})).status,'NOOP_ALREADY_APPLIED');
 await assert.rejects(migrateWorkbenchDisplayMedia({...options,expectedDatabase:'not_this_synthetic_database'}),/DISPLAY_MEDIA_DATABASE_MISMATCH/u);
}));

test('existing worker makes the video poster first, preserves originals and leaves member thumbnail policy unchanged',{skip,timeout:180000},()=>withDetailRestructureFixture(async f=>{
 const bytes=Buffer.alloc(128,0);bytes.writeUInt32BE(24);bytes.write('ftyp',4);bytes.write('isom',8);
 const jpeg=await sharp({create:{width:120,height:80,channels:3,background:'blue'}}).jpeg().toBuffer(),calls:string[]=[];
 const transcoder:H5MediaTranscoder={thumbnail:async input=>{assert.equal(input.kind,'VIDEO');calls.push('poster');return {bytes:Buffer.from(jpeg),mime_type:'image/jpeg'};},normalize:async()=>{calls.push('playback');return {bytes:Buffer.from(bytes),mime_type:'video/mp4',duration_ms:2000};},close:async()=>{},ownedResourceState:()=>({active:0,processes:0,temporary_files:0})};
 const seeded=await seedEmployeeMedia(f,[{bytes,kind:'VIDEO',mime:'video/mp4',duration:2000}],{transcoder}),ref=seeded.refs[0];assert.ok(ref);
 try{
  const original=await readFile(join(f.privateRoot,ref+'.original.asset'));assert.deepEqual(await seeded.media.processNextTranscode(),{processed:true});assert.deepEqual(calls,['poster']);
  const metadata=await seeded.media.listForIntake({intakeId:seeded.intakeId,verifyCurrentRead:async()=>{}});assert.equal(metadata[0]?.thumbnail?.status,'READY');assert.equal(metadata[0]?.playback_status,'PENDING');
  const response=await fetch(f.origin+url(ref,'THUMBNAIL'),{headers:{cookie:f.cookies[0]??''}});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),jpeg);
  await assert.rejects(seeded.media.read({scope:seeded.scope,ref,requestRef:seeded.requestRef,variant:'THUMBNAIL',verifyCurrentRead:async()=>{}}),{code:'YXX_MEDIA_THUMBNAIL_UNAVAILABLE'});
  assert.deepEqual(await seeded.media.processNextTranscode(),{processed:true});assert.deepEqual(calls,['poster','playback']);assert.deepEqual(await readFile(join(f.privateRoot,ref+'.original.asset')),original);
  await f.pool.query("UPDATE intake.web_media_upload SET thumbnail_status='PENDING',thumbnail_mime_type=NULL,thumbnail_byte_size=NULL,thumbnail_sha256=NULL WHERE media_ref=$1::uuid",[ref]);
  const disabled=createYxxH5Media({pool:f.pool,store:createYxxH5MediaPrivateStore({root:f.privateRoot,key:f.key}),enabled:true,transcoder});try{assert.deepEqual(await disabled.processNextTranscode(),{processed:false});}finally{await disabled.close();}
 }finally{await seeded.media.close();}
},{employeeReadEnabled:true}));
