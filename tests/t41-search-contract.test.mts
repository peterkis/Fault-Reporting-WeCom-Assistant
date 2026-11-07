import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSearchRequest,parseSearchBody,normalizeSearchCriteria,searchCriteriaKey,searchParameters,hasSearchCriteria,SearchInputError} from '../shared/workbench-search-contracts.mjs';
import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {transpileModule,ModuleKind,ScriptTarget,createSourceFile,isImportDeclaration,isStringLiteral} from 'typescript';
import type {WorkbenchCard,BoardPage} from '../contracts/web01_workbench_contracts.js';
import type {WorkbenchSearchCriteria,WorkbenchSearchPage} from '../contracts/workbench_search_contracts.js';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';

test('search canonicalizes complete criteria without treating literal wildcard characters as a pattern',()=>{
 const raw=new URLSearchParams('q=%20%25_%20&sources=WECOM_GROUP,WECOM_DIRECT&statuses=QUEUED,NEW&limit=2');
 const input=parseSearchRequest(raw);
 assert.deepEqual(input,{criteria:{q:'%_',column:'all',range:'all',scope:'team',responsibility:'any',resolver_team_id:null,assignee_id:null,
  sources:['WECOM_DIRECT','WECOM_GROUP'],source_group_ref:null,statuses:['NEW','QUEUED'],supplement:'any',schedule:'any'},cursor:null,limit:2});
 assert.equal(raw.get('q'),' %_ ');
 assert.equal(searchCriteriaKey(input.criteria),searchCriteriaKey(parseSearchRequest(searchParameters(input.criteria)).criteria));
});
test('search rejects unknown or duplicate keys, array duplicates, controls and invalid enum instead of silently changing criteria',()=>{
 for(const query of ['q=a&q=b','unknown=x','sources=WECOM_GROUP,WECOM_GROUP','statuses=NEW,','statuses=VIEWER','q=%0Ahello','source_group_ref=same-name','responsibility=owner','supplement=read','range=cancelled']){
  assert.throws(()=>parseSearchRequest(new URLSearchParams(query)),SearchInputError,query);
 }
 const q='😀'.repeat(128);assert.equal(parseSearchRequest(new URLSearchParams({q})).criteria.q,q);
 assert.throws(()=>parseSearchRequest(new URLSearchParams({q:q+'x'})),SearchInputError);
 const original=parseSearchRequest(new URLSearchParams()).criteria;
 assert.throws(()=>normalizeSearchCriteria({...original,hidden_count:1}),SearchInputError);
 assert.throws(()=>normalizeSearchCriteria({...original,q:'\ud800'}),SearchInputError);
});
test('search bounds limit and opaque cursor separately',()=>{
 for(const value of ['0','101','01','1.5','Infinity'])assert.throws(()=>parseSearchRequest(new URLSearchParams({limit:value})),error=>error instanceof SearchInputError&&error.code==='LIMIT_INVALID');
 for(const value of ['', 'a'.repeat(2049),'/not-a-cursor'])assert.throws(()=>parseSearchRequest(new URLSearchParams({cursor:value})),error=>error instanceof SearchInputError&&error.code==='CURSOR_INVALID');
});
test('closure_kind is optional, closed, round-tripped and bound into canonical search criteria',()=>{
 const original=parseSearchRequest(new URLSearchParams()).criteria;
 assert.equal(Object.hasOwn(original,'closure_kind'),false);
 for(const closure_kind of ['completed','dismissed']){
  const criteria=parseSearchRequest(new URLSearchParams({closure_kind})).criteria;
  assert.equal(criteria.closure_kind,closure_kind);
  assert.notEqual(searchCriteriaKey(criteria),searchCriteriaKey(original));
  assert.equal(searchCriteriaKey(criteria),searchCriteriaKey(parseSearchRequest(searchParameters(criteria)).criteria));
 }
 for(const raw of ['closure_kind=','closure_kind=COMPLETED','closure_kind=all','closure_kind=completed&closure_kind=dismissed'])assert.throws(()=>parseSearchRequest(new URLSearchParams(raw)),SearchInputError);
 for(const value of [null,undefined,false])assert.throws(()=>normalizeSearchCriteria({...original,closure_kind:value}),SearchInputError);
});

