import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {entryConfig} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {validateYxxEntryConfig} from '../src/p2-g2-yixiaoxiu-contract.mjs';
import {createYxxDelegatedIdentityMapping} from '../src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {createApplicationMemberVerifier} from '../src/wecom-application-member.mjs';
import type {VerifiedApplicationMember} from '../src/wecom-application-member.mjs';
import {isPureGroupThanks} from '../src/mvp-group-replies.mjs';

test('MVP app member mode needs no roster while explicit legacy correspondence remains scoped and case sensitive',async()=>{
 const config=validateYxxEntryConfig({...entryConfig,identityMode:'VERIFIED_APP_OPENID'});let calls=0;
 const empty=await createYxxDelegatedIdentityMapping({config,accessTokenProvider:async()=>{calls++;throw Error('NO_STARTUP_DIRECTORY_SYNC');}});assert.equal(calls,0);
 assert.throws(()=>validateYxxEntryConfig({...config,proofRef:null}));
 assert.throws(()=>validateYxxEntryConfig({...config,proofKind:'SYNTHETIC',validationProfile:'DEPLOYMENT'}));
 assert.throws(()=>validateYxxEntryConfig({...config,reporterUserIds:['old-A','OLD-a']}));
 const legacy=validateYxxEntryConfig({...config,reporterUserIds:['old-A']});
 const mapping=await createYxxDelegatedIdentityMapping({config:legacy,accessTokenProvider:async()=> 'synthetic',fetchImpl:async(input,init)=>{
  assert.equal(new URL(String(input)).pathname,'/cgi-bin/batch/userid_to_openuserid');assert.deepEqual(JSON.parse(String(init?.body)),{userid_list:['old-A']});
  return new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:'old-A',open_userid:'open-Old-A'}]}));
 }});
 assert.notEqual(mapping.configHash,empty.configHash);
});

test('MVP application qualification checks the exact open identity, visibility and account state without logging a directory',async()=>{
 let response:unknown={errcode:0,userid:'open-A',name:'合成人员',status:1,enable:1},calls=0;
 const verify=createApplicationMemberVerifier({accessTokenProvider:async()=> 'synthetic-token',fetchImpl:async(input,init)=>{
  calls++;const url=new URL(String(input));assert.equal(url.pathname,'/cgi-bin/user/get');assert.equal(url.searchParams.get('userid'),'open-A');assert.equal(init?.method,'GET');assert.equal(init.redirect,'error');
  return new Response(JSON.stringify(response));
 }});
 assert.equal((await verify('open-A'))?.displayName,'合成人员');
 for(const value of [{errcode:60011},{errcode:0,userid:'open-B',status:1},{errcode:0,userid:'open-A',status:2},{errcode:0,userid:'open-A',status:1,enable:0}]){response=value;assert.equal(await verify('open-A'),null);}
 response=[];await assert.rejects(verify('open-A'),{name:'ApplicationMemberUnavailableError'});
 const before=calls;assert.equal(await verify('@all'),null);assert.equal(await verify('open-A|open-B'),null);assert.equal(calls,before);
});

test('MVP application qualification keeps a bounded serial fence when a provider ignores cancellation',{timeout:9000},async()=>{
 let release:((value:Response)=>void)|undefined,blocked=true,calls=0;
 const verify=createApplicationMemberVerifier({accessTokenProvider:async()=> 'synthetic',fetchImpl:async()=>{
  calls++;if(blocked)return new Promise<Response>(resolve=>{release=resolve;});return new Response('{"errcode":0,"userid":"open-A","status":1}');
 }});
 const pending=Promise.allSettled(Array.from({length:32},()=>verify('open-A')));await assert.rejects(verify('open-A'),{name:'ApplicationMemberUnavailableError'});
 const results=await pending;assert.ok(results.every(v=>v.status==='rejected'&&v.reason instanceof Error&&v.reason.name==='ApplicationMemberUnavailableError'));assert.equal(calls,1);assert.ok(release);
 blocked=false;release(new Response('{"errcode":0,"userid":"open-A","status":1}'));await delay(0);
 assert.equal((await verify('open-A'))?.openUserId,'open-A');assert.equal(calls,2);
});

test('MVP application lookup unavailability remains distinct from confirmed non-membership',async()=>{
 for(const response of [new Response('busy',{status:503}),new Response('{"errcode":-1}'),new Response('{"errcode":40014}'),new Response('{"errcode":42001}')]){
  const verify=createApplicationMemberVerifier({accessTokenProvider:async()=> 'synthetic',fetchImpl:async()=>response});
  await assert.rejects(verify('open-A'),{name:'ApplicationMemberUnavailableError'});
 }
 const failed=createApplicationMemberVerifier({accessTokenProvider:async()=>{throw Error('SYNTHETIC_TOKEN_UNAVAILABLE');}});
 await assert.rejects(failed('open-A'),{name:'ApplicationMemberUnavailableError'});
});

test('MVP courtesy recognizes only a pure current thanks and never consumes a mixed fault or ordinary acknowledgement',()=>{
 for(const text of ['谢谢','@医小修 感谢！','谢谢你啦～','辛苦了','谢谢小修🙏'])assert.equal(isPureGroupThanks(text),true,text);
 for(const text of ['谢谢，打印机还是不行','感谢，但是电脑无法登录','收到','好的','好了','天气怎么样','@医小修 在吗'])assert.equal(isPureGroupThanks(text),false,text);
});

