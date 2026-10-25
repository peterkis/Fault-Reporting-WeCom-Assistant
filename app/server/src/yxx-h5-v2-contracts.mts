import type {H5RequestInput,H5UrgeInput,H5EvaluationInput,H5PublicProgressInput,H5ReportFilters,H5Limits} from '../../../contracts/yxx_h5_v2_contracts.js';
import {exactP2016,uuidP2016,versionP2016} from './p2-016-domain-contracts.mjs';
import {shanghaiLocalToEpochMs} from './platform/time-contract.mjs';

export const H5_ACCEPT='application/vnd.yixiaoxiu.v2+json';
export const H5_LIMITS:Readonly<H5Limits>=Object.freeze({voice_count:1,voice_duration_seconds:60,voice_bytes:5*1024*1024,image_count:6,image_bytes:10*1024*1024,video_count:1,video_duration_seconds:60,video_bytes:20*1024*1024,total_bytes:40*1024*1024});
export function h5Fail(code='YXX_INPUT_INVALID',status=400):never{throw Object.assign(new Error(code),{code,status});}
function exact(input:unknown,keys:string[]){try{return exactP2016(input,keys);}catch{h5Fail();}}
export function h5Text(value:unknown,max:number,nullable=false):string|null{
  if(value===null&&nullable)return null;
  if(typeof value!=='string')h5Fail();const v=value.trim();
  if(!v&&nullable)return null;if(!v||[...v].length>max||Buffer.byteLength(v)>max*4)h5Fail();return v;
}
export function h5Uuid(input:unknown):string{try{return uuidP2016(input).toLowerCase();}catch{h5Fail();}}
export function h5Version(input:unknown):number{try{return versionP2016(input);}catch{h5Fail();}}
export function h5RequestRef(input:unknown):string{if(typeof input!=='string'||!/^[A-Za-z0-9_-]{32}$/u.test(input))h5Fail();return input;}
export function parseH5RequestInput(input:unknown):H5RequestInput{
  const v=exact(input,['schema_version','client_command_id','intent','description','location','media_refs']);
  if(v.schema_version!==2||(v.intent!=='FAULT'&&v.intent!=='CONTACT_REQUEST'))h5Fail();
  const location=exact(v.location,['text','unknown']);if(typeof location.unknown!=='boolean')h5Fail();
  const text=h5Text(location.text,200,true);if(!location.unknown&&text===null)h5Fail();
  if(!Array.isArray(v.media_refs)||v.media_refs.length>8)h5Fail();const refs=v.media_refs.map(h5Uuid);
  if(new Set(refs).size!==refs.length)h5Fail();const description=h5Text(v.description,4000,true);
  if(v.intent==='FAULT'&&description===null&&refs.length===0)h5Fail();
  return {schema_version:2,client_command_id:h5Uuid(v.client_command_id),intent:v.intent,description,location:{text,unknown:location.unknown},media_refs:refs};
}
export function parseH5UrgeInput(input:unknown):H5UrgeInput{
  const v=exact(input,['schema_version','client_command_id','expected_ticket_version']);if(v.schema_version!==1)h5Fail();
  return {schema_version:1,client_command_id:h5Uuid(v.client_command_id),expected_ticket_version:h5Version(v.expected_ticket_version)};
}
export function parseH5EvaluationInput(input:unknown):H5EvaluationInput{
  const v=exact(input,['schema_version','client_command_id','expected_ticket_version','completed_round_ref','rating','comment']);
  if(v.schema_version!==1||!Number.isInteger(v.rating)||Number(v.rating)<1||Number(v.rating)>5)h5Fail();
  return {schema_version:1,client_command_id:h5Uuid(v.client_command_id),expected_ticket_version:h5Version(v.expected_ticket_version),completed_round_ref:h5RequestRef(v.completed_round_ref),rating:Number(v.rating),comment:h5Text(v.comment,200,true)};
}
export function parseH5PublicProgressInput(input:unknown):H5PublicProgressInput{
  const v=exact(input,['client_command_id','expected_version','summary','estimated_at']);
  if(v.estimated_at!==null){if(typeof v.estimated_at!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(v.estimated_at))h5Fail();try{shanghaiLocalToEpochMs(v.estimated_at);}catch{h5Fail();}}
  return {client_command_id:h5Uuid(v.client_command_id),expected_version:h5Version(v.expected_version),summary:h5Text(v.summary,500) as string,estimated_at:v.estimated_at as string|null};
}
export function parseH5ReportFilters(input:H5ReportFilters={}):Required<H5ReportFilters>{
  const search=input.search===undefined?null:h5Text(input.search,100,true);
  const status=input.status??null;if(status!==null&&!['OPEN','ACTIVE','COMPLETED'].includes(status))h5Fail();return {search,status};
}
