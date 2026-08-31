import { randomUUID } from 'node:crypto';
import { setInterval } from 'node:timers';
import { Pool } from 'pg';

import { createCommunicationDeliveryWorker } from '../../src/p2-004-communication-delivery-worker.mjs';

const { P2_004_CHILD_DATABASE_URL: databaseUrl, P2_004_CHILD_DELIVERY_ID: deliveryId, P2_004_CHILD_MODE: mode } = process.env;
if (!databaseUrl || !deliveryId || !['LEASED', 'SENDING'].includes(mode)) process.exit(2);
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 2_000, application_name: `p2_004_child_${mode.toLowerCase()}` });

if (mode === 'LEASED') {
  const token = randomUUID();
  await pool.query(
    `UPDATE communication.delivery SET status='LEASED', lease_token=$2::uuid,
       lease_expires_at='2026-09-01T00:00:01Z', updated_at='2026-09-01T00:00:00Z'
     WHERE id=$1::uuid AND status='PENDING'`,
    [deliveryId, token],
  );
  process.send?.({ stage: 'LEASED' });
} else {
  const sender = Object.freeze({ send: async () => {
    process.send?.({ stage: 'SENDING' });
    return new Promise(() => {});
  }});
  const worker = createCommunicationDeliveryWorker({
    pool, sender, enabled: true, now: () => new Date('2026-09-01T00:00:00Z'),
    leaseMs: 120_000, sendTimeoutMs: 60_000,
  });
  void worker.deliver({ deliveryId });
}

setInterval(() => {}, 60_000);