test('B5 custom dates round-trip GET and POST with closure kind while legacy criteria keep their original shape',()=>{
 const legacy=parseSearchRequest(new URLSearchParams('range=recent&closure_kind=dismissed')).criteria;
 assert.equal(Object.hasOwn(legacy,'closed_from'),false);assert.equal(Object.hasOwn(legacy,'closed_to'),false);
 assert.equal(hasSearchCriteria(parseSearchRequest(new URLSearchParams()).criteria),false);
 assert.equal(hasSearchCriteria(parseSearchRequest(new URLSearchParams('range=custom&closed_from=2000-02-29&closed_to=2000-03-01')).criteria),true);
 assert.equal(searchParameters(legacy).toString(),'q=&column=all&range=recent&scope=team&responsibility=any&supplement=any&schedule=any&closure_kind=dismissed');
 for(const closure_kind of ['completed','dismissed'] as const){
  const request=parseSearchRequest(new URLSearchParams({range:'custom',closed_from:'2000-02-29',closed_to:'2000-03-01',closure_kind}));
  assert.equal(request.criteria.closed_from,'2000-02-29');assert.equal(request.criteria.closed_to,'2000-03-01');
  assert.deepEqual(parseSearchBody({criteria:request.criteria,cursor:null,limit:50}),request);
  assert.deepEqual(parseSearchRequest(searchParameters(request.criteria)).criteria,request.criteria);
  assert.equal(hasSearchCriteria(request.criteria),true);
  const changes:ReadonlyArray<Partial<WorkbenchSearchCriteria>>=[{closed_from:'2000-02-28'},{closed_to:'2000-03-02'},{closure_kind:closure_kind==='completed'?'dismissed':'completed'}];
  for(const change of changes){
   assert.notEqual(searchCriteriaKey({...request.criteria,...change}),searchCriteriaKey(request.criteria),'dates and closure kind remain in cursor criteria identity');
  }
 }
 for(const [closed_from,closed_to] of [['0001-01-01','0001-01-01'],['2024-02-29','2024-02-29'],['9999-12-30','9999-12-30']] as const){
  assert.equal(parseSearchRequest(new URLSearchParams({range:'custom',closed_from,closed_to})).criteria.closed_to,closed_to);
 }
});

test('B5 custom date guards reject impossible calendars, missing pairs, duplicates and dates on other ranges',()=>{
 const valid=parseSearchRequest(new URLSearchParams('range=custom&closed_from=2026-11-01&closed_to=2026-11-06')).criteria;
 for(const [closed_from,closed_to] of [['1900-02-29','1900-03-01'],['2026-02-30','2026-03-01'],['2026-04-31','2026-05-01'],['0000-01-01','2026-11-06'],['2026-13-01','2026-11-06'],['2026-11-07','2026-11-06'],['9999-12-30','9999-12-31'],['2026-11-01T00:00:00+08:00','2026-11-06']]){
  assert.throws(()=>parseSearchBody({criteria:{...valid,closed_from,closed_to},cursor:null,limit:50}),SearchInputError,JSON.stringify([closed_from,closed_to]));
 }
 for(const raw of ['range=custom','range=custom&closed_from=2026-11-01','range=custom&closed_to=2026-11-06',
  'range=custom&closed_from=2026-11-01&closed_to=2026-11-06&closed_from=2026-11-01',
  'range=custom&closed_from=2026-11-01&closed_to=2026-11-06&closed_to=2026-11-06',
  'range=all&closed_from=2026-11-01&closed_to=2026-11-06','range=recent&closed_from=2026-11-01',
  'range=custom&closed_from=2026-11-01&closed_to=2026-11-06&closed_until=2026-11-07']){
  assert.throws(()=>parseSearchRequest(new URLSearchParams(raw)),SearchInputError,raw);
 }
 const legacy=parseSearchRequest(new URLSearchParams()).criteria;
 for(const value of [null,undefined,false,'']){
  for(const key of ['closed_from','closed_to']){
   assert.throws(()=>parseSearchBody({criteria:{...legacy,[key]:value},cursor:null,limit:50}),SearchInputError);
   assert.throws(()=>parseSearchBody({criteria:{...valid,[key]:value},cursor:null,limit:50}),SearchInputError);
  }
 }
});

