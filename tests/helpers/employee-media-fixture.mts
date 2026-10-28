import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {crc32} from 'node:zlib';
import {AsyncLocalStorage} from 'node:async_hooks';
import {performance} from 'node:perf_hooks';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {DetailRestructureFixture} from './detail-restructure-fixture.mjs';
import type {H5MediaKind,H5MediaTranscoder} from '../../contracts/yxx_h5_media_contracts.js';
import type {YxxMemberScope} from '../../app/server/src/yxx-self-service-authorization.mjs';
import {createYxxH5Media} from '../../app/server/src/yxx-h5-media.mjs';
import {createYxxH5MediaPrivateStore} from '../../app/server/src/yxx-h5-media-store.mjs';
import {transactionP2016} from '../../app/server/src/p2-016-domain-contracts.mjs';

const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==','base64');
export function paddedEmployeePng(size:number,png=PNG){
 const payload=Buffer.alloc(size-png.length-12,7),chunk=Buffer.alloc(payload.length+12);chunk.writeUInt32BE(payload.length);chunk.write('paDd',4);payload.copy(chunk,8);chunk.writeUInt32BE(crc32(chunk.subarray(4,chunk.length-4)),chunk.length-4);
 return Buffer.concat([png.subarray(0,png.length-12),chunk,png.subarray(png.length-12)]);
}
export interface EmployeeMediaObservation {path:string;method:string;range:string|null;sql:string[];sqlAfterHeaders:number;status:number;bytes:number;elapsed_ms:number}
/** Observe only this synthetic HTTP request, excluding unrelated worker queries. */
export function observeEmployeeMediaHttp(f:DetailRestructureFixture){
 const server=f.runtime.server,listeners=server.listeners('request');assert.equal(listeners.length,1);const listener=listeners[0];assert.ok(listener);
 const context=new AsyncLocalStorage<{record:EmployeeMediaObservation;response:ServerResponse}>(),records:EmployeeMediaObservation[]=[],query=f.pool.query;
 const wrapped=(request:IncomingMessage,response:ServerResponse)=>{const start=performance.now(),record:EmployeeMediaObservation={path:request.url??'',method:request.method??'',range:request.headers.range??null,sql:[],sqlAfterHeaders:0,status:0,bytes:0,elapsed_ms:0};records.push(record);
  response.once('finish',()=>{record.status=response.statusCode;record.bytes=Number(response.getHeader('content-length')??0);record.elapsed_ms=performance.now()-start;});
  context.run({record,response},()=>listener.call(server,request,response));};
 server.removeAllListeners('request');server.on('request',wrapped);
 f.pool.query=new Proxy(query,{apply(target,receiver,args){const active=context.getStore();if(active&&typeof args[0]==='string'){active.record.sql.push(args[0].slice(0,512));if(active.response.headersSent)active.record.sqlAfterHeaders++;}return Reflect.apply(target,receiver,args);}});
 return {records,close(){f.pool.query=query;server.removeAllListeners('request');server.on('request',(request,response)=>listener.call(server,request,response));context.disable();}};
}
export async function seedEmployeeMedia(f:DetailRestructureFixture,materials:readonly {bytes:Buffer;kind:H5MediaKind;mime:string;duration?:number}[],{employeeReadEnabled=true,transcoder=null}:{employeeReadEnabled?:boolean;transcoder?:H5MediaTranscoder|null}={}){
 const first=f.tickets[0];assert.ok(first);
 const row=(await f.pool.query<{scope_hash:string;corp:string;app:string;request_ref:string;submission_id:string;retention:string}>(`SELECT b.canonical_reporter_binding AS scope_hash,b.source_corp_scope AS corp,b.source_app_scope AS app,b.request_ref,
  i.primary_web_submission_id::text AS submission_id,b.retention_until_epoch_ms::text AS retention
  FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id WHERE b.intake_id=$1::uuid`,[first.intake.intakeId])).rows[0];assert.ok(row);
 const scope:YxxMemberScope={scopeHash:row.scope_hash as YxxMemberScope['scopeHash'],sourceCorpScope:row.corp,sourceAppScope:row.app,proofRef:'SYNTHETIC_EMPLOYEE_MEDIA'};
 const store=createYxxH5MediaPrivateStore({root:f.privateRoot,key:f.key}),media=createYxxH5Media({pool:f.pool,store,transcoder,enabled:true,employeeReadEnabled,performanceEnabled:true});
 const refs:string[]=[],allow=async()=>{};
 try{
  for(const material of materials){const reserved=await media.reserve({scope,input:{schema_version:1,client_command_id:randomUUID(),kind:material.kind,mime_type:material.mime,byte_size:material.bytes.length,duration_ms:material.duration??null},verifyCurrentWrite:allow});
   await media.upload({scope,ref:reserved.media_ref,body:Readable.from([material.bytes]),verifyCurrentWrite:allow});refs.push(reserved.media_ref);}
  await transactionP2016(f.pool,transaction=>media.claimInTransaction({transaction,scope,refs,intakeId:first.intake.intakeId,submissionId:row.submission_id,requestRef:row.request_ref,retentionUntilEpochMs:row.retention}));
  return {media,store,refs,ticketId:first.ticket.id,intakeId:first.intake.intakeId,scope,requestRef:row.request_ref};
 }catch(error){await media.close();throw error;}
}
