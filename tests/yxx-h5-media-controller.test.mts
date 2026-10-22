import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createElement,type ComponentType,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transpileModule,ModuleKind,ScriptTarget,JsxEmit,createSourceFile,isFunctionDeclaration,isVariableStatement,ScriptKind} from 'typescript';
import type {H5EntryBootstrap,H5Thumbnail} from '../contracts/yxx_h5_entry_contracts.js';
import type {H5Media} from '../contracts/yxx_h5_v2_contracts.js';
import {createH5PureModuleLoader} from './helpers/h5-pure-module-loader.mjs';

const bootstrap:H5EntryBootstrap={authenticated:true,identity_mode:'MEMBER_SELF_SERVICE',read_only:false,can_submit:true,can_supplement:true,csrf_token:'synthetic-csrf',recovery_scope:'synthetic-member',h5:{profile:{name:null,department:null,phone:null,avatar_url:null},can_upload:true,can_urge:true,can_evaluate:true,can_view_department:false,sdk:{enabled:false,corp_id:null,agent_id:null},support:{emergency_phone:'18117887318',service_phone:'61318500'},limits:{voice_count:1,voice_duration_seconds:60,voice_bytes:5*1024*1024,image_count:6,image_bytes:10*1024*1024,video_count:1,video_duration_seconds:60,video_bytes:20*1024*1024,total_bytes:40*1024*1024}}};
interface MediaElement {duration:number;src:string;preload:string;onloadedmetadata:(()=>void)|null;onerror:(()=>void)|null;loads:number;removeAttribute:(name:string)=>void;load:()=>void}
interface ItemSnapshot {id:string;ref:string|null;status:string;progress:number;durationMs?:number|null;file?:Blob|null;localId?:string|null;failure?:{stage:string;code:string;messageKey:string}}
interface Controller {getBusy:()=>boolean;getItems:()=>ItemSnapshot[];getItemIds:()=>readonly string[];getItem:(id:string)=>ItemSnapshot|null;getError:()=>string|null;getErrorTone:()=>string;getRecording:()=>{canClear:boolean;canWecom:boolean;starting:boolean;recording:boolean};getNative:()=>boolean;choosePhotos:(fallback:()=>void)=>Promise<void>;add:(file:File,kind:'IMAGE'|'VOICE'|'VIDEO')=>Promise<void>;remove:(id:string)=>void;clear:(bound?:boolean)=>void;start:()=>Promise<void>;release:(cancel?:boolean)=>void;playNative:(item:ItemSnapshot)=>Promise<void>;retry:(id:string)=>void;subscribe:(listener:()=>void)=>()=>void;dispose:()=>void;mount:()=>void}
interface ApiFixture {calls:{reserves:{signal:AbortSignal|undefined}[];cancels:string[];uploads:{id:string;signal:AbortSignal;progress:(value:number)=>void;complete:()=>void}[]};control:{pendingReserve:boolean;holdUploads:boolean;uploadStatus:number|null}}
/** Keep the actual singleton device-work coordinator when replacing only SDK registration in a controller fixture. */
async function previewCoordinatorSource(){
 const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd(),source=await readFile(resolve(root,'h5/src/hooks/wecom-registration.ts'),'utf8'),ast=createSourceFile('wecom-registration.ts',source,ScriptTarget.Latest,true,ScriptKind.TS),names=new Set(['markNativePreview','hasNativePreviewWork','stopNativePreview','waitNativePreviewStops']);
 const selected=ast.statements.filter(node=>isFunctionDeclaration(node)&&node.name&&names.has(node.name.text)||isVariableStatement(node)&&node.declarationList.declarations.some(value=>['nativePreview','nativeStops','nativeCapture'].includes(value.name.getText(ast))));assert.equal(selected.length,7);return selected.map(node=>node.getText(ast)).join('\n');
}
const apiFixture=`
export const authLost=new EventTarget();
export const calls={reserves:[],cancels:[],uploads:[]};
export const control={pendingReserve:false,holdUploads:false,uploadStatus:null};
export const api={
 reserve:async(input,csrf,signal)=>{calls.reserves.push({signal});if(control.pendingReserve)await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});return{media_ref:'11111111-1111-4111-8111-111111111111',kind:input.kind};},
 upload:async(ref,file,csrf,id,signal,progress)=>{if(signal.aborted)throw new DOMException('Aborted','AbortError');if(control.uploadStatus!==null)throw{status:control.uploadStatus,message:'unsafe private URL'};if(control.holdUploads)await new Promise((resolve,reject)=>{const abort=()=>reject(new DOMException('Aborted','AbortError'));signal.addEventListener('abort',abort,{once:true});calls.uploads.push({id,signal,progress,complete:()=>{signal.removeEventListener('abort',abort);resolve();}});});else progress(22);progress(100);return{media_ref:ref,kind:'IMAGE'};},
 cancelUpload:async(ref)=>{calls.cancels.push(ref);},
 importWecom:async()=>{throw new Error('Native device APIs are not used by this fixture');}
};`;

