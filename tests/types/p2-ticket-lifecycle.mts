import { normalizeP2016TicketCommand } from '../../src/p2-016-ticket-command-facade.mjs';
import type { TicketCommand } from '../../src/p2-016-ticket-command-facade.mjs';
import { createP2016CommandLedger } from '../../src/p2-016-ticket-command-ledger.mjs';
import type { LedgerExecution } from '../../src/p2-016-ticket-command-ledger.mjs';
import type { PostgresPool } from '../../src/platform/postgres-pool.mjs';
import type { ReporterTimeline } from '../../src/p2-016-reporter-timeline.mjs';

declare const externalCommand: unknown;
const command = normalizeP2016TicketCommand(externalCommand);
if (command.action === 'transfer-assignment') {
  const target: string = command.target_principal_id;
  void target;
} else if (command.action === 'takeover-and-accept-ticket') {
  const version: number = command.expected_session_row_version;
  const session: string = command.session_id;
  void version; void session;
}
const base = { ticket_id: 'synthetic', client_command_id: 'synthetic', expected_version: 1, reason_code: 'TEST' };
// @ts-expect-error -- Transfer commands require the target principal validated by normalization.
const missingTarget: TicketCommand = { ...base, action: 'transfer-assignment' };
// @ts-expect-error -- Regular actions cannot carry transfer-only ownership fields.
const foreignTarget: TicketCommand = { ...base, action: 'accept', target_principal_id: 'synthetic' };
// @ts-expect-error -- User actions exclude background auto-close from the accepted command union.
const automatic: TicketCommand = { ...base, action: 'auto-close' };
// @ts-expect-error -- Ticket versions are bounded integer numbers at this boundary, not BIGINT strings.
const stringVersion: TicketCommand = { ...base, action: 'accept', expected_version: '1' };
void missingTarget; void foreignTarget; void automatic; void stringVersion;

declare const pool: PostgresPool;
const ledger = createP2016CommandLedger({ pool });
const reviewResult = await ledger.execute({
  command: { action: 'MANUAL_REVIEW', client_command_id: 'synthetic', review_id: 'synthetic', expected_row_version: '1' },
  authorize: async transaction => {
    await transaction.query('SELECT 1');
    // @ts-expect-error -- Only the outer transaction owner can release the connection.
    transaction.release();
    return { principal: { principal_id: 'synthetic' }, review: { id: 'synthetic' }, ticket: null };
  },
  run: async (transaction, context) => {
    await transaction.query('SELECT 1');
    const id: string = context.review.id;
    const ticket: null = context.ticket;
    // @ts-expect-error -- A review context with no ticket cannot become Ticket authorization.
    void context.ticket.version;
    void ticket;
    return { ok: true, resolution_decision_id: id, action_count: 1 };
  },
});
if (reviewResult.ok && !reviewResult.replayed) {
  const decision: string = reviewResult.resolution_decision_id;
  void decision;
} else if (reviewResult.ok && reviewResult.replayed) {
  // @ts-expect-error -- DB JSON replay preserves an unknown payload rather than asserting consumer fields.
  const unverified: string = reviewResult.resolution_decision_id;
  void unverified;
} else if (!reviewResult.ok) {
  const retryable: boolean = reviewResult.error.retryable;
  const replayed: boolean = reviewResult.replayed;
  void retryable; void replayed;
}
const deliveryResult = await ledger.execute({
  command: { action: 'DELIVERY_RETRY', client_command_id: 'synthetic', delivery_id: 'synthetic' },
  authorize: async () => ({ principal: { principal_id: 'synthetic' } }),
  run: async () => ({ ok: true, delivery_id: 'synthetic', status: 'PENDING' as const }),
});
if (deliveryResult.ok && !deliveryResult.replayed) {
  const delivery: string = deliveryResult.delivery_id;
  const status: 'PENDING' = deliveryResult.status;
  void delivery; void status;
}
const execution: LedgerExecution<{ principal: { principal_id: string }; review: { id: string } }, { ok: true }> = {
  command: { action: 'MANUAL_REVIEW', client_command_id: 'synthetic' },
  authorize: async () => ({ principal: { principal_id: 'synthetic' }, review: { id: 'synthetic' } }),
  run: async (_transaction, context) => {
    // @ts-expect-error -- authorize context fields must agree with the run callback input.
    void context.ticket;
    return { ok: true };
  },
};
void execution;
declare const timeline: ReporterTimeline;
const publicDetail = await timeline.detail({ sessionToken: 'synthetic', publicRef: 'synthetic' });
// @ts-expect-error -- Reporter projection excludes internal Ticket IDs.
void publicDetail.ticket_id;
const publicEvents = await timeline.timeline({ sessionToken: 'synthetic', publicRef: 'synthetic' });
// @ts-expect-error -- Reporter milestones never expose internal note text.
void publicEvents.items[0]?.internal_note;
