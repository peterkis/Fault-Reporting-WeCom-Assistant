import type {AliasDictionary} from './p2-007-alias-resolver.mjs';
import type {RuleEvaluationInput} from './p2-007-rule-engine.mjs';
import type {RouteContext,SafeRoute,SafeActionSuggestion} from './p2-015-decision-router.mjs';
import {createAliasResolver,DEFAULT_ALIAS_DICTIONARY_PATH} from './p2-007-alias-resolver.mjs';
import {normalizeHospitalText,readJsonConfig} from './p2-007-domain-utils.mjs';
import {createRuleEngine} from './p2-007-rule-engine.mjs';
import {routeP2007Decision} from './p2-015-decision-router.mjs';
import {freezePublic,safeHash} from './p2-015-domain-contracts.mjs';

export const MANUAL_REPORT_ALIAS_SET_ID='WBINT_T17_MANUAL_SYMPTOMS';
export const MANUAL_REPORT_ALIAS_SET_VERSION='1.0.0';
export const MANUAL_REPORT_DECISION_POLICY_VERSION='workbench-manual-safe-route/1.0.0';
export const MANUAL_REPORT_AFFIRMATION_GATE_VERSION='workbench-manual-print-affirmation/1.0.0';
interface ClassificationSource {
  alias_set_id:string;alias_set_version:string;alias_set_hash:string;
  base_alias_set_id:string;base_alias_set_version:string;base_alias_set_hash:string;
  new_alias_applied:boolean;affirmation_gate_version:string;
}
export interface ManualReportRoute extends SafeRoute {classification_source:ClassificationSource}

// This guard only decides whether the one new alias enters the real resolver.
// Quotation and a request for help do not negate an observed fault.
function affirmedPrintAlias(text:string):boolean{
  const normalized=normalizeHospitalText(text);
  for(const clause of normalized.split(/[，,。.!！？?；;\n]|但是|但|而是/u)){
    for(const match of clause.matchAll(/无法打印/gu)){
      const prefix=clause.slice(0,match.index),suffix=clause.slice(match.index+4);
      if(/(?:不是|并非|不再|并没有|没有|未出现|未发生)(?:\s|["'“‘]|打印机|当前|现在|出现|发生|存在|所谓|所述|这种)*$/u.test(prefix))continue;
      if(/(?:如果|假如|假设|假定|假若|一旦)(?:\s|["'“‘]|打印机|下次|以后|当前|现在|出现|发生|遇到)*$/u.test(prefix))continue;
      if(/(?:什么叫|什么是|解释|词义|含义)(?:\s|["'“‘]|打印机|的|是)*$/u.test(prefix)
        ||/^(?:\s|["'”’]|这个词|一词|这个说法|的)*(?:是什么意思|指什么|怎么理解|有何含义|词义|含义)/u.test(suffix))continue;
      return true;
    }
  }
  return false;
}

// The source adapter supplies an additive dictionary to the real P2-007 engine.
// BOT/WEB callers continue to use the original dictionary and rule set.
export function createManualReportRulePolicy(){
  const input=readJsonConfig(DEFAULT_ALIAS_DICTIONARY_PATH);
  const baseResolver=createAliasResolver({dictionary:input});
  // The public resolver above validates the dictionary, including every entry.
  const base=input as AliasDictionary;
  const dictionary:AliasDictionary={...base,alias_set_id:MANUAL_REPORT_ALIAS_SET_ID,alias_set_version:MANUAL_REPORT_ALIAS_SET_VERSION,
    symptom_aliases:[...base.symptom_aliases,{alias:'无法打印',symptom_code:'PRINT.NO_OUTPUT',assertion:'AFFIRMED'}]};
  const resolver=createAliasResolver({dictionary});
  const source=freezePublic({alias_set_id:resolver.alias_set_id,alias_set_version:resolver.alias_set_version,alias_set_hash:resolver.alias_set_hash,
    base_alias_set_id:baseResolver.alias_set_id,base_alias_set_version:baseResolver.alias_set_version,base_alias_set_hash:baseResolver.alias_set_hash});
  return Object.freeze({source,
    route(input:RuleEvaluationInput,context:RouteContext):ManualReportRoute{
      const applied=affirmedPrintAlias(input.text),activeResolver=applied?resolver:baseResolver;
      const engine=createRuleEngine({aliasDictionary:applied?dictionary:base});
      const original=routeP2007Decision({rule_output:engine.evaluate(input),context});
      const {result_hash:_previousHash,...result}=original;
      const suggestions=[...original.safe_action_suggestions];
      if(original.result_code==='NEEDS_DESCRIPTION'){
        const payload={service_intake_id:context.service_intake_id,journey_ref:context.journey_ref,clarification_code:null,template_code:null};
        const review:SafeActionSuggestion={action_ordinal:suggestions.length+1,action_type:'ENQUEUE_MANUAL_REVIEW',
          execution_policy:'AUTO_SAFE_DB_ONLY',safe_payload:payload,payload_hash:safeHash(payload)};
        suggestions.push(review);
      }
      const classificationSource={...source,alias_set_id:activeResolver.alias_set_id,alias_set_version:activeResolver.alias_set_version,
        alias_set_hash:activeResolver.alias_set_hash,new_alias_applied:applied,affirmation_gate_version:MANUAL_REPORT_AFFIRMATION_GATE_VERSION};
      const safeResult={...result,engine_version:'workbench-manual-rule-adapter/1.0.0',decision_policy_version:MANUAL_REPORT_DECISION_POLICY_VERSION,
        classification_source:classificationSource,manual_review_required:original.manual_review_required||original.result_code==='NEEDS_DESCRIPTION',safe_action_suggestions:suggestions};
      return freezePublic({...safeResult,result_hash:safeHash(safeResult)});
    },
  });
}