async function fixture(){
 const loader=createH5PureModuleLoader({overrides:{'api/client.ts':apiFixture,'hooks/wecom-registration.ts':await previewCoordinatorSource()+"export async function registeredWecom(){throw new Error('No native SDK in this fixture');}"}});
 const source:{createMediaController:(bootstrap:()=>H5EntryBootstrap,transcript:(value:string)=>void,message:(key:string)=>string)=>Controller}=await import(await loader.moduleUrl('hooks/useMedia.ts'));
 const api:ApiFixture=await import(await loader.moduleUrl('api/client.ts'));
 const elements:MediaElement[]=[],events=new EventTarget(),oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{visibilityState:'visible',addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),createElement:()=>{
  const element:MediaElement={duration:12,src:'',preload:'',onloadedmetadata:null,onerror:null,loads:0,removeAttribute:(name:string)=>{if(name==='src')element.src='';},load:()=>{element.loads+=1;}};elements.push(element);return element;
 }}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'Synthetic browser'}});
 const controller=source.createMediaController(()=>bootstrap,()=>undefined,key=>key);controller.mount();
 return{controller,api,elements,close:()=>{controller.dispose();if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document');if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else Reflect.deleteProperty(globalThis,'navigator');}};
}
async function until(check:()=>boolean){for(let index=0;index<20;index++){if(check())return;await new Promise<void>(resolve=>setImmediate(resolve));}assert.fail('Bounded media task did not settle');}

/** Runs the actual reservation parser and its real format guards without starting a database or host. */
async function reservationParserUrl(){
 const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd(),source=await readFile(resolve(root,'src/yxx-h5-media.mts'),'utf8');
 const ast=createSourceFile('yxx-h5-media.mts',source,ScriptTarget.Latest,true,ScriptKind.TS),parser=ast.statements.find(node=>isFunctionDeclaration(node)&&node.name?.text==='parse');assert.ok(parser);
 const format=transpileModule(await readFile(resolve(root,'src/yxx-h5-media-format.mts'),'utf8'),{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022}}).outputText;
 const formatUrl='data:text/javascript;base64,'+Buffer.from(format).toString('base64');
 const parsed=transpileModule(`import {mediaFail,mediaUuid,supportedMedia,H5_MEDIA_LIMITS} from ${JSON.stringify(formatUrl)};${parser.getText(ast)};export const parseReservation=parse;`,{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022}}).outputText;
 return 'data:text/javascript;base64,'+Buffer.from(parsed).toString('base64');
}
type TranscriptEvent={type:'BEGIN';id:string}|{type:'READY';id:string;text:string}|{type:'REMOVE';id:string};
interface DraftFixtureStore {getDescription:()=>string;setDescription:(value:string)=>void;getLocation:()=>string;setLocation:(value:string)=>void;transcript:(event:TranscriptEvent)=>void;clear:()=>void}
async function draftStore():Promise<DraftFixtureStore>{
 const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd(),source=await readFile(resolve(root,'h5/src/components/ReportDraftProvider.tsx'),'utf8'),ast=createSourceFile('ReportDraftProvider.tsx',source,ScriptTarget.Latest,true,ScriptKind.TSX),factory=ast.statements.find(node=>isFunctionDeclaration(node)&&node.name?.text==='createDraft');assert.ok(factory);
 const code=transpileModule(factory.getText(ast)+';export const create=createDraft;',{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022}}).outputText,module:{create:()=>DraftFixtureStore}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));return module.create();
}
interface VoiceApi {calls:{reserves:{duration_ms:number;client_command_id:string}[];rejections:{status:number;code:string}[];imports:number;binaries:number};control:{reserveStatus:number;importStatus:number}}
interface VoiceSdk {calls:string[];control:{holdSdk:boolean;holdStart:boolean;holdStop:boolean;holdTranslate:boolean;setupFailure:boolean;startFailure:boolean;stopFailure:boolean;translateFailure:boolean;uploadFailure:boolean};resolvers:{sdk:(()=>void)[];start:()=>void;stop:()=>void;translations:((text:string)=>void)[]}}
interface CaptureOptions {mimeType?:string;audioBitsPerSecond?:number}
interface CaptureConstraints {audio:{echoCancellation:boolean;noiseSuppression:boolean;autoGainControl:boolean;sampleRate:{ideal:number};channelCount:{ideal:number}}}
async function nativeVoiceController(t:TestContext,transcript:(event:TranscriptEvent)=>void=()=>{},browser=false,wecom=true,holdChunk=false){
 const sourceRoot=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd();
 const chunkOverrides:Record<string,string>=holdChunk?{'hooks/capture-chunk-gate.ts':"let resolve,reject;export let entered=0;export const pending=new Promise((ok,fail)=>{resolve=ok;reject=fail;});export const enter=()=>{entered+=1;return pending;};export const open=()=>resolve();export const fail=()=>reject(new Error('synthetic chunk unavailable'));",'hooks/voice-capture.ts':"import{enter}from'./capture-chunk-gate';await enter();\n"+await readFile(resolve(sourceRoot,'h5/src/hooks/voice-capture.ts'),'utf8')}:{};
 const parser=await reservationParserUrl(),loader=createH5PureModuleLoader({overrides:{
  ...chunkOverrides,
  'api/client.ts':`import{parseReservation}from${JSON.stringify(parser)};export const authLost=new EventTarget();export const calls={reserves:[],rejections:[],imports:0,binaries:0};export const control={reserveStatus:0,importStatus:0};export const api={reserve:async input=>{calls.reserves.push(input);try{parseReservation(input);}catch(reason){calls.rejections.push({status:reason.status,code:reason.code});throw reason;}if(control.reserveStatus)throw{status:control.reserveStatus,code:'YXX_MEDIA_STORAGE_UNAVAILABLE',message:'unsafe secret URL'};return{media_ref:'11111111-1111-4111-8111-111111111111'};},upload:async(ref,file,csrf,id,signal,progress)=>{calls.binaries+=1;progress(100);},importWecom:async()=>{calls.imports+=1;if(control.importStatus)throw{status:control.importStatus,errMsg:'unsafe secret URL'};},cancelUpload:async()=>{}};`,
  'hooks/wecom-registration.ts':await previewCoordinatorSource()+`export const calls=[],control={holdSdk:false,holdStart:false,holdStop:false,holdTranslate:false,setupFailure:false,startFailure:false,stopFailure:false,translateFailure:false,uploadFailure:false},resolvers={sdk:[],start:()=>{},stop:()=>{},translations:[]};export async function registeredWecom(){calls.push('registered');if(control.holdSdk)await new Promise(resolve=>resolvers.sdk.push(resolve));if(control.setupFailure)throw new Error('unsafe SDK URL');return{SizeType:{original:'original'},SourceType:{camera:'camera',album:'album'},chooseImage:async()=>{calls.push('chooseImage');return{localIds:[]};},startRecord:async()=>{calls.push('startRecord');if(control.holdStart)await new Promise(resolve=>{resolvers.start=resolve;});if(control.startFailure)throw new Error('unsafe native start');},stopRecord:async()=>{calls.push('stopRecord');if(control.holdStop)await new Promise(resolve=>{resolvers.stop=resolve;});if(control.stopFailure)throw new Error('unsafe native stop');return{localId:'synthetic-local-voice'};},onVoiceRecordEnd:()=>{},uploadVoice:async()=>{calls.push('uploadVoice');if(control.uploadFailure)throw{errMsg:'unsafe secret URL'};return{serverId:'synthetic-server-voice'};},translateVoice:async()=>{calls.push('translateVoice');if(control.translateFailure)throw new Error('unsafe transcript');return{translateResult:control.holdTranslate?await new Promise(resolve=>resolvers.translations.push(resolve)):'synthetic transcript'};},playVoice:async()=>{calls.push('playVoice');},stopVoice:async()=>{calls.push('stopVoice');}};}`,
 }});
 const source:{createMediaController:(bootstrap:()=>H5EntryBootstrap,transcript:(event:TranscriptEvent)=>void,message:(key:string)=>string)=>Controller}=await import(await loader.moduleUrl('hooks/useMedia.ts'));
 const api:VoiceApi=await import(await loader.moduleUrl('api/client.ts')),sdk:VoiceSdk=await import(await loader.moduleUrl('hooks/wecom-registration.ts'));
 const names=['document','navigator','window','performance','MediaRecorder'] as const,previous=names.map(name=>({name,descriptor:Object.getOwnPropertyDescriptor(globalThis,name)}));let clock=1000.25;
 const capture={permissionCalls:0,activeTracks:0,recorderStarts:0,options:null as CaptureOptions|null,constraints:null as CaptureConstraints|null,holdPermission:false,holdStop:false,empty:false,permissionError:null as unknown,grant:()=>{},flushStop:()=>{},failRecorder:()=>{}};
 const track=Object.assign(new EventTarget(),{muted:false,readyState:'live',stop:()=>{capture.activeTracks=0;track.readyState='ended';}});
 class SyntheticRecorder {
  static isTypeSupported(mime:string){return mime==='audio/webm;codecs=opus';}
  state='inactive';mimeType:string;ondataavailable:((event:{data:Blob})=>void)|null=null;onstop:(()=>void)|null=null;onerror:(()=>void)|null=null;
  constructor(_stream:unknown,options:CaptureOptions){capture.options=options;this.mimeType=options.mimeType??'audio/webm';capture.failRecorder=()=>this.onerror?.();}
  start(){capture.recorderStarts+=1;this.state='recording';}
  stop(){this.state='inactive';const flush=()=>{this.ondataavailable?.({data:new Blob(capture.empty?[]:['synthetic recording'],{type:this.mimeType})});this.onstop?.();};if(capture.holdStop)capture.flushStop=flush;else flush();}
 }
 const documentEvents=new EventTarget(),dataset:Record<string,string>={};
 Object.defineProperty(globalThis,'document',{configurable:true,value:{visibilityState:'visible',documentElement:{dataset,removeAttribute:(name:string)=>{if(name==='data-h5-draft')delete dataset.h5Draft;}},addEventListener:documentEvents.addEventListener.bind(documentEvents),removeEventListener:documentEvents.removeEventListener.bind(documentEvents)}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:wecom?'wxwork Synthetic Android':'Synthetic browser',...(browser?{mediaDevices:{getUserMedia:async(constraints:CaptureConstraints)=>{capture.permissionCalls+=1;capture.constraints=constraints;if(capture.holdPermission)await new Promise<void>(resolve=>{capture.grant=resolve;});if(capture.permissionError)throw capture.permissionError;capture.activeTracks=1;track.readyState='live';return{getTracks:()=>[track]};}}}:{})}});
 if(browser)Object.defineProperty(globalThis,'MediaRecorder',{configurable:true,value:SyntheticRecorder});else Reflect.deleteProperty(globalThis,'MediaRecorder');
 Object.defineProperty(globalThis,'window',{configurable:true,value:{setTimeout,setInterval}});
 Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>clock}});
 const native={...bootstrap,h5:{...bootstrap.h5,sdk:{enabled:wecom,corp_id:wecom?'synthetic-corp':null,agent_id:wecom?'synthetic-agent':null}}},controller=source.createMediaController(()=>native,transcript,key=>key);controller.mount();
 t.after(()=>{controller.dispose();for(const item of previous)if(item.descriptor)Object.defineProperty(globalThis,item.name,item.descriptor);else Reflect.deleteProperty(globalThis,item.name);});
 const chunk:{entered:number;open:()=>void;fail:()=>void}|null=holdChunk?await import(await loader.moduleUrl('hooks/capture-chunk-gate.ts')):null;
 return{controller,api,sdk,capture,track,chunk,setClock:(value:number)=>{clock=value;}};
}

test('H5 fractional recording clock reserves integer milliseconds accepted by the actual backend parser',async t=>{
 const value=await nativeVoiceController(t);await value.controller.start();value.setClock(5000.65);value.controller.release();await until(()=>['READY','ERROR'].includes(value.controller.getItems()[0]?.status??''));
 assert.equal(value.api.calls.reserves.length,1);assert.deepEqual(value.api.calls.rejections,[],'A fractional performance.now elapsed must not become a reservation 400');assert.equal(Number.isSafeInteger(value.api.calls.reserves[0]?.duration_ms),true);assert.equal(value.controller.getItems()[0]?.status,'READY');assert.equal(value.api.calls.imports,1);
});

test('H5 a recording below two raw seconds is not rounded into a valid upload or transcription',async t=>{
 const value=await nativeVoiceController(t);await value.controller.start();value.setClock(3000.24);value.controller.release();await until(()=>!value.controller.getBusy());
 assert.equal(value.controller.getError(),'voice:tooShort');assert.equal(value.controller.getErrorTone(),'info');assert.deepEqual(value.controller.getItems(),[]);assert.equal(value.api.calls.reserves.length,0);assert.equal(value.api.calls.imports,0);assert.equal(value.sdk.calls.includes('translateVoice'),false);assert.equal(value.sdk.calls.includes('uploadVoice'),false);
});

