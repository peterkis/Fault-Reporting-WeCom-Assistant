import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Socket} from 'node:net';
import {IncomingMessage,ServerResponse} from 'node:http';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
import {createWorkbenchConversations} from '../app/server/src/workbench-conversations.mjs';
import {createConversationWorkbenchQueryService} from '../app/server/src/p2-006-workbench-query.mjs';
import {createPilotWorkbenchAuthorizationAdapter} from '../app/server/src/p2-006-workbench-authorization.mjs';
import {createConversationWorkbenchCommandFacade} from '../app/server/src/p2-006-workbench-command-facade.mjs';
import {createWeb01WorkbenchQuery} from '../app/server/src/web01-workbench-query.mjs';
import {createP2016TicketQuery} from '../app/server/src/p2-016-ticket-query.mjs';
import {createP2016WorkbenchHttp} from '../app/server/src/p2-016-workbench-http.mjs';
import type {PostgresTransaction} from '../app/server/src/platform/postgres-pool.mjs';
type Context=Parameters<ReturnType<typeof createWorkbenchConversations>['handler']>[0];
const unexpected=async():Promise<never>=>{throw Error('UNEXPECTED_PORT_ACCESS');};
function fixture(){
 let calls=0;const pool:PostgresTransaction={query:async()=>{calls++;return unexpected();}},authorize=createPilotWorkbenchAuthorizationAdapter({pool}),query=createConversationWorkbenchQueryService({pool,authorize,enabled:true}),ticketQuery=createP2016TicketQuery({pool,enabled:true}),itemQuery=createWeb01WorkbenchQuery({pool,query:ticketQuery});
 const commands=createConversationWorkbenchCommandFacade({enabled:true,authorize,controlService:{requestHandoff:unexpected,takeoverSession:unexpected,transferAssignment:unexpected,releaseAssignment:unexpected,cancelHandoff:unexpected,advanceReadCursor:unexpected},communicationService:{commitExternalMessage:unexpected,commitInternalNote:unexpected},deliveryControl:{retry:unexpected,reconcile:unexpected}});
 return {pool,authorize,query,ticketQuery,itemQuery,commands,calls:()=>calls};
}
function context(path:string,method='GET',body:Record<string,unknown>={}):{value:Context;output:()=>unknown;close:()=>void}{
 const socket=new Socket(),request=new IncomingMessage(socket),response=new ServerResponse(request);request.method=method;let output:unknown;
 return {value:{request,response,url:new URL(path,'http://127.0.0.1'),authContext:{principal_id:randomUUID(),auth_method:'COOKIE',expires_epoch_ms:'253402271999000',csrf_token:'synthetic',public_origin:'http://127.0.0.1'},readJson:async()=>body,validateWriteRequest:()=>{throw Error('UNEXPECTED_WRITE_VALIDATION');},json:(_response,_status,value)=>{output=value;}},output:()=>output,close:()=>socket.destroy()};
}

test('workspace default-off and closed command input reject before any new fact or command port access',async()=>{
 const f=fixture(),id=randomUUID(),disabled=createWorkbenchConversations(f),off=context('/api/workbench/conversations');
 try{await assert.rejects(disabled.handler(off.value),{status:503});}finally{off.close();}assert.equal(f.calls(),0);
 const enabled=createWorkbenchConversations({...f,enabled:true});
 for(const [action,extra]of [['messages',{target_id:'private canary'}],['messages',{reply_to_item_id:randomUUID()}],['internal-notes',{external_visible:true}],['release',{target_principal_id:randomUUID()}]] as const){const c=context('/api/workbench/conversations/'+id+'/'+action,'POST',{client_command_id:randomUUID(),expected_row_version:1,text:'synthetic',...extra});try{await assert.rejects(enabled.handler(c.value),{code:'P2_016_INPUT_INVALID'});}finally{c.close();}}
 assert.equal(f.calls(),0);
});

test('purpose-specific recovery capability is independent of old Notes and requires raw recovery plus actual workspace capability',async()=>{
 const f=fixture(),principal={principal_id:randomUUID(),display_name:'synthetic',is_active:true,roles:['ADMIN'],team_ids:[]};const query=createP2016TicketQuery({pool:f.pool,enabled:true,authorization:{...f.authorize,resolvePrincipal:async()=>principal}});
 const ports={query,tickets:{perform:unexpected,internalNoteReceipt:unexpected},reviews:{manualReviewReceipt:unexpected,listManualReviews:unexpected,getManualReviewDetail:unexpected,journey:unexpected,resolveManualReview:unexpected},deliveryControl:{perform:unexpected},enabled:true};
 for(const [workspace,recovery,expected]of [[false,false,false],[false,true,false],[true,false,false],[true,true,true]] as const){const c=context('/api/lifecycle/bootstrap');try{await createP2016WorkbenchHttp({...ports,workbenchConversationsEnabled:workspace,workbenchDraftRecoveryEnabled:recovery})(c.value);const body=c.output();assert.ok(body&&typeof body==='object'&&'conversation_draft_recovery_enabled' in body&&'draft_recovery_enabled' in body&&'conversation_workspace_enabled' in body);assert.equal(body.conversation_workspace_enabled,workspace);assert.equal(body.conversation_draft_recovery_enabled,expected);assert.equal(body.draft_recovery_enabled,false);}finally{c.close();}}
 assert.equal(f.calls(),0);
});

test('closed text and safe receipt schemas preserve original identities without private payload or target disclosure',async()=>{
 const base={session_id:randomUUID(),client_command_id:randomUUID()},result={message_id:randomUUID(),outbox_id:randomUUID(),delivery_ids:[randomUUID()],command_status:'REPLAYED',replayed:true,created_at:'2026-10-08 09:00:00'},command={client_command_id:base.client_command_id,expected_row_version:1,text:'synthetic reply'};
 await assertP2016Schema('workbench_conversation_text_command',command);for(const value of [{...command,target_id:'canary'},{...command,reply_to_item_id:randomUUID()},{...command,expected_row_version:Number.MAX_SAFE_INTEGER+1},{...command,text:''},{...command,text:'x'.repeat(20481)},{...command,client_command_id:'invalid'}])await assert.rejects(assertP2016Schema('workbench_conversation_text_command',value));
 for(const value of [{...base,state:'UNKNOWN'},{...base,state:'COMMITTED',result}])await assertP2016Schema('workbench_conversation_command_receipt',value);
 for(const value of [{...base,state:'UNKNOWN',result},{...base,state:'COMMITTED',result:{...result,text:'private canary'}},{...base,state:'COMMITTED',result:{...result,target_id:'private canary'}},{...base,state:'UNKNOWN',purpose:'INTERNAL_NOTE'},{...base,state:'FAILED'}])await assert.rejects(assertP2016Schema('workbench_conversation_command_receipt',value));
 const page={session_id:base.session_id,items:[{item_id:randomUUID(),sequence_no:'1',item_type:'INTERNAL_NOTE',sender_kind:'AGENT',visibility:'RESTRICTED',text:'synthetic restricted material',occurred_at:result.created_at}],before_sequence:'1',after_sequence:'1',has_more:false};
 await assertP2016Schema('workbench_conversation_item_page',page);await assert.rejects(assertP2016Schema('workbench_conversation_item_page',{...page,items:[{...page.items[0],target_id:'private canary'}]}));
});


