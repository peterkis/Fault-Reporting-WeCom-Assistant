import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createElement,type ComponentType} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transpileModule,ModuleKind,ScriptTarget,JsxEmit} from 'typescript';
import type {H5EntryBootstrap,H5Thumbnail} from '../contracts/yxx_h5_entry_contracts.js';
import type {H5Media} from '../contracts/yxx_h5_v2_contracts.js';
import {createH5PureModuleLoader} from './helpers/h5-pure-module-loader.mjs';

const bootstrap:H5EntryBootstrap={authenticated:true,identity_mode:'MEMBER_SELF_SERVICE',read_only:false,can_submit:true,can_supplement:true,csrf_token:'synthetic-csrf',recovery_scope:'synthetic-member',h5:{profile:{name:null,department:null,phone:null,avatar_url:null},can_upload:true,can_urge:true,can_evaluate:true,can_view_department:false,sdk:{enabled:false,corp_id:null,agent_id:null},support:{emergency_phone:'18117887318',service_phone:'61318500'},limits:{voice_count:1,voice_duration_seconds:60,voice_bytes:5*1024*1024,image_count:6,image_bytes:10*1024*1024,video_count:1,video_duration_seconds:60,video_bytes:20*1024*1024,total_bytes:40*1024*1024}}};
interface MediaElement {duration:number;src:string;preload:string;onloadedmetadata:(()=>void)|null;onerror:(()=>void)|null;loads:number;removeAttribute:(name:string)=>void;load:()=>void}
interface ItemSnapshot {id:string;ref:string|null;status:string;progress:number}
interface Controller {getBusy:()=>boolean;getItems:()=>ItemSnapshot[];getItemIds:()=>readonly string[];getItem:(id:string)=>ItemSnapshot|null;getError:()=>string|null;add:(file:File,kind:'IMAGE'|'VOICE'|'VIDEO')=>Promise<void>;remove:(id:string)=>void;clear:(bound?:boolean)=>void;start:()=>Promise<void>;release:(cancel?:boolean)=>void;subscribe:(listener:()=>void)=>()=>void;dispose:()=>void;mount:()=>void}
interface ApiFixture {calls:{reserves:{signal:AbortSignal|undefined}[];cancels:string[];uploads:{id:string;signal:AbortSignal;progress:(value:number)=>void;complete:()=>void}[]};control:{pendingReserve:boolean;holdUploads:boolean}}
const apiFixture=`
export const authLost=new EventTarget();
export const calls={reserves:[],cancels:[],uploads:[]};
export const control={pendingReserve:false,holdUploads:false};
export const api={
 reserve:async(input,csrf,signal)=>{calls.reserves.push({signal});if(control.pendingReserve)await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});return{media_ref:'11111111-1111-4111-8111-111111111111',kind:input.kind};},
 upload:async(ref,file,csrf,id,signal,progress)=>{if(signal.aborted)throw new DOMException('Aborted','AbortError');if(control.holdUploads)await new Promise((resolve,reject)=>{const abort=()=>reject(new DOMException('Aborted','AbortError'));signal.addEventListener('abort',abort,{once:true});calls.uploads.push({id,signal,progress,complete:()=>{signal.removeEventListener('abort',abort);resolve();}});});else progress(22);progress(100);return{media_ref:ref,kind:'IMAGE'};},
 cancelUpload:async(ref)=>{calls.cancels.push(ref);},
 importWecom:async()=>{throw new Error('Native device APIs are not used by this fixture');}
};`;

async function fixture(){
 const loader=createH5PureModuleLoader({overrides:{'api/client.ts':apiFixture,'hooks/wecom-registration.ts':"export async function registeredWecom(){throw new Error('No native SDK in this fixture');}"}});
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
test('H5 acquiring microphone permission remains busy until a released attempt is cleaned up',async()=>{
 const value=await fixture(),previous=Object.getOwnPropertyDescriptor(globalThis,'MediaRecorder');
 let grant:(stream:{getTracks:()=>{stop:()=>void}[]})=>void=()=>assert.fail('Permission resolver not installed'),stopped=0;
 const permission=new Promise<{getTracks:()=>{stop:()=>void}[]}>(resolve=>{grant=resolve;});
 try{
  Object.defineProperty(globalThis,'MediaRecorder',{configurable:true,value:class {}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'Synthetic browser',mediaDevices:{getUserMedia:()=>permission}}});
  const starting=value.controller.start();assert.equal(value.controller.getBusy(),true);assert.equal(value.controller.getItems().length,0);
  value.controller.release(true);grant({getTracks:()=>[{stop:()=>{stopped+=1;}}]});await starting;
  assert.equal(stopped,1);assert.equal(value.controller.getBusy(),false);assert.equal(value.controller.getItems().length,0);assert.equal(value.api.calls.reserves.length,0);
 }finally{if(previous)Object.defineProperty(globalThis,'MediaRecorder',previous);else Reflect.deleteProperty(globalThis,'MediaRecorder');value.close();}
});
test('H5 cold SDK auto-AGENT and explicit CORP signatures share one serialized registration',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 const sdk=`let options,agent;export let registrations=0;export function register(value){registrations+=1;options=value;agent=options.getAgentConfigSignature('https://synthetic.invalid/wecom/yixiaoxiu/');}export function ensureCorpConfigReady(){return options.getConfigSignature('https://synthetic.invalid/wecom/yixiaoxiu/');}export function ensureAgentConfigReady(){return agent;}`;
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
  assert.equal(transport.stats.max,1);assert.equal(transport.stats.active,0);assert.deepEqual(transport.stats.kinds,['AGENT','CORP']);
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
 return{module,client};
}
const legacyVoice:PlaybackMedia={media_ref:'11111111-1111-4111-8111-111111111111',kind:'VOICE',mime_type:'audio/wav',byte_size:12,duration_ms:12_000,url:'',playback_status:'READY',playback_mime_type:'audio/wav'};
test('H5 entry AV metadata opts into native playback; legacy rendering starts no media download',async()=>{
 const {module}=await playbackFixture(),previous=globalThis.fetch;let reads=0;
 globalThis.fetch=async()=>{reads+=1;throw new Error('No media may be read while rendering');};
 try{
  assert.equal(module.supportsProgressivePlayback(legacyVoice),false);
  assert.equal(module.supportsProgressivePlayback({...legacyVoice,thumbnail:null}),true);
  assert.equal(module.supportsProgressivePlayback({...legacyVoice,kind:'IMAGE',thumbnail:null}),false);
  const voice=renderToStaticMarkup(createElement(module.Material,{media:legacyVoice,requestRef:'r'.repeat(32)}));
  const video=renderToStaticMarkup(createElement(module.Material,{media:{...legacyVoice,kind:'VIDEO',mime_type:'video/mp4',playback_mime_type:'video/mp4'},requestRef:'r'.repeat(32)}));
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
