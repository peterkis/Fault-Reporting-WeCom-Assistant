import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hash, record, safeFile, strings } from './common.mjs';
import { loadRoutes, type Selection } from './routing.mjs';

export const ACCEPTANCE_PATH='plans/yxx-current-readiness-acceptance.json';
export function currentAcceptance(root:string): {
  status:string; contract_sha256:string; current_files:string[]; historical_registered_files:string[];
  historical_head:string; historical_base:string; historical_strict_command:string[]; historical_regression_files:string[];
  live_authorized:false;
} {
  const text=readFileSync(safeFile(root,ACCEPTANCE_PATH),'utf8'),doc=record(JSON.parse(text) as unknown);
  assert.deepEqual(Object.keys(doc).sort(),['schema_version','contract','current_files','historical_registered_files',
    'historical_head','historical_base','historical_strict_command','historical_regression_files','live_authorized'].sort());
  assert.equal(doc.schema_version,1);assert.equal(doc.contract,'ADR-0027');assert.equal(doc.live_authorized,false);
  assert.equal(doc.historical_head,'41edd855e7bc55149facb6a4b2e0076776c22e66');
  assert.equal(doc.historical_base,'375d47b013017edb858206cc5f3475c9aed77dfd');
  const current=strings(doc.current_files),historical=strings(doc.historical_registered_files);
  assert.deepEqual(historical,['tests/yxx-ss-008-validation-scope.test.mjs']);
  assert.deepEqual([...current,...historical].sort(),loadRoutes(root).entries.map(entry=>entry.path).sort());
  assert.deepEqual(current,[...new Set(current)].sort());
  const historicalStrict=strings(doc.historical_strict_command),regressions=strings(doc.historical_regression_files);
  assert.deepEqual(historicalStrict,['node','scripts/validate-yxx-self-service.mjs','--require-ready']);
  assert.deepEqual(regressions,[...historical,'tests/yxx-ss-009-evidence.test.mjs',
    'tests/yxx-ss-009-evidence-history.test.mjs','tests/yxx-ss-009-governance.test.mjs']);
  return {status:'EXECUTION_PLAN_NOT_READINESS',contract_sha256:hash(text.replaceAll('\r\n','\n')),
    current_files:current,historical_registered_files:historical,historical_head:doc.historical_head,
    historical_base:doc.historical_base,historical_strict_command:historicalStrict,historical_regression_files:regressions,live_authorized:false};
}
export function currentSelection(root:string):Selection {
  const plan=currentAcceptance(root),routes=loadRoutes(root);
  return {label:'yxx-current-full',flags:[],entries:plan.current_files.map(file=>{
    const entry=routes.entries.find(entry=>entry.path===file);assert.ok(entry);return entry;
  })};
}
