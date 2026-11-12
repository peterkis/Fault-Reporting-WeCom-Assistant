import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';

// Card 32D-T: toast timing and the three-notice cap are one dependency-free policy module, loaded from its PC source.
interface Item {id:string;visible:boolean;duration?:number;createdAt:number}
interface Policy {toastTone:(type:string,className?:string)=>string;toastHeading:(title:string|undefined,source:string)=>string|null;AUTO_DISMISS_MS:number;MAX_VISIBLE_TOASTS:number;toastDuration:(kind:{unknown:boolean;loading:boolean;error:boolean;persistent:boolean})=>number;overflowToasts:(toasts:readonly Item[])=>Item[]}
async function policy():Promise<Policy>{
 const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??resolve(import.meta.dirname,'..');
 const source=await readFile(resolve(root,'app/pc-admin/src/app/toast-policy.ts'),'utf8');
 const output=transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022,verbatimModuleSyntax:true}}).outputText;
 return await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64')) as Policy;
}
const plain={unknown:false,loading:false,error:false,persistent:false};

test('Card 32D-T toast durations: success and plain notices close after 4s; unknown, in-progress and error notices wait for the user',async()=>{
 const p=await policy();
 assert.equal(p.AUTO_DISMISS_MS,4000);assert.equal(p.MAX_VISIBLE_TOASTS,3);
 assert.equal(p.toastDuration(plain),4000);
 for(const key of ['unknown','loading','error','persistent'] as const)assert.equal(p.toastDuration({...plain,[key]:true}),Infinity,key);
});

test('Card 32D-T five auto-closing notices leave at most three visible, pushing out the oldest first',async()=>{
 const p=await policy();
 const five=[1,2,3,4,5].map(n=>({id:'t'+n,visible:true,duration:4000,createdAt:n*10}));
 const pushed=p.overflowToasts(five);
 assert.deepEqual(pushed.map(t=>t.id),['t1','t2']);
 assert.equal(five.filter(t=>!pushed.includes(t)).length,3);
 // Three or fewer visible: nothing is pushed out; notices already leaving do not count.
 assert.deepEqual(p.overflowToasts(five.slice(0,3)),[]);
 assert.deepEqual(p.overflowToasts([...five.slice(0,3),{id:'gone',visible:false,duration:4000,createdAt:0}]),[]);
});

test('Card 32D-T a notice that waits for the user is never pushed out, even when it is the oldest',async()=>{
 const p=await policy();
 const items=[{id:'unknown',visible:true,duration:Infinity,createdAt:1},{id:'error',visible:true,duration:Infinity,createdAt:2},
  {id:'a',visible:true,duration:4000,createdAt:3},{id:'b',visible:true,duration:4000,createdAt:4},{id:'c',visible:true,duration:4000,createdAt:5}];
 assert.deepEqual(p.overflowToasts(items).map(t=>t.id),['a','b']);
 // Only waiting notices beyond the cap: none can be pushed out, so they all stay.
 const waiting=[1,2,3,4].map(n=>({id:'w'+n,visible:true,duration:Infinity,createdAt:n}));
 assert.deepEqual(p.overflowToasts(waiting),[]);
 assert.deepEqual(p.overflowToasts([{id:'loading',visible:true,createdAt:1},...three(2)]).map(t=>t.id),['x2']);
});
function three(start:number):Item[]{return [0,1,2].map(n=>({id:'x'+(start+n),visible:true,duration:4000,createdAt:start+n}));}

test('Card 33 tones: the toaster type and the unknown-outcome class select one of five tones',async()=>{
 const p=await policy();
 assert.equal(p.toastTone('success',''),'success');assert.equal(p.toastTone('blank',''),'info');assert.equal(p.toastTone('blank','is-warning'),'warning');
 assert.equal(p.toastTone('error',''),'danger');assert.equal(p.toastTone('loading',''),'loading');
 // The toaster type wins over the class: an error or in-progress notice is never shown as an unknown outcome.
 assert.equal(p.toastTone('error','is-warning'),'danger');assert.equal(p.toastTone('loading','is-warning'),'loading');
});

test('Card 33 headings: an outcome title, else the purpose label, else none — and then the message is a single line',async()=>{
 const p=await policy();
 assert.equal(p.toastHeading('已恢复','closure-restore'),'已恢复');assert.equal(p.toastHeading(undefined,'item-follow'),'关注');
 assert.equal(p.toastHeading(undefined,'closure-restore'),null);assert.equal(p.toastHeading('','closure-restore'),null);
 // Never the generic 「操作提示」 fallback.
 assert.notEqual(p.toastHeading(undefined,'unlabelled-source'),'操作提示');assert.equal(p.toastHeading(undefined,'unlabelled-source'),null);
});
