import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {setImmediate} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Writable} from 'node:stream';
import {createElement,type ComponentType} from 'react';
import {renderToPipeableStream} from 'react-dom/server';
import {transpileModule,ModuleKind,ScriptTarget,JsxEmit} from 'typescript';
import {createH5PureModuleLoader} from './helpers/h5-pure-module-loader.mjs';

// The production package targets browsers. Keep its DOM declarations out of the Node-only test lane.
const queryCoreSpecifier='@tanstack/query-core';
const{QueryClient,InfiniteQueryObserver,QueryObserver}=await import(queryCoreSpecifier);
interface TestQueryClient {
 getQueryData<T>(key:readonly unknown[]):T|undefined;
 setQueryData<T>(key:readonly unknown[],value:T):unknown;
 getQueryState(key:readonly unknown[]):{fetchStatus:string;isInvalidated:boolean}|undefined;
 removeQueries(options:{queryKey:readonly unknown[];exact?:boolean}):void;
 invalidateQueries(options:{queryKey:readonly unknown[];exact?:boolean;refetchType:'none'}):Promise<void>;
 clear():void;
}

const ref='11111111111111111111111111111111';
function deferred<T>(){let complete:(value:T)=>void=()=>{throw new Error('Deferred not initialized');};const promise=new Promise<T>(resolve=>{complete=resolve;});return{promise,resolve:(value:T)=>complete(value)};}
async function until(predicate:()=>boolean,label:string){for(let attempt=0;attempt<100;attempt+=1){if(predicate())return;await setImmediate();}assert.fail(label);}
function bootstrap(scope='scope-a',canViewDepartment=false){return{authenticated:true,identity_mode:'MEMBER_SELF_SERVICE',read_only:false,can_submit:true,can_supplement:true,csrf_token:'synthetic-csrf',recovery_scope:scope,h5:{profile:{name:null,department:null,phone:null,avatar_url:null},can_upload:true,can_urge:true,can_evaluate:true,can_view_department:canViewDepartment,sdk:{enabled:false,corp_id:null,agent_id:null},support:{emergency_phone:'18117887318',service_phone:'61318500'},limits:{voice_count:1,voice_duration_seconds:60,voice_bytes:5*1024*1024,image_count:6,image_bytes:10*1024*1024,video_count:1,video_duration_seconds:60,video_bytes:20*1024*1024,total_bytes:40*1024*1024}}};}
function detail(version:number){return{request_ref:ref,intake_no:'SYNTHETIC',source_kind:'WEB_REQUEST',input_revision:'1',processed_revision:'1',display_status:'TICKET_CREATED',needs_action:null,safe_description:'Synthetic fault',supplements:[],supplements_cursor:null,safe_location:null,created_at:'2026-10-20 12:00:00',created_epoch_ms:'1792468800000',updated_at:'2026-10-20 12:00:00',updated_epoch_ms:'1792468800000',ticket:{ticket_no:'SYNTHETIC-1',status:'IN_PROGRESS'},safe_clarification:null,can_supplement:true,h5:{ticket_version:version,media:[],handler:null,public_progress:null,urge:{active:false,count:0,last_urged_at:null,last_urged_epoch_ms:null,next_allowed_at:null,next_allowed_epoch_ms:null,can_urge:true},evaluation:{can_evaluate:false,completed_round_ref:null,completed_round_no:null,ticket_version:version,rating:null,comment:null,evaluated_at:null,evaluated_epoch_ms:null},intent:'FAULT'}};}
function timeline(label:string){return{items:[{event_type:'TICKET_UPDATED',occurred_at:'2026-10-20 12:00:00',occurred_epoch_ms:'1792468800000',summary:label,ticket:{ticket_no:'SYNTHETIC-1',status:'IN_PROGRESS'}}],next_cursor:'cursor-'+label};}
function entry(version:number,scope='scope-a',revision='membership-a'){return{schema_version:1,view:'request',bootstrap:bootstrap(scope),membership_revision:revision,data:{detail:detail(version),timeline:{status:'READY',data:timeline('entry-'+version)}}};}
function homeEntry(total:number,scope='scope-a',revision='membership-a',canViewDepartment=true){return{schema_version:1,view:'home',bootstrap:bootstrap(scope,canViewDepartment),membership_revision:revision,data:{recent_reports:[{kind:'WEB_REQUEST',ref,display_status:'TICKET_CREATED',created_at:'2026-10-20 12:00:00',created_epoch_ms:'1792468800000',ticket:{ticket_no:'SYNTHETIC-1',status:'IN_PROGRESS'},safe_summary:'home-'+total}],department_summary:canViewDepartment?{total,active_count:Math.min(1,total),membership_revision:revision}:null}};}
function response(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});}
const routingStub="export function initialRoute(){return {key:JSON.stringify({view:'request',request_ref:'"+ref+"'}),input:{view:'request',request_ref:'"+ref+"'},path:'/requests/"+ref+"'};} export async function loadPage(){return {default:()=>null};}";

