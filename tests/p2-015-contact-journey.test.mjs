import test from 'node:test';
import assert from 'node:assert/strict';
import { FaultingDirectory, MockResolvedDirectory, reporterIdentityHash, resolveDirectJourneyAssociation } from '../src/p2-015-contact-journey.mjs';

test('reporter identity is HMAC-bound and directory failures defer safely', async () => {
  const first = reporterIdentityHash({ provider: 'WECOM_AIBOT', bot_id: 'bot-a', reporter_external_id: 'user-a', hmac_key: '0123456789abcdef' });
  const second = reporterIdentityHash({ provider: 'WECOM_AIBOT', bot_id: 'bot-a', reporter_external_id: 'user-b', hmac_key: '0123456789abcdef' });
  assert.match(first, /^[a-f0-9]{64}$/u); assert.notEqual(first, second);
  assert.deepEqual(await FaultingDirectory().resolve({ reporter_identity_hash: first }), { status: 'DEFERRED', snapshot: {} });
  assert.equal((await MockResolvedDirectory({ departments: ['IT', 'OUTPATIENT'] }).resolve({ reporter_identity_hash: first })).snapshot.departments.length, 2);
});

test('direct association follows reliable priorities and never uses userid plus time', () => {
  assert.equal(resolveDirectJourneyAssociation({ provider_context_journey_id: 'j1', guided_candidates: [{ id: 'j2' }] }).reason, 'PROVIDER_CONTEXT');
  assert.equal(resolveDirectJourneyAssociation({ direct_binding_journey_id: 'j1' }).reason, 'EXISTING_DIRECT_BINDING');
  assert.equal(resolveDirectJourneyAssociation({ continuation_journey_id: 'j1' }).reason, 'CONTINUATION_REF');
  assert.equal(resolveDirectJourneyAssociation({ explicit_reference_journey_id: 'j1' }).reason, 'EXPLICIT_REFERENCE');
  assert.equal(resolveDirectJourneyAssociation({ guided_candidates: [{ id: 'j1' }] }).reason, 'UNIQUE_GUIDED_JOURNEY');
  assert.equal(resolveDirectJourneyAssociation({ guided_candidates: [{ id: 'j1' }, { id: 'j2' }] }).outcome, 'ASK_USER_TO_SELECT');
  assert.equal(resolveDirectJourneyAssociation({ reporter_userid: 'same', nearby_time: true }).outcome, 'DIRECT_ORGANIC');
});
