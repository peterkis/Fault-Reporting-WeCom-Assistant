import test from 'node:test';
import assert from 'node:assert/strict';
import {createYxxDelegatedIdentityMapping,yxxIdentityConfigHash} from '../src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {entryConfig} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {validateYxxEntryConfig} from '../src/p2-g2-yixiaoxiu-contract.mjs';
import {createYxxMemberAuthorizer} from '../src/p2-g2-yixiaoxiu-authorizer.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
import {main as serve} from '../scripts/p2-g2-yixiaoxiu-serve.mjs';
import {mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {readYxxG2AppConfiguration} from '../src/p2-g2-yixiaoxiu-g2-config.mjs';

const config={...entryConfig,identityMode:'VERIFIED_DELEGATED_MAPPING',reporterUserIds:['synthetic-A','synthetic-B']};
const success={errcode:0,open_userid_list:[{userid:'synthetic-a',open_userid:'encrypted-A'},{userid:'synthetic-B',open_userid:'encrypted-B'}],invalid_userid_list:[]};
test('delegated member conversion binds exact original Bot identities without normalizing encrypted IDs',async()=>{
 let calls=0;
 const mapping=await createYxxDelegatedIdentityMapping({config,accessTokenProvider:async()=> 'synthetic-token',fetchImpl:async(url,options)=>{
  calls++;assert.equal(url.origin,'https://qyapi.weixin.qq.com');assert.equal(url.pathname,'/cgi-bin/batch/userid_to_openuserid');
  assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),{userid_list:['synthetic-A','synthetic-B']});
  return new Response(JSON.stringify(success));
 }});
 assert.equal(calls,1);assert.equal(mapping.resolve('encrypted-A'),'synthetic-A');assert.equal(mapping.resolve('encrypted-B'),'synthetic-B');
 assert.equal(mapping.resolve('encrypted-a'),null);assert.equal(mapping.resolve('synthetic-A'),null);assert.equal(mapping.resolve('unknown'),null);
});
test('delegated configuration and public schema bound the approved roster and forbid invented proof',async()=>{
 await assertP2016Schema('yixiaoxiu_member_entry_config',config);
 for(const reporterUserIds of [[],Array.from({length:33},(_,i)=>'u'+i),['A','a'],['bad id'],['x'.repeat(65)]]){
  assert.throws(()=>validateYxxEntryConfig({...config,reporterUserIds}),{code:'YXX_ENTRY_CONFIG_INVALID'});
 }
 for(const patch of [{memberIdsConfirmed:false},{proofKind:null},{validationProfile:'DEPLOYMENT'},{proofRef:''}])assert.throws(()=>validateYxxEntryConfig({...config,...patch}));
 assert.throws(()=>validateYxxEntryConfig({...entryConfig,reporterUserIds:['A']}));
});
test('delegated conversion permits omitted empty invalid list only with a complete one-to-one response',async()=>{
 const {invalid_userid_list,...complete}=success;
 const build=body=>createYxxDelegatedIdentityMapping({config,accessTokenProvider:async()=> 'token',fetchImpl:async()=>new Response(JSON.stringify(body))});
 assert.equal((await build(complete)).resolve('encrypted-A'),'synthetic-A');
 for(const body of [{...complete,open_userid_list:complete.open_userid_list.slice(0,1)},... [null,false,{},['synthetic-B']].map(invalid=>({...complete,invalid_userid_list:invalid}))]){
  await assert.rejects(build(body),{code:'YXX_ENTRY_UNAVAILABLE'});
 }
});
test('delegated conversion rejects partial, duplicate, foreign and malformed mappings without identity or token leaks',async()=>{
 const rows=success.open_userid_list;
 for(const body of [
  {...success,invalid_userid_list:['synthetic-B']}, {...success,open_userid_list:[rows[0]]},
  {...success,open_userid_list:[rows[0],rows[0]]},
  {...success,open_userid_list:[rows[0],{...rows[1],open_userid:'encrypted-A'}]},
  {...success,open_userid_list:[rows[0],{...rows[1],userid:'outsider'}]},
  {...success,open_userid_list:[rows[0],{...rows[1],open_userid:'bad id'}]}, {errcode:60020,errmsg:'SECRET_DATA'},
 ]){
  await assert.rejects(createYxxDelegatedIdentityMapping({config,accessTokenProvider:async()=> 'SECRET_TOKEN',fetchImpl:async()=>new Response(JSON.stringify(body))}),e=>e.code==='YXX_ENTRY_UNAVAILABLE'&&!/SECRET|synthetic/.test(e.message));
 }
 await assert.rejects(createYxxDelegatedIdentityMapping({config,accessTokenProvider:async()=> 'token',fetchImpl:async()=>new Response('x'.repeat(65537))}),{code:'YXX_ENTRY_UNAVAILABLE'});
 let cancelled=false;
 await assert.rejects(createYxxDelegatedIdentityMapping({config,accessTokenProvider:async()=> 'token',fetchImpl:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:503})}),{code:'YXX_ENTRY_UNAVAILABLE'});
 assert.equal(cancelled,true);
});
test('delegated map cannot be reused under another scope or authorize an unlisted OAuth identity',async()=>{
 const mapping=await createYxxDelegatedIdentityMapping({config,accessTokenProvider:async()=> 'token',fetchImpl:async()=>new Response(JSON.stringify(success))});
 const oauth={enabled:true,scope:{corpId:config.corpId,agentId:config.agentId},authenticate:()=>({corpId:config.corpId,userid:'encrypted-A'})};
 assert.throws(()=>createYxxMemberAuthorizer({pool:{},oauth,config}),{code:'YXX_ENTRY_IDENTITY_NAMESPACE_UNVERIFIED'});
 assert.throws(()=>createYxxMemberAuthorizer({pool:{},oauth,config:{...config,botId:'other'},identityMapping:mapping}),{code:'YXX_ENTRY_IDENTITY_NAMESPACE_UNVERIFIED'});
 const authorizer=createYxxMemberAuthorizer({pool:{},oauth,config,identityMapping:mapping});
 assert.equal(authorizer.authenticate('session').userid,'synthetic-A');
 oauth.authenticate=()=>({corpId:config.corpId,userid:'unlisted'});assert.throws(()=>authorizer.authenticate('session'),{code:'YXX_ENTRY_MEMBER_REQUIRED'});
 authorizer.close();assert.throws(()=>authorizer.authenticate('session'),{code:'YXX_ENTRY_UNAVAILABLE'});
});
test('delegated conversion rejects a non-cooperative Provider within its startup deadline',async()=>{
 let signal;const started=Date.now();
 await assert.rejects(createYxxDelegatedIdentityMapping({config,accessTokenProvider:async()=> 'token',fetchImpl:async(_url,options)=>{signal=options.signal;return new Promise(()=>{});}}),{code:'YXX_ENTRY_UNAVAILABLE'});
 assert.equal(signal.aborted,true);assert.ok(Date.now()-started<7000);
});
test('readonly check stays offline and conversion failure prevents startup; full mapped mode requires exact config proof',async()=>{
 const directory=mkdtempSync('tmp/yxx-mapping-check-'),file=directory+'/config.json';
 const deployment={...config,proofKind:'LIVE',proofRef:'synthetic-unit-proof-not-live-evidence',validationProfile:'DEPLOYMENT'};
 writeFileSync(file,JSON.stringify({reporterMemberEntry:deployment}));
 const env={YIXIAOXIU_RUNTIME_PROFILE:'MEMBER_TICKET_READONLY',WECOM_WEB_OAUTH_ORIGIN:'https://entry.test',WECOM_WEB_OAUTH_ENABLED:'true',
  YIXIAOXIU_MEMBER_TICKET_ENTRY_ENABLED:'true',YIXIAOXIU_MEMBER_TICKET_ENTRY_CONFIG:file,CORP_ID:deployment.corpId,APP_ID:deployment.agentId,APP_SECRET:'synthetic-secret',
  PILOT_DATABASE_URL:'postgres://synthetic:synthetic@127.0.0.1:1/synthetic_not_connected',P2_G2_REPORTER_HMAC_SECRET:'synthetic-only-reporter-key-at-least-32-bytes'};
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async url=>{calls++;return new Response(JSON.stringify(url.pathname.endsWith('/gettoken')?{errcode:0,access_token:'synthetic-token',expires_in:7200}:{errcode:0,open_userid_list:[],invalid_userid_list:['synthetic-A']}));};
 try{
  await serve(['--check'],env);assert.equal(calls,0);
  await assert.rejects(serve(['--serve'],env),{code:'YXX_ENTRY_UNAVAILABLE'});assert.equal(calls,2);
  const fullEnv={...env,WECOM_BOT_ID:deployment.botId,YIXIAOXIU_MEMBER_TICKET_ENTRY_CONFIG_JSON:JSON.stringify(deployment)};
  assert.throws(()=>readYxxG2AppConfiguration({manifest:{scope:{reporter_access_policy:'MEMBER_REQUIRED'}},env:fullEnv}),{code:'YXX_ENTRY_CONFIG_INVALID'});
  assert.deepEqual(readYxxG2AppConfiguration({manifest:{mode:'live',scope:{reporter_access_policy:'MEMBER_REQUIRED',member_entry_config_sha256:yxxIdentityConfigHash(deployment)}},env:fullEnv}),validateYxxEntryConfig(deployment));
 }finally{globalThis.fetch=original;unlinkSync(file);rmdirSync(directory);}
});
