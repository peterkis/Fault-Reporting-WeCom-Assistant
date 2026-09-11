import test from 'node:test';
import assert from 'node:assert/strict';
import {validateYxxEntryConfig,reporterAccessPolicy} from '../src/p2-g2-yixiaoxiu-contract.mjs';
import {buildP2016TemplateCard} from '../src/p2-016-template-card-builder.mjs';
import {createP2016ReporterHttp} from '../src/p2-016-reporter-http.mjs';
import {createYxxMemberAuthorizer} from '../src/p2-g2-yixiaoxiu-authorizer.mjs';
import {createWeComWebOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import {entryConfig,entryOrigin} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {createP2016WeComSender} from '../src/p2-016-wecom-sender.mjs';
import {textHashP2016} from '../src/p2-016-domain-contracts.mjs';
import {randomUUID} from 'node:crypto';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
import {computeCommunicationContentHash} from '../src/p2-004-communication-core.mjs';

test('YXX-07 YXX-33 member policy and identity proof fail closed without coercion or legacy fallback',()=>{
  assert.equal(reporterAccessPolicy('MEMBER_REQUIRED'),'MEMBER_REQUIRED');
  assert.throws(()=>reporterAccessPolicy('member_required'),{code:'YXX_ENTRY_CONFIG_INVALID'});
  assert.equal(validateYxxEntryConfig({}).enabled,false);
  assert.throws(()=>validateYxxEntryConfig({enabled:'true'}),{code:'YXX_ENTRY_CONFIG_INVALID'});
  assert.throws(()=>validateYxxEntryConfig({enabled:true,identityMode:'VERIFIED_SAME_NAMESPACE',memberIdsConfirmed:true}),{code:'YXX_ENTRY_CONFIG_INVALID'});
});
test('YXX-01 member Sender validates persisted delivery binding without reading a Grant before its mock SDK call',async()=>{
  const model={public_ref:'A'.repeat(32),suffix:'1234',status:'QUEUED',occurred_at:'2026-09-11 12:00:00',version:1,notification_type:'TICKET_ACCEPTED',source:'DIRECT'};
  let sends=0,grantReads=0,binding=true,body;
  const sender=createP2016WeComSender({enabled:true,cardEnabled:true,linkMode:'MEMBER_REQUIRED',origin:entryOrigin,allowedHosts:['entry.test'],allowedTargetHashes:[textHashP2016('synthetic-A')],
    reporterAccess:{deliveryGrant:async()=>{grantReads++;throw Error('UNEXPECTED_GRANT_READ');},deliveryBinding:async()=>({
      provider:'WECOM_AIBOT',channel_account_id:'bot-test',target_id:'synthetic-A',idempotency_key:request.idempotency_key,
      content_hash:computeCommunicationContentHash(model),public_ref:model.public_ref,
      recipient_binding_hash:binding?textHashP2016(JSON.stringify(['WECOM_AIBOT','bot-test','synthetic-A'])):'0'.repeat(64)})},
    gateway:{getAuthenticatedClient:()=>({sendMessage:async(_target,sent)=>{sends++;body=sent;return {errcode:0};}})}});
  const request={provider:'WECOM_AIBOT',channel_account_id:'bot-test',target_type:'PERSON',target_id:'synthetic-A',delivery_id:randomUUID(),idempotency_key:randomUUID(),message:{message_type:'template_card',content:model},signal:new AbortController().signal};
  assert.equal((await sender.send(request)).outcome,'ACKNOWLEDGED');assert.equal(grantReads,0);assert.equal(sends,1);
  assert.equal(body.template_card.card_action.url,entryOrigin+'/wecom/yixiaoxiu/tickets/'+model.public_ref);
  binding=false;assert.equal((await sender.send(request)).outcome,'REJECTED_NOT_APPLIED');assert.equal(sends,1);assert.equal(grantReads,0);
  binding=true;
  const malformed=await sender.send({...request,message:{...request.message,content:{...model,unexpected:Array(33).fill('x')}}});
  assert.equal(malformed.outcome,'REJECTED_NOT_APPLIED');assert.equal(malformed.retryable,false);assert.equal(sends,1);
});
test('YXX-35 closed member schemas expose authentication mode without raw identity or nullable Ticket guessing',async()=>{
  await assertP2016Schema('yixiaoxiu_member_session',{identity_mode:'MEMBER_REQUIRED',authenticated:true,read_only:true});
  await assertP2016Schema('yixiaoxiu_legacy_prepared',{entry_path:'/wecom/yixiaoxiu/continue/'+'a'.repeat(64)});
  await assertP2016Schema('yixiaoxiu_member_entry_config',entryConfig);
  await assertP2016Schema('yixiaoxiu_error',{error:{code:'YXX_ENTRY_NOT_FOUND',retryable:false}});
});
test('YXX-06 YXX-07 YXX-33 unverified scope or disabled OAuth cannot construct a permissive member endpoint',()=>{
  assert.throws(()=>createP2016ReporterHttp({accessPolicy:'MEMBER_REQUIRED',enabled:true}),{code:'YXX_ENTRY_CONFIG_INVALID'});
  assert.throws(()=>createP2016ReporterHttp({accessPolicy:'MEMBER_REQUIRED',enabled:false,memberHandler:()=>{}}),{code:'YXX_ENTRY_CONFIG_INVALID'});
  const oauth=createWeComWebOAuth({enabled:true,publicOrigin:entryOrigin,corpId:'other-corp',agentId:entryConfig.agentId,resolveCode:async()=>({userid:'synthetic-A'})});
  assert.throws(()=>createYxxMemberAuthorizer({pool:{},oauth,config:entryConfig}),{code:'YXX_ENTRY_CONFIG_INVALID'});oauth.close();
  assert.throws(()=>createYxxMemberAuthorizer({pool:{},oauth:createWeComWebOAuth(),config:entryConfig}),{code:'YXX_ENTRY_CONFIG_INVALID'});
  assert.throws(()=>validateYxxEntryConfig({...entryConfig,validationProfile:'DEPLOYMENT'}),{code:'YXX_ENTRY_CONFIG_INVALID'});
});
test('YXX-35 configuration refuses Proxy, accessors, toJSON, cycles and loose identity coercions',()=>{
  let gets=0;const cycle={};cycle.self=cycle;
  for(const value of [new Proxy({},{get(){gets++;return true;}}),{get enabled(){gets++;return true;}},{toJSON(){gets++;return {};}},cycle,
    {...entryConfig,memberIdsConfirmed:'true'},{...entryConfig,proofRef:''},{...entryConfig,identityMode:'SAME_NAME'}]){
    assert.throws(()=>validateYxxEntryConfig(value),{code:'YXX_ENTRY_CONFIG_INVALID'});
  }assert.equal(gets,0);
});
test('YXX-01 both member card click regions use one canonical ref without a grant or identity',()=>{
  const card=buildP2016TemplateCard({model:{public_ref:'A'.repeat(32),suffix:'1234',status:'NEW',occurred_at:'2026-09-11 12:00:00',version:1,notification_type:'TICKET_CREATED',source:'DIRECT'},
    origin:'https://entry.test',allowedHosts:['entry.test'],token:'B'.repeat(64),linkMode:'MEMBER_REQUIRED'}).template_card;
  assert.equal(card.card_action.url,'https://entry.test/wecom/yixiaoxiu/tickets/'+'A'.repeat(32));
  assert.equal(card.jump_list[0].url,card.card_action.url);
  assert.doesNotMatch(JSON.stringify(card),/grant=|userid|code=|state=|access_token/u);
});
