import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {g2CandidateInventory,G2_ROOT} from './p2-g2-candidate.mjs';
import {evidenceHash} from './yxx-self-service-verification.mjs';
import {validateLimitedManifest} from './yxx-limited-write-contract.mjs';
import {readCurrentYxxScope} from './yxx-current-readiness-scope.mjs';
import {verifyCurrentYxxEvidenceHistory} from './yxx-current-evidence-history.mjs';
import {readCurrentYxxReport,verifyCurrentYxxReportBinding,verifyCurrentYxxExecution,verifyCurrentYxxReviews,verifyCurrentYxxCleanup,verifyCurrentYxxHistoricalProof,verifyCurrentYxxSpecializedProof,verifyCurrentYxxSourceAccounting,verifyCurrentYxxScenarios} from './yxx-current-evidence.mjs';

export const SS010_REPORT='evidence/yxx-ss-010-report.json';
export const SS010_TEMPLATE='config_examples/yxx-limited-write-authorization.example.json';
export const SS010_ACCEPTANCE=Object.freeze([
  {id:'YXX-AC-091',tests:['SS010 AC091 artifact references reject path traversal missing and corrupted execution data']},
  {id:'YXX-AC-092',tests:['SS010 AC092 offline defaults and unapproved template never start runtime capabilities','SS010 AC092 limited App Worker HTTP lifecycle rejects cross-member access and preserves restart budgets',
    'SS010 AC092 owner approval cannot be reused for changed window actors database or quotas','SS010 AC092 concurrent global and supplement limits count committed commands and never charge replays',
    'SS010 AC092 preflight rejects occupied port drift and resumed foreign scope without processing pending']},
  {id:'YXX-AC-093',tests:['SS010 AC093 real browser limited roles complete supplement review and safe member feedback','SS010 AC093 commit-time revocation rolls back facts and new runs cannot reset persisted scope']},
  {id:'YXX-AC-094',tests:['SS010 AC094 unknown duplicate and run arguments fail without implicit authorization']},
]);
const lf=value=>value.replaceAll('\r\n','\n');
export function readSS010Artifact(root,ref){
  assert.match(ref?.path??'',/^evidence\/yxx-ss-010-[a-zA-Z0-9_.-]+$/u);
  assert.equal(lstatSync(path.join(root,'evidence')).isSymbolicLink(),false);
  const target=path.join(root,ref.path),stat=lstatSync(target);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=64*1024*1024);
  const content=lf(readFileSync(target,'utf8'));assert.equal(evidenceHash(content),ref.sha256);return content;
}
const defaultSourceRoot=path.basename(path.resolve(G2_ROOT))==='runtime'
  &&path.basename(path.dirname(path.resolve(G2_ROOT)))==='.build'
  ?path.resolve(G2_ROOT,'../..'):G2_ROOT;
export function checkSS010({root=defaultSourceRoot,requireReady=false}={}){
  validateLimitedManifest(JSON.parse(readFileSync(path.join(root,SS010_TEMPLATE),'utf8')),{template:true});
  const scope=readCurrentYxxScope(root);
  verifyCurrentYxxEvidenceHistory(root);
  const inventory=g2CandidateInventory(root);
  if(requireReady){
    const {report}=readCurrentYxxReport(root);verifyCurrentYxxReportBinding(root,report);
    if(report.current_runs!==undefined)verifyCurrentYxxExecution(root,report);
    if(report.reviews!==undefined)verifyCurrentYxxReviews(root,report);
    if(report.cleanup!==undefined)verifyCurrentYxxCleanup(root,report);
    if(report.historical!==undefined)verifyCurrentYxxHistoricalProof(root,report);
    if(report.specialized!==undefined)verifyCurrentYxxSpecializedProof(root,report);
    if(report.source_accounting!==undefined)verifyCurrentYxxSourceAccounting(root,report);
    if(report.scenarios!==undefined)verifyCurrentYxxScenarios(root,report,SS010_ACCEPTANCE);
    throw Object.assign(new Error('CURRENT_EVIDENCE_INCOMPLETE'),{code:'CURRENT_EVIDENCE_INCOMPLETE',stage:'EVIDENCE'});
  }
  return {ok:true,status:'STRUCTURE_VALID_NOT_READY',contract:'ADR-0027',scope_base:scope.base_head,
    candidate_fingerprint:inventory.fingerprint,database_connections:0,provider_calls:0,listener_started:false,
    live_authorized:false,parent_gate_advanced:false};
}