async function harness(t:TestContext,options:{home?:ReturnType<typeof homeEntry>}={}){
 const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),events=new EventTarget();
 const document=Object.assign(new EventTarget(),{visibilityState:'visible',documentElement:{dataset:{} as Record<string,string|undefined>}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:document});Object.defineProperty(globalThis,'window',{configurable:true,value:events});
 const homeRouting="export function initialRoute(){return{key:JSON.stringify({view:'home'}),input:{view:'home'},path:'/'};}export async function loadPage(){return{default:()=>null};}";
 const loader=createH5PureModuleLoader({overrides:{'routing.ts':options.home?homeRouting:routingStub}});
 const runtimeModule=await import(await loader.moduleUrl('page-runtime.ts')),query=await import(await loader.moduleUrl('api/query.ts')),transport=await import(await loader.moduleUrl('api/client.ts'));
 const calls:{url:string;options:RequestInit;reply:ReturnType<typeof deferred<Response>>}[]=[];
 t.mock.method(globalThis,'fetch',async(input:Parameters<typeof fetch>[0],options:RequestInit={})=>{const reply=deferred<Response>();calls.push({url:String(input),options,reply});return reply.promise;});
 const client:TestQueryClient=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity,staleTime:30_000,refetchOnWindowFocus:false,refetchOnReconnect:false,refetchOnMount:false}}});
 const runtime=new runtimeModule.PageRuntime(client);
 t.after(()=>{runtime.stop();client.clear();if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document');if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else Reflect.deleteProperty(globalThis,'window');});
 runtime.start();await until(()=>calls.length===1,'initial entry must start before page completion');calls[0]?.reply.resolve(response(options.home??entry(1)));await until(()=>runtime.getSnapshot().ready,'initial actual entry must be seeded');
 return{client,runtime,query,transport,calls,events,document};
}

function tabRoute(view:'home'|'reports'|'report'){return{key:JSON.stringify({view}),input:{view},path:view==='home'?'/':'/'+view};}
function tabEntry(view:'home'|'reports'|'report'){
 if(view==='home')return homeEntry(4);
 return{schema_version:1,view,bootstrap:bootstrap('scope-a',true),membership_revision:'membership-a',data:view==='report'?null:{reports:{items:homeEntry(4).data.recent_reports,next_cursor:null}}};
}

test('H5 rapid tab revisit keeps fresh authorized home content without repeating entry',async t=>{
 const{runtime,calls}=await harness(t,{home:homeEntry(4)});
 for(const view of ['reports'] as const){const before=calls.length,pending=runtime.navigate(tabRoute(view));await until(()=>calls.length===before+1,'a cold tab starts its entry');calls[before]?.reply.resolve(response(tabEntry(view)));await pending;}
 const before=calls.length,pending=runtime.navigate(tabRoute('home')),snapshot=runtime.getSnapshot();
 const observed={additional_entries:calls.length-before,ready:snapshot.ready,checking:snapshot.checking,session_present:snapshot.session!==null};t.diagnostic(JSON.stringify({revisit:observed}));
 if(calls.length>before)calls[before]?.reply.resolve(response(homeEntry(4)));await pending;
 assert.deepEqual(observed,{additional_entries:0,ready:true,checking:false,session_present:true},'same-scope home is already warm inside the 30-second freshness window');
});

test('H5 rapid tab return cancels the abandoned cold request while retaining the warm destination',async t=>{
 const{runtime,client,query,calls}=await harness(t,{home:homeEntry(4)}),abandoned=runtime.navigate(tabRoute('reports')).catch((error:unknown)=>error);await until(()=>calls.length===2,'the first cold destination remains genuinely pending');
 const before=calls.length,returned=runtime.navigate(tabRoute('home')),snapshot=runtime.getSnapshot(),observed={abandoned_aborted:calls[1]?.options.signal?.aborted,additional_entries:calls.length-before,ready:snapshot.ready,checking:snapshot.checking};
 if(calls.length>before)calls[before]?.reply.resolve(response(homeEntry(4)));await returned;calls[1]?.reply.resolve(response(tabEntry('reports')));const stopped=await abandoned;assert.ok(stopped instanceof DOMException);assert.equal(stopped.name,'AbortError');
 assert.equal(client.getQueryData(query.queryKeys.reports('scope-a',{q:'',status:'',source:''})),undefined,'a late abandoned response cannot install its private data');t.diagnostic(JSON.stringify({rapid_return:observed}));
 assert.deepEqual(observed,{abandoned_aborted:true,additional_entries:0,ready:true,checking:false});
});

test('H5 warm entry stamps expire at thirty seconds without sliding on cache reads or navigation',async t=>{
 const{runtime,calls}=await harness(t,{home:homeEntry(4)}),route=tabRoute('home'),initial=runtime.getSnapshot(),now=Date.now();let clock=now;t.mock.method(Date,'now',()=>clock);
 let notifications=0;const off=runtime.subscribe(()=>{notifications+=1;});t.after(off);
 assert.equal(runtime.canUseCached(route),true);assert.equal(runtime.canUseCached(route),true);assert.equal(runtime.getSnapshot(),initial);assert.equal(notifications,0,'cache selection must be a synchronous read');
 clock=now+20_000;await runtime.navigate(route);assert.equal(calls.length,1);
 clock=now+30_001;assert.equal(runtime.canUseCached(route),false,'warm navigation did not renew the authorization stamp');const renewed=runtime.navigate(route);await until(()=>calls.length===2,'the expired current route must read entry again');calls[1]?.reply.resolve(response(homeEntry(5)));await renewed;assert.equal(runtime.canUseCached(route),true);
});

for(const missing of ['home','summary','bootstrap','membership'] as const)test('H5 warm home requires its '+missing+' Query data even when its verified stamp is fresh',async t=>{
 const{client,runtime,query,calls}=await harness(t,{home:homeEntry(4)}),route=tabRoute('home'),keys={home:query.queryKeys.home('scope-a'),summary:query.queryKeys.departmentSummary('scope-a','membership-a'),bootstrap:query.queryKeys.bootstrap,membership:query.queryKeys.membership('scope-a')};
 assert.equal(runtime.canUseCached(route),true);client.removeQueries({queryKey:keys[missing],exact:true});assert.equal(runtime.canUseCached(route),false);
 const renewed=runtime.navigate(route);await until(()=>calls.length===2,'missing page data requires a new entry, including on the current route');calls[1]?.reply.resolve(response(homeEntry(7)));await renewed;assert.equal(runtime.canUseCached(route),true);
});

test('H5 invalidated warm data cannot bypass entry and the reports filter is part of its identity',async t=>{
 const{client,runtime,query,calls}=await harness(t,{home:homeEntry(4)}),route=tabRoute('reports'),opened=runtime.navigate(route);await until(()=>calls.length===2,'the unfiltered list is cold');calls[1]?.reply.resolve(response(tabEntry('reports')));await opened;
 const input={view:'reports',search:'printer',status:null,source:null},filtered={key:JSON.stringify(input),input,path:'/reports?search=printer'};assert.equal(runtime.canUseCached(route),true);assert.equal(runtime.canUseCached(filtered),false);
 await client.invalidateQueries({queryKey:query.queryKeys.reports('scope-a',{q:'',status:'',source:''}),exact:true,refetchType:'none'});assert.equal(runtime.canUseCached(route),false);const renewed=runtime.navigate(route);await until(()=>calls.length===3,'explicit invalidation forces current-list entry');calls[2]?.reply.resolve(response(tabEntry('reports')));await renewed;assert.equal(runtime.canUseCached(route),true);
});

test('H5 request cache requires complete detail and page chains while an unavailable timeline remains an explicit complete section',async t=>{
 const{client,runtime,query,calls}=await harness(t),route=runtime.getSnapshot().route;assert.equal(runtime.canUseCached(route),true);
 const supplements=query.queryKeys.supplements('scope-a',ref),timelineKey=query.queryKeys.timeline('scope-a',ref),section=query.queryKeys.timelineSection('scope-a',ref);
 client.setQueryData(supplements,{pages:[],pageParams:[]});assert.equal(runtime.canUseCached(route),false);client.setQueryData(supplements,{pages:[{items:[],next_cursor:null}],pageParams:[null]});assert.equal(runtime.canUseCached(route),true);
 client.removeQueries({queryKey:timelineKey,exact:true});assert.equal(runtime.canUseCached(route),false,'READY cannot hide a missing timeline page');client.setQueryData(section,'UNAVAILABLE');assert.equal(runtime.canUseCached(route),true,'an intentionally unavailable timeline offers its existing retry path');
 await client.invalidateQueries({queryKey:section,exact:true,refetchType:'none'});assert.equal(runtime.canUseCached(route),false);assert.equal(calls.length,1,'cache inspection never starts an implicit fetch');
});

test('H5 route stamps are bounded to eight entries and warming a route does not discard its Query-independent identity checks',async t=>{
 const{runtime,calls}=await harness(t,{home:homeEntry(4)}),routes=[];
 for(let index=0;index<8;index+=1){const input={view:'reports',search:'filter-'+index,status:null,source:null},route={key:JSON.stringify(input),input,path:'/reports?search=filter-'+index};routes.push(route);const pending=runtime.navigate(route);await until(()=>calls.length===index+2,'each distinct filter needs its first authorization');calls[index+1]?.reply.resolve(response(tabEntry('reports')));await pending;}
 assert.equal(runtime.canUseCached(tabRoute('home')),false,'the ninth distinct successful entry evicts the oldest stamp');for(const route of routes)assert.equal(runtime.canUseCached(route),true);assert.equal(calls.length,9);
});

test('H5 foreground events close writes immediately and merge into one entry without allowing a warm navigation escape',async t=>{
 const{runtime,calls,events}=await harness(t,{home:homeEntry(4)});t.mock.timers.enable({apis:['setTimeout']});
 events.dispatchEvent(new Event('focus'));assert.equal(runtime.getSnapshot().checking,true,'write gating precedes the 250ms debounce');assert.equal(runtime.canUseCached(tabRoute('home')),false);
 for(const name of ['pageshow','online','focus'])events.dispatchEvent(new Event(name));t.mock.timers.tick(249);assert.equal(calls.length,1);t.mock.timers.tick(1);await until(()=>calls.length===2,'one coalesced foreground entry starts');
 const same=runtime.navigate(tabRoute('home'));assert.equal(calls.length,2,'a route effect joins the actual pending entry');assert.equal(runtime.getSnapshot().checking,true);calls[1]?.reply.resolve(response(homeEntry(8)));await same;assert.equal(runtime.getSnapshot().checking,false);assert.equal(runtime.canUseCached(tabRoute('home')),true);
});

test('H5 a foreground recheck failure cannot be unlocked by a fresh warm-route stamp',async t=>{
 const{runtime,calls,events}=await harness(t,{home:homeEntry(4)});t.mock.timers.enable({apis:['setTimeout']});events.dispatchEvent(new Event('focus'));t.mock.timers.tick(250);await until(()=>calls.length===2,'recheck starts');calls[1]?.reply.resolve(response({error:{code:'YXX_UNAVAILABLE'}},503));await until(()=>runtime.getSnapshot().error!==null,'failure is observed');
 assert.equal(runtime.canUseCached(tabRoute('home')),false);const retried=runtime.navigate(tabRoute('home'));await until(()=>calls.length===3,'navigation retries actual authorization rather than treating old data as current');calls[2]?.reply.resolve(response(homeEntry(8)));await retried;assert.equal(runtime.canUseCached(tabRoute('home')),true);
});

for(const change of ['scope','revision','generation'] as const)test('H5 '+change+' change fences previously warm route stamps',async t=>{
 const{runtime,transport,calls}=await harness(t,{home:homeEntry(4)}),reports=runtime.navigate(tabRoute('reports'));await until(()=>calls.length===2,'reports acquires its own verified stamp');calls[1]?.reply.resolve(response(tabEntry('reports')));await reports;assert.equal(runtime.canUseCached(tabRoute('home')),true);
 if(change==='generation')transport.advanceAuthGeneration();else{const updated=runtime.refresh();await until(()=>calls.length===3,'scope/revision is checked by entry');const value=tabEntry('reports');calls[2]?.reply.resolve(response({...value,bootstrap:bootstrap(change==='scope'?'scope-b':'scope-a',true),membership_revision:change==='revision'?'membership-b':'membership-a'}));await updated;}
 assert.equal(runtime.canUseCached(tabRoute('home')),false,'a prior authorization cannot be reused in a different member context');
});

test('H5 resume after an expired session permits a fresh authorization attempt instead of a permanent denied state',async t=>{
 const{runtime,calls,events}=await harness(t,{home:homeEntry(4)});t.mock.timers.enable({apis:['setTimeout']});
 events.dispatchEvent(new Event('focus'));t.mock.timers.tick(250);await until(()=>calls.length===2,'the first real focus refresh starts');
 calls[1]?.reply.resolve(response({error:{code:'YXX_AUTH_REQUIRED'}},401));await until(()=>runtime.getSnapshot().session===null&&!runtime.getSnapshot().ready,'expired session clears protected content');await setImmediate();
 const expired=runtime.getSnapshot();assert.equal(expired.session,null);assert.equal(expired.ready,false);
 assert.equal(expired.expired,true);assert.equal(expired.denied,false);
 events.dispatchEvent(new Event('focus'));t.mock.timers.tick(250);await setImmediate();
 t.diagnostic(JSON.stringify({after_401:{denied:expired.denied,protected_content_cleared:expired.session===null},after_next_focus:{entry_calls:calls.length,checking:runtime.getSnapshot().checking,denied:runtime.getSnapshot().denied}}));
 assert.equal(calls.length,3,'a later visible focus must not be permanently suppressed after a 401');
 calls[2]?.reply.resolve(response(homeEntry(4)));await until(()=>runtime.getSnapshot().ready,'fresh authorization can restore the current view');assert.equal(runtime.getSnapshot().denied,false);
});

for(const guard of ['h5Draft','h5CommandPending'] as const)test('H5 401 captures '+guard+' before protected cleanup and retains that recovery guard until successful reauthorization',async t=>{
 const{runtime,transport,calls,document}=await harness(t,{home:homeEntry(4)});document.documentElement.dataset[guard]='true';const clear=()=>{delete document.documentElement.dataset[guard];};transport.authLost.addEventListener('lost',clear);t.after(()=>transport.authLost.removeEventListener('lost',clear));
 transport.authLost.dispatchEvent(new transport.AuthFailureEvent(401));assert.equal(runtime.getSnapshot().recoveryBlocked,true);assert.equal(document.documentElement.dataset[guard],undefined);assert.equal(runtime.getSnapshot().expired,true);assert.equal(runtime.getSnapshot().denied,false);assert.equal(runtime.canUseCached(tabRoute('home')),false);
 const retry=runtime.refresh().catch((error:unknown)=>error);await until(()=>calls.length===2,'explicit retry still uses a fresh entry');calls[1]?.reply.resolve(response({error:{code:'YXX_AUTH_REQUIRED'}},401));await retry;assert.equal(runtime.getSnapshot().recoveryBlocked,true,'cleanup of the old subtree cannot authorize a later automatic document jump');
 const restored=runtime.refresh();await until(()=>calls.length===3,'reauthorization retry is not latched behind a cancelled task');calls[2]?.reply.resolve(response(homeEntry(4)));await restored;assert.equal(runtime.getSnapshot().expired,false);assert.equal(runtime.getSnapshot().recoveryBlocked,false);assert.equal(runtime.getSnapshot().ready,true);
});

test('H5 legacy plain lost events retain the conservative terminal 403 behavior',async t=>{
 const{runtime,transport,client,query}=await harness(t,{home:homeEntry(4)});transport.authLost.dispatchEvent(new Event('lost'));const snapshot=runtime.getSnapshot();assert.equal(snapshot.denied,true);assert.equal(snapshot.expired,false);assert.equal(snapshot.session,null);assert.equal(runtime.canUseCached(tabRoute('home')),false);assert.equal(client.getQueryData(query.queryKeys.home('scope-a')),undefined);await assert.rejects(runtime.refresh(),{status:403});
});

const translationLoader=createH5PureModuleLoader();
async function translatedApp(runtime:unknown){
 const language=await import(await translationLoader.moduleUrl('i18n.ts'));
 const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd(),source=await readFile(resolve(root,'h5/src/App.tsx'),'utf8');
 const compiled=transpileModule(source,{fileName:'App.tsx',compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022,jsx:JsxEmit.ReactJSX,verbatimModuleSyntax:true}}).outputText;
 const authSource=await readFile(resolve(root,'h5/src/components/AuthState.tsx'),'utf8'),authCompiled=transpileModule(authSource,{fileName:'AuthState.tsx',compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022,jsx:JsxEmit.ReactJSX,verbatimModuleSyntax:true}}).outputText;
 const routing="import {createElement} from 'react';export function describeRoute(path){const view=path==='/'?'home':path.slice(1);return{key:JSON.stringify({view}),input:{view},path};}export const pages=Object.fromEntries(['home','reports','report','request','department'].map(view=>[view,()=>createElement('article',{'data-protected-page':view},view)]));";
 const pass="export function SessionProvider({children}){return children;}export function CommandProvider({children}){return children;}";
 const loader=createH5PureModuleLoader({overrides:{'App.tsx':compiled,'components/AuthState.ts':authCompiled,'components/PageFailure.ts':"export default function PageFailure(){return null;}",'routing.ts':routing,'navigation.ts':"export function HashRouter({children}){return children;}export function useLocation(){return{pathname:'/',search:''};}export function Navigate(){return null;}",'session.ts':pass,'hooks/useCommand.ts':pass,'components/AppShell.ts':"import {createElement} from 'react';export function Shell({children}){return createElement('main',null,children);}export function Loading(){return createElement('div',{'data-state':'loading'});}",'components/ui/primitives.ts':"import {createElement} from 'react';export function Button({children,...props}){return createElement('button',props,children);}",'lib/reload.ts':"export function hasProtectedInput(){return false;}export function reloadIfSafe(){}"}});
 const app:{default:ComponentType<{runtime:unknown}>}=await import(await loader.moduleUrl('App.tsx'));
 await import(await loader.moduleUrl('components/AuthState.ts'));await language.default.changeLanguage('zh-CN');
 return()=>new Promise<string>((done,reject)=>{let html='';const sink=new Writable({write(chunk,_encoding,callback){html+=String(chunk);callback();}});sink.on('finish',()=>done(html));sink.on('error',reject);const stream=renderToPipeableStream(createElement(app.default,{runtime}),{onAllReady(){stream.pipe(sink);},onError:reject});});
}

