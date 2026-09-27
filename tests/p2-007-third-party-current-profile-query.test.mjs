import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createP2016TicketQuery } from '../src/p2-016-ticket-query.mjs';

test('deferred history can read a later current binding without rewriting history', async () => {
  const ticketId=randomUUID(), hash='e'.repeat(64);
  const row={profile_resolution_status:'DEFERRED',profile_snapshot:{},reporter_identity_hash:hash};
  const pool={query:async sql=>sql.includes('FROM pilot_ticket.ticket')
    ?{rowCount:1,rows:[{id:ticketId,resolver_team_id:'PILOT_IT'}]}:{rowCount:1,rows:[row]}};
  let reads=0;
  const query=createP2016TicketQuery({pool,enabled:true,
    authorization:{resolvePrincipal:async()=>({principal_id:randomUUID(),roles:['ADMIN'],team_ids:[],is_active:true})},
    directoryStore:{findByReporterHash:async input=>{reads++;assert.equal(input.reporter_identity_hash,hash);
      return {nickname:'现在的姓名',memberships:[{name:'现在的部门',department_ref:'private-id'}]};}}});
  const result=await query.reporterContact({authContext:{},ticketId});
  assert.equal(reads,1);assert.equal(result.status,'DEFERRED');assert.equal(result.contact,null);
  assert.equal(result.current_profile.status,'RESOLVED');assert.equal(result.current_profile.contact.name,'现在的姓名');
  assert.doesNotMatch(JSON.stringify(result),/private-id/);
  assert.deepEqual(row.profile_snapshot,{});assert.equal(row.profile_resolution_status,'DEFERRED');
});

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
  assert.equal(result.departments[0].department_ref, null);
  assert.equal(result.departments[0].name, '报修时部门');
  assert.equal(result.departments[0].role, 'MEMBER');
  assert.equal(result.current_profile.contact.name, '当前姓名');
  assert.equal(result.current_profile.departments[0].department_ref, null);
  assert.doesNotMatch(JSON.stringify(result), /dept-old|dept-new/);
  assert.equal(result.current_profile.departments[0].role, 'MEMBER');
  assert.equal(result.current_profile.avatar_url, 'https://avatar.example.test/current');
});

test('ticket reporter contact keeps source-specific historical membership roles fail-closed', async () => {
  const ticketId = randomUUID();
  const pool = {
    query: async sql => {
      if (sql.includes('FROM pilot_ticket.ticket')) return { rowCount: 1, rows: [{ id: ticketId, status: 'QUEUED', assignee_id: null, resolver_team_id: 'PILOT_IT', version: 1 }] };
      return { rowCount: 1, rows: [{
        profile_resolution_status: 'RESOLVED', reporter_identity_hash: 'd'.repeat(64),
        profile_snapshot: {
          source: 'WECOM_DIRECTORY', version: 'wecom-member-v1', fetched_at: '2026-09-27 10:00:00',
          contact: { name: '企业微信报修人' },
          memberships: [
            { department_ref: 'dept-primary', name: '主科室', role: 'PRIMARY' },
            { department_ref: 'dept-untrusted', name: '未知角色科室', role: 'MEMBER' },
          ],
        },
      }] };
    },
  };
  const query = createP2016TicketQuery({
    pool,
    enabled: true,
    authorization: { resolvePrincipal: async () => ({ principal_id: randomUUID(), roles: ['ADMIN'], team_ids: [], is_active: true }) },
  });
  const result = await query.reporterContact({ authContext: {}, ticketId });
  assert.equal(result.departments[0].role, 'PRIMARY');
  assert.equal(result.departments[1].role, 'UNKNOWN');
  assert.equal(Object.hasOwn(result, 'current_profile'), false);
});
