import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createP2016TicketQuery } from '../src/p2-016-ticket-query.mjs';

test('ticket reporter contact separates historical report snapshot from current local directory', async () => {
  const ticketId = randomUUID();
  const reporterHash = 'c'.repeat(64);
  const pool = {
    query: async sql => {
      if (sql.includes('FROM pilot_ticket.ticket')) return { rowCount: 1, rows: [{ id: ticketId, status: 'QUEUED', assignee_id: null, resolver_team_id: 'PILOT_IT', version: 1 }] };
      return { rowCount: 1, rows: [{
        profile_resolution_status: 'RESOLVED', reporter_identity_hash: reporterHash,
        profile_snapshot: {
          source: 'THIRD_PARTY_STAFF_DIRECTORY', version: 'third-party-member-v1', fetched_at: '2026-09-27 10:00:00',
          contact: { name: '报修时姓名', mobile: '13800000000' }, sex: '1',
          memberships: [{ department_ref: 'dept-old', name: '报修时部门', role: 'MEMBER' }],
        },
      }] };
    },
  };
  const query = createP2016TicketQuery({
    pool,
    enabled: true,
    authorization: { resolvePrincipal: async () => ({ principal_id: randomUUID(), roles: ['ADMIN'], team_ids: [], is_active: true }) },
    directoryStore: { findByReporterHash: async () => ({
      nickname: '当前姓名', phone: '13900000000', sex: '1', avatar_url: 'https://avatar.example.test/current', fetched_at: '2026-09-28 10:00:00',
      memberships: [{ department_ref: 'dept-new', name: '当前部门' }],
    }) },
  });
  const result = await query.reporterContact({ authContext: {}, ticketId });
  assert.equal(result.contact.name, '报修时姓名');
  assert.equal(result.departments[0].department_ref, 'dept-old');
  assert.equal(result.current_profile.contact.name, '当前姓名');
  assert.equal(result.current_profile.departments[0].department_ref, 'dept-new');
  assert.equal(result.current_profile.avatar_url, 'https://avatar.example.test/current');
});
