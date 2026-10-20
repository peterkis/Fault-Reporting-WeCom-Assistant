import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {entryConfig} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {validateYxxEntryConfig} from '../src/p2-g2-yixiaoxiu-contract.mjs';
import {createYxxDelegatedIdentityMapping} from '../src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {createApplicationMemberVerifier} from '../src/wecom-application-member.mjs';
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
 for(const value of [{errcode:60011},{errcode:0,userid:'open-B',status:1},{errcode:0,userid:'open-A',status:2},{errcode:0,userid:'open-A',status:1,enable:0},[]]){response=value;assert.equal(await verify('open-A'),null);}
 const before=calls;assert.equal(await verify('@all'),null);assert.equal(await verify('open-A|open-B'),null);assert.equal(calls,before);
});

test('MVP application qualification keeps a bounded serial fence when a provider ignores cancellation',{timeout:9000},async()=>{
 let release:((value:Response)=>void)|undefined,blocked=true,calls=0;
 const verify=createApplicationMemberVerifier({accessTokenProvider:async()=> 'synthetic',fetchImpl:async()=>{
  calls++;if(blocked)return new Promise<Response>(resolve=>{release=resolve;});return new Response('{"errcode":0,"userid":"open-A","status":1}');
 }});
 const pending=Array.from({length:32},()=>verify('open-A'));assert.equal(await verify('open-A'),null);
 const results=await Promise.all(pending);assert.ok(results.every(v=>v===null));assert.equal(calls,1);assert.ok(release);
 blocked=false;release(new Response('{"errcode":0,"userid":"open-A","status":1}'));await delay(0);
 assert.equal((await verify('open-A'))?.openUserId,'open-A');assert.equal(calls,2);
});

test('MVP courtesy recognizes only a pure current thanks and never consumes a mixed fault or ordinary acknowledgement',()=>{
 for(const text of ['谢谢','@医小修 感谢！','谢谢你啦～','辛苦了','谢谢小修🙏'])assert.equal(isPureGroupThanks(text),true,text);
 for(const text of ['谢谢，打印机还是不行','感谢，但是电脑无法登录','收到','好的','好了','天气怎么样','@医小修 在吗'])assert.equal(isPureGroupThanks(text),false,text);
});
