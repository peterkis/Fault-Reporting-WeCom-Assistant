import { createCommunicationSenderPort } from './p2-004-communication-sender-port.mjs';
import { snapshotP2016, textHashP2016 } from './p2-016-domain-contracts.mjs';
import { createP2016WeComSender } from './p2-016-wecom-sender.mjs';

const HASH = /^[a-f0-9]{64}$/u;
const TEST_LABEL = '【p2-012测试】';
const rejected = (code) => ({ outcome: 'REJECTED_NOT_APPLIED', provider_message_id: null, error_code: code, retryable: false });
const hashes = (values, { required = false } = {}) => Array.isArray(values)
  && (!required || values.length >= 1) && values.length <= 20
  && new Set(values).size === values.length && values.every((value) => typeof value === 'string' && HASH.test(value));

function tagged(message) {
  return Array.isArray(message.content) && message.content.some((item) => item?.kind === 'text'
    && typeof item.text?.clean === 'string' && item.text.clean.normalize('NFKC').toLowerCase().includes(TEST_LABEL));
}

export function createP2012ApprovedGroupReporterRegistry({ pool, botId, groupHashes } = {}) {
  if (!pool || typeof pool.query !== 'function' || typeof botId !== 'string' || !botId || !hashes(groupHashes, { required: true })) {
    throw new TypeError('P2_012_REPORTER_REGISTRY_CONFIGURATION_INVALID');
  }
  return Object.freeze({
    async isApprovedGroupReporter({ sender_user_id } = {}) {
      if (typeof sender_user_id !== 'string' || !sender_user_id) return false;
      const result = await pool.query(`SELECT 1 FROM channel.message_inbox
        WHERE provider='WECOM_AIBOT' AND bot_id=$1 AND chat_type='group' AND sender_user_id=$2
          AND encode(sha256(convert_to(chat_id,'UTF8')),'hex')=ANY($3::text[])
          AND position('【p2-012测试】' in clean_text)>0
        LIMIT 1`, [botId, sender_user_id, groupHashes]);
      return result.rowCount === 1;
    },
  });
}

export function createP2012LiveReporterScope({ bot_id, person_hashes = [], group_hashes,
  isApprovedGroupReporter, require_test_label = true } = {}) {
  if (typeof bot_id !== 'string' || !bot_id || !hashes(person_hashes) || !hashes(group_hashes, { required: true })
    || typeof isApprovedGroupReporter !== 'function' || require_test_label !== true) {
    throw new TypeError('P2_012_LIVE_REPORTER_SCOPE_INVALID');
  }
  const people = new Set(person_hashes);
  const groups = new Set(group_hashes);
  async function discovered(sender_user_id) {
    return await isApprovedGroupReporter({ sender_user_id, bot_id, group_hashes });
  }
  return Object.freeze({
    allowed_target_hashes: Object.freeze([...new Set([...people, ...groups])]),
    async accepts(input) {
      let message;
      try { message = snapshotP2016(input); } catch { return false; }
      if (message?.provider !== 'WECOM_AIBOT' || message.bot_id !== bot_id
        || typeof message.sender_user_id !== 'string' || !tagged(message)) return false;
      if (message.chat_type === 'group') {
        return typeof message.chat_id === 'string' && groups.has(textHashP2016(message.chat_id));
      }
      if (message.chat_type !== 'single') return false;
      return people.has(textHashP2016(message.sender_user_id)) || await discovered(message.sender_user_id);
    },
    async authorizesDestination({ target_type, target_id } = {}) {
      if (typeof target_id !== 'string' || !target_id) return false;
      if (target_type === 'GROUP') return groups.has(textHashP2016(target_id));
      if (target_type !== 'PERSON') return false;
      return people.has(textHashP2016(target_id)) || await discovered(target_id);
    },
  });
}

export function createP2012DynamicWeComSender({ pool, gateway, allowedTargetHashes = [], approvedGroupHashes,
  botId, enabled = false, cardEnabled = false, reporterAccess, origin, allowedHosts = [], allowLocalHttp = false } = {}) {
  if (!enabled) return createCommunicationSenderPort(async () => rejected('P2_012_SENDER_DISABLED'));
  const registry = createP2012ApprovedGroupReporterRegistry({ pool, botId, groupHashes: approvedGroupHashes });
  const scope = createP2012LiveReporterScope({ bot_id: botId, person_hashes: allowedTargetHashes.filter((value) => !approvedGroupHashes.includes(value)),
    group_hashes: approvedGroupHashes, isApprovedGroupReporter: registry.isApprovedGroupReporter, require_test_label: true });
  return createCommunicationSenderPort(async (request) => {
    if (!await scope.authorizesDestination({ target_type: request.target_type, target_id: request.target_id })) {
      return rejected('P2_012_SEND_SCOPE_FORBIDDEN');
    }
    const targetHash = textHashP2016(request.target_id);
    const sender = createP2016WeComSender({ gateway, enabled, cardEnabled, reporterAccess, origin, allowedHosts, allowLocalHttp,
      allowedTargetHashes: [...new Set([...allowedTargetHashes, targetHash])] });
    return sender.send(request);
  });
}

export async function assertP2012ApprovedDatabaseScope(pool, configuration) {
  const people = configuration.inboundScope.person_hashes;
  const groups = configuration.inboundScope.group_hashes;
  const result = await pool.query(`SELECT
    (SELECT count(*)::integer FROM intake.service_intake i WHERE NOT (
      i.source_provider='WECOM_AIBOT' AND i.source_bot_id=$1 AND (
        (i.source_chat_type='group' AND encode(sha256(convert_to(i.source_chat_id,'UTF8')),'hex')=ANY($3::text[])) OR
        (i.source_chat_type='single' AND (
          encode(sha256(convert_to(i.reporter_wecom_userid,'UTF8')),'hex')=ANY($2::text[]) OR EXISTS(
            SELECT 1 FROM channel.message_inbox g WHERE g.provider='WECOM_AIBOT' AND g.bot_id=$1
              AND g.chat_type='group' AND g.sender_user_id=i.reporter_wecom_userid
              AND encode(sha256(convert_to(g.chat_id,'UTF8')),'hex')=ANY($3::text[])
              AND position('【p2-012测试】' in g.clean_text)>0)))))) AS foreign_intakes,
    (SELECT count(*)::integer FROM communication.delivery d WHERE NOT (
      d.provider='WECOM_AIBOT' AND d.channel_account_id=$1 AND (
        (d.target_type='GROUP' AND d.target_hash=ANY($3::text[])) OR
        (d.target_type='PERSON' AND (d.target_hash=ANY($2::text[]) OR EXISTS(
          SELECT 1 FROM channel.message_inbox g WHERE g.provider='WECOM_AIBOT' AND g.bot_id=$1
            AND g.chat_type='group' AND encode(sha256(convert_to(g.sender_user_id,'UTF8')),'hex')=d.target_hash
            AND encode(sha256(convert_to(g.chat_id,'UTF8')),'hex')=ANY($3::text[])
            AND position('【p2-012测试】' in g.clean_text)>0)))))) AS foreign_deliveries,
    (SELECT count(*)::integer FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
      AND application_name IN ('p2_g1_app','p2_g1_worker','p2_g1_gateway')) AS competing_roles`,
  [configuration.botId, people, groups]);
  if (Object.values(result.rows[0]).some((value) => value !== 0)) throw new Error('P2_012_DEDICATED_APPROVED_DATABASE_REQUIRED');
  return result.rows[0];
}
