import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
import {createP2016WorkbenchHttp} from '../app/server/src/p2-016-workbench-http.mjs';

test('internal-note receipt schema admits only safe closed UNKNOWN, COMMITTED and FAILED shapes',async()=>{
  const base={client_command_id:randomUUID(),ticket_id:randomUUID()};
  const committed={...base,state:'COMMITTED',result:{ok:true,ticket_id:base.ticket_id,ticket_version:3,ticket_event_id:randomUUID(),control_event_id:null,replayed:true}};
  const failed={...base,state:'FAILED',error:{code:'P2_016_VERSION_CONFLICT',retryable:false}};
  for(const value of [{...base,state:'UNKNOWN'},committed,failed])await assertP2016Schema('p2_016_internal_note_receipt',value);
  for(const value of [{...base,state:'UNKNOWN',result:committed.result},{...failed,result:committed.result},{...committed,error:failed.error},{...committed,note:'private'},{...failed,error:{code:'P2_016_VERSION_CONFLICT',retryable:true}},{...committed,result:{...committed.result,ticket_version:'3'}},{...base,state:'UNKNOWN',client_command_id:'bad'}])await assert.rejects(assertP2016Schema('p2_016_internal_note_receipt',value));
});

test('disabled receipt lookup never invokes its port and bootstrap advertises only enabled recovery and actual cookie logout',async()=>{
  let calls=0;
  const ports={query:{principal:async()=>({principal_id:randomUUID(),display_name:'synthetic',roles:['HANDLER']})},tickets:{internalNoteReceipt:async()=>{calls++;throw new Error('UNEXPECTED_RECEIPT_ACCESS');}},reviews:{},deliveryControl:{},enabled:true};
  const url=new URL('http://127.0.0.1/api/tickets/'+randomUUID()+'/internal-notes/commands/'+randomUUID());
  const invoke=async(options,requestUrl=url,authContext={auth_method:'COOKIE',csrf_token:'synthetic'})=>{
    let body;
    await createP2016WorkbenchHttp({...ports,...options})({request:{method:'GET'},response:{},url:requestUrl,authContext,json:(_response,_status,value)=>{body=value;}});
    return body;
  };
  for(const options of [{},{workbenchInternalNotesEnabled:true},{workbenchDraftRecoveryEnabled:true}])await assert.rejects(invoke(options),{code:'P2_016_DISABLED'});
  assert.equal(calls,0);
  const bootstrap=new URL('http://127.0.0.1/api/lifecycle/bootstrap');
  assert.equal((await invoke({},bootstrap)).draft_recovery_enabled,false);
  assert.equal((await invoke({},bootstrap)).logout_enabled,false);
  assert.equal((await invoke({workbenchDraftRecoveryEnabled:true},bootstrap)).draft_recovery_enabled,false);
  assert.equal((await invoke({workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true},bootstrap)).draft_recovery_enabled,true);
  for(const auth of [{auth_method:'BEARER',csrf_token:null},{auth_method:'COOKIE',csrf_token:''}])assert.equal((await invoke({logoutReady:()=>true},bootstrap,auth)).logout_enabled,false);
  assert.equal((await invoke({logoutReady:()=>true},bootstrap)).logout_enabled,true);
});
