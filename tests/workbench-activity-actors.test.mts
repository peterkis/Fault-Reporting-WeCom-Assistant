import test from 'node:test';
import assert from 'node:assert/strict';
import {activityActorName,extendActivityActorColors} from '../app/pc-admin/src/app/activity-actors.mjs';

test('different actor labels no longer share the former five-slot collision',()=>{
  const records=[{actor:'张三',audience:'INTERNAL'},{actor:null,audience:'REPORT'},{actor:'SYSTEM',audience:'INTERNAL'}];
  const colors=extendActivityActorColors(new Map(),records);
  assert.deepEqual([...colors.keys()],['张三','报修人','系统']);
  assert.equal(new Set([...colors.values()].map(value=>value.backgroundColor)).size,3);
  assert.equal(activityActorName({actor:'WORKER',audience:'INTERNAL'}),'系统');
  assert.equal(activityActorName({actor:'constructor',audience:'INTERNAL'}),'constructor');
  assert.equal(activityActorName({actor:'__proto__',audience:'INTERNAL'}),'__proto__');
  assert.strictEqual(extendActivityActorColors(colors,[...records,{actor:'SERVICE',audience:'INTERNAL'}]),colors);
});

test('new pages, new participants and reordered refreshes preserve earlier actor colors',()=>{
  const first=[{actor:'张三',audience:'INTERNAL'},{actor:null,audience:'REPORT'}];
  const before=extendActivityActorColors(new Map(),first);
  const after=extendActivityActorColors(before,[{actor:'王五',audience:'INTERNAL'},...first,{actor:'吴九',audience:'INTERNAL'}]);
  assert.equal(before.size,2);assert.equal(after.size,4);
  for(const [name,color] of before)assert.strictEqual(after.get(name),color);
  assert.equal(new Set([...after.values()].map(value=>value.backgroundColor)).size,4);
  assert.strictEqual(extendActivityActorColors(after,[...first].reverse()),after);
});

test('more actors than the base palette remain distinct and readable',()=>{
  const records=Array.from({length:64},(_,index)=>({actor:'合成参与人'+index,audience:'INTERNAL'}));
  const colors=extendActivityActorColors(new Map(),records);
  assert.equal(colors.size,64);
  assert.equal(new Set([...colors.values()].map(value=>value.backgroundColor)).size,64);
  const luminance=(hex:string)=>[1,3,5].map(start=>Number.parseInt(hex.slice(start,start+2),16)/255)
    .map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4)
    .reduce((total,value,index)=>total+value*([0.2126,0.7152,0.0722][index]??0),0);
  for(const value of colors.values()){
    assert.match(value.backgroundColor,/^#[\da-f]{6}$/u);assert.match(value.color,/^#[\da-f]{6}$/u);
    assert.ok((luminance(value.backgroundColor)+0.05)/(luminance(value.color)+0.05)>=4.5);
  }
});