test('H5 display reads use the exact qualified open identity and only its primary department, with no entry lookup overhead',async()=>{
 const calls:string[]=[];const events:import('../src/wecom-application-member.mjs').ApplicationMemberVerificationEvent[]=[];
 const verify=createApplicationMemberVerifier({h5EntryReadEnabled:true,accessTokenProvider:async()=> 'synthetic-profile-token',observe:event=>events.push(event),fetchImpl:async(input,init)=>{
  const url=new URL(String(input));calls.push(url.pathname);assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');
  if(url.pathname==='/cgi-bin/user/get'){assert.equal(url.searchParams.get('userid'),'open-profile-A');return Response.json({errcode:0,userid:'open-profile-A',name:'合成成员',status:1,department:[7,9],main_department:9});}
  assert.equal(url.pathname,'/cgi-bin/department/get');assert.equal(url.searchParams.get('id'),'9');return Response.json({errcode:0,department:{id:9,name:'合成科室'}});
 }});
 await verify.h5EntryRead('open-profile-A');assert.deepEqual(calls,['/cgi-bin/user/get']);
 assert.ok(verify.profileRead);const value=await verify.profileRead('open-profile-A');assert.equal(value?.displayName,'合成成员');assert.equal(value?.departmentName,'合成科室');
 assert.deepEqual(calls,['/cgi-bin/user/get','/cgi-bin/user/get','/cgi-bin/department/get']);
 assert.deepEqual(events.filter(event=>event.phase==='STARTED').map(event=>event.purpose),['H5_ENTRY','BASE']);assert.ok(events.every(event=>event.base_active<=1&&event.active<=2));
 assert.equal(events.at(-1)?.pending,0);assert.equal(Object.getOwnPropertyDescriptor(verify,'profileRead')?.writable,false);
});

test('H5 display metadata cannot qualify a foreign/inactive member or fabricate department names',async()=>{
 let user:unknown={errcode:0,userid:'open-A',name:'合成成员',status:1,department:[4]},department:unknown={errcode:0,department:{id:4,name:'合成科室'}},departmentCalls=0;
 const verify=createApplicationMemberVerifier({accessTokenProvider:async()=> 'synthetic',fetchImpl:async input=>{
  if(new URL(String(input)).pathname==='/cgi-bin/user/get')return Response.json(user);departmentCalls++;return Response.json(department);
 }});assert.ok(verify.profileRead);
 assert.equal((await verify.profileRead('open-A'))?.departmentName,'合成科室');
 for(const invalid of [{errcode:0,department:{id:5,name:'WRONG_DEPARTMENT'}},{errcode:60011},{errcode:0,department:{id:4,name:'unsafe\nname'}}]){
  department=invalid;const result:VerifiedApplicationMember|null=await verify.profileRead('open-A');assert.equal(result?.departmentName,null);assert.equal(result?.displayName,'合成成员');
 }
 for(const invalid of [{errcode:60111},{errcode:0,userid:'open-B',status:1},{errcode:0,userid:'open-A',status:2}]){
  user=invalid;const before=departmentCalls;assert.equal(await verify.profileRead('open-A'),null);assert.equal(departmentCalls,before);
 }
 for(const ids of [undefined,[],[4,4],['4'],[-1],Array.from({length:21},(_,i)=>i+1)]){
  user={errcode:0,userid:'open-A',name:'合成成员',status:1,department:ids};const before=departmentCalls;assert.equal((await verify.profileRead('open-A'))?.departmentName,null);assert.equal(departmentCalls,before);
 }
});

test('H5 display cancellation retains its BASE slot until an uncooperative department fetch actually settles',async()=>{
 let release:(response:Response)=>void=()=>{throw Error('NO_DEPARTMENT_FETCH');},enteredResolve:()=>void=()=>{};
 const entered=new Promise<void>(resolve=>{enteredResolve=resolve;}),calls:string[]=[];let lastPending=0;
 const verify=createApplicationMemberVerifier({h5EntryReadEnabled:true,accessTokenProvider:async()=> 'synthetic',observe:event=>{lastPending=event.pending;},fetchImpl:async input=>{
  const url=new URL(String(input));calls.push(url.pathname);
  if(url.pathname==='/cgi-bin/user/get')return Response.json({errcode:0,userid:url.searchParams.get('userid'),status:1,department:[4]});
  enteredResolve();return new Promise<Response>(resolve=>{release=resolve;});
 }});assert.ok(verify.profileRead);const first=new AbortController(),second=new AbortController();
 const pending=verify.profileRead('open-A',first.signal);await entered;first.abort();await assert.rejects(pending,{name:'ApplicationMemberUnavailableError'});
 const blocked=verify('open-B',second.signal);assert.deepEqual(calls,['/cgi-bin/user/get','/cgi-bin/department/get']);second.abort();await assert.rejects(blocked,{name:'ApplicationMemberUnavailableError'});
 assert.equal(lastPending,1);release(Response.json({errcode:0,department:{id:4,name:'合成科室'}}));
 await delay(0);assert.equal(lastPending,0);assert.equal(calls.length,2);
});