test('H5 the successful recording clock excludes SDK initialization and stop response delays',async t=>{
 const value=await nativeVoiceController(t);value.sdk.control.holdStart=true;const start=value.controller.start();await until(()=>value.sdk.calls.includes('startRecord'));value.setClock(9000.75);value.sdk.resolvers.start();await start;
 value.sdk.control.holdStop=true;value.setClock(12000.75);value.controller.release();await until(()=>value.sdk.calls.includes('stopRecord'));value.setClock(25000.5);value.sdk.resolvers.stop();await until(()=>value.controller.getItems()[0]?.status==='READY');
 assert.equal(value.api.calls.reserves[0]?.duration_ms,3000);assert.equal(value.controller.getItems()[0]?.durationMs,3000);
});

test('H5 canceling or disposing a short recording stays silent and starts no upload or ASR',async t=>{
 const value=await nativeVoiceController(t);await value.controller.start();value.setClock(1100.5);value.controller.release(true);await until(()=>!value.controller.getBusy());assert.equal(value.controller.getError(),null);
 await value.controller.start();value.controller.dispose();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.controller.getError(),null);assert.equal(value.api.calls.reserves.length,0);assert.equal(value.sdk.calls.includes('translateVoice'),false);
});

test('H5 transcript ownership removes only unedited voice text and rejects late results from removed and cleared recordings',async t=>{
 let draft:DraftFixtureStore|undefined;const value=await nativeVoiceController(t,event=>draft?.transcript(event));draft=await draftStore();draft.setLocation('synthetic ward');value.sdk.control.holdTranslate=true;
 const record=async()=>{await value.controller.start();value.setClock(5000.5+value.api.calls.reserves.length*5000);value.controller.release();await until(()=>value.controller.getItems()[0]?.status==='READY');await until(()=>value.sdk.resolvers.translations.length>value.api.calls.reserves.length-1);const item=value.controller.getItems()[0];assert.ok(item);return item;};
 const one=await record();value.sdk.resolvers.translations[0]?.('first recognized text');await until(()=>draft?.getDescription()==='first recognized text');value.controller.remove(one.id);assert.equal(draft.getDescription(),'');assert.equal(draft.getLocation(),'synthetic ward');
 const two=await record();draft.setDescription('handwritten correction');value.sdk.resolvers.translations[1]?.('second recognized text');await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(draft.getDescription(),'handwritten correction');value.controller.remove(two.id);assert.equal(draft.getDescription(),'handwritten correction');
 draft.setDescription('');const three=await record();value.controller.remove(three.id);const four=await record();value.sdk.resolvers.translations[2]?.('late removed text');await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(draft.getDescription(),'');value.sdk.resolvers.translations[3]?.('current voice text');await until(()=>draft?.getDescription()==='current voice text');
 draft.setDescription('current voice text edited');value.controller.clear(true);assert.equal(draft.getDescription(),'current voice text edited');draft.clear();draft.transcript({type:'READY',id:four.id,text:'late after clear'});assert.equal(draft.getDescription(),'');
});

test('H5 manual editing an automatic transcript, including deleting it, prevents a delayed ASR overwrite',async t=>{
 await nativeVoiceController(t);const draft=await draftStore();draft.transcript({type:'BEGIN',id:'one'});draft.setDescription('handwritten');draft.setDescription('');draft.transcript({type:'READY',id:'one',text:'late text'});assert.equal(draft.getDescription(),'');
 draft.transcript({type:'BEGIN',id:'two'});draft.transcript({type:'READY',id:'two',text:'original'});draft.setDescription('original');draft.transcript({type:'REMOVE',id:'two'});assert.equal(draft.getDescription(),'original','Even an explicit edit with equal text transfers ownership to the user');
 draft.clear();draft.transcript({type:'BEGIN',id:'three'});draft.transcript({type:'READY',id:'three',text:'replaceable'});draft.transcript({type:'BEGIN',id:'four'});assert.equal(draft.getDescription(),'');draft.transcript({type:'READY',id:'three',text:'stale'});assert.equal(draft.getDescription(),'');draft.transcript({type:'READY',id:'four',text:'replacement'});assert.equal(draft.getDescription(),'replacement');
});

for(const [status,code]of [[400,'INPUT_REJECTED'],[401,'AUTH_REQUIRED'],[403,'FORBIDDEN'],[409,'EXPIRED'],[429,'BUSY'],[503,'UNAVAILABLE'],[418,'UPLOAD_FAILED']] as const)test('H5 reserve '+status+' failures expose only a safe phase and classification without automatic retry',async t=>{
 const value=await nativeVoiceController(t);value.api.control.reserveStatus=status;await value.controller.start();value.setClock(5000.5);value.controller.release();await until(()=>value.controller.getItems()[0]?.status==='ERROR');
 const item=value.controller.getItems()[0];assert.ok(item);assert.deepEqual(item.failure,{stage:'RESERVE',code,messageKey:'voice:'+({INPUT_REJECTED:'uploadInvalid',AUTH_REQUIRED:'uploadSignIn',FORBIDDEN:'uploadForbidden',EXPIRED:'uploadExpired',BUSY:'uploadBusy',UNAVAILABLE:'uploadUnavailable',UPLOAD_FAILED:'uploadFailed'} as const)[code]});assert.equal(JSON.stringify(item.failure).includes('unsafe'),false);await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.api.calls.reserves.length,1);assert.equal(value.api.calls.imports,0);
});

test('H5 native transfer and server import failures retain distinct safe stages and explicit retry reuses the original reservation',async t=>{
 const value=await nativeVoiceController(t);value.sdk.control.uploadFailure=true;await value.controller.start();value.setClock(5000.5);value.controller.release();await until(()=>value.controller.getItems()[0]?.status==='ERROR');
 let item=value.controller.getItems()[0];assert.ok(item);assert.deepEqual(item.failure,{stage:'NATIVE_UPLOAD',code:'SDK_FAILED',messageKey:'voice:nativeUploadFailed'});assert.equal(value.api.calls.reserves.length,1);
 value.sdk.control.uploadFailure=false;value.api.control.importStatus=503;value.controller.retry(item.id);await until(()=>value.controller.getItems()[0]?.failure?.stage==='SERVER_IMPORT');item=value.controller.getItems()[0];assert.ok(item);assert.equal(item.failure?.code,'UNAVAILABLE');assert.equal(value.api.calls.reserves.length,1);assert.equal(value.api.calls.imports,1);
 value.api.control.importStatus=0;value.controller.retry(item.id);await until(()=>value.controller.getItems()[0]?.status==='READY');assert.equal(value.controller.getItems()[0]?.failure,undefined);assert.equal(value.api.calls.reserves.length,1);assert.equal(value.api.calls.imports,2);
});

test('H5 a preview requested immediately before removal cannot restart native audio after cleanup',async t=>{
 const value=await nativeVoiceController(t);await value.controller.start();value.setClock(5000.5);value.controller.release();await until(()=>value.controller.getItems()[0]?.status==='READY');const item=value.controller.getItems()[0];assert.ok(item);
 const playback=value.controller.playNative(item);value.controller.remove(item.id);await playback;assert.equal(value.sdk.calls.filter(call=>call==='playVoice').length,0);assert.equal(value.sdk.calls.includes('stopVoice'),false,'A canceled preview that never reached the bridge needs no native stop');assert.equal(value.controller.getError(),null);
});

test('H5 native preview coalesces a repeated pending play and clear invalidates queued playback',async t=>{
 const value=await nativeVoiceController(t);await value.controller.start();value.setClock(5000.5);value.controller.release();await until(()=>value.controller.getItems()[0]?.status==='READY');const item=value.controller.getItems()[0];assert.ok(item);
 await Promise.all([value.controller.playNative(item),value.controller.playNative(item)]);assert.equal(value.sdk.calls.filter(call=>call==='playVoice').length,1);
 const next=value.controller.playNative(item);value.controller.clear(true);await next;assert.equal(value.sdk.calls.filter(call=>call==='playVoice').length,1);assert.ok(value.sdk.calls.includes('stopVoice'));
});

test('H5 binary upload network errors retain a safe file-upload phase and never retry themselves',async()=>{
 const value=await fixture();try{value.api.control.uploadStatus=0;await value.controller.add(new File(['synthetic image'],'photo.jpg',{type:'image/jpeg'}),'IMAGE');await until(()=>value.controller.getItems()[0]?.status==='ERROR');assert.deepEqual(value.controller.getItems()[0]?.failure,{stage:'BINARY_UPLOAD',code:'NETWORK',messageKey:'voice:uploadNetwork'});assert.equal(value.api.calls.reserves.length,1);assert.equal(value.controller.getError(),null);}finally{value.close();}
});

test('H5 unified clear canonical recording keeps native photos independent of auxiliary ASR',async t=>{
 const events:TranscriptEvent[]=[],value=await nativeVoiceController(t,event=>events.push(event),true);
 assert.deepEqual(value.controller.getRecording(),{canClear:true,canWecom:true,starting:false,recording:false,seconds:0,cancelling:false});assert.equal(value.capture.permissionCalls,0);assert.equal(value.controller.getNative(),true);
 await value.controller.choosePhotos(()=>assert.fail('Unified recording must not turn native photos into a file fallback'));assert.ok(value.sdk.calls.includes('chooseImage'));
 const ids=value.controller.getItemIds();await value.controller.start();await until(()=>value.controller.getRecording().recording);assert.equal(value.controller.getItemIds(),ids);
 assert.deepEqual(value.capture.constraints,{audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,sampleRate:{ideal:48000},channelCount:{ideal:1}}});assert.deepEqual(value.capture.options,{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:128000});
 value.setClock(5000.65);value.controller.release();await until(()=>value.controller.getItems()[0]?.status==='READY');assert.equal(value.api.calls.binaries,1);assert.equal(value.api.calls.imports,0);assert.equal(value.sdk.calls.includes('startRecord'),true);await until(()=>events.some(event=>event.type==='READY'));assert.equal(value.capture.activeTracks,0);
 const item=value.controller.getItems()[0];assert.ok(item);await value.controller.start();assert.equal(value.capture.recorderStarts,1,'An existing voice blocks a second capture');value.controller.remove(item.id);
});

