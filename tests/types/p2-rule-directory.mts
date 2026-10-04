import type { DirectoryProfileResult } from '../../src/p2-007-third-party-staff-directory-adapter.mjs';
import type { RuleAction, RuleResult } from '../../src/p2-007-rule-engine.mjs';
import type { ReporterDirectoryResult } from '../../src/p2-015-contact-journey.mjs';
import { createServiceIntakeDecisionPort } from '../../src/p2-015-service-intake-decision-port.mjs';
import type { IntakeDecisionInput } from '../../src/p2-015-service-intake-decision-port.mjs';
import type { P2015SafeRoute } from '../../contracts/p2_015_contracts.js';
import type { PostgresTransaction } from '../../src/platform/postgres-pool.mjs';
import { createRuleEngine } from '../../src/p2-007-rule-engine.mjs';
import { resolveFactConflicts } from '../../src/p2-007-conflict-resolver.mjs';
import type { FactConflict } from '../../src/p2-007-conflict-resolver.mjs';
import { resolveDirectJourneyAssociation } from '../../src/p2-015-contact-journey.mjs';

declare const profile: DirectoryProfileResult;
if (profile.status === 'RESOLVED') {
  const employeeId: string = profile.profile.employee_id;
  void employeeId;
} else {
  // @ts-expect-error -- Unresolved adapter states carry no authorized person profile.
  void profile.profile.employee_id;
}
declare const directory: ReporterDirectoryResult;
if (directory.status !== 'RESOLVED') {
  // @ts-expect-error -- Deferred reporter results do not carry a resolved contact snapshot.
  void directory.snapshot.contact.name;
}
const action: RuleAction = { action: 'ADD_SYMPTOM', symptom_code: 'AUTH.LOGIN_FAILED' };
// @ts-expect-error -- A symptom action requires symptom_code rather than a selected service field.
const wrongAction: RuleAction = { action: 'ADD_SYMPTOM', service_code: 'ACCESS.REGISTRATION' };
declare const rules: RuleResult;
// @ts-expect-error -- Rule classification output is distinct from the upper orchestration decision contract.
const wrongRoute: P2015SafeRoute = rules;
declare const transaction: PostgresTransaction;
declare const input: IntakeDecisionInput;
void createServiceIntakeDecisionPort().apply({ transaction, input });
// @ts-expect-error -- Decision persistence requires a query transaction rather than an arbitrary pool owner.
void createServiceIntakeDecisionPort().apply({ transaction: { connect() {} }, input });
void action; void wrongAction; void wrongRoute;
// @ts-expect-error -- Unresolved directory states must reject construction with resolved contact data.
const invalidDirectory: ReporterDirectoryResult = { status: 'DEFERRED', snapshot: { contact: { name: 'Synthetic' } } };
declare const externalInput: unknown;
const rawRule = createRuleEngine().evaluate(externalInput);
// @ts-expect-error -- Existing guards do not establish optional external scope as a string.
const invalidScope: string = rawRule.scope;
declare const externalRules: unknown;
const customRule = createRuleEngine({ ruleSet: externalRules }).evaluate({ text: '', source_ref: 'synthetic', observed_at: '2026-10-04 20:00:00' });
// @ts-expect-error -- An unknown custom rule action cannot guarantee a known result-state literal.
const invalidState: RuleResult['result_state'] = customRule.result_state;
const rawConflict = resolveFactConflicts(externalInput);
// @ts-expect-error -- A plain JSON facts array does not prove full provenance fields.
const invalidFact: string = rawConflict.facts[0].fact_id;
const rawJourney = resolveDirectJourneyAssociation(externalInput);
if (rawJourney.outcome === 'LINK') {
  // @ts-expect-error -- A raw guided candidate id has not been checked as a string.
  const invalidJourney: string = rawJourney.journey_id;
  void invalidJourney;
}
declare const conflict: FactConflict;
if (conflict.resolution_status === 'DEFERRED_TO_HUMAN') {
  const needsHuman: true = conflict.requires_human;
  const selected: null = conflict.selected_fact_id;
  void needsHuman; void selected;
}
void invalidDirectory; void invalidScope; void invalidState; void invalidFact;
