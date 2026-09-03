import fs from 'node:fs';
import path from 'node:path';

import { createAliasResolver } from '../src/p2-007-alias-resolver.mjs';
import { createRuleEngine } from '../src/p2-007-rule-engine.mjs';
import { loadServiceCatalog } from '../src/p2-007-service-catalog.mjs';

const root = process.cwd();
const errors = [];
let checks = 0;
function check(condition, message) {
  checks += 1;
  if (!condition) errors.push(message);
}

const sourceFiles = fs.readdirSync(path.join(root, 'src'))
  .filter((name) => /^p2-007.*\.mjs$/u.test(name))
  .sort();
check(sourceFiles.length === 10, 'P2-007 runtime source inventory is exactly ten modules');

const forbiddenPatterns = [
  [/from\s+['"](?:@wecom|pg|node:http|node:https)/u, 'P2-007 source imports an external/runtime seam'],
  [/\b(?:fetch|Date\.now|new\s+Date|toISOString|randomUUID|Math\.random)\s*\(/u, 'P2-007 source uses network, time, or randomness'],
  [/\b(?:DeepSeek|CALL_WECOM_SDK|CREATE_INCIDENT_RECORD|UPDATE_TICKET_CORE)\b/u, 'P2-007 source contains a forbidden integration action'],
];
for (const name of sourceFiles) {
  const content = fs.readFileSync(path.join(root, 'src', name), 'utf8');
  for (const [pattern, message] of forbiddenPatterns) check(!pattern.test(content), `${name}: ${message}`);
}

const catalog = loadServiceCatalog();
const aliasResolver = createAliasResolver({ catalog });
const engine = createRuleEngine({ catalog });
check(catalog.service_count >= 50, 'service catalog contains at least 50 canonical services');
check(catalog.category_count === 11, 'service catalog contains the frozen 11 categories');
check(aliasResolver.resolve('PACS 打不开').selected_service_code === 'DIAG.IMAGING_VIEWER', 'alias resolver is operational');
const sample = engine.evaluate({ text: '门诊系统打不开', source_ref: 'validator-sample', observed_at: '2026-09-03 15:30:00' });
check(sample.side_effects.length === 0, 'rule engine emits no side effects');
check(sample.facts.every((fact) => fact.source_ref && Object.hasOwn(fact, 'rule_id')), 'all sample facts have provenance');
check(/^[a-f0-9]{64}$/u.test(sample.result_hash), 'sample result has a stable SHA-256 hash');
check(sample.evaluated_at === '2026-09-03 15:30:00', 'sample result preserves LocalDateTime');
check(!/[TZ]|[+-][0-9]{2}:[0-9]{2}/u.test(sample.evaluated_at), 'sample result has no UTC or offset suffix');

const migrations = fs.readdirSync(path.join(root, 'database', 'migrations'));
check(!migrations.some((name) => /p2[-_]?007|hospital.it.domain/iu.test(name)), 'P2-007 creates no database migration');
const decisions = JSON.parse(fs.readFileSync(path.join(root, 'config_examples', 'p2-007-domain-decisions.v1.2.json'), 'utf8'));
for (const key of [
  'p2_007_external_side_effects', 'p2_007_directory_network_call', 'p2_007_model_calls',
  'p2_007_ocr_calls', 'p2_007_incident_creation', 'p2_007_ticket_mutation', 'p2_007_wecom_send',
]) check(decisions.feature_boundaries?.[key] === false, `${key} remains false`);
check(decisions.feature_boundaries?.all_feature_flags_default_false === true, 'all Feature Flag defaults remain false');

if (errors.length > 0) {
  console.error(`P2-007 runtime validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`P2-007 runtime validation passed (${checks} checks; ${sourceFiles.length} modules; ${catalog.service_count} services).`);
}