test('H5 native compatibility preserves ASR only when the browser capture API is absent',async t=>{
 const value=await nativeVoiceController(t);await value.controller.start();value.setClock(5000.65);value.controller.release();await until(()=>value.controller.getItems()[0]?.status==='READY');
 assert.equal(value.capture.permissionCalls,0);assert.equal(value.capture.recorderStarts,0);assert.equal(value.sdk.calls.filter(call=>call==='startRecord').length,1);assert.ok(value.sdk.calls.includes('translateVoice'));assert.equal(value.api.calls.imports,1);assert.equal(value.api.calls.binaries,0);
});

test('H5 a quick browser release before permission resolves produces a short hint and never starts another recorder',async t=>{
 const value=await nativeVoiceController(t,()=>{},true);value.capture.holdPermission=true;const start=value.controller.start();assert.equal(value.controller.getRecording().starting,true);await until(()=>value.capture.permissionCalls===1);value.controller.release();value.setClock(10000);value.capture.grant();await start;
 assert.equal(value.controller.getError(),'voice:tooShort');assert.equal(value.controller.getErrorTone(),'info');assert.equal(value.controller.getRecording().starting,false);assert.equal(value.capture.activeTracks,0);assert.equal(value.capture.recorderStarts,0);assert.equal(value.api.calls.reserves.length,0);assert.equal(value.sdk.calls.includes('startRecord'),false);assert.equal(value.controller.getBusy(),false);
});

test('H5 a quick native release before SDK start completes produces a short hint while explicit cancellation stays silent',async t=>{
 const value=await nativeVoiceController(t);value.sdk.control.holdStart=true;const start=value.controller.start();await until(()=>value.sdk.calls.includes('startRecord'));value.controller.release();value.setClock(10000);value.sdk.resolvers.start();await start;
 assert.equal(value.controller.getError(),'voice:tooShort');assert.equal(value.controller.getRecording().starting,false);assert.equal(value.api.calls.reserves.length,0);assert.equal(value.sdk.calls.includes('translateVoice'),false);
 const cancelled=value.controller.start();await until(()=>value.sdk.calls.filter(call=>call==='startRecord').length===2);value.controller.release(true);value.sdk.resolvers.start();await cancelled;assert.equal(value.controller.getError(),null);assert.equal(value.controller.getBusy(),false);
});

test('H5 browser stop latency cannot make a short recording eligible and cancellation releases granted tracks silently',async t=>{
 const value=await nativeVoiceController(t,()=>{},true);value.capture.holdStop=true;await value.controller.start();value.setClock(3000.15);value.controller.release();assert.equal(value.controller.getBusy(),true);value.setClock(20000);value.capture.flushStop();assert.equal(value.controller.getBusy(),false);assert.equal(value.controller.getError(),'voice:tooShort');assert.equal(value.api.calls.reserves.length,0);assert.equal(value.capture.activeTracks,0);
 value.capture.holdStop=false;await value.controller.start();value.controller.release(true);assert.equal(value.controller.getError(),null);assert.equal(value.capture.activeTracks,0);assert.equal(value.api.calls.reserves.length,0);
});

test('H5 denied browser recording in WeCom remains a single user attempt without falling back to native recording',async t=>{
 const value=await nativeVoiceController(t,()=>{},true);value.capture.permissionError=new DOMException('unsafe private device detail','NotAllowedError');await value.controller.start();
 assert.equal(value.controller.getError(),'voice:browserDenied');assert.equal(value.controller.getErrorTone(),'error');assert.equal(value.controller.getBusy(),false);assert.equal(value.capture.permissionCalls,1);assert.equal(value.capture.recorderStarts,0);assert.equal(value.sdk.calls.includes('startRecord'),false);assert.equal(value.api.calls.reserves.length,0);
});

test('H5 native-only capability uses the compatibility recorder without a browser permission prompt',async t=>{
 const value=await nativeVoiceController(t);assert.equal(value.controller.getRecording().canClear,false);assert.equal(value.controller.getRecording().canWecom,true);await value.controller.start();assert.equal(value.sdk.calls.filter(call=>call==='startRecord').length,1);assert.equal(value.capture.permissionCalls,0);value.controller.release(true);await until(()=>!value.controller.getBusy());
});

test('H5 a plain browser defaults to clear recording and never initializes unavailable WeCom voice',async t=>{
 const value=await nativeVoiceController(t,()=>{},true,false);assert.equal(value.controller.getRecording().canClear,true);assert.equal(value.controller.getRecording().canWecom,false);assert.equal(value.controller.getNative(),false);await value.controller.start();assert.equal(value.controller.getRecording().recording,true);assert.equal(value.controller.getRecording().starting,false);value.setClock(5000.65);value.controller.release();await until(()=>value.controller.getItems()[0]?.status==='READY');assert.equal(value.capture.permissionCalls,1);assert.equal(value.sdk.calls.length,0);assert.equal(value.api.calls.binaries,1);assert.equal(value.capture.activeTracks,0);
});

test('H5 media admission stays busy while metadata is pending and through upload readiness',async()=>{
 const value=await fixture();
 try{
  const snapshots:{busy:boolean;ready:boolean}[]=[];
  const unsubscribe=value.controller.subscribe(()=>snapshots.push({busy:value.controller.getBusy(),ready:value.controller.getItems()[0]?.status==='READY'}));
  const adding=value.controller.add(new File(['synthetic audio'],'voice.wav',{type:'audio/wav'}),'VOICE');
  assert.equal(value.controller.getBusy(),true);assert.equal(value.controller.getItems().length,0);assert.equal(value.elements.length,1);
  value.elements[0]?.onloadedmetadata?.();await adding;await until(()=>value.controller.getItems()[0]?.status==='READY');
  assert.equal(value.controller.getBusy(),false);assert.ok(snapshots.length>0);assert.ok(snapshots.filter(snapshot=>!snapshot.ready).every(snapshot=>snapshot.busy),'No admission-to-upload gap may enable submit');
  assert.equal(value.elements[0]?.src,'');assert.equal(value.elements[0]?.loads,1);assert.ok(value.api.calls.reserves[0]?.signal instanceof AbortSignal);unsubscribe();
 }finally{value.close();}
});
test('H5 disposing a metadata probe closes it and never reserves an omitted attachment',async()=>{
 const value=await fixture();
 try{
  const adding=value.controller.add(new File(['synthetic video'],'clip.mp4',{type:'video/mp4'}),'VIDEO');
  assert.equal(value.controller.getBusy(),true);value.controller.dispose();await adding;
  assert.equal(value.controller.getBusy(),false);assert.equal(value.elements[0]?.src,'');assert.equal(value.elements[0]?.loads,1);assert.equal(value.api.calls.reserves.length,0);assert.equal(value.controller.getError(),null);
 }finally{value.close();}
});
test('H5 navigation preserves READY refs for an in-flight or UNKNOWN command; explicit removal cancels',async()=>{
 const value=await fixture();
 try{
  await value.controller.add(new File(['synthetic image'],'photo.jpg',{type:'image/jpeg'}),'IMAGE');await until(()=>value.controller.getItems()[0]?.status==='READY');
  value.controller.dispose();assert.deepEqual(value.api.calls.cancels,[],'Unmount cannot cancel materials that an uncertain command may bind');
 }finally{value.close();}
 const removed=await fixture();
 try{
  await removed.controller.add(new File(['synthetic image'],'photo.jpg',{type:'image/jpeg'}),'IMAGE');await until(()=>removed.controller.getItems()[0]?.status==='READY');
  const id=removed.controller.getItems()[0]?.id;assert.ok(id);removed.controller.remove(id);await until(()=>removed.api.calls.cancels.length===1);assert.equal(removed.controller.getItems().length,0);
 }finally{removed.close();}
});
test('H5 a pending reservation receives and honors the page abort signal',async()=>{
 const value=await fixture();
 try{
  value.api.control.pendingReserve=true;
  await value.controller.add(new File(['synthetic image'],'photo.jpg',{type:'image/jpeg'}),'IMAGE');await until(()=>value.api.calls.reserves.length===1);
  const signal=value.api.calls.reserves[0]?.signal;assert.ok(signal);assert.equal(signal.aborted,false);
  value.controller.dispose();assert.equal(signal.aborted,true);await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.controller.getBusy(),false);assert.deepEqual(value.api.calls.cancels,[]);
 }finally{value.close();}
});