// As in the inbox contract tests, execute the actual browser decoder without booting the DOM app.
async function workbenchBrowserModule(){
 const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd(),cache=new Map<string,Promise<string>>();
 function moduleUrl(file:string):Promise<string>{const existing=cache.get(file);if(existing)return existing;
  const loaded=(async()=>{let code=transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022,verbatimModuleSyntax:true}}).outputText;
   for(const node of createSourceFile(file,code,ScriptTarget.ES2022,true).statements){if(!isImportDeclaration(node)||!isStringLiteral(node.moduleSpecifier))continue;const specifier=node.moduleSpecifier.text,path=resolve(dirname(file),specifier),target=specifier.startsWith('.')?await moduleUrl(path.endsWith('.mjs')?path.slice(0,-4)+'.mts':path.endsWith('.ts')?path:path+'.ts'):import.meta.resolve(specifier);code=code.replaceAll("'"+specifier+"'",JSON.stringify(target)).replaceAll('"'+specifier+'"',JSON.stringify(target));}
   return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');})();cache.set(file,loaded);return loaded;}
 const module:{api:{board:(column:'pending'|'active'|'closed',range:'all',cursor:null,signal:AbortSignal)=>Promise<BoardPage>;search:(criteria:WorkbenchSearchCriteria,cursor:null,signal:AbortSignal)=>Promise<WorkbenchSearchPage>}}=await import(await moduleUrl(resolve(root,'app/pc-admin/src/api/client.ts')));return module;
}
const closure:NonNullable<WorkbenchCard['closure']>={kind:'DISMISSED',source:'MANUAL',reason_code:'REPORTER_WITHDREW',reason_label:'报修人撤回',reason_note:'报修人撤回（合成）',secondary_reason:null,closed_by_display_name:'值班员（合成）',closed_at:'2026-11-06 09:00:00',duplicate_of:null,can_restore:true};
const cancelled:WorkbenchCard={kind:'ticket',id:'11111111-1111-4111-8111-111111111111',intake_id:'22222222-2222-4222-8222-222222222222',number:'T-001（合成）',title:'取消事项（合成）',status:'CANCELLED',column:'closed',priority:null,source:'WECOM_DIRECT',source_label:'单聊',source_group:null,location:null,reporter_name:null,assignee_name:null,review_reason:null,created_at:'2026-11-05 08:00:00',updated_at:'2026-11-06 09:01:00',completed_at:'2026-11-06 09:00:00',closure,service:null,stage_entered_at:'2026-11-06 09:00:00'};
test('default board and list decoders preserve closure and grouped counts, with no compatibility query',async t=>{
 const {api}=await workbenchBrowserModule(),range={mode:'all' as const,from:'2026-11-05 00:00:00',until:'2026-11-07 00:00:00',timezone:'Asia/Shanghai' as const};
 let body:unknown={items:[cancelled],next_cursor:null,column:'closed',range,group_counts:{completed:0,dismissed:1}};const urls:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:string|URL|Request)=>{urls.push(String(input));return Response.json(body);});
 const board=await api.board('closed','all',null,new AbortController().signal);
 assert.deepEqual(board.items[0]?.closure,closure);assert.deepEqual(board.group_counts,{completed:0,dismissed:1});
 assert.equal(new URL(urls[0]??'','http://127.0.0.1').searchParams.has('include_closure'),false);
 await assertP2016Schema('web01_workbench_board',body);
 const criteria=parseSearchRequest(new URLSearchParams('column=closed&closure_kind=dismissed')).criteria;
 const {service,stage_entered_at,...searchCard}=cancelled;assert.equal(service,null);assert.equal(stage_entered_at,closure.closed_at);
 body={items:[searchCard],next_cursor:null,column:'closed',range,criteria};
 const search=await api.search(criteria,null,new AbortController().signal);assert.deepEqual(search.items[0]?.closure,closure);
 assert.equal(new URL(urls.at(-1)??'','http://127.0.0.1').searchParams.get('closure_kind'),'dismissed');
 await assertP2016Schema('workbench_search_page',body);
 body={items:[{...searchCard,closure:{...closure,reason_note:null,closed_by_display_name:null}}],next_cursor:null,column:'closed',range,criteria};
 const normalized=await api.search(criteria,null,new AbortController().signal);assert.equal(normalized.items[0]?.closure?.reason_note,null);assert.equal(normalized.items[0]?.closure?.closed_by_display_name,null);
 await assertP2016Schema('workbench_search_page',body);
 body={items:[{...searchCard,reporter_department:'信息科（合成）',reporter_profile:{state:'UNAVAILABLE',source:null,captured_at:null},web_report_urge:{active:false,count:0,last_urged_at:null}}],next_cursor:null,column:'closed',range,criteria};
 const auxiliary=await api.search(criteria,null,new AbortController().signal);assert.equal(auxiliary.items[0]?.reporter_department,'信息科（合成）');assert.deepEqual(auxiliary.items[0]?.web_report_urge,{active:false,count:0,last_urged_at:null});
 await assertP2016Schema('workbench_search_page',body);
});
test('board decoder rejects missing closure or counts, false lifecycle kind, impossible time and private extensions',async t=>{
 const {api}=await workbenchBrowserModule(),range={mode:'all',from:'2026-11-05 00:00:00',until:'2026-11-07 00:00:00',timezone:'Asia/Shanghai'};
 let body:unknown;t.mock.method(globalThis,'fetch',async()=>Response.json(body));
 const page=(item:unknown,counts:unknown={completed:0,dismissed:1})=>({items:[item],next_cursor:null,column:'closed',range,group_counts:counts});
 const {closure:omitted,...without}=cancelled;assert.deepEqual(omitted,closure);
 const faults=[page(without),page({...cancelled,closure:null}),page({...cancelled,closure:{...closure,kind:'COMPLETED'}}),page({...cancelled,closure:{...closure,closed_at:'2026-02-30 09:00:00'}}),
  page({...cancelled,closure:{...closure,private_note:'hidden'}}),page({...cancelled,closure:{...closure,reason_note:'x'.repeat(2001)}}),page({...cancelled,closure:{...closure,source:'SYSTEM'}}),
  page(cancelled,null),page(cancelled,{completed:0,dismissed:-1}),page(cancelled,{completed:0,dismissed:1.5}),page(cancelled,{completed:0,dismissed:1,hidden_count:8}),
  {items:[cancelled],next_cursor:null,column:'closed',range}];
 faults.push({...page(cancelled),range:{...range,mode:'cancelled'}});
 for(const fault of faults){body=fault;await assert.rejects(api.board('closed','all',null,new AbortController().signal),{code:'INVALID_RESPONSE'});}
 const pendingBody={items:[{...cancelled,status:'NEW',column:'pending',closure:null}],next_cursor:null,column:'pending',range};body=pendingBody;
 assert.equal((await api.board('pending','all',null,new AbortController().signal)).items[0]?.closure,null);
 body={...pendingBody,group_counts:{completed:0,dismissed:0}};await assert.rejects(api.board('pending','all',null,new AbortController().signal),{code:'INVALID_RESPONSE'});
});