test('H5 App retains a warm page rather than replacing its protected subtree with the loading branch',async t=>{
 const{runtime,calls}=await harness(t,{home:homeEntry(4)}),render=await translatedApp(runtime);assert.match(await render(),/data-protected-page="home"/u);
 const opened=runtime.navigate(tabRoute('reports'));await until(()=>calls.length===2,'the other cold tab loads');calls[1]?.reply.resolve(response(tabEntry('reports')));await opened;
 const during=await render(),returned=runtime.navigate(tabRoute('home'));if(calls.length===3)calls[2]?.reply.resolve(response(homeEntry(4)));await returned;assert.match(await render(),/data-protected-page="home"/u);
 t.diagnostic(JSON.stringify({actual_app_branch:{protected_page_present:during.includes('data-protected-page="home"'),loading_present:during.includes('data-state="loading"')},measurement:'Actual App server-rendered guard projection; no claim of browser lifecycle counts'}));
 assert.match(during,/data-protected-page="home"/u,'the real App conditional must not remove an already warm protected page on a tab return');
});

test('H5 App expired-session state has an available authentication recovery action',async t=>{
 const{runtime,calls}=await harness(t,{home:homeEntry(4)}),render=await translatedApp(runtime),expired=runtime.refresh().catch((error:unknown)=>error);await until(()=>calls.length===2,'a real entry recheck starts');calls[1]?.reply.resolve(response({error:{code:'YXX_AUTH_REQUIRED'}},401));await expired;
 const markup=await render();t.diagnostic(JSON.stringify({actual_app_auth_branch:{recovery_action:/<button\b/u.test(markup),raw_translation_key:markup.includes('>authRequired<')},measurement:'Actual App/AuthState onAllReady server-rendered guard projection; client effects are not executed'}));
 assert.match(markup,/<button\b/u,'the resolved authentication panel needs an actionable recovery control, not just the brand link');assert.match(markup,/[\p{Script=Han}]/u,'the actual resolved authentication panel contains the selected language');
});