test('H5 progress preserves member and unrelated item snapshots while flushing 100 percent immediately',async()=>{
 const value=await fixture(),previousClock=Object.getOwnPropertyDescriptor(globalThis,'performance');
 try{
  for(const name of ['one','two']){await value.controller.add(new File([name],name+'.png',{type:'image/png'}),'IMAGE');await until(()=>!value.controller.getBusy());}
  const originalIds=value.controller.getItemIds(),first=originalIds[0],second=originalIds[1];assert.ok(first&&second);
  const firstItem=value.controller.getItem(first),secondItem=value.controller.getItem(second);assert.ok(firstItem&&secondItem);
  value.api.control.holdUploads=true;await value.controller.add(new File(['three'],'three.png',{type:'image/png'}),'IMAGE');await until(()=>value.api.calls.uploads.length===1);
  const ids=value.controller.getItemIds(),activeId=ids[2],upload=value.api.calls.uploads[0];assert.ok(activeId&&upload);assert.notEqual(ids,originalIds);assert.deepEqual(originalIds,[first,second]);assert.equal(value.controller.getBusy(),true);
  let memberChanges=0,firstChanges=0,activeChanges=0,active=value.controller.getItem(activeId);const unsubscribe=value.controller.subscribe(()=>{if(value.controller.getItemIds()!==ids)memberChanges+=1;if(value.controller.getItem(first)!==firstItem)firstChanges+=1;const next=value.controller.getItem(activeId);if(next!==active){activeChanges+=1;active=next;}});
  // The controlled clock makes the existing 100ms throttle/100% flush deterministic.
  Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>1000}});
  const commandSnapshot=value.controller.getItems();upload.progress(22);assert.equal(value.controller.getItem(activeId)?.progress,22);upload.progress(55);assert.equal(value.controller.getItem(activeId)?.progress,22,'Intermediate progress waits for the existing throttle');
  upload.progress(100);assert.equal(value.controller.getItem(activeId)?.progress,100,'Completion flushes without waiting for the pending timer');upload.complete();await until(()=>value.controller.getItem(activeId)?.status==='READY');
  assert.equal(value.controller.getItemIds(),ids);assert.equal(value.controller.getItem(first),firstItem);assert.equal(value.controller.getItem(second),secondItem);assert.notEqual(value.controller.getItems(),commandSnapshot);assert.equal(value.controller.getBusy(),false);assert.equal(memberChanges,0);assert.equal(firstChanges,0);assert.ok(activeChanges>=2);unsubscribe();
 }finally{value.close();if(previousClock)Object.defineProperty(globalThis,'performance',previousClock);else Reflect.deleteProperty(globalThis,'performance');}
});

test('H5 member snapshots change only for membership and clear nullable selectors without changing the single upload queue',async()=>{
 const value=await fixture();
 try{
  const empty=value.controller.getItemIds();assert.equal(value.controller.getItemIds(),empty);assert.equal(value.controller.getItem('missing'),null);value.api.control.holdUploads=true;
  await value.controller.add(new File(['one'],'one.png',{type:'image/png'}),'IMAGE');await until(()=>value.api.calls.uploads.length===1);const one=value.controller.getItemIds(),first=one[0],firstUpload=value.api.calls.uploads[0];assert.ok(first&&firstUpload);assert.notEqual(one,empty);assert.deepEqual(empty,[]);
  await value.controller.add(new File(['two'],'two.png',{type:'image/png'}),'IMAGE');const two=value.controller.getItemIds(),second=two[1];assert.ok(second);assert.notEqual(two,one);assert.deepEqual(one,[first]);assert.equal(value.controller.getItem(second)?.status,'QUEUED');assert.equal(value.api.calls.reserves.length,1,'Queued membership cannot start a second concurrent upload');
  firstUpload.complete();await until(()=>value.api.calls.uploads.length===2);const secondUpload=value.api.calls.uploads[1],secondItem=value.controller.getItem(second);assert.ok(secondUpload&&secondItem);assert.equal(value.api.calls.reserves.length,2);
  value.controller.remove(first);const remaining=value.controller.getItemIds();assert.notEqual(remaining,two);assert.deepEqual(remaining,[second]);assert.equal(value.controller.getItem(first),null);assert.equal(value.controller.getItem(second),secondItem);value.controller.remove('missing');assert.equal(value.controller.getItemIds(),remaining);
  value.controller.clear(true);const cleared=value.controller.getItemIds();assert.deepEqual(cleared,[]);assert.equal(value.controller.getItem(second),null);assert.equal(secondUpload.signal.aborted,true);assert.equal(value.controller.getBusy(),false);value.controller.clear(true);assert.equal(value.controller.getItemIds(),cleared);value.controller.dispose();assert.equal(value.controller.getItemIds(),cleared);
 }finally{value.close();}
});
test('H5 acquiring microphone permission remains busy and a late grant is cleaned after cancellation',async t=>{
 const value=await nativeVoiceController(t,()=>{},true,false);value.capture.holdPermission=true;const starting=value.controller.start();await until(()=>value.capture.permissionCalls===1);assert.equal(value.controller.getBusy(),true);assert.equal(value.controller.getItems().length,0);
 value.controller.release(true);await starting;assert.equal(value.controller.getBusy(),false);value.capture.grant();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.capture.activeTracks,0);assert.equal(value.capture.recorderStarts,0);assert.equal(value.controller.getItems().length,0);assert.equal(value.api.calls.reserves.length,0);
});
test('H5 legacy SDK CORP and AGENT signature callbacks share one serialized registration',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 const sdk=`let ready;export let registrations=0;export function register(value){registrations+=1;ready=Promise.all([value.getConfigSignature('https://synthetic.invalid/wecom/yixiaoxiu/'),value.getAgentConfigSignature('https://synthetic.invalid/wecom/yixiaoxiu/')]);}export function ensureConfigReady(){return ready;}export function onVoicePlayEnd(){}`;
 const sdkURL='data:text/javascript;base64,'+Buffer.from(sdk).toString('base64');
 const sourceRoot=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd();
 const source=(await readFile(resolve(sourceRoot,'h5/src/hooks/wecom-registration.ts'),'utf8')).replace("const pending=import('../lib/wecom')",'const pending=import('+JSON.stringify(sdkURL)+')');
 const client=`export const authLost=new EventTarget();export const stats={active:0,max:0,kinds:[]};export const api={signature:async(url,kind,csrf,signal)=>{if(signal.aborted)throw new DOMException('Aborted','AbortError');stats.active+=1;stats.max=Math.max(stats.max,stats.active);stats.kinds.push(kind);await new Promise(resolve=>setTimeout(resolve,5));stats.active-=1;return{timestamp:1,nonceStr:'synthetic',signature:'synthetic'};}};`;
 const loader=createH5PureModuleLoader({overrides:{'hooks/wecom-registration.ts':source,'api/client.ts':client}});
 const module:{registeredWecom:(bootstrap:H5EntryBootstrap)=>Promise<unknown>}=await import(await loader.moduleUrl('hooks/wecom-registration.ts'));
 const transport:{stats:{active:number;max:number;kinds:string[]}}=await import(await loader.moduleUrl('api/client.ts'));
 const oldLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
 try{
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'wxwork Synthetic browser'}});
  Object.defineProperty(globalThis,'location',{configurable:true,value:{href:'https://synthetic.invalid/wecom/yixiaoxiu/#/report'}});
  const native={...bootstrap,h5:{...bootstrap.h5,sdk:{enabled:true,corp_id:'synthetic-corp',agent_id:'synthetic-agent'}}};
  const first=module.registeredWecom(native),second=module.registeredWecom(native);assert.equal(first,second);await first;
  assert.equal(transport.stats.max,1);assert.equal(transport.stats.active,0);assert.deepEqual(transport.stats.kinds,['CORP','AGENT']);
 }finally{if(previous)Object.defineProperty(globalThis,'navigator',previous);else Reflect.deleteProperty(globalThis,'navigator');if(oldLocation)Object.defineProperty(globalThis,'location',oldLocation);else Reflect.deleteProperty(globalThis,'location');}
});

