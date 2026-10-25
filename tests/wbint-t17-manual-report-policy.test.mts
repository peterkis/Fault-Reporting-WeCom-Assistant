import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAliasResolver} from '../app/server/src/p2-007-alias-resolver.mjs';
import {createRuleEngine} from '../app/server/src/p2-007-rule-engine.mjs';
import {routeP2007Decision} from '../app/server/src/p2-015-decision-router.mjs';
import {safeHash,safeTextHash} from '../app/server/src/p2-015-domain-contracts.mjs';
import {createManualReportRulePolicy,MANUAL_REPORT_ALIAS_SET_VERSION} from '../app/server/src/workbench-manual-report-policy.mjs';

const input={text:'合成电话报修：打印机无法打印',source_ref:'manual:00000000-0000-4000-8000-000000000017',source_kind:'USER_TEXT',observed_at:'2026-10-09 08:00:00',occurrence_location:null};
const context={service_intake_id:'00000000-0000-4000-8000-000000000017',journey_ref:'00000000-0000-4000-8000-000000000018',
  safe_normalized_text:input.text,input_hash:safeHash({description:input.text,location:null}),source_refs:[input.source_ref],message_sequence_window:{start:1,end:1,count:1},delivery_mode:'APP_ONLY'};

test('manual alias policy delegates real symptom facts with original source while leaving default profiles unchanged',()=>{
  const base=createAliasResolver(),policy=createManualReportRulePolicy(),result=policy.route(input,context);
  assert.equal(result.result_code,'TICKET_ELIGIBLE');assert.equal(result.ticket_creation_recommended,true);
  assert.deepEqual(result.known_fields.symptom_codes,['PRINT.NO_OUTPUT']);
  const fact=result.fact_provenance.find(f=>f.field_path==='fault.symptom_codes'&&f.normalized_value==='PRINT.NO_OUTPUT');
  assert.ok(fact);assert.equal(fact.source_ref,input.source_ref);assert.equal(fact.assertion,'AFFIRMED');assert.equal(fact.source_kind,'REPORTER_EXPLICIT');
  assert.equal(fact.source_hash,safeTextHash(input.text));
  assert.equal(result.input_hash,context.input_hash);assert.deepEqual(result.source_refs,[input.source_ref]);
  assert.equal(result.classification_source.alias_set_version,MANUAL_REPORT_ALIAS_SET_VERSION);
  assert.equal(result.classification_source.new_alias_applied,true);
  assert.equal(result.classification_source.base_alias_set_id,base.alias_set_id);assert.equal(result.classification_source.base_alias_set_hash,base.alias_set_hash);
  assert.deepEqual(result.safe_action_suggestions.map(a=>a.action_type),['APPLY_INTAKE_CLASSIFICATION','CREATE_MINIMAL_TICKET']);
  for(const source_kind of ['USER_TEXT','WEB']){
    const unmodified=routeP2007Decision({rule_output:createRuleEngine().evaluate({...input,source_kind}),context});
    assert.equal(unmodified.result_code,'NEEDS_DESCRIPTION');assert.equal(unmodified.ticket_creation_recommended,false);
  }
  for(const text of ['电话转述“打印机无法打印”','打印机无法打印怎么办']){
    const admitted=policy.route({...input,text},{...context,safe_normalized_text:text,input_hash:safeHash({description:text,location:null})});
    assert.equal(admitted.result_code,'TICKET_ELIGIBLE');assert.equal(admitted.classification_source.new_alias_applied,true);
  }
});

test('unresolved manual description retains NEEDS_DESCRIPTION and queues the existing Review without communication',()=>{
  const text='合成电话报修：打印机情况不明',result=createManualReportRulePolicy().route({...input,text},{...context,safe_normalized_text:text,input_hash:safeHash({description:text,location:null})});
  assert.equal(result.result_code,'NEEDS_DESCRIPTION');assert.equal(result.reason_code,'ONE_DESCRIPTION_REQUIRED');
  assert.equal(result.ticket_creation_recommended,false);assert.equal(result.manual_review_required,true);
  assert.deepEqual(result.safe_action_suggestions.map(a=>a.action_type),['APPLY_INTAKE_CLASSIFICATION','ENQUEUE_MANUAL_REVIEW']);
  for(const [index,action] of result.safe_action_suggestions.entries()){
    assert.equal(action.action_ordinal,index+1);assert.equal(action.payload_hash,safeHash(action.safe_payload));
  }
  const {result_hash,...safeResult}=result;assert.equal(result_hash,safeHash(safeResult));
});

test('the one new manual symptom alias does not turn explicit denial or a pure hypothetical or definition into a fault',()=>{
  const policy=createManualReportRulePolicy(),base=createAliasResolver();
  for(const text of ['打印机不是无法打印','并没有无法打印的问题','如果打印机无法打印怎么办','无法打印是什么意思']){
    const result=policy.route({...input,text},{...context,safe_normalized_text:text,input_hash:safeHash({description:text,location:null})});
    assert.equal(result.ticket_creation_recommended,false,text);assert.equal(result.classification_source.new_alias_applied,false,text);
    assert.equal(result.classification_source.alias_set_hash,base.alias_set_hash,text);
    assert.equal(result.safe_action_suggestions.some(a=>a.action_type==='CREATE_MINIMAL_TICKET'||a.action_type==='REQUEST_ONE_DESCRIPTION'),false,text);
  }
});
