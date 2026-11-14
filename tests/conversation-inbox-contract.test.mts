import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {conversationInboxCriteria} from '../app/server/src/workbench-conversation-inbox.mjs';
import {conversationReference} from '../app/server/src/conversation-topic-scope.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {transpileModule,ModuleKind,ScriptTarget,createSourceFile,isImportDeclaration,isStringLiteral} from 'typescript';

// Execute the actual closed frontend decoders, including their existing API datetime guard.
async function inboxBrowserModule(){
  const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd(),cache=new Map<string,Promise<string>>();
  function moduleUrl(file:string):Promise<string>{const existing=cache.get(file);if(existing)return existing;
    const loaded=(async()=>{let code=transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022,verbatimModuleSyntax:true}}).outputText;
      for(const node of createSourceFile(file,code,ScriptTarget.ES2022,true).statements){if(!isImportDeclaration(node)||!isStringLiteral(node.moduleSpecifier))continue;const specifier=node.moduleSpecifier.text,path=resolve(dirname(file),specifier),target=specifier.startsWith('.')?await moduleUrl(path.endsWith('.mjs')?path.slice(0,-4)+'.mts':path.endsWith('.ts')?path:path+'.ts'):import.meta.resolve(specifier);code=code.replaceAll("'"+specifier+"'",JSON.stringify(target)).replaceAll('"'+specifier+'"',JSON.stringify(target));}
      return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');})();cache.set(file,loaded);return loaded;}
  const module:{decodeInboxEntry:(value:unknown)=>{waiting_since?:string|null};decodeChatEntry:(value:unknown)=>{waiting_since?:string|null};decodeConversationSummary:(value:unknown)=>unknown;conversationSummaryQuery:(principal:{principal_id:string;conversation_workspace_enabled:boolean;conversation_inbox_enabled:boolean})=>{queryKey:readonly string[];enabled:boolean;refetchOnWindowFocus:boolean;queryFn:(context:{signal:AbortSignal})=>Promise<unknown>}}=await import(await moduleUrl(resolve(root,'app/pc-admin/src/features/conversations/inbox-client.ts')));return module;
}
test('inbox criteria are closed, bounded and preserve explicit origin filters',()=>{
  const url=(q:string)=>new URL('/api/workbench/conversation-inbox'+q,'http://127.0.0.1');
  assert.deepEqual(conversationInboxCriteria(url('')),{state:'open',source:'all',q:'',group:null,limit:30});
  for(const q of ['?target_id=x','?state=open&state=mine','?limit=101','?limit=0','?q='+('字'.repeat(129)),'?source=H5','?source_group_ref=raw-id','?q=%00'])assert.throws(()=>conversationInboxCriteria(url(q)));
});
test('contact and topic references separate purposes, bot accounts and real participants',()=>{
  const key='synthetic-only-identity-key',identity={provider:'WECOM_AIBOT',channel_account_id:'private-bot',participant_key:'private-person'};
  const contact=conversationReference(key,'contact',identity);assert.match(contact,/^cci_v1_[a-f0-9]{64}$/u);assert.equal(contact.includes('private'),false);
  assert.equal(contact,conversationReference(key,'contact',identity));assert.notEqual(contact,conversationReference(key,'contact',{...identity,participant_key:'another-person'}));assert.notEqual(contact,conversationReference(key,'contact',{...identity,channel_account_id:'another-bot'}));assert.notEqual(contact,conversationReference(key,'topic',identity,'journey:one'));
});

test('waiting projection accepts only explicit booleans and does not change existing cursor criteria',()=>{
  const url=(q:string)=>new URL('/api/workbench/conversation-inbox'+q,'http://127.0.0.1');
  for(const value of ['true','false'])assert.deepEqual(conversationInboxCriteria(url('?include_waiting_since='+value)),conversationInboxCriteria(url('')));
  for(const value of ['','1','TRUE','null','true&include_waiting_since=false'])assert.throws(()=>conversationInboxCriteria(url('?include_waiting_since='+value)));
});
test('the forward inbox schema rejects identity disclosure and retains explicit internal preview semantics',async()=>{
  const identity={provider:'WECOM_AIBOT',channel_account_id:'b',participant_key:'p'},contact={contact_ref:conversationReference('synthetic-key-for-test','contact',identity),participant_label:'合成报修人',department_label:null,anchor_session_id:randomUUID(),matching_topic_count:1,latest_activity_at:'2026-10-17 09:00:00',last_item_preview:null,unread_count:0,source_badges:[{kind:'group',label:'企微群聊',ref:'a'.repeat(64)}],additional_source_count:0,assignment_summary:{kind:'UNASSIGNED',label:'待接待'},has_delivery_exception:false};
  await assertP2016Schema('workbench_conversation_inbox_page',{items:[contact],next_cursor:null});
  for(const waiting_since of [null,'2026-11-05 08:00:00'])await assertP2016Schema('workbench_conversation_inbox_page',{items:[{...contact,waiting_since}],next_cursor:null});
  for(const waiting_since of [0,'2026-02-30 08:00:00','2026-11-05T08:00:00+08:00'])await assert.rejects(assertP2016Schema('workbench_conversation_inbox_page',{items:[{...contact,waiting_since}],next_cursor:null}));
  for(const extra of [{participant_key:'canary'},{userid:'canary'},{target_id:'canary'}])await assert.rejects(assertP2016Schema('workbench_conversation_inbox_page',{items:[{...contact,...extra}],next_cursor:null}));
});