test('H5 current-member 403 stays denied when foreground events recur',async t=>{
 const{client,runtime,query,calls,events}=await harness(t,{home:homeEntry(4)});t.mock.timers.enable({apis:['setTimeout']});const rejected=runtime.refresh().catch((error:unknown)=>error);await until(()=>calls.length===2,'member check starts');calls[1]?.reply.resolve(response({error:{code:'YXX_MEMBER_FORBIDDEN'}},403));await rejected;
 for(const name of ['focus','pageshow','online'])events.dispatchEvent(new Event(name));t.mock.timers.tick(250);await setImmediate();assert.equal(calls.length,2);assert.equal(runtime.getSnapshot().denied,true);assert.equal(runtime.getSnapshot().session,null);assert.equal(client.getQueryData(query.queryKeys.home('scope-a')),undefined);
});

test('H5 authRequired resolves in both actual language resources instead of falling through as a key',async()=>{
 const language=await import(await translationLoader.moduleUrl('i18n.ts'));for(const lng of ['zh-CN','en']){const value=language.default.t('authRequired',{lng});assert.notEqual(value,'authRequired');assert.ok(value.length>0);if(lng==='zh-CN')assert.match(value,/\p{Script=Han}/u);}
});

test('H5 home observers use one authorized entry for recent reports and department statistics on mount and refresh',async t=>{
 const{client,runtime,query,calls}=await harness(t,{home:homeEntry(4)});
 const reports=new QueryObserver(client,query.homeOptions('scope-a')),summary=new QueryObserver(client,query.departmentSummaryOptions('scope-a','membership-a'));
 const offReports=reports.subscribe(()=>{}),offSummary=summary.subscribe(()=>{});t.after(()=>{offReports();offSummary();});await setImmediate();
 assert.equal(calls.length,1,'neither mounted observer may start a secondary reports or department-summary request');
 assert.equal(summary.getCurrentResult().data?.total,4);assert.equal(reports.getCurrentResult().data?.[0]?.safe_summary,'home-4');
 const refreshed=runtime.refresh();await until(()=>calls.length===2,'one refreshed entry starts');calls[1]?.reply.resolve(response(homeEntry(9)));await refreshed;await setImmediate();
 assert.equal(calls.length,2,'one entry refresh updates both observers without a summary waterfall');assert.equal(summary.getCurrentResult().data?.total,9);assert.equal(reports.getCurrentResult().data?.[0]?.safe_summary,'home-9');
 for(const call of calls){const url=new URL(call.url,'https://synthetic.invalid');assert.equal(url.pathname,'/api/yixiaoxiu/h5/entry');assert.equal(url.searchParams.get('view'),'home');}
});

test('H5 home replacement cancels older report and summary reads before seeding both current results',async t=>{
 const{client,runtime,query,calls}=await harness(t,{home:homeEntry(4)}),oldSummary=deferred<{total:number;active_count:number;membership_revision:string}>(),oldReports=deferred<ReturnType<typeof homeEntry>['data']['recent_reports']>();
 const summaryKey=query.queryKeys.departmentSummary('scope-a','membership-a'),reportsKey=query.queryKeys.home('scope-a');let summarySignal:AbortSignal|undefined,reportsSignal:AbortSignal|undefined;
 const summary=new QueryObserver(client,{queryKey:summaryKey,enabled:false,queryFn:({signal}:{signal:AbortSignal})=>{summarySignal=signal;return oldSummary.promise;}}),reports=new QueryObserver(client,{queryKey:reportsKey,enabled:false,queryFn:({signal}:{signal:AbortSignal})=>{reportsSignal=signal;return oldReports.promise;}});
 const offSummary=summary.subscribe(()=>{}),offReports=reports.subscribe(()=>{});t.after(()=>{offSummary();offReports();});const readingSummary=summary.refetch(),readingReports=reports.refetch();
 await until(()=>client.getQueryState(summaryKey)?.fetchStatus==='fetching'&&client.getQueryState(reportsKey)?.fetchStatus==='fetching','both older home reads must really be in flight');
 const refreshed=runtime.refresh();await until(()=>calls.length===2,'replacement entry starts');calls[1]?.reply.resolve(response(homeEntry(8)));await refreshed;
 assert.equal(summarySignal?.aborted,true);assert.equal(reportsSignal?.aborted,true);oldSummary.resolve({total:999,active_count:999,membership_revision:'membership-a'});oldReports.resolve(homeEntry(999).data.recent_reports);await Promise.all([readingSummary,readingReports]);await setImmediate();
 assert.equal(client.getQueryData<{total:number}>(summaryKey)?.total,8);assert.equal(client.getQueryData<{safe_summary:string}[]>(reportsKey)?.[0]?.safe_summary,'home-8');assert.equal(calls.length,2);
});

