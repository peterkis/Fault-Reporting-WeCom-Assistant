import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {parseH5RequestInput,parseH5UrgeInput,parseH5EvaluationInput,parseH5PublicProgressInput,parseH5ReportFilters,H5_LIMITS} from '../app/server/src/yxx-h5-v2-contracts.mjs';
import {parseYxxRequestInput,parseYxxInitialRequestInput} from '../app/server/src/yxx-self-service-store.mjs';
import {routeH5DeclaredRequest} from '../app/server/src/yxx-self-service-orchestrator.mjs';
import {routeP2007Decision} from '../app/server/src/p2-015-decision-router.mjs';
import {createYxxMemberCommandContext} from '../app/server/src/yxx-self-service-command.mjs';

const input=()=>({schema_version:2,client_command_id:randomUUID(),intent:'FAULT',description:null,location:{text:null,unknown:true},media_refs:[randomUUID()]});
const rejects=(run:()=>unknown)=>assert.throws(run,{code:'YXX_INPUT_INVALID'});

test('H5 V2 accepts independent voice/image/video references and contact without content',()=>{
  const media=input();assert.deepEqual(parseH5RequestInput(media),media);
  const contact={...input(),intent:'CONTACT_REQUEST',media_refs:[]};assert.equal(parseH5RequestInput(contact).description,null);
  assert.equal(parseH5RequestInput({...input(),description:'  测试故障  ',media_refs:[]}).description,'测试故障');
  rejects(()=>parseH5RequestInput({...input(),media_refs:[]}));
  rejects(()=>parseH5RequestInput({...input(),description:'  ',media_refs:[]}));
});

test('H5 V2 rejects identity injection, missing and nested additional keys',()=>{
  for(const key of ['notify_recipient_id','canonical_reporter_binding','source_app_scope','write_flag','service_code'])rejects(()=>parseH5RequestInput({...input(),[key]:'forged'}));
  const partial:Record<string,unknown>=input();delete partial.description;rejects(()=>parseH5RequestInput(partial));
  rejects(()=>parseH5RequestInput({...input(),location:{text:null,unknown:true,department_id:'forged'}}));
  rejects(()=>parseH5RequestInput({...input(),location:{text:null,unknown:false}}));
  rejects(()=>parseH5RequestInput({...input(),intent:'INTERNAL_NOTE'}));
});

test('H5 V2 enforces canonical unique media references and Unicode limits',()=>{
  const id=randomUUID();rejects(()=>parseH5RequestInput({...input(),media_refs:[id,id.toUpperCase()]}));
  rejects(()=>parseH5RequestInput({...input(),media_refs:Array.from({length:9},()=>randomUUID())}));
  rejects(()=>parseH5RequestInput({...input(),media_refs:['../../secret']}));
  assert.equal(parseH5RequestInput({...input(),description:'修'.repeat(4000)}).description?.length,4000);
  rejects(()=>parseH5RequestInput({...input(),description:'修'.repeat(4001)}));
  assert.equal(H5_LIMITS.total_bytes,40*1024*1024);assert.equal(H5_LIMITS.voice_count,1);
});

test('H5 V2 dispatch preserves V1 closed input and raw V2 intent',()=>{
  const v1={schema_version:1,client_command_id:randomUUID(),description:'合成故障',location:{text:null,unknown:true},service_code:null,impact_scope:'UNKNOWN',reported_department_text:null,extension:null};
  assert.deepEqual(parseYxxInitialRequestInput(v1),parseYxxRequestInput(v1));
  const v2=input();assert.deepEqual(parseYxxInitialRequestInput(v2),v2);assert.throws(()=>parseYxxRequestInput(v2));
  assert.throws(()=>parseYxxInitialRequestInput({...v2,schema_version:3}));
});

