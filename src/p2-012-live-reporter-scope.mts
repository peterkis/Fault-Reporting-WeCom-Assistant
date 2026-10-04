import type { PostgresTransaction } from './platform/postgres-pool.mjs';
import type { P2012LiveConfiguration } from './p2-012-live-configuration.mjs';
import type { CommunicationSenderRequest } from '../contracts/communication_contracts.js';
import type { CommunicationSenderResult } from './p2-004-communication-sender-port.mjs';
type LabelSource = 'clean' | 'raw';
export interface ReporterLookup { sender_user_id?: string | undefined; reporter_user_id?: string | undefined; bot_id?: string | undefined; group_hashes?: readonly string[] | undefined; transaction?: PostgresTransaction | undefined }
export type ReporterDiscovery = (input?: ReporterLookup) => Promise<boolean>;
type RegistryOptions = { pool?: PostgresTransaction | undefined; botId?: string | undefined; groupHashes?: readonly string[] | undefined; testLabel?: string | undefined; labelSource?: LabelSource | undefined };
type ScopeOptions = { bot_id?: string | undefined; person_hashes?: readonly string[] | undefined; group_hashes?: readonly string[] | undefined; isApprovedGroupReporter?: ReporterDiscovery; hasMatchingDirectLeg?: ReporterDiscovery; require_test_label?: boolean; testLabel?: string | undefined; labelSource?: LabelSource | undefined };
type SenderBase = Parameters<typeof createP2016WeComSender>[0];
type DynamicSenderOptions = Partial<SenderBase> & { pool?: PostgresTransaction; approvedGroupHashes?: readonly string[]; botId?: string | undefined; testLabel?: string; labelSource?: LabelSource; groupClosureWebhook?: Omit<Parameters<typeof createP2016GroupClosureWebhookSender>[0], 'pool'> | null };
export type P2012LiveReporterScope = ReturnType<typeof createP2012LiveReporterScope>;
import { createCommunicationSenderPort } from './p2-004-communication-sender-port.mjs';
import { snapshotP2016, textHashP2016 } from './p2-016-domain-contracts.mjs';
import { createP2016WeComSender } from './p2-016-wecom-sender.mjs';
import { createP2016GroupClosureWebhookSender } from './p2-016-group-closure-webhook.mjs';

const HASH = /^[a-f0-9]{64}$/u;
const TEST_LABEL = '【p2-012测试】';
const rejected = (code: string): CommunicationSenderResult => ({ outcome: 'REJECTED_NOT_APPLIED', provider_message_id: null, error_code: code, retryable: false });
const hashes = (values: unknown, { required = false } = {}) => Array.isArray(values)
  && (!required || values.length >= 1) && values.length <= 20
  && new Set(values).size === values.length && values.every((value) => typeof value === 'string' && HASH.test(value));

const validLabel = (label: string, source: string) => ['【p2-012测试】', '【p2-g2测试】'].includes(label) && ['clean', 'raw'].includes(source);
function tagged(message: { content?: unknown }, testLabel = TEST_LABEL, labelSource: LabelSource = 'clean') {
  return Array.isArray(message.content) && message.content.some((item) => item?.kind === 'text'
    && typeof item.text?.[labelSource] === 'string' && (item.text[labelSource] as string).normalize('NFKC').toLowerCase().includes(testLabel));
}