type PlaybackMedia=H5Media&{thumbnail?:H5Thumbnail|null};
async function playbackFixture(){
 const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd();
 const source=transpileModule(await readFile(resolve(root,'h5/src/components/Materials.tsx'),'utf8'),{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022,jsx:JsxEmit.ReactJSX,verbatimModuleSyntax:true}}).outputText;
 const loader=createH5PureModuleLoader({overrides:{
  'components/Materials.ts':source,
  'api/client.ts':`export class ApiError extends Error{constructor(status,code){super(code);this.status=status;this.code=code;}}export const V2_ACCEPT='application/vnd.yixiaoxiu.v2+json';export const authLost=new EventTarget();export const stats={lost:0};export const captureAuthGeneration=()=>0;export function reportAuthLost(generation,signal){if(generation===0&&!signal.aborted){stats.lost+=1;authLost.dispatchEvent(new Event('lost'));}}`,
  'session.ts':"export function useSessionStatus(){return{refresh:async()=>{}};}",
  'components/Icon.ts':"export function Icon(){return null;}",
  'components/ui/primitives.ts':"import{createElement}from'react';export function Button({children,...props}){return createElement('button',props,children);}",
 }});
 const module:{Material:ComponentType<{media:PlaybackMedia;requestRef:string}>;supportsProgressivePlayback:(media:PlaybackMedia)=>boolean;readMediaBlob:(ref:string,media:PlaybackMedia,variant:'PLAYABLE',signal:AbortSignal)=>Promise<Blob>}=await import(await loader.moduleUrl('components/Materials.ts'));
 const client:{stats:{lost:number}}=await import(await loader.moduleUrl('api/client.ts'));
 const bridge:{I18nProvider:ComponentType<{children:ReactNode}>}=await import(await loader.moduleUrl('i18n-react.ts'));
 return{module,client,I18nProvider:bridge.I18nProvider};
}
const legacyVoice:PlaybackMedia={media_ref:'11111111-1111-4111-8111-111111111111',kind:'VOICE',mime_type:'audio/wav',byte_size:12,duration_ms:12_000,url:'',playback_status:'READY',playback_mime_type:'audio/wav'};
test('H5 entry AV metadata opts into native playback; legacy rendering starts no media download',async()=>{
 const {module,I18nProvider}=await playbackFixture(),previous=globalThis.fetch;let reads=0;
 globalThis.fetch=async()=>{reads+=1;throw new Error('No media may be read while rendering');};
 try{
  assert.equal(module.supportsProgressivePlayback(legacyVoice),false);
  assert.equal(module.supportsProgressivePlayback({...legacyVoice,thumbnail:null}),true);
  assert.equal(module.supportsProgressivePlayback({...legacyVoice,kind:'IMAGE',thumbnail:null}),false);
  const voice=renderToStaticMarkup(createElement(I18nProvider,{children:createElement(module.Material,{media:legacyVoice,requestRef:'r'.repeat(32)})}));
  const video=renderToStaticMarkup(createElement(I18nProvider,{children:createElement(module.Material,{media:{...legacyVoice,kind:'VIDEO',mime_type:'video/mp4',playback_mime_type:'video/mp4'},requestRef:'r'.repeat(32)})}));
  assert.match(voice,/<audio[^>]*preload="none"/u);assert.doesNotMatch(voice,/<audio[^>]*src=/u);assert.doesNotMatch(video,/<video/u);assert.equal(reads,0);
 }finally{globalThis.fetch=previous;}
});
test('H5 explicit legacy playback fetches bounded PLAYABLE once without a Range request',async()=>{
 const {module}=await playbackFixture(),previous=globalThis.fetch,calls:{path:string;options:RequestInit}[]=[];
 globalThis.fetch=async(input,options={})=>{calls.push({path:String(input),options});return new Response('synthetic audio',{headers:{'content-type':'audio/wav'}});};
 try{
  const blob=await module.readMediaBlob('r'.repeat(32),legacyVoice,'PLAYABLE',new AbortController().signal);
  assert.equal(await blob.text(),'synthetic audio');assert.equal(calls.length,1);
  assert.match(calls[0]?.path??'',/\?variant=PLAYABLE$/u);assert.equal(new Headers(calls[0]?.options.headers).get('range'),null);assert.equal(calls[0]?.options.credentials,'same-origin');assert.equal(calls[0]?.options.cache,'no-store');
 }finally{globalThis.fetch=previous;}
});
test('H5 legacy playback never retries a member refusal and cancels an oversized response',async()=>{
 const {module,client}=await playbackFixture(),previous=globalThis.fetch;let reads=0,canceled=false;
 try{
  globalThis.fetch=async()=>{reads+=1;return new Response(null,{status:403});};
  await assert.rejects(()=>module.readMediaBlob('r'.repeat(32),legacyVoice,'PLAYABLE',new AbortController().signal),error=>error instanceof Error&&'status'in error&&error.status===403);
  assert.equal(reads,1);assert.equal(client.stats.lost,1);
  globalThis.fetch=async()=>new Response(new ReadableStream({cancel:()=>{canceled=true;}}),{headers:{'content-type':'audio/wav','content-length':String(5*1024*1024+1)}});
  await assert.rejects(()=>module.readMediaBlob('r'.repeat(32),legacyVoice,'PLAYABLE',new AbortController().signal),error=>error instanceof Error&&error.message==='MEDIA_TOO_LARGE');assert.equal(canceled,true);
 }finally{globalThis.fetch=previous;}
});

