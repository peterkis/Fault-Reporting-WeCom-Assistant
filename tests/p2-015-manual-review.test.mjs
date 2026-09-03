import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualReviewStore } from '../src/p2-015-manual-review.mjs';

test('manual review internal query and resolve default deny before storage access', async () => {
  let queries = 0;
  const transaction = { query: async () => { queries += 1; return { rows: [], rowCount: 0 }; } };
  const store = createManualReviewStore();
  await assert.rejects(store.list({ transaction, principal: { principal_id: 'x' } }), { code: 'P2_015_AUTHORIZATION_DENIED' });
  await assert.rejects(store.resolve({ transaction, principal: { principal_id: 'x' }, command: {
    review_id: 'x', expected_row_version: '1', client_command_id: 'x', resolution_code: 'ACKNOWLEDGE',
    resolution_reason_code: 'HUMAN_ACK', resolved_at: '2026-09-03 12:00:00',
  } }), { code: 'P2_015_AUTHORIZATION_DENIED' });
  assert.equal(queries, 0);
});
