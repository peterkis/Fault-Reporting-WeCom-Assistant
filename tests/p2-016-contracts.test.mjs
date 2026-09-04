import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { snapshotP2016,publicP2016,flagsP2016,hashP2016,limitP2016,textHashP2016 } from '../src/p2-016-domain-contracts.mjs';
import { normalizeP2016TicketCommand } from '../src/p2-016-ticket-command-facade.mjs';
import { validateP2016CardModel,buildP2016TemplateCard,reporterCardLinkP2016 } from '../src/p2-016-template-card-builder.mjs';
import { ticketNotificationP2016 } from '../src/p2-016-ticket-notification-policy.mjs';
import { createP2016ReporterAccess } from '../src/p2-016-reporter-access.mjs';
import { createP2016WeComSender } from '../src/p2-016-wecom-sender.mjs';
import { createP2016InboundScope } from '../src/p2-016-inbound-scope.mjs';
const model=()=>({public_ref:'p'.repeat(32),suffix:'0012',status:'QUEUED',version:1,notification_type:'TICKET_CREATED',source:'GROUP',occurred_at:'2026-09-04 10:00:00'});
const command=()=>({ticket_id:randomUUID(),client_command_id:randomUUID(),action:'accept',expected_version:1,reason_code:'TEST'});
test('P2-016 plain JSON excludes active objects without invoking user hooks',()=>{
  let invoked=0;const accessor=Object.defineProperty({},'x',{enumerable:true,get(){invoked++;return 1;}});
  const proxy=new Proxy({},{ownKeys(){invoked++;return [];}}),cyclic={};cyclic.self=cyclic;
  for(const value of [accessor,proxy,cyclic,new Date(),new Map(),{toJSON:'forbidden'},{nested:{toJSON(){invoked++;}}},JSON.parse('{"__proto__":{}}'),{[Symbol('x')]:1}])assert.throws(()=>snapshotP2016(value),{code:'P2_016_INPUT_INVALID'});
  assert.equal(invoked,0);const source={rows:[{status:'QUEUED'}]},copy=publicP2016(source);source.rows[0].status='CLOSED';assert.equal(copy.rows[0].status,'QUEUED');
  assert.ok(Object.isFrozen(copy.rows[0]));assert.equal(hashP2016({b:2,a:1}),hashP2016({a:1,b:2}));
});
test('P2-016 strict command, versions, closed keys and bounded lists',()=>{
  assert.equal(normalizeP2016TicketCommand(command()).action,'accept');
  for(const patch of [{action:'auto-close'},{extra:1},{expected_version:'1'},{expected_version:0},{expected_version:2147483648},{note:'x'.repeat(2001)},{external_visible:'false'},{ticket_id:'0012'},{reason_code:'unsafe reason'},{session_id:randomUUID()}])assert.throws(()=>normalizeP2016TicketCommand({...command(),...patch}));
  for(const limit of ['01','1e2','0','201',0,101,-1,NaN])assert.throws(()=>limitP2016(limit));assert.equal(limitP2016('100'),100);
  assert.deepEqual(Object.values(flagsP2016()),[false,false,false]);for(const v of ['TRUE',1,null])assert.throws(()=>flagsP2016({REPORTER_TIMELINE_ENABLED:v}));
  assert.throws(()=>createP2016ReporterAccess({enabled:true}),{code:'P2_016_REPORTER_SECRET_REQUIRED'});
  assert.doesNotThrow(()=>createP2016ReporterAccess({enabled:false}));
});
const transitions=[['created','QUEUED'],['accepted','ACCEPTED'],['started','IN_PROGRESS'],['resumed','IN_PROGRESS'],['waiting_requester','WAITING_REQUESTER'],['waiting_vendor','WAITING_VENDOR'],['resolved','RESOLVED'],['closed','CLOSED'],['reopened','REOPENED'],['cancelled','CANCELLED']];
for(const [event,status] of transitions)test('notification policy includes '+event,()=>{const p=ticketNotificationP2016({event_type:'ticket.'+event,new_status:status});assert.ok(p.external_status);assert.ok(Object.isFrozen(p));});
test('notes and assignment changes never become external free-text notifications',()=>{for(const type of ['note_added','information_added','assignment_transferred'])assert.equal(ticketNotificationP2016({event_type:'ticket.'+type,new_status:'IN_PROGRESS'}),null);});
test('template card exact shape, last-four and safe immutable view',()=>{
  const card=buildP2016TemplateCard({model:model(),origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],token:'g'.repeat(64)});
  assert.deepEqual(Object.keys(card),['msgtype','template_card']);assert.equal(card.template_card.emphasis_content.title,'0012');
  assert.equal(card.template_card.card_type,'text_notice');assert.ok(Object.isFrozen(card.template_card.jump_list));
  for(const patch of [{public_ref:['p'.repeat(32)]},{suffix:12},{status:['QUEUED']},{occurred_at:'2026-09-04T10:00:00Z'},{occurred_at:'2026-09-04 10:00:00+08:00'},{patient_name:'secret'}])assert.throws(()=>validateP2016CardModel({...model(),...patch}));
});
for(const origin of ['javascript:alert(1)','data:text/html,x','file:///x','http://reporter.example.test','https://attacker.invalid','https://user:secret@reporter.example.test','https://reporter.example.test/?grant=abc','https://reporter.example.test/#x','https://reporter.example.test/path'])test('card rejects unsafe origin '+origin.replace('user:secret@','[userinfo]@'),()=>{
  assert.throws(()=>reporterCardLinkP2016({origin,allowedHosts:['reporter.example.test'],token:'x'.repeat(64)}),{code:'P2_016_CARD_URL_INVALID'});
});
function senderFixture({receipt={errcode:0},enabled=true,cardEnabled=true,target='synthetic-reporter',binding=true,gatewayReady=true}={}){
  let calls=0;
  const sender=createP2016WeComSender({enabled,cardEnabled,allowedTargetHashes:[textHashP2016('synthetic-reporter')],origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],
    gateway:{getAuthenticatedClient(){if(!gatewayReady)throw new Error('synthetic disconnect');return {sendMessage:async()=>{calls++;return receipt;}};}},
    reporterAccess:{deliveryGrant:async()=>({public_ref:model().public_ref,token:'g'.repeat(64),recipient_binding_hash:binding?textHashP2016(JSON.stringify(['WECOM_AIBOT','synthetic-bot','synthetic-reporter'])):'0'.repeat(64)})}});
  return {sender,get calls(){return calls;},request:{provider:'WECOM_AIBOT',channel_account_id:'synthetic-bot',target_type:'PERSON',target_id:target,delivery_id:randomUUID(),idempotency_key:randomUUID(),message:{message_type:'template_card',content:model()},signal:new AbortController().signal}};
}
for(const [receipt,outcome] of [[{errcode:0},'ACKNOWLEDGED'],[{body:{errcode:0}},'ACKNOWLEDGED'],[{},'UNKNOWN'],[{errcode:'0'},'UNKNOWN'],[{errcode:null},'UNKNOWN'],[{errcode:40001},'REJECTED_NOT_APPLIED']])test('sender accepts only explicit numeric ACK '+JSON.stringify(receipt),async()=>{const f=senderFixture({receipt});assert.equal((await f.sender.send(f.request)).outcome,outcome);assert.equal(f.calls,1);});
for(const options of [{enabled:false},{cardEnabled:false},{target:'not-allowlisted'},{binding:false}])test('sender fail-closed '+JSON.stringify(options),async()=>{const f=senderFixture(options);assert.equal((await f.sender.send(f.request)).outcome,'REJECTED_NOT_APPLIED');assert.equal(f.calls,0);});
test('gateway unavailable before network is retry-safe, no SDK call',async()=>{const f=senderFixture({gatewayReady:false});await assert.rejects(f.sender.send(f.request),{code:'GATEWAY_UNAVAILABLE_BEFORE_SEND'});assert.equal(f.calls,0);});
test('live inbound is clipped before persistence by approved bot, person and group hashes',()=>{
  const scope=createP2016InboundScope({bot_id:'approved-bot',person_hashes:[textHashP2016('approved-person')],group_hashes:[textHashP2016('approved-group')]});
  const message={provider:'WECOM_AIBOT',bot_id:'approved-bot',sender_user_id:'approved-person',chat_type:'group',chat_id:'approved-group'};
  assert.equal(scope.accepts(message),true);assert.equal(scope.accepts({...message,chat_type:'single',chat_id:null}),true);
  for(const patch of [{provider:'OTHER'},{bot_id:'other-bot'},{sender_user_id:'other-person'},{chat_id:'other-group'},{chat_type:'UNKNOWN'}])assert.equal(scope.accepts({...message,...patch}),false);
  assert.equal(scope.accepts(new Proxy({},{ownKeys(){throw new Error('trap');}})),false);
  assert.throws(()=>createP2016InboundScope({bot_id:'approved-bot',person_hashes:[],group_hashes:[]}),{code:'P2_016_LIVE_SCOPE_REQUIRED'});
});