type VoiceFailureScenario='sdk'|'native'|'unsupported'|'denied'|'permission-network'|'browser-start'|'native-stop';
async function voiceFailureFixture(t:TestContext,scenario:VoiceFailureScenario){
 const secret='SYNTHETIC_PRIVATE_SIGNATURE_AND_URL',descriptors=new Map(['navigator','document','window','MediaRecorder'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),events=new EventTarget(),stats={browser:0,tracksStopped:0};
 const native=scenario==='sdk'||scenario==='native'||scenario==='native-stop';
 Object.defineProperties(globalThis,{window:{configurable:true,value:Object.assign(new EventTarget(),{setInterval,clearInterval,setTimeout,clearTimeout})},document:{configurable:true,value:Object.assign(events,{visibilityState:'visible'})},navigator:{configurable:true,value:{userAgent:native?'Android wxwork/5.0.4':'Synthetic browser',mediaDevices:scenario==='unsupported'?undefined:{getUserMedia:async()=>{stats.browser+=1;if(scenario==='denied')throw new DOMException(secret,'NotAllowedError');if(scenario==='permission-network')throw new Error(secret);return{getTracks:()=>[{stop:()=>{stats.tracksStopped+=1;}}]};}}}}});
 if(scenario==='unsupported'||native)Reflect.deleteProperty(globalThis,'MediaRecorder');else Object.defineProperty(globalThis,'MediaRecorder',{configurable:true,value:class {static isTypeSupported(){return false;}constructor(){throw new Error(secret);}}});
 const registration=await previewCoordinatorSource()+"export const stats={initializations:0,starts:0,stops:0};export async function registeredWecom(){stats.initializations+=1;if('"+scenario+"'==='sdk')throw new Error('"+secret+"');return{startRecord:async()=>{stats.starts+=1;if('"+scenario+"'==='native')throw{errMsg:'startRecord:permission denied "+secret+"',errCode:10003};},onVoiceRecordEnd(){},stopRecord:async()=>{stats.stops+=1;throw new Error('"+secret+"');}};}";
 const loader=createH5PureModuleLoader({overrides:{'api/client.ts':apiFixture,'hooks/wecom-registration.ts':registration}}),module:{createMediaController:(get:()=>H5EntryBootstrap,transcript:(text:string)=>void,message:(key:string)=>string)=>Controller}=await import(await loader.moduleUrl('hooks/useMedia.ts')),api:ApiFixture=await import(await loader.moduleUrl('api/client.ts')),sdk:{stats:{initializations:number;starts:number;stops:number}}=await import(await loader.moduleUrl('hooks/wecom-registration.ts'));
 const value={...bootstrap,h5:{...bootstrap.h5,sdk:{enabled:native,corp_id:native?'synthetic-corp':null,agent_id:native?'synthetic-agent':null}}},controller=module.createMediaController(()=>value,()=>{},key=>key);controller.mount();
 t.after(()=>{controller.dispose();for(const[key,descriptor]of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});
 return{controller,stats,sdk:sdk.stats,api,secret,native};
}
for(const [scenario,key]of [['sdk','setupFailed'],['native','nativeStartFailed'],['unsupported','browserUnavailable'],['denied','browserDenied'],['permission-network','browserFailed'],['browser-start','browserFailed'],['native-stop','finishFailed']]as const)test('H5 voice '+scenario+' failure uses an allowlisted phase message without retrying or exposing raw errors',async t=>{
 const value=await voiceFailureFixture(t,scenario);await value.controller.start();if(scenario==='native-stop'){assert.equal(value.controller.getRecording().recording,true);value.controller.release();await until(()=>!value.controller.getBusy());}
 assert.equal(value.controller.getError(),'voice:'+key);assert.equal(value.controller.getError()?.includes(value.secret),false);assert.equal(value.controller.getRecording().recording,false);assert.equal(value.controller.getBusy(),false);assert.equal(value.controller.getItems().length,0);assert.equal(value.api.calls.reserves.length,0,'a failed recording never starts a media POST');
 if(value.native)assert.equal(value.stats.browser,0,'native failure must not start a second browser recorder');else assert.equal(value.sdk.initializations,0,'browser mode must not initialize native APIs');
 if(scenario==='sdk')assert.equal(value.sdk.starts,0);if(scenario==='native')assert.equal(value.sdk.starts,1);if(scenario==='browser-start')assert.equal(value.stats.tracksStopped,1,'failed MediaRecorder construction releases the granted track');
});

test('H5 unified one press captures a single clear canonical Blob and uses native voice only for transcription',async t=>{
 const events:TranscriptEvent[]=[],value=await nativeVoiceController(t,event=>events.push(event),true);
 await value.controller.start();assert.equal(value.capture.recorderStarts,1,'One press must start the clear canonical recorder');
 assert.equal(value.sdk.calls.filter(name=>name==='startRecord').length,1);
 value.setClock(5000.65);value.controller.release();await until(()=>value.controller.getItems()[0]?.status==='READY');
 const item=value.controller.getItems()[0];assert.ok(item);assert.ok(item.file instanceof Blob);assert.equal(item.localId,null);
 assert.equal(value.api.calls.binaries,1);assert.equal(value.api.calls.imports,0);assert.equal(value.sdk.calls.includes('uploadVoice'),false);
 await until(()=>events.some(event=>event.type==='READY'));assert.equal(events.filter(event=>event.type==='READY').length,1);
});

test('H5 unified native compatibility accepts exactly two raw seconds with bounded integer duration',async t=>{
 const value=await nativeVoiceController(t);await value.controller.start();value.setClock(3000.25);value.controller.release();await until(()=>!value.controller.getBusy());
 assert.equal(value.controller.getItems()[0]?.status,'READY');assert.equal(value.api.calls.reserves[0]?.duration_ms,2000);assert.deepEqual(value.api.calls.rejections,[]);
});

test('H5 unified 1999.9 raw milliseconds stays short without upload or transcription',async t=>{
 const value=await nativeVoiceController(t);await value.controller.start();value.setClock(3000.15);value.controller.release();await until(()=>!value.controller.getBusy());
 assert.equal(value.controller.getError(),'voice:tooShort');assert.equal(value.controller.getErrorTone(),'info');assert.equal(value.controller.getItems().length,0);assert.equal(value.api.calls.reserves.length,0);assert.equal(value.sdk.calls.includes('translateVoice'),false);
});

test('H5 unified empty canonical Blob is never reserved uploaded or transcribed',async t=>{
 const value=await nativeVoiceController(t,()=>{},true);value.capture.empty=true;await value.controller.start();value.setClock(5000.5);value.controller.release();await until(()=>!value.controller.getBusy());
 assert.equal(value.controller.getItems().length,0);assert.equal(value.controller.getError(),'voice:finishFailed');assert.equal(value.api.calls.reserves.length,0);assert.equal(value.sdk.calls.includes('translateVoice'),false);assert.equal(value.capture.activeTracks,0);
});

test('H5 unified missing browser stop event has a bounded cleanup and late events cannot save',async t=>{
 const value=await nativeVoiceController(t,()=>{},true,false);value.capture.holdStop=true;t.mock.timers.enable({apis:['setTimeout']});await value.controller.start();value.setClock(5000.5);value.controller.release();assert.equal(value.controller.getBusy(),true);t.mock.timers.tick(5000);
 assert.equal(value.controller.getBusy(),false);assert.equal(value.controller.getError(),'voice:finishFailed');assert.equal(value.capture.activeTracks,0);value.capture.flushStop();assert.equal(value.controller.getItems().length,0);assert.equal(value.api.calls.reserves.length,0);
});

for(const phase of ['setupFailure','startFailure','stopFailure','translateFailure']as const)test('H5 unified auxiliary '+phase+' retains clear canonical audio and does not block upload or submit',async t=>{
 const value=await nativeVoiceController(t,()=>{},true);value.sdk.control[phase]=true;await value.controller.start();await until(()=>value.controller.getRecording().recording);assert.equal(value.controller.getRecording().starting,false);value.setClock(5000.5);value.controller.release();await until(()=>value.controller.getItems()[0]?.status==='READY');await until(()=>value.controller.getError()==='voice:transcriptUnavailable');
 assert.equal(value.controller.getErrorTone(),'info');assert.equal(value.api.calls.binaries,1);assert.equal(value.api.calls.imports,0);assert.equal(value.sdk.calls.includes('uploadVoice'),false);assert.equal(value.controller.getBusy(),false);assert.ok(value.controller.getItems()[0]?.file instanceof Blob);assert.equal(value.controller.getItems()[0]?.localId,null);
});

test('H5 unified SDK initialization overlaps the user permission request but cannot bypass denial or release',async t=>{
 const value=await nativeVoiceController(t,()=>{},true);value.capture.holdPermission=true;const starting=value.controller.start();await until(()=>value.capture.permissionCalls===1);assert.ok(value.sdk.calls.includes('registered'),'SDK readiness begins without waiting for the permission response');assert.equal(value.sdk.calls.includes('startRecord'),false);value.controller.release(true);await starting;value.capture.grant();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.capture.activeTracks,0);assert.equal(value.capture.recorderStarts,0);assert.equal(value.sdk.calls.includes('startRecord'),false);assert.equal(value.api.calls.reserves.length,0);
});

test('H5 unified recording announcement waits for the auxiliary native start ACK without postponing clear capture',async t=>{
 const value=await nativeVoiceController(t,()=>{},true);value.sdk.control.holdStart=true;const starting=value.controller.start();await until(()=>value.sdk.calls.includes('startRecord'));
 try{assert.equal(value.capture.recorderStarts,1);assert.equal(value.controller.getRecording().starting,true,'The preparation cue must remain until the native microphone really starts');assert.equal(value.controller.getRecording().recording,false,'Do not invite speech while the ASR microphone has not acknowledged start');}
 finally{value.setClock(1800.25);value.sdk.resolvers.start();await starting;}
 await until(()=>value.controller.getRecording().recording);assert.equal(value.controller.getRecording().starting,false);value.setClock(4000.25);value.controller.release();await until(()=>value.controller.getItems()[0]?.status==='READY');assert.equal(value.api.calls.reserves[0]?.duration_ms,3000);assert.equal(value.capture.activeTracks,0);assert.equal(value.api.calls.binaries,1);assert.equal(value.api.calls.imports,0);
});

test('H5 unified cold SDK preparation keeps the cue honest while clear capture already owns the microphone',async t=>{
 const value=await nativeVoiceController(t,()=>{},true);value.sdk.control.holdSdk=true;await value.controller.start();
 try{assert.equal(value.capture.recorderStarts,1);assert.equal(value.controller.getRecording().starting,true);assert.equal(value.controller.getRecording().recording,false);assert.equal(value.sdk.calls.includes('startRecord'),false);}
 finally{value.sdk.control.holdSdk=false;for(const ready of value.sdk.resolvers.sdk)ready();}
 await until(()=>value.controller.getRecording().recording);assert.equal(value.sdk.calls.filter(call=>call==='startRecord').length,1);value.controller.release(true);await until(()=>!value.controller.getBusy());assert.equal(value.capture.activeTracks,0);assert.equal(value.api.calls.reserves.length,0);
});

test('H5 unified auxiliary SDK preparation is bounded and cannot dispatch a native start after degradation',async t=>{
 const value=await nativeVoiceController(t,()=>{},true);value.sdk.control.holdSdk=true;t.mock.timers.enable({apis:['setTimeout']});await value.controller.start();assert.equal(value.controller.getRecording().starting,true);t.mock.timers.tick(4999);await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.controller.getRecording().recording,false);
 t.mock.timers.tick(1);await until(()=>value.controller.getRecording().recording);assert.equal(value.controller.getRecording().starting,false);assert.equal(value.controller.getError(),'voice:transcriptUnavailable');value.sdk.control.holdSdk=false;for(const ready of value.sdk.resolvers.sdk)ready();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.sdk.calls.includes('startRecord'),false,'An expired auxiliary preparation must never acquire a late microphone');
 value.setClock(8000.25);value.controller.release();await until(()=>value.controller.getItems()[0]?.status==='READY');assert.equal(value.api.calls.binaries,1);assert.equal(value.api.calls.imports,0);assert.equal(value.sdk.calls.includes('translateVoice'),false);assert.equal(value.capture.activeTracks,0);assert.equal(value.controller.getBusy(),false);
});

test('H5 unified timed-out auxiliary start still owns real device work until its late ACK is stopped',async t=>{
 const value=await nativeVoiceController(t,()=>{},true);value.sdk.control.holdStart=true;t.mock.timers.enable({apis:['setTimeout']});await value.controller.start();await until(()=>value.sdk.calls.includes('startRecord'));assert.equal(value.controller.getRecording().starting,true);
 t.mock.timers.tick(5000);await until(()=>value.controller.getRecording().recording);value.setClock(8000.25);value.controller.release();await until(()=>value.controller.getItems()[0]?.status==='READY');assert.equal(value.api.calls.binaries,1);assert.equal(value.sdk.calls.includes('translateVoice'),false);const item=value.controller.getItems()[0];assert.ok(item);value.controller.remove(item.id);
 const second=value.controller.start();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.capture.permissionCalls,1,'Real pending native work must fence the next microphone');assert.equal(value.sdk.calls.filter(call=>call==='startRecord').length,1);value.controller.release(true);await second;value.sdk.resolvers.start();await until(()=>value.sdk.calls.includes('stopRecord'));assert.equal(value.sdk.calls.filter(call=>call==='stopRecord').length,1);assert.equal(value.sdk.calls.includes('translateVoice'),false);assert.equal(value.capture.activeTracks,0);assert.equal(value.controller.getBusy(),false);
});

