import { createHash } from 'node:crypto';
import { assertPlainJson, deepFreeze } from './p2-007-domain-utils.mjs';
import { WorkbenchError } from './p2-006-workbench-query.mjs';
import { assertEpochMsString, assertLocalDateTime, formatEpochMsToShanghaiLocal } from './platform/time-contract.mjs';

export const P2016_LIMITS = Object.freeze({ pool:4, list:30, maximumList:100, events:200, reporter:100, sse:32, batch:20, maximumBatch:100 });
export const P2016_ERROR_CODES=Object.freeze(['INPUT_INVALID','DISABLED','FLAG_INVALID','LIMIT_INVALID','CURSOR_INVALID','FORBIDDEN','NOT_FOUND',
  'VERSION_CONFLICT','COMMAND_CONFLICT','ACTION_FAILED','CONTROL_CONFLICT','CONTROL_UNAVAILABLE','TARGET_INVALID',
  'REVIEW_ACTION_FAILED','REVIEW_ALREADY_RESOLVED','REVIEW_SCOPE_TOO_LARGE','RESOLUTION_NOT_PERMITTED','DELIVERY_STATE_CONFLICT',
  'NOTIFICATION_BINDING_INVALID','NOTIFICATION_EVENT_INVALID','NOTIFICATION_FAILED','GUIDED_ASSOCIATION_CONFLICT','REALTIME_SOURCE_CONFLICT',
  'GRANT_INVALID','REPORTER_BINDING_INVALID','REPORTER_SECRET_REQUIRED','REPORTER_UNAUTHENTICATED','REPORTER_REQUIRED_FOR_CARD',
  'BODY_TOO_LARGE','CONTENT_TYPE_INVALID','ORIGIN_INVALID','CARD_INVALID','CARD_URL_INVALID','LIVE_APPROVAL_REQUIRED','LIVE_SCOPE_REQUIRED'].map(c=>'P2_016_'+c));
export function failP2016(code='INPUT_INVALID',status=400) {
  const stable='P2_016_'+code;throw new WorkbenchError(P2016_ERROR_CODES.includes(stable)?stable:'P2_016_INPUT_INVALID',status);
}
export function snapshotP2016(value) {
  try {
    const copy=assertPlainJson(value,{maxDepth:12,maxNodes:12000,maxArrayLength:1000,maxStringLength:20000});
    const visit=v=>{if(v&&typeof v==='object')for(const [key,child] of Object.entries(v)){
      if(key.toLowerCase()==='tojson')throw new Error('plain data required');visit(child);
    }};
    visit(copy);return copy;
  }
  catch { failP2016(); }
}
export function publicP2016(value) { return deepFreeze(snapshotP2016(value)); }
export function exactP2016(value,keys,required=keys) {
  const copy=snapshotP2016(value);
  if(!copy || Array.isArray(copy) || typeof copy!=='object'
    || Object.keys(copy).some(k=>!keys.includes(k)) || required.some(k=>!Object.hasOwn(copy,k)))failP2016();
  return copy;
}
export function uuidP2016(value) {
  if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value))failP2016();
  return value.toLowerCase();
}
export function versionP2016(value) { if(!Number.isSafeInteger(value)||value<1||value>2147483647)failP2016();return value; }
export function codeP2016(value) { if(typeof value!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/u.test(value))failP2016();return value; }
export function limitP2016(value,maximum=100) {
  if(value===undefined||value===null)return 30;
  if(typeof value==='string'&&!/^[1-9][0-9]{0,2}$/u.test(value))failP2016('LIMIT_INVALID');
  const n=Number(value);if(!Number.isInteger(n)||n<1||n>maximum)failP2016('LIMIT_INVALID');return n;
}
export function flagsP2016(input={}) {
  const copy=exactP2016(input,['TICKET_LIFECYCLE_WORKBENCH_ENABLED','REPORTER_TIMELINE_ENABLED','WECOM_TEMPLATE_CARD_ENABLED'],[]);
  const values={};for(const key of ['TICKET_LIFECYCLE_WORKBENCH_ENABLED','REPORTER_TIMELINE_ENABLED','WECOM_TEMPLATE_CARD_ENABLED']) {
    const v=copy[key];if(v!==undefined&&![false,true,'false','true'].includes(v))failP2016('FLAG_INVALID',503);
    values[key]=v===true||v==='true';
  }return Object.freeze(values);
}
export function guardP2016(enabled) { if(enabled!==true)failP2016('DISABLED',503); }
export function hashP2016(value) {
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  return createHash('sha256').update(JSON.stringify(canonical(snapshotP2016(value)))).digest('hex');
}
export const textHashP2016=value=>createHash('sha256').update(value).digest('hex');
export function stampP2016(now=()=>String(Date.now())) {
  const epoch=assertEpochMsString(now());if(BigInt(epoch)>9223372036854775807n)failP2016();
  return Object.freeze({epoch,local:formatEpochMsToShanghaiLocal(epoch)});
}
export function cursorP2016(value) { return Buffer.from(JSON.stringify(snapshotP2016(value)),'utf8').toString('base64url'); }
export function decodeCursorP2016(value,keys) {
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{10,2048}$/u.test(value))failP2016('CURSOR_INVALID');
  try { const parsed=exactP2016(JSON.parse(Buffer.from(value,'base64url').toString('utf8')),keys);if(cursorP2016(parsed)!==value)failP2016();return parsed; }
  catch { failP2016('CURSOR_INVALID'); }
}
export const localP2016=value=>assertLocalDateTime(value);
export async function transactionP2016(pool,run) {
  const tx=await pool.connect();let destroy=false;
  try { await tx.query('BEGIN');const result=await run(tx);await tx.query('COMMIT');return result; }
  catch(error){try{await tx.query('ROLLBACK');}catch{destroy=true;}throw error;}
  finally{tx.release(destroy);}
}