for(const change of ['scope','revision'] as const)test('H5 home '+change+' replacement removes the former organization summary and fences a late read',async t=>{
 const{client,runtime,query,calls}=await harness(t,{home:homeEntry(4)}),oldSummary=deferred<{total:number;active_count:number;membership_revision:string}>();
 const oldKey=query.queryKeys.departmentSummary('scope-a','membership-a');let signal:AbortSignal|undefined;
 const observer=new QueryObserver(client,{queryKey:oldKey,enabled:false,queryFn:({signal:current}:{signal:AbortSignal})=>{signal=current;return oldSummary.promise;}});const off=observer.subscribe(()=>{});t.after(off);const pending=observer.refetch();await until(()=>client.getQueryState(oldKey)?.fetchStatus==='fetching','former organization query starts');
 const scope=change==='scope'?'scope-b':'scope-a',revision='membership-b',refreshed=runtime.refresh();await until(()=>calls.length===2,'new organization entry starts');calls[1]?.reply.resolve(response(homeEntry(7,scope,revision)));await refreshed;
 assert.equal(signal?.aborted,true);assert.equal(client.getQueryData(oldKey),undefined);oldSummary.resolve({total:999,active_count:999,membership_revision:'membership-a'});await pending;await setImmediate();
 assert.equal(client.getQueryData(oldKey),undefined);assert.equal(client.getQueryData<{total:number}>(query.queryKeys.departmentSummary(scope,revision))?.total,7);assert.equal(client.getQueryData<{safe_summary:string}[]>(query.queryKeys.home(scope))?.[0]?.safe_summary,'home-7');assert.equal(runtime.getSnapshot().membershipRevision,revision);assert.equal(calls.length,2);
});

test('H5 home removes former summary data when the same member no longer has department READ',async t=>{
 const{client,runtime,query,calls}=await harness(t,{home:homeEntry(4)}),key=query.queryKeys.departmentSummary('scope-a','membership-a');assert.equal(client.getQueryData<{total:number}>(key)?.total,4);
 const refreshed=runtime.refresh();await until(()=>calls.length===2,'read capability recheck starts');calls[1]?.reply.resolve(response(homeEntry(0,'scope-a','membership-a',false)));await refreshed;
 assert.equal(runtime.getSnapshot().session?.h5.can_view_department,false);assert.equal(client.getQueryData(key),undefined);assert.equal(calls.length,2);
});

test('H5 home entry decoder requires authorized same-revision statistics and never invents empty counts',async()=>{
 const loader=createH5PureModuleLoader(),{decoders}=await import(await loader.moduleUrl('api/decode.ts')),valid=homeEntry(0);
 assert.equal(decoders.entry(valid),valid);const noRead=homeEntry(0,'scope-a','membership-a',false);assert.equal(decoders.entry(noRead),noRead);
 for(const invalid of [{...valid,data:{recent_reports:[]}},{...valid,data:{...valid.data,department_summary:null}},{...valid,data:{...valid.data,department_summary:{total:4,active_count:1,membership_revision:'another-revision'}}},{...valid,data:{...valid.data,department_summary:{total:'4',active_count:1,membership_revision:'membership-a'}}},{...noRead,data:valid.data}])assert.throws(()=>decoders.entry(invalid),{name:'InvalidResponse'});
});

test('H5 home entry database failure is reported without replacing real statistics by zero or starting a fallback',async t=>{
 const{client,runtime,query,calls}=await harness(t,{home:homeEntry(4)}),refreshed=runtime.refresh();await until(()=>calls.length===2,'entry refresh starts');calls[1]?.reply.resolve(response({error:{code:'YXX_UNAVAILABLE'}},503));await assert.rejects(refreshed,{name:'ApiError'});await setImmediate();
 assert.equal(calls.length,2);assert.equal(runtime.getSnapshot().checking,false);assert.ok(runtime.getSnapshot().error);assert.equal(runtime.getSnapshot().legacy,false);assert.equal(client.getQueryData<{total:number}>(query.queryKeys.departmentSummary('scope-a','membership-a'))?.total,4);
});

test('H5 home current-member denial clears recent reports and department statistics without legacy fallback',async t=>{
 const{client,runtime,query,calls}=await harness(t,{home:homeEntry(4)}),refreshed=runtime.refresh();await until(()=>calls.length===2,'entry reauthorization starts');calls[1]?.reply.resolve(response({error:{code:'YXX_MEMBER_FORBIDDEN'}},403));await assert.rejects(refreshed);await setImmediate();
 assert.equal(calls.length,2);assert.equal(runtime.getSnapshot().denied,true);assert.equal(runtime.getSnapshot().ready,false);assert.equal(client.getQueryData(query.queryKeys.home('scope-a')),undefined);assert.equal(client.getQueryData(query.queryKeys.departmentSummary('scope-a','membership-a')),undefined);
});

test('H5 explicitly disabled home entry keeps authorized legacy reports and department statistics available',async t=>{
 const{client,runtime,query,calls}=await harness(t,{home:homeEntry(4)}),refreshed=runtime.refresh();await until(()=>calls.length===2,'entry negotiation starts');calls[1]?.reply.resolve(response({error:{code:'YXX_H5_ENTRY_DISABLED'}},404));await until(()=>calls.length===3,'legacy bootstrap starts');calls[2]?.reply.resolve(response(bootstrap('scope-a',true)));await until(()=>calls.length===4,'legacy recent reports start');calls[3]?.reply.resolve(response({items:homeEntry(6).data.recent_reports,next_cursor:null}));await refreshed;
 assert.equal(runtime.getSnapshot().legacy,true);assert.equal(client.getQueryData<{safe_summary:string}[]>(query.queryKeys.home('scope-a'))?.[0]?.safe_summary,'home-6');
 const observer=new QueryObserver(client,query.departmentSummaryOptions('scope-a','legacy')),off=observer.subscribe(()=>{});t.after(off);await until(()=>calls.length===5,'legacy summary compatibility read starts');assert.ok(calls[4]?.url.endsWith('/h5/department-summary'));calls[4]?.reply.resolve(response({error:{code:'YXX_H5_ENTRY_DISABLED'}},404));await until(()=>calls.length===6,'legacy department fallback starts');assert.ok(calls[5]?.url.endsWith('/department-reports'));calls[5]?.reply.resolve(response({items:[],total:6,active_count:2,next_cursor:null}));await until(()=>observer.getCurrentResult().isSuccess,'legacy real statistics become available');
 assert.deepEqual(observer.getCurrentResult().data,{total:6,active_count:2,membership_revision:'legacy'});assert.equal(calls.length,6);
});