export function createP2012ApprovedGroupReporterRegistry({ pool, botId, groupHashes, testLabel = TEST_LABEL, labelSource = 'clean' }: RegistryOptions = {}) {
  if (!pool || typeof pool.query !== 'function' || typeof botId !== 'string' || !botId || !hashes(groupHashes, { required: true }) || !validLabel(testLabel, labelSource)) {
    throw new TypeError('P2_012_REPORTER_REGISTRY_CONFIGURATION_INVALID');
  }
  return Object.freeze({
    async hasMatchingDirectLeg({ reporter_user_id, bot_id = botId, transaction = pool } : ReporterLookup = {}) {
      if (bot_id !== botId || typeof reporter_user_id !== 'string' || !reporter_user_id) return false;
      const result = await (transaction as PostgresTransaction).query(`SELECT 1 FROM intake.channel_leg leg
        JOIN intake.service_intake i ON i.id=leg.source_intake_id
        JOIN intake.contact_journey journey ON journey.id=leg.journey_id
        JOIN intake.service_intake origin ON origin.id=journey.origin_intake_id
        WHERE leg.leg_type IN ('DIRECT_GUIDED','DIRECT_ORGANIC')
          AND i.source_provider='WECOM_AIBOT' AND i.source_bot_id=$1
          AND i.source_chat_type='single' AND i.reporter_wecom_userid=$2
          AND leg.reporter_identity_hash=journey.reporter_identity_hash
          AND origin.source_provider=i.source_provider AND origin.source_bot_id=i.source_bot_id
          AND origin.reporter_wecom_userid=i.reporter_wecom_userid
          AND journey.retention_until_epoch_ms>platform.physical_epoch_ms()
        LIMIT 1`, [botId, reporter_user_id]);
      return result.rowCount === 1;
    },
    async isApprovedGroupReporter({ sender_user_id, transaction = pool } : ReporterLookup = {}) {
      if (typeof sender_user_id !== 'string' || !sender_user_id) return false;
      const result = await (transaction as PostgresTransaction).query(`SELECT 1 FROM channel.message_inbox
        WHERE provider='WECOM_AIBOT' AND bot_id=$1 AND chat_type='group' AND sender_user_id=$2
          AND encode(sha256(convert_to(chat_id,'UTF8')),'hex')=ANY($3::text[])
          AND position($4 in ${labelSource === 'raw' ? 'raw_text' : 'clean_text'})>0
        LIMIT 1`, [botId, sender_user_id, groupHashes, testLabel]);
      return result.rowCount === 1;
    },
  });
}

export function createP2012LiveReporterScope({ bot_id, person_hashes = [], group_hashes,
  isApprovedGroupReporter, hasMatchingDirectLeg = async () => false, require_test_label = true, testLabel = TEST_LABEL, labelSource = 'clean' }: ScopeOptions = {}) {
  if (typeof bot_id !== 'string' || !bot_id || !hashes(person_hashes) || !hashes(group_hashes, { required: true })
    || typeof isApprovedGroupReporter !== 'function' || typeof hasMatchingDirectLeg !== 'function' || require_test_label !== true || !validLabel(testLabel, labelSource)) {
    throw new TypeError('P2_012_LIVE_REPORTER_SCOPE_INVALID');
  }
  const people = new Set(person_hashes);
  const groups = new Set(group_hashes);
  async function discovered(sender_user_id: string, transaction?: PostgresTransaction) {
    return await (isApprovedGroupReporter as ReporterDiscovery)({ sender_user_id, bot_id, group_hashes, transaction });
  }
  return Object.freeze({
    allowed_target_hashes: Object.freeze([...new Set([...people, ...groups])]),
    async accepts(input: unknown): Promise<boolean> {
      let message;
      try { message = snapshotP2016(input) as { provider?: unknown; bot_id?: unknown; sender_user_id?: unknown; content?: unknown; chat_type?: unknown; chat_id?: unknown }; } catch { return false; }
      if (message?.provider !== 'WECOM_AIBOT' || message.bot_id !== bot_id
        || typeof message.sender_user_id !== 'string' || !tagged(message, testLabel, labelSource)) return false;
      if (message.chat_type === 'group') {
        return typeof message.chat_id === 'string' && groups.has(textHashP2016(message.chat_id));
      }
      if (message.chat_type !== 'single') return false;
      return people.has(textHashP2016(message.sender_user_id)) || await discovered(message.sender_user_id);
    },
    async authorizesDestination({ target_type, target_id, transaction }: { target_type?: string; target_id?: string; transaction?: PostgresTransaction | undefined } = {}): Promise<boolean> {
      if (typeof target_id !== 'string' || !target_id) return false;
      if (target_type === 'GROUP') return groups.has(textHashP2016(target_id));
      if (target_type !== 'PERSON') return false;
      return (people.has(textHashP2016(target_id)) || await discovered(target_id, transaction))
        && await hasMatchingDirectLeg({ reporter_user_id: target_id, bot_id, transaction });
    },
  });
}

export function createP2012PersonDestinationAuthorizer({ pool, botId, personHashes = [], groupHashes, testLabel = TEST_LABEL, labelSource = 'clean' }: RegistryOptions & { personHashes?: readonly string[] } = {}) {
  const registry = createP2012ApprovedGroupReporterRegistry({ pool, botId, groupHashes, testLabel, labelSource });
  const scope = createP2012LiveReporterScope({ bot_id: botId, person_hashes: personHashes, group_hashes: groupHashes,
    isApprovedGroupReporter: registry.isApprovedGroupReporter, hasMatchingDirectLeg: registry.hasMatchingDirectLeg, testLabel, labelSource });
  return async ({ transaction, bot_id, reporter_user_id }: { transaction: PostgresTransaction; bot_id: string; reporter_user_id: string }) => bot_id === botId
    && await scope.authorizesDestination({ target_type: 'PERSON', target_id: reporter_user_id, transaction });
}