test('Card 27B contracts reject the removed cancelled range for board and list',async()=>{
 const range={mode:'cancelled',from:'2026-11-05 00:00:00',until:'2026-11-07 00:00:00',timezone:'Asia/Shanghai'};
 const criteria=parseSearchRequest(new URLSearchParams()).criteria;
 await assertP2016Schema('workbench_search_criteria',criteria);
 await assert.rejects(assertP2016Schema('web01_workbench_board',{items:[cancelled],next_cursor:null,column:'closed',range,group_counts:{completed:0,dismissed:1}}));
 await assert.rejects(assertP2016Schema('workbench_search_criteria',{...criteria,range:'cancelled'}));
 await assert.rejects(assertP2016Schema('workbench_search_page',{items:[],next_cursor:null,column:'closed',range,criteria}));
});

test('B5 custom date Schema requires the pair only for custom and keeps response mode consistent',async()=>{
 const legacy=parseSearchRequest(new URLSearchParams()).criteria;
 const criteria=parseSearchRequest(new URLSearchParams('range=custom&closed_from=2000-02-29&closed_to=2000-03-01&closure_kind=dismissed')).criteria;
 await assertP2016Schema('workbench_search_criteria',criteria);
 const page={items:[],next_cursor:null,column:'all',criteria,range:{mode:'custom',from:'2000-02-29 00:00:00',until:'2000-03-02 00:00:00',timezone:'Asia/Shanghai'}};
 await assertP2016Schema('workbench_search_page',page);
 for(const bad of [{...legacy,range:'custom'},{...legacy,closed_from:'2026-11-01'},{...legacy,closed_to:'2026-11-06'},
  {...criteria,closed_from:'0000-01-01'},{...criteria,closed_to:'9999-12-31'},{...criteria,closed_from:null}]){
  await assert.rejects(assertP2016Schema('workbench_search_criteria',bad));
 }
 await assert.rejects(assertP2016Schema('workbench_search_page',{...page,range:{...page.range,mode:'all'}}));
});