test('H5 entry cancels older pagination and detail before replacing the first pages',async t=>{
 const{client,runtime,query,calls}=await harness(t),next=deferred<ReturnType<typeof timeline>>(),oldDetail=deferred<ReturnType<typeof detail>>();
 const timelineKey=query.queryKeys.timeline('scope-a',ref),detailKey=query.queryKeys.detail('scope-a',ref);
 const pages=new InfiniteQueryObserver(client,{queryKey:timelineKey,initialPageParam:null,queryFn:({signal}:{signal:AbortSignal})=>{void signal;return next.promise;},getNextPageParam:(page:ReturnType<typeof timeline>)=>page.next_cursor,staleTime:Infinity});
 const detailObserver=new QueryObserver(client,{queryKey:detailKey,queryFn:({signal}:{signal:AbortSignal})=>{void signal;return oldDetail.promise;},enabled:false});
 const offPages=pages.subscribe(()=>{}),offDetail=detailObserver.subscribe(()=>{});t.after(()=>{offPages();offDetail();});
 const pendingPage=pages.fetchNextPage().catch((error:unknown)=>error),pendingDetail=detailObserver.refetch().catch((error:unknown)=>error);
 await until(()=>client.getQueryState(timelineKey)?.fetchStatus==='fetching'&&client.getQueryState(detailKey)?.fetchStatus==='fetching','old reads must really be in flight');
 const refreshed=runtime.refresh();await until(()=>calls.length===2,'refresh entry must start');calls[1]?.reply.resolve(response(entry(2)));await refreshed;
 next.resolve(timeline('obsolete-next-page'));oldDetail.resolve(detail(1));await Promise.all([pendingPage,pendingDetail]);
 assert.equal(client.getQueryData<ReturnType<typeof detail>>(detailKey)?.h5.ticket_version,2);
 const data=client.getQueryData<{pages:ReturnType<typeof timeline>[];pageParams:unknown[]}>(timelineKey);assert.equal(data?.pages.length,1);assert.equal(data?.pages[0]?.items[0]?.summary,'entry-2');assert.equal(data?.pages[0]?.next_cursor,'cursor-entry-2');assert.deepEqual(data?.pageParams,[null]);
});

test('H5 timeline manual retry replaces loaded history with one entry first page after a pagination error',async t=>{
 const{client,query,calls}=await harness(t),key=query.queryKeys.timeline('scope-a',ref);
 client.setQueryData(key,{pages:[timeline('old-first'),timeline('old-second'),timeline('old-third')],pageParams:[null,'cursor-old-first','cursor-old-second']});
 const observer=new InfiniteQueryObserver(client,{...query.timelineOptions('scope-a',ref),retry:false});const off=observer.subscribe(()=>{});t.after(off);
 const failedPage=observer.fetchNextPage();await until(()=>calls.length===2,'pagination must really request its next cursor');
 const failedCall=calls[1];assert.ok(failedCall);assert.equal(new URL(failedCall.url,'https://synthetic.invalid').searchParams.get('cursor'),'cursor-old-third');failedCall.reply.resolve(response({error:{code:'YXX_UNAVAILABLE'}},503));await failedPage;
 assert.equal(observer.getCurrentResult().isFetchNextPageError,true);assert.equal(client.getQueryData<{pages:unknown[]}>(key)?.pages.length,3);
 const beforeRetry=calls.length,retried=query.refreshRequest(client,'scope-a',ref);await until(()=>calls.length===beforeRetry+1,'manual retry must start one fresh entry');
 const refreshCall=calls[beforeRetry];assert.ok(refreshCall);const url=new URL(refreshCall.url,'https://synthetic.invalid');assert.equal(url.pathname,'/api/yixiaoxiu/h5/entry');assert.equal(url.searchParams.get('view'),'request');assert.equal(url.searchParams.get('request_ref'),ref);
 refreshCall.reply.resolve(response(entry(2)));await retried;await setImmediate();
 assert.equal(calls.length,beforeRetry+1,'manual retry must not refetch any historical timeline cursor');
 const data=client.getQueryData<{pages:ReturnType<typeof timeline>[];pageParams:unknown[]}>(key);assert.equal(data?.pages.length,1);assert.equal(data?.pages[0]?.items[0]?.summary,'entry-2');assert.equal(data?.pages[0]?.next_cursor,'cursor-entry-2');assert.deepEqual(data?.pageParams,[null]);assert.equal(observer.getCurrentResult().isError,false);
});

test('H5 post-commit refresh cannot reuse an entry that started before the receipt',async t=>{
 const{client,runtime,query,calls}=await harness(t);
 const beforeCommit=runtime.refresh().catch((error:unknown)=>error);await until(()=>calls.length===2,'pre-commit entry must be held in flight');
 const afterCommit=query.refreshRequest(client,'scope-a',ref,{afterCommit:true});await until(()=>calls.length===3,'post-commit barrier must issue a new entry');
 assert.equal(calls[1]?.options.signal?.aborted,true,'the earlier entry is superseded');
 calls[2]?.reply.resolve(response(entry(2)));await afterCommit;
 calls[1]?.reply.resolve(response(entry(1)));const earlier=await beforeCommit;assert.ok(earlier instanceof DOMException);assert.equal(earlier.name,'AbortError');
 assert.equal(client.getQueryData<ReturnType<typeof detail>>(query.queryKeys.detail('scope-a',ref))?.h5.ticket_version,2);
 assert.equal(runtime.getSnapshot().ready,true);
});

test('H5 old-scope 401 and successful media ACK cannot clear or publish into a new member scope',async t=>{
 const{runtime,transport,calls}=await harness(t);let lost=0;const listener=()=>{lost+=1;};transport.authLost.addEventListener('lost',listener);t.after(()=>transport.authLost.removeEventListener('lost',listener));
 const forbidden=transport.api.reserve({schema_version:1,client_command_id:'11111111-1111-4111-8111-111111111111',kind:'IMAGE',mime_type:'image/jpeg',byte_size:10,duration_ms:null},'synthetic').catch((error:unknown)=>error);
 const acknowledgement=transport.api.importWecom('synthetic-media','synthetic-server','synthetic','22222222-2222-4222-8222-222222222222').catch((error:unknown)=>error);
 await until(()=>calls.length===3,'both old-scope operations must start');const nextScope=runtime.refresh();await until(()=>calls.length===4,'new scope entry must start');calls[3]?.reply.resolve(response(entry(2,'scope-b','membership-b')));await nextScope;
 calls[1]?.reply.resolve(response({error:{code:'YXX_MEMBER_FORBIDDEN'}},401));calls[2]?.reply.resolve(response({media_ref:'synthetic-media',kind:'IMAGE',playback_status:'READY'}));
 for(const result of await Promise.all([forbidden,acknowledgement])){assert.ok(result instanceof DOMException);assert.equal(result.name,'AbortError');}
 assert.equal(lost,0);assert.equal(runtime.getSnapshot().session?.recovery_scope,'scope-b');assert.equal(runtime.getSnapshot().denied,false);
 const current=transport.api.bootstrap().catch((error:unknown)=>error);await until(()=>calls.length===5,'current member read must start');calls[4]?.reply.resolve(response({error:{code:'YXX_MEMBER_FORBIDDEN'}},403));await current;assert.equal(lost,1);assert.equal(runtime.getSnapshot().denied,true);
});