test('H5 unified canceled SDK preparation cannot replace the next gesture cue or start an obsolete microphone',async t=>{
 const value=await nativeVoiceController(t,()=>{},true);value.sdk.control.holdSdk=true;await value.controller.start();value.controller.release(true);assert.equal(value.controller.getBusy(),false);await value.controller.start();assert.equal(value.capture.recorderStarts,2);assert.equal(value.controller.getRecording().starting,true);
 value.sdk.resolvers.sdk[0]?.();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.controller.getRecording().starting,true);assert.equal(value.controller.getRecording().recording,false);assert.equal(value.sdk.calls.includes('startRecord'),false);assert.equal(value.controller.getError(),null);
 value.sdk.resolvers.sdk[1]?.();await until(()=>value.controller.getRecording().recording);assert.equal(value.sdk.calls.filter(call=>call==='startRecord').length,1);value.controller.release(true);await until(()=>!value.controller.getBusy());assert.equal(value.capture.activeTracks,0);assert.equal(value.api.calls.reserves.length,0);assert.equal(value.sdk.calls.includes('translateVoice'),false);
});

test('H5 unified clear upload completes before a native stop ACK and deletion fences its late result',async t=>{
 const events:TranscriptEvent[]=[],value=await nativeVoiceController(t,event=>events.push(event),true);value.sdk.control.holdStop=true;await value.controller.start();await until(()=>value.sdk.calls.includes('startRecord'));value.setClock(5000.5);value.controller.release();await until(()=>value.controller.getItems()[0]?.status==='READY');
 assert.equal(value.controller.getBusy(),false);assert.equal(value.api.calls.binaries,1);assert.equal(value.sdk.calls.includes('translateVoice'),false);const item=value.controller.getItems()[0];assert.ok(item);value.controller.remove(item.id);value.sdk.resolvers.stop();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(events.some(event=>event.type==='READY'),false);assert.equal(value.sdk.calls.includes('translateVoice'),false);assert.equal(value.controller.getItems().length,0);
});

test('H5 unified a native start ACK after release is cleaned without transcribing a late capture',async t=>{
 const value=await nativeVoiceController(t,()=>{},true);value.sdk.control.holdStart=true;await value.controller.start();await until(()=>value.sdk.calls.includes('startRecord'));value.setClock(5000.5);value.controller.release();await until(()=>value.controller.getItems()[0]?.status==='READY');assert.equal(value.controller.getBusy(),false);value.setClock(9000.5);value.sdk.resolvers.start();await until(()=>value.sdk.calls.includes('stopRecord'));await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(value.sdk.calls.filter(name=>name==='stopRecord').length,1);assert.equal(value.sdk.calls.includes('translateVoice'),false);assert.equal(value.controller.getError(),'voice:transcriptUnavailable');assert.equal(value.controller.getErrorTone(),'info');assert.equal(value.api.calls.binaries,1);
});

for(const signal of ['mute','ended','recorder-error']as const)test('H5 unified observable clear '+signal+' interruption stops both captures and never saves partial data',async t=>{
 const value=await nativeVoiceController(t,()=>{},true);await value.controller.start();await until(()=>value.sdk.calls.includes('startRecord'));value.setClock(5000.5);
 if(signal==='recorder-error')value.capture.failRecorder();else{if(signal==='mute')value.track.muted=true;else value.track.readyState='ended';value.track.dispatchEvent(new Event(signal));}
 await until(()=>!value.controller.getBusy());assert.equal(value.controller.getError(),'voice:interrupted');assert.equal(value.controller.getErrorTone(),'error');assert.equal(value.capture.activeTracks,0);assert.equal(value.controller.getItems().length,0);assert.equal(value.api.calls.reserves.length,0);assert.equal(value.sdk.calls.includes('translateVoice'),false);await until(()=>value.sdk.calls.includes('stopRecord'));
});

test('H5 unified sixty-second canonical auto-stop saves one bounded clear file and stops native work once',async t=>{
 const value=await nativeVoiceController(t,()=>{},true);t.mock.timers.enable({apis:['setTimeout','setInterval']});await value.controller.start();await until(()=>value.sdk.calls.includes('startRecord'));value.setClock(61000.25);t.mock.timers.tick(60000);await until(()=>value.controller.getItems()[0]?.status==='READY');assert.equal(value.controller.getItems()[0]?.durationMs,60000);assert.equal(value.api.calls.binaries,1);assert.equal(value.api.calls.imports,0);assert.equal(value.capture.activeTracks,0);assert.equal(value.sdk.calls.filter(name=>name==='stopRecord').length,1);assert.equal(value.controller.getBusy(),false);
});

test('H5 unified unresolved SDK preparation owns no device slot and does not block the next clear gesture',async t=>{
 const value=await nativeVoiceController(t,()=>{},true);value.sdk.control.holdSdk=true;await value.controller.start();assert.equal(value.sdk.resolvers.sdk.length,1);value.setClock(5000.5);value.controller.release();await until(()=>value.controller.getItems()[0]?.status==='READY');assert.equal(value.controller.getBusy(),false);const first=value.controller.getItems()[0];assert.ok(first);value.controller.remove(first.id);
 await value.controller.start();assert.equal(value.controller.getRecording().starting,true);assert.equal(value.controller.getRecording().recording,false);assert.equal(value.capture.recorderStarts,2);assert.equal(value.capture.permissionCalls,2);assert.equal(value.sdk.resolvers.sdk.length,2);assert.equal(value.sdk.calls.includes('startRecord'),false);value.setClock(9000.5);value.controller.release();await until(()=>value.controller.getItems()[0]?.status==='READY');assert.equal(value.api.calls.binaries,2);
 value.sdk.control.holdSdk=false;for(const ready of value.sdk.resolvers.sdk)ready();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.sdk.calls.includes('startRecord'),false,'Canceled SDK setup must never dispatch a late native start');assert.equal(value.sdk.calls.includes('stopRecord'),false,'No actual start was dispatched, so no physical stop is required');assert.equal(value.sdk.calls.includes('translateVoice'),false);assert.equal(value.controller.getBusy(),false);assert.equal(value.controller.getError(),'voice:transcriptUnavailable');
 const second=value.controller.getItems()[0];assert.ok(second);value.controller.remove(second.id);await value.controller.start();assert.equal(value.capture.permissionCalls,3);await until(()=>value.sdk.calls.includes('startRecord'));value.controller.release(true);
});

test('H5 lazy capture cancellation ends busy immediately while the actual import is still pending',async t=>{
 const value=await nativeVoiceController(t,()=>{},true,false,true),chunk=value.chunk;assert.ok(chunk);const starting=value.controller.start();value.controller.release(true);
 try{assert.equal(value.controller.getBusy(),false,'Pure chunk loading must not retain a released recording');assert.equal(value.controller.getRecording().starting,false);assert.equal(value.controller.getError(),null);assert.equal(value.capture.permissionCalls,0);assert.equal(value.api.calls.reserves.length,0);}
 finally{chunk.open();await starting;}
 assert.equal(value.capture.permissionCalls,0);assert.equal(value.api.calls.reserves.length,0);
});

test('H5 lazy normal release immediately gives the short hint and a late import starts no device work',async t=>{
 const value=await nativeVoiceController(t,()=>{},true,true,true),chunk=value.chunk;assert.ok(chunk);const starting=value.controller.start();value.controller.release();
 try{assert.equal(value.controller.getBusy(),false);assert.equal(value.controller.getError(),'voice:tooShort');assert.equal(value.controller.getErrorTone(),'info');assert.equal(value.controller.getRecording().starting,false);}
 finally{chunk.open();await starting;}
 assert.equal(value.capture.permissionCalls,0);assert.equal(value.sdk.calls.includes('startRecord'),false);assert.equal(value.api.calls.reserves.length,0);
});

test('H5 lazy canceled imports cannot clear a newer gesture starting state or acquire extra microphones',async t=>{
 const value=await nativeVoiceController(t,()=>{},true,false,true),chunk=value.chunk;assert.ok(chunk);value.capture.holdPermission=true;
 const old=value.controller.start();value.controller.release(true);const recent=value.controller.start();value.controller.release(true);const current=value.controller.start();assert.equal(value.controller.getRecording().starting,true);await until(()=>chunk.entered===1);chunk.open();await Promise.all([old,recent]);await until(()=>value.capture.permissionCalls===1);
 try{assert.equal(value.controller.getRecording().starting,true,'Old import continuations must not reset the current permission wait');assert.equal(value.controller.getBusy(),true);assert.equal(value.controller.getError(),null);assert.equal(value.capture.recorderStarts,0);}
 finally{value.controller.release(true);value.capture.grant();await current;}
 assert.equal(value.controller.getBusy(),false);assert.equal(value.capture.permissionCalls,1);assert.equal(value.capture.activeTracks,0);assert.equal(value.capture.recorderStarts,0);assert.equal(value.api.calls.reserves.length,0);
});

test('H5 lazy rejected obsolete import cannot replace a completed normal-release notice',async t=>{
 const value=await nativeVoiceController(t,()=>{},true,true,true),chunk=value.chunk;assert.ok(chunk);const starting=value.controller.start();value.controller.release();await until(()=>chunk.entered===1);chunk.fail();await starting;
 assert.equal(value.controller.getBusy(),false);assert.equal(value.controller.getRecording().starting,false);assert.equal(value.controller.getError(),'voice:tooShort');assert.equal(value.controller.getErrorTone(),'info');assert.equal(value.capture.permissionCalls,0);assert.equal(value.sdk.calls.includes('startRecord'),false);assert.equal(value.api.calls.reserves.length,0);
});