test('H5 declared form intention directly recommends the existing minimal Core action',()=>{
  for(const intent of ['FAULT','CONTACT_REQUEST'] as const){
    const route=routeH5DeclaredRequest({service_intake_id:randomUUID(),journey_ref:randomUUID(),delivery_mode:'APP_ONLY',safe_normalized_text:'谢谢',source_refs:['web:synthetic'],message_sequence_window:{start:1,end:1,count:1},input_hash:'a'.repeat(64)},intent);
    assert.equal(route.result_code,'TICKET_ELIGIBLE');assert.equal(route.ticket_creation_recommended,true);
    assert.deepEqual(route.safe_action_suggestions.map(a=>a.action_type),['APPLY_INTAKE_CLASSIFICATION','CREATE_MINIMAL_TICKET']);
    assert.equal(route.manual_review_required,false);
  }
  const v1=routeP2007Decision({rule_output:{catalog_version:'c',rule_set_version:'r',result_hash:'a'.repeat(64),domain_intent:'ACKNOWLEDGEMENT_OR_CHATTER'},context:{delivery_mode:'APP_ONLY',safe_normalized_text:'谢谢',message_sequence_window:{start:1,end:1,count:1}}});
  assert.equal(v1.result_code,'ACKNOWLEDGEMENT');assert.equal(v1.ticket_creation_recommended,false);
});

test('H5 lifecycle inputs bind current Ticket version and a real completion reference',()=>{
  const base={schema_version:1,client_command_id:randomUUID(),expected_ticket_version:3};assert.deepEqual(parseH5UrgeInput(base),base);
  rejects(()=>parseH5UrgeInput({...base,expected_ticket_version:'3'}));rejects(()=>parseH5UrgeInput({...base,expected_ticket_version:0}));
  const evaluation={...base,completed_round_ref:'A'.repeat(32),rating:5,comment:null};assert.deepEqual(parseH5EvaluationInput(evaluation),evaluation);
  for(const rating of [0,6,1.5,'5'])rejects(()=>parseH5EvaluationInput({...evaluation,rating}));
  rejects(()=>parseH5EvaluationInput({...evaluation,comment:'测'.repeat(201)}));
  rejects(()=>parseH5EvaluationInput({...evaluation,completed_round_ref:randomUUID()}));
});

test('H5 progress requires bounded explicit public text and valid Shanghai time',()=>{
  const p={client_command_id:randomUUID(),expected_version:4,summary:'正在处理合成网络故障',estimated_at:'2026-10-20 15:30:00'};
  assert.deepEqual(parseH5PublicProgressInput(p),p);assert.equal(parseH5PublicProgressInput({...p,estimated_at:null}).estimated_at,null);
  rejects(()=>parseH5PublicProgressInput({...p,summary:' '}));rejects(()=>parseH5PublicProgressInput({...p,estimated_at:'2026-02-30 15:30:00'}));
  rejects(()=>parseH5PublicProgressInput({...p,internal_note:'must not publish'}));
  assert.deepEqual(parseH5ReportFilters({search:'  printer  ',status:'ACTIVE'}),{search:'printer',status:'ACTIVE'});
});

test('member command authentication preserves unavailable qualification and never invokes a store',async()=>{
  const server=createServer();const request=new (await import('node:http')).IncomingMessage(new (await import('node:net')).Socket());
  let touched=false;const unavailable=Object.assign(new Error('YXX_ENTRY_UNAVAILABLE'),{code:'YXX_ENTRY_UNAVAILABLE',status:503});
  const command=createYxxMemberCommandContext({profile:'MEMBER_SELF_SERVICE',flags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true},
    store:{accept:async()=>{touched=true;throw Error('UNREACHABLE');},acceptInTransaction:async()=>{throw Error('UNREACHABLE');},command:async()=>{throw Error('UNREACHABLE');}},
    authenticate:async()=>{throw unavailable;},recheck:Object.assign(async()=>({}),{localOnly:true as const}),quota:Object.assign(async()=>true,{localOnly:true as const})});
  await assert.rejects(command.accept({request,input:input()}),error=>error===unavailable);assert.equal(touched,false);request.destroy();server.close();
});