test('summary is a closed numeric read projection with a strict local calculation time',async()=>{
  const summary={unassigned_contact_count:0,my_unread_count:0,as_of:'2026-11-05 09:00:00'};
  await assertP2016Schema('workbench_conversation_inbox_summary',summary);
  for(const extra of [{unassigned_contact_count:-1},{my_unread_count:0.5},{my_unread_count:null},{as_of:'2026-02-30 09:00:00'},{as_of:'2026-11-05T09:00:00+08:00'},{principal_id:randomUUID()}])await assert.rejects(assertP2016Schema('workbench_conversation_inbox_summary',{...summary,...extra}));
});

test('B1–B4 frontend accepts only the new optional waiting projection and closed summary',async()=>{
  const {decodeInboxEntry,decodeChatEntry,decodeConversationSummary}=await inboxBrowserModule();
  const id=randomUUID(),contact={contact_ref:'cci_v1_'+'a'.repeat(64),participant_label:'报修人（合成）',department_label:null,anchor_session_id:id,matching_topic_count:1,latest_activity_at:'2026-11-05 09:00:00',last_item_preview:null,unread_count:0,source_badges:[],additional_source_count:0,assignment_summary:{kind:'UNASSIGNED',label:'待接待'},has_delivery_exception:false};
  const chat={session:{session_id:id,status:'OPEN',control_mode:'HUMAN',generation_version:1,row_version:1,last_activity_at:contact.latest_activity_at},participant_label:contact.participant_label,topic:'主题（合成）',channel_label:'群',canonical_item:null,assignment:{status:'UNASSIGNED',assigned_to_me:false,assigned_display_name:null},handoff:null,capabilities:[],contact_ref:contact.contact_ref,topic_ref:'ctp_v1_'+'b'.repeat(64),department_label:null,original_source:{kind:'group',label:'群（合成）',ref:'c'.repeat(64)},current_contact_channel:'group',reply_channel_label:'私聊'};
  for(const [decode,value] of [[decodeInboxEntry,contact],[decodeChatEntry,chat]] as const){
    assert.equal(Object.hasOwn(decode(value),'waiting_since'),false,'old payload remains supported');
    for(const waiting_since of [null,'2026-11-05 08:00:00'])assert.equal(decode({...value,waiting_since}).waiting_since,waiting_since);
    for(const extra of [{waiting_since:'2026-02-30 08:00:00'},{waiting_since:0},{waiting_since:undefined},{waiting_since:'2026-11-05T08:00:00Z'},{private_identity:'canary'}])assert.throws(()=>decode({...value,...extra}),/INVALID_RESPONSE/u);
  }
  const summary={unassigned_contact_count:3,my_unread_count:101,as_of:'2026-11-05 09:00:00'};assert.deepEqual(decodeConversationSummary(summary),summary);
  for(const extra of [{unassigned_contact_count:-1},{my_unread_count:1.5},{my_unread_count:null},{as_of:'2026-02-30 09:00:00'},{private_identity:'canary'}])assert.throws(()=>decodeConversationSummary({...summary,...extra}),/INVALID_RESPONSE/u);
});
test('B1/B5 auxiliary summary failures hide counts without hiding authority or aborted reads',async t=>{
  const {conversationSummaryQuery}=await inboxBrowserModule(),principal={principal_id:randomUUID(),conversation_workspace_enabled:true,conversation_inbox_enabled:true},query=conversationSummaryQuery(principal),signal=new AbortController().signal;
  assert.deepEqual(query.queryKey,['conversation-inbox',principal.principal_id,'summary']);assert.equal(query.enabled,true);assert.equal(query.refetchOnWindowFocus,false);
  assert.equal(conversationSummaryQuery({...principal,conversation_inbox_enabled:false}).enabled,false);assert.equal(conversationSummaryQuery({...principal,conversation_workspace_enabled:false}).enabled,false);
  let response:()=>Promise<Response>=async()=>new Response('',{status:503});const paths:string[]=[];
  t.mock.method(globalThis,'fetch',async(input:string|URL|Request)=>{paths.push(String(input));return response();});
  assert.equal(await query.queryFn({signal}),null);
  response=async()=>new Response('{}');assert.equal(await query.queryFn({signal}),null);
  const valid={unassigned_contact_count:0,my_unread_count:0,as_of:'2026-11-05 09:00:00'};response=async()=>new Response(JSON.stringify(valid),{headers:{'content-type':'application/json'}});assert.deepEqual(await query.queryFn({signal}),valid);
  response=async()=>{throw new TypeError('synthetic network failure');};assert.equal(await query.queryFn({signal}),null);
  for(const status of [401,403]){response=async()=>new Response('{}',{status});await assert.rejects(query.queryFn({signal}));}
  response=async()=>{throw new DOMException('synthetic cancellation','AbortError');};await assert.rejects(query.queryFn({signal}),{name:'AbortError'});
  const abort=new AbortController();abort.abort();await assert.rejects(query.queryFn({signal:abort.signal}));
  assert.ok(paths.every(path=>path==='/api/workbench/conversations/summary'),'summary has no filters or query parameters');
});