test('H5 an aborted GET cannot publish a late 401 while the error body is being read',async t=>{
 const loader=createH5PureModuleLoader(),transport=await import(await loader.moduleUrl('api/client.ts'));let lost=0;const listener=()=>{lost+=1;};transport.authLost.addEventListener('lost',listener);t.after(()=>transport.authLost.removeEventListener('lost',listener));
 const body=deferred<Uint8Array>();const stream=new ReadableStream<Uint8Array>({async start(controller){controller.enqueue(await body.promise);controller.close();}});
 t.mock.method(globalThis,'fetch',async()=>new Response(stream,{status:401,headers:{'content-type':'application/json'}}));
 const controller=new AbortController(),pending=transport.api.bootstrap(controller.signal).catch((error:unknown)=>error);await setImmediate();controller.abort();body.resolve(new TextEncoder().encode(JSON.stringify({error:{code:'YXX_AUTH_REQUIRED'}})));const result=await pending;
 assert.ok(result instanceof DOMException);assert.equal(result.name,'AbortError');assert.equal(lost,0);
});

test('H5 legacy fallback still shows its authorized detail when the independent timeline fails',async t=>{
 const{client,runtime,query,calls}=await harness(t);const refreshed=runtime.refresh();await until(()=>calls.length===2,'entry negotiation starts');calls[1]?.reply.resolve(response({error:{code:'YXX_H5_ENTRY_DISABLED'}},404));await until(()=>calls.length===3,'legacy bootstrap starts');calls[2]?.reply.resolve(response(bootstrap()));await until(()=>calls.length===5,'legacy detail and timeline run independently');
 const detailCall=calls.find((call,index)=>index>2&&call.url.endsWith('/requests/'+ref)),timelineCall=calls.find((call,index)=>index>2&&call.url.endsWith('/timeline'));assert.ok(detailCall);assert.ok(timelineCall);
 detailCall.reply.resolve(response(detail(2)));timelineCall.reply.resolve(response({error:{code:'YXX_UNAVAILABLE'}},503));await refreshed;
 assert.equal(runtime.getSnapshot().ready,true);assert.equal(runtime.getSnapshot().legacy,true);assert.equal(client.getQueryData<ReturnType<typeof detail>>(query.queryKeys.detail('scope-a',ref))?.h5.ticket_version,2);assert.equal(client.getQueryData(query.queryKeys.timelineSection('scope-a',ref)),'UNAVAILABLE');assert.equal(client.getQueryData(query.queryKeys.timeline('scope-a',ref)),undefined);
});

test('H5 legacy reports replacement cancels an older fetchNextPage before seeding',async t=>{
 const{client,query,calls}=await harness(t),filter={q:'',status:'',source:''},key=query.queryKeys.reports('scope-a',filter),next=deferred<{items:unknown[];next_cursor:string|null}>();
 const item=(summary:string)=>({kind:'WEB_REQUEST',ref,display_status:'TICKET_CREATED',created_at:'2026-10-20 12:00:00',created_epoch_ms:'1792468800000',ticket:{ticket_no:'SYNTHETIC-1',status:'IN_PROGRESS'},safe_summary:summary});
 client.setQueryData(key,{pages:[{items:[item('old')],next_cursor:'old-cursor'}],pageParams:[null]});
 const observer=new InfiniteQueryObserver(client,{queryKey:key,initialPageParam:null,queryFn:({signal}:{signal:AbortSignal})=>{void signal;return next.promise;},getNextPageParam:(page:{next_cursor:string|null})=>page.next_cursor,staleTime:Infinity});const off=observer.subscribe(()=>{});t.after(off);
 const old=observer.fetchNextPage().catch((error:unknown)=>error);await until(()=>client.getQueryState(key)?.fetchStatus==='fetching','old reports page must be fetching');
 const refreshed=query.legacyEntry(client,{view:'reports'},new AbortController().signal,'scope-a');await until(()=>calls.length===2,'legacy bootstrap must start');calls[1]?.reply.resolve(response(bootstrap()));await until(()=>calls.length===3,'new first reports page must start');calls[2]?.reply.resolve(response({items:[item('fresh')],next_cursor:'fresh-cursor'}));await refreshed;
 next.resolve({items:[item('obsolete-next')],next_cursor:null});await old;
 const data=client.getQueryData<{pages:{items:{safe_summary:string}[];next_cursor:string|null}[];pageParams:unknown[]}>(key);assert.equal(data?.pages.length,1);assert.equal(data?.pages[0]?.items[0]?.safe_summary,'fresh');assert.equal(data?.pages[0]?.next_cursor,'fresh-cursor');assert.deepEqual(data?.pageParams,[null]);
});

async function routingModule(){
 const overrides=Object.fromEntries(['Home','Report','Reports','Detail','Department'].map(name=>['pages/'+name+'.ts','export default function Page(){return null;}']));
 return import(await createH5PureModuleLoader({overrides}).moduleUrl('routing.ts'));
}
function browserLocation(t:TestContext,href:string){
 const oldLocation=Object.getOwnPropertyDescriptor(globalThis,'location'),oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),url=new URL(href),state={synthetic:'history-state'},replacements:string[]=[];
 Object.defineProperty(globalThis,'location',{configurable:true,value:url});Object.defineProperty(globalThis,'window',{configurable:true,value:{history:{state,replaceState(next:unknown,_title:string,target:string){assert.equal(next,state);replacements.push(target);url.href=new URL(target,url).href;},pushState(){assert.fail('initial compatibility routing must not add a history entry');}}}});
 t.after(()=>{if(oldLocation)Object.defineProperty(globalThis,'location',oldLocation);else Reflect.deleteProperty(globalThis,'location');if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else Reflect.deleteProperty(globalThis,'window');});
 return{url,replacements};
}
for(const example of [{suffix:'/'+ref,path:'/requests/'+ref,input:{view:'request',request_ref:ref}},{suffix:'/new',path:'/report',input:{view:'report'}},{suffix:'',path:'/reports',input:{view:'reports',search:null,status:null,source:null}}])test('H5 legacy document /reports'+example.suffix+' installs its canonical hash before hash navigation starts',async t=>{
 const{url,replacements}=browserLocation(t,'https://synthetic.invalid/wecom/yixiaoxiu/reports'+example.suffix),originalPath=url.pathname,routing=await routingModule(),route=routing.initialRoute();
 assert.deepEqual(route.input,example.input);assert.equal(route.path,example.path);assert.equal(url.pathname,originalPath);assert.equal(url.hash,'#'+example.path);assert.deepEqual(replacements,['#'+example.path]);
 const{createHashHistory}=await import(await createH5PureModuleLoader().moduleUrl('lib/hash-history.ts'));const history=createHashHistory({origin:url.origin,readHash:()=>url.hash,writeHash:()=>assert.fail('reading the initial route must not navigate'),go:()=>{},listen:()=>()=>{}});
 const selected=history.getSnapshot();assert.equal(selected.pathname,example.path);assert.deepEqual(routing.describeRoute(selected.pathname,selected.search).input,route.input,'the mounted hash router must not replace the selected entry with home');
 assert.deepEqual(routing.initialRoute(),route);assert.equal(replacements.length,1,'repeated initial reads do not add or replace history again');
});

test('H5 explicit hashes take priority over legacy document paths and keep query filters',async t=>{
 const{url,replacements}=browserLocation(t,'https://synthetic.invalid/wecom/yixiaoxiu/reports/'+ref),routing=await routingModule();
 for(const example of [{hash:'#/reports?status=ACTIVE&source=WEB&search=printer',input:{view:'reports',search:'printer',status:'ACTIVE',source:'WEB'}},{hash:'#/department',input:{view:'department'}},{hash:'#/report',input:{view:'report'}},{hash:'#/',input:{view:'home'}},{hash:'#/requests/'+ref,input:{view:'request',request_ref:ref}}]){url.hash=example.hash;assert.deepEqual(routing.initialRoute().input,example.input);assert.equal(url.hash,example.hash);}
 assert.deepEqual(replacements,[]);
});

