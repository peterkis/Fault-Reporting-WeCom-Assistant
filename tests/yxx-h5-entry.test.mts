import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {PostgresTransaction} from '../app/server/src/platform/postgres-pool.mjs';
import type {YxxMemberScope} from '../app/server/src/yxx-self-service-authorization.mjs';
import {h5SupplementPage,readH5Supplements,withH5TimelineBudget} from '../app/server/src/yxx-h5-entry.mjs';
import {createYxxSelfServiceAuthorization} from '../app/server/src/yxx-self-service-authorization.mjs';

const secret='h5-entry-unit-secret-longer-than-thirty-two-bytes';
const ref='a'.repeat(32);
const scope:YxxMemberScope={scopeHash:createHash('sha256').update('synthetic-entry-unit').digest('hex') as YxxMemberScope['scopeHash'],sourceCorpScope:'synthetic-corp',sourceAppScope:'synthetic-app',proofRef:'entry-unit'};
function transaction(calls:string[]):PostgresTransaction{return {async query(text){calls.push(text);return {rows:[],rowCount:0,command:'TEST',oid:0,fields:[]};}};}

test('H5 entry timeline savepoint restores settings on success and only degrades explicit SQL timeout',async()=>{
 const calls:string[]=[],tx=transaction(calls);
 assert.deepEqual(await withH5TimelineBudget(tx,async()=>({items:[]})),{status:'READY',data:{items:[]}});
 assert.deepEqual(calls,['SAVEPOINT h5_entry_timeline',"SET LOCAL statement_timeout='250ms'",'ROLLBACK TO SAVEPOINT h5_entry_timeline','RELEASE SAVEPOINT h5_entry_timeline']);
 calls.length=0;
 assert.deepEqual(await withH5TimelineBudget(tx,async()=>{throw Object.assign(new Error('canceling statement due to statement timeout'),{code:'57014'});}),{status:'UNAVAILABLE',code:'YXX_UNAVAILABLE'});
 assert.equal(calls.at(-2),'ROLLBACK TO SAVEPOINT h5_entry_timeline');
 for(const error of [Object.assign(new Error('canceling statement due to user request'),{code:'57014'}),Object.assign(new Error('permission denied'),{code:'YXX_FORBIDDEN',status:403}),Object.assign(new Error('division by zero'),{code:'22012'})]){
  await assert.rejects(withH5TimelineBudget(tx,async()=>{throw error;}),value=>value===error);
 }
});

test('H5 supplement page is bounded, ascending for display, and cursor fenced to member and request',async()=>{
 const rows=Array.from({length:21},(_,index)=>({input_revision:String(30-index),text:'synthetic '+String(30-index)}));
 const page=h5SupplementPage(rows,scope,ref,'30',secret);
 assert.equal(page.items.length,20);assert.equal(page.items[0]?.input_revision,'11');assert.equal(page.items.at(-1)?.input_revision,'30');assert.ok(page.next_cursor);
 const calls:string[]=[],tx=transaction(calls);
 await assert.rejects(readH5Supplements(tx,{...scope,sourceAppScope:'other-app'},ref,secret,page.next_cursor),{code:'YXX_CURSOR_INVALID'});
 await assert.rejects(readH5Supplements(tx,scope,'b'.repeat(32),secret,page.next_cursor),{code:'YXX_CURSOR_INVALID'});
 await assert.rejects(readH5Supplements(tx,scope,ref,secret,page.next_cursor+'tampered'),{code:'YXX_CURSOR_INVALID'});
 assert.equal(calls.length,0);
 assert.equal(h5SupplementPage(rows.slice(0,20),scope,ref,'30',secret).next_cursor,null);
});

test('H5 composed READ operations use the original operation policy without another authentication',async()=>{
 let authenticated=0,rechecked=0;
 const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:false,YIXIAOXIU_MY_REPORTS_ENABLED:false};
 const current=()=>({profile:'MEMBER_TICKET_READONLY',flags,write_flag:false,scope,csrf_token:'synthetic-csrf'});
 const authorization=createYxxSelfServiceAuthorization<object>({profile:'MEMBER_TICKET_READONLY',flags,authenticate:async()=>{authenticated++;return current();},recheck:Object.assign(async()=>{rechecked++;return current();},{localOnly:true as const})});
 const context=await authorization.authorize({request:{},operation:'BOT_LIST',source:'BOT'});
 assert.equal(authorization.assertOperationAllowed(context,'BOT_TICKET','BOT'),true);
 assert.throws(()=>authorization.assertOperationAllowed(context,'WEB_TIMELINE','WEB'),{code:'YXX_MEMBER_READ_DISABLED'});
 assert.throws(()=>authorization.assertOperationAllowed(context,'MY_REPORTS',null),{code:'YXX_MEMBER_READ_DISABLED'});
 assert.equal(authenticated,1);assert.equal(rechecked,0);
});