test('B5 browser decoder accepts the exact custom half-open window and rejects shifted, mismatched or extended dates',async t=>{
 const {api}=await workbenchBrowserModule(),criteria=parseSearchRequest(new URLSearchParams('range=custom&closed_from=2000-02-29&closed_to=2000-03-01&closure_kind=dismissed')).criteria;
 const range={mode:'custom',from:'2000-02-29 00:00:00',until:'2000-03-02 00:00:00',timezone:'Asia/Shanghai'};
 const page={items:[],next_cursor:null,column:'all',criteria,range};let body:unknown=page;const urls:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:string|URL|Request)=>{urls.push(String(input));return Response.json(body);});
 assert.deepEqual((await api.search(criteria,null,new AbortController().signal)).range,range);
 const url=new URL(urls[0]??'','http://127.0.0.1');assert.equal(url.searchParams.get('closed_from'),'2000-02-29');assert.equal(url.searchParams.get('closed_to'),'2000-03-01');assert.equal(url.searchParams.get('closure_kind'),'dismissed');
 for(const [closed_from,closed_to,from,until] of [['0001-01-01','0001-01-01','0001-01-01 00:00:00','0001-01-02 00:00:00'],['9999-12-30','9999-12-30','9999-12-30 00:00:00','9999-12-31 00:00:00']] as const){
  const edge=parseSearchRequest(new URLSearchParams({range:'custom',closed_from,closed_to})).criteria;
  body={...page,criteria:edge,range:{...range,from,until}};
  assert.equal((await api.search(edge,null,new AbortController().signal)).range.until,until);
 }
 const faults=[{...page,range:{...range,from:'2000-02-28 00:00:00'}},{...page,range:{...range,until:'2000-03-01 00:00:00'}},
  {...page,range:{...range,until:'2000-03-02 00:00:01'}},{...page,range:{...range,mode:'all'}},
  {...page,criteria:{...criteria,closed_to:'2000-03-02'}},{...page,criteria:{...criteria,closed_until:'2000-03-02'}},
  {...page,range:{...range,closed_to:'2000-03-01'}}];
 for(const fault of faults){body=fault;await assert.rejects(api.search(criteria,null,new AbortController().signal),{code:'INVALID_RESPONSE'});}
});