test('H5 legacy path compatibility accepts only the native host whitelist and complete request references',async t=>{
 const{url,replacements}=browserLocation(t,'https://synthetic.invalid/'),routing=await routingModule();
 for(const path of ['/wecom/yixiaoxiu/reports/short','/wecom/yixiaoxiu/reports/'+ref+'extra','/wecom/yixiaoxiu/reports/'+ref+'/extra','/wecom/yixiaoxiu/reports/%E0%A4%A','/wecom/yixiaoxiu/reports/'+('%41'.repeat(32)),'/other/wecom/yixiaoxiu/reports/'+ref,'/wecom/yixiaoxiu/reports/','/wecom/yixiaoxiu/reports/new/','/wecom/yixiaoxiu/tickets/'+ref]){url.href='https://synthetic.invalid'+path;assert.deepEqual(routing.initialRoute().input,{view:'home'},path);assert.equal(url.hash,'',path);}
 assert.deepEqual(replacements,[]);const legal='A_b-Cd09'.repeat(4);url.href='https://synthetic.invalid/wecom/yixiaoxiu/reports/'+legal;assert.deepEqual(routing.initialRoute().input,{view:'request',request_ref:legal});assert.equal(url.hash,'#/requests/'+legal);
});

test('H5 initial hash reference decoding remains bounded by the existing backend authority on malformed escapes',async t=>{
 const{url,replacements}=browserLocation(t,'https://synthetic.invalid/wecom/yixiaoxiu/reports/new#/requests/%E0%A4%A'),routing=await routingModule();
 assert.deepEqual(routing.initialRoute().input,{view:'request',request_ref:''});url.hash='#/requests/'+('%41'.repeat(32));assert.deepEqual(routing.initialRoute().input,{view:'request',request_ref:'A'.repeat(32)});assert.deepEqual(replacements,[]);
});

test('H5 document query request_ref compatibility is retained without turning it into an untrusted document path',async t=>{
 const{replacements}=browserLocation(t,'https://synthetic.invalid/wecom/yixiaoxiu/?request_ref='+ref),routing=await routingModule();assert.deepEqual(routing.initialRoute().input,{view:'request',request_ref:ref});assert.deepEqual(replacements,[]);
});

test('H5 small hash history preserves query routes, native back/forward and modified links',async()=>{
 const loader=createH5PureModuleLoader(),navigation=await import(await loader.moduleUrl('lib/hash-history.ts'));let stack=['#/report'],position=0,native=()=>{},changes=0;
 const history=navigation.createHashHistory({origin:'https://synthetic.invalid',readHash:()=>stack[position]??'#/',writeHash:(hash:string,replace:boolean)=>{if(replace)stack[position]=hash;else{stack=stack.slice(0,position+1);stack.push(hash);position+=1;}},go:(delta:number)=>{position=Math.max(0,Math.min(stack.length-1,position+delta));native();},listen:(listener:()=>void)=>{native=listener;return()=>{native=()=>{};};}});
 const off=history.subscribe(()=>{changes+=1;});assert.deepEqual(history.getSnapshot(),{pathname:'/report',search:''});
 history.navigate('/reports?status=ACTIVE');assert.deepEqual(history.getSnapshot(),{pathname:'/reports',search:'?status=ACTIVE'});assert.equal(history.href('/report'),'#/report');
 history.navigate('/requests/'+ref,{replace:true});assert.equal(stack.length,2);history.navigate(-1);assert.equal(history.getSnapshot().pathname,'/report');history.navigate(1);assert.equal(history.getSnapshot().pathname,'/requests/'+ref);
 const before=changes;native();assert.equal(changes,before,'duplicate hashchange/popstate does not publish a second location');
 assert.throws(()=>history.href('https://other.invalid/route'));
 const click={button:0,metaKey:false,altKey:false,ctrlKey:false,shiftKey:false,defaultPrevented:false};assert.equal(navigation.handleLinkClick(click,undefined,false),true);
 for(const key of ['metaKey','altKey','ctrlKey','shiftKey','defaultPrevented'])assert.equal(navigation.handleLinkClick({...click,[key]:true},undefined,false),false);
 assert.equal(navigation.handleLinkClick({...click,button:1},undefined,false),false);assert.equal(navigation.handleLinkClick(click,'_blank',false),false);assert.equal(navigation.handleLinkClick(click,undefined,true),false);off();
});

for(const reason of ['abort','scope-change'] as const)test('H5 upload does not send after '+reason+' while its optional module is loading',async t=>{
 const loaded=deferred<void>(),release=deferred<void>(),gate={loaded:()=>loaded.resolve(),ready:release.promise,calls:0};
 const prior=Object.getOwnPropertyDescriptor(globalThis,'__H5_UPLOAD_TEST_GATE__');Object.defineProperty(globalThis,'__H5_UPLOAD_TEST_GATE__',{configurable:true,value:gate});t.after(()=>{if(prior)Object.defineProperty(globalThis,'__H5_UPLOAD_TEST_GATE__',prior);else Reflect.deleteProperty(globalThis,'__H5_UPLOAD_TEST_GATE__');});
 const loader=createH5PureModuleLoader({overrides:{'api/raw-upload.ts':"const gate=globalThis.__H5_UPLOAD_TEST_GATE__;gate.loaded();await gate.ready;export async function rawUpload(){gate.calls+=1;return{media_ref:'synthetic',kind:'IMAGE'};}"}});
 const transport=await import(await loader.moduleUrl('api/client.ts')),controller=new AbortController();
 const operation=transport.api.upload('synthetic',new Blob(['synthetic']),'synthetic','synthetic',controller.signal,()=>{}).catch((error:unknown)=>error);await loaded.promise;
 if(reason==='abort')controller.abort();else transport.advanceAuthGeneration();release.resolve();const result=await operation;assert.ok(result instanceof DOMException);assert.equal(result.name,'AbortError');assert.equal(gate.calls,0,'no XHR or API action may start in the new member scope');
});

for(const reason of ['abort','scope-change'] as const)test('H5 legacy bootstrap does not start after '+reason+' while compatibility code is loading',async t=>{
 const loaded=deferred<void>(),release=deferred<void>(),gate={loaded:()=>loaded.resolve(),ready:release.promise,calls:0};
 const prior=Object.getOwnPropertyDescriptor(globalThis,'__H5_LEGACY_TEST_GATE__');Object.defineProperty(globalThis,'__H5_LEGACY_TEST_GATE__',{configurable:true,value:gate});t.after(()=>{if(prior)Object.defineProperty(globalThis,'__H5_LEGACY_TEST_GATE__',prior);else Reflect.deleteProperty(globalThis,'__H5_LEGACY_TEST_GATE__');});
 const loader=createH5PureModuleLoader({overrides:{'api/legacy-entry.ts':"const gate=globalThis.__H5_LEGACY_TEST_GATE__;gate.loaded();await gate.ready;export async function readLegacyEntry(){gate.calls+=1;return null;}"}});
 const query=await import(await loader.moduleUrl('api/query.ts')),transport=await import(await loader.moduleUrl('api/client.ts')),controller=new AbortController();
 const operation=query.legacyEntry({}, {view:'report'},controller.signal).catch((error:unknown)=>error);await loaded.promise;
 if(reason==='abort')controller.abort();else transport.advanceAuthGeneration();release.resolve();const result=await operation;assert.ok(result instanceof DOMException);assert.equal(result.name,'AbortError');assert.equal(gate.calls,0);
});
