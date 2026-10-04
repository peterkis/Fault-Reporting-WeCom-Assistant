import type { DirectoryProfileResult } from '../../src/p2-007-third-party-staff-directory-adapter.mjs';
import type { RuleAction, RuleResult } from '../../src/p2-007-rule-engine.mjs';
import type { ReporterDirectoryResult } from '../../src/p2-015-contact-journey.mjs';
import { createServiceIntakeDecisionPort } from '../../src/p2-015-service-intake-decision-port.mjs';
import type { IntakeDecisionInput } from '../../src/p2-015-service-intake-decision-port.mjs';
import type { P2015SafeRoute } from '../../contracts/p2_015_contracts.js';
import type { PostgresTransaction } from '../../src/platform/postgres-pool.mjs';

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
  void directory.snapshot.contact;
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
