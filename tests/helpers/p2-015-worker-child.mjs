import { createPostgresPool } from '../../src/platform/postgres-pool.mjs';
import { createPilotTicketCore } from '../../src/p1-005-pilot-ticket-core.mjs';
import { createDecisionStore } from '../../src/p2-015-decision-store.mjs';
import { createManualReviewStore } from '../../src/p2-015-manual-review.mjs';
import { createRuleFirstOrchestrator } from '../../src/p2-015-rule-first-orchestrator.mjs';
import { createExistingTicketCommandPort, createP2004FixedCommunicationPort, createSafeActionExecutor } from '../../src/p2-015-safe-action-executor.mjs';
import { createServiceIntakeDecisionPort } from '../../src/p2-015-service-intake-decision-port.mjs';
import { createP2015Worker } from '../../src/p2-015-worker.mjs';

const mode = process.argv[2];
const intakeId = process.argv[3];
const pool = createPostgresPool({ connectionString: process.env.PILOT_DATABASE_URL, max: 4,
  connectionTimeoutMillis: 5_000, application_name: `p2_015_child_${mode}`.slice(0, 63) });
let client = null;
const output = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
async function close(code = 0) { await client?.query('ROLLBACK').catch(() => {}); client?.release?.(); client = null; await pool.end().catch(() => {}); process.exit(code); }
process.once('SIGTERM', () => { void close(0); });
process.once('SIGINT', () => { void close(0); });

if (mode === 'claim-hang') {
  client = await pool.connect(); await client.query('BEGIN');
  const claim = await client.query('SELECT id::text FROM intake.service_intake WHERE id=$1::uuid FOR UPDATE SKIP LOCKED', [intakeId]);
  output({ event: 'claimed', count: claim.rowCount }); setInterval(() => {}, 1_000);
} else {
  const decisionStore = createDecisionStore();
  const manualReviewStore = createManualReviewStore({ authorizer: { authorizedJourneyIds: async () => [] } });
  const executor = createSafeActionExecutor({ intakeDecisionPort: createServiceIntakeDecisionPort(),
    ticketCommandPort: createExistingTicketCommandPort({ ticketCore: createPilotTicketCore({ pool }) }),
    communicationPort: createP2004FixedCommunicationPort(), manualReviewStore, decisionStore });
  const orchestrator = createRuleFirstOrchestrator({ pool, identityHmacKey: 'p2-015-child-hmac-key-32-characters', decisionStore, safeActionExecutor: executor });
  const worker = createP2015Worker({ pool, orchestrator });
  const result = await worker.processDueBatch({ feature_flags: { RULE_FIRST_ORCHESTRATION_ENABLED: true, MANUAL_REVIEW_QUEUE_ENABLED: true }, batch_size: 20, now_epoch_ms: String(Date.now()) });
  output({ event: 'processed', processed: result.processed });
  if (mode === 'process-hang') setInterval(() => {}, 1_000); else await close(0);
}