export function createP2012DynamicWeComSender({ pool, gateway, allowedTargetHashes = [], approvedGroupHashes,
  botId, enabled = false, cardEnabled = false, reporterAccess, origin, allowedHosts = [], allowLocalHttp = false, testLabel = TEST_LABEL, labelSource = 'clean',groupClosureWebhook=null,linkMode='LEGACY_BOUND_GRANT' }: DynamicSenderOptions = {}) {
  if (!enabled) return createCommunicationSenderPort(async () => rejected('P2_012_SENDER_DISABLED'));
  const closureSender=groupClosureWebhook?createP2016GroupClosureWebhookSender({pool:pool as PostgresTransaction,...groupClosureWebhook}):null;
  const registry = createP2012ApprovedGroupReporterRegistry({ pool, botId, groupHashes: approvedGroupHashes, testLabel, labelSource });
  const scope = createP2012LiveReporterScope({ bot_id: botId, person_hashes: allowedTargetHashes.filter((value) => !(approvedGroupHashes as readonly string[]).includes(value)),
    group_hashes: approvedGroupHashes, isApprovedGroupReporter: registry.isApprovedGroupReporter,
    hasMatchingDirectLeg: registry.hasMatchingDirectLeg, require_test_label: true, testLabel, labelSource });
  return createCommunicationSenderPort(async (request) => {
    if (request.provider !== 'WECOM_AIBOT' || request.channel_account_id !== botId
      || !await scope.authorizesDestination({ target_type: request.target_type, target_id: request.target_id })) {
      return rejected('P2_012_SEND_SCOPE_FORBIDDEN');
    }
    const targetHash = textHashP2016(request.target_id);
    if((request.message.content as { transport?: unknown } | null)?.transport==='WECOM_GROUP_WEBHOOK')return closureSender?closureSender.send(request as CommunicationSenderRequest):rejected('P2_016_WEBHOOK_ROUTE_MISSING');
    const sender = createP2016WeComSender({ gateway:gateway as SenderBase['gateway'], enabled, cardEnabled, reporterAccess:reporterAccess as SenderBase['reporterAccess'], origin:origin as string, allowedHosts, allowLocalHttp,linkMode,
      allowedTargetHashes: [...new Set([...allowedTargetHashes, targetHash])] });
    return sender.send(request as CommunicationSenderRequest);
  });
}

export async function assertP2012ApprovedDatabaseScope(pool: PostgresTransaction, configuration: Pick<P2012LiveConfiguration, 'botId' | 'inboundScope'>) {
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
            AND position('【p2-012测试】' in g.clean_text)>0)) AND EXISTS(
          SELECT 1 FROM intake.channel_leg leg
          JOIN intake.service_intake i ON i.id=leg.source_intake_id
          JOIN intake.contact_journey journey ON journey.id=leg.journey_id
          JOIN intake.service_intake origin ON origin.id=journey.origin_intake_id
          WHERE leg.leg_type IN ('DIRECT_GUIDED','DIRECT_ORGANIC')
            AND i.source_provider='WECOM_AIBOT' AND i.source_bot_id=$1 AND i.source_chat_type='single'
            AND encode(sha256(convert_to(i.reporter_wecom_userid,'UTF8')),'hex')=d.target_hash
            AND leg.reporter_identity_hash=journey.reporter_identity_hash
            AND origin.source_provider=i.source_provider AND origin.source_bot_id=i.source_bot_id
            AND origin.reporter_wecom_userid=i.reporter_wecom_userid
            AND journey.retention_until_epoch_ms>platform.physical_epoch_ms()))))) AS foreign_deliveries,
    (SELECT count(*)::integer FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
      AND application_name IN ('p2_g1_app','p2_g1_worker','p2_g1_gateway')) AS competing_roles`,
  [configuration.botId, people, groups]);
  if (Object.values(result.rows[0] as Record<string, unknown>).some((value) => value !== 0)) throw new Error('P2_012_DEDICATED_APPROVED_DATABASE_REQUIRED');
  return result.rows[0];
}
