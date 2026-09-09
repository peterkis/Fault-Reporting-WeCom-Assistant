import { createHash } from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
export const required = ['CONVERSATION_CENTER_ENABLED', 'CONVERSATION_REALTIME_SSE_ENABLED', 'HUMAN_WORKBENCH_V2_ENABLED',
  'RULE_FIRST_ORCHESTRATION_ENABLED', 'MANUAL_REVIEW_QUEUE_ENABLED', 'TICKET_LIFECYCLE_WORKBENCH_ENABLED',
  'REPORTER_TIMELINE_ENABLED', 'WECOM_TEMPLATE_CARD_ENABLED', 'INCIDENT_CORRELATION_ENABLED',
  'INCIDENT_PUBLIC_NOTICE_ENABLED', 'INCIDENT_PRIVATE_NOTICE_ENABLED'];
export const forbidden = ['AI_TRIAGE_ENABLED', 'AI_CONVERSATION_ENABLED', 'AI_AUTO_REPLY_ENABLED', 'OCR_ENABLED',
  'INTEGRATION_CONNECTOR_ENABLED', 'HOSPITAL_IDENTITY_ENABLED', 'INTRANET_PORTAL_SOURCE_ENABLED', 'HOSPITAL_API_SOURCE_ENABLED', 'MONITORING_SOURCE_ENABLED'];
export function configurationFixture(mode = 'synthetic') {
  const env = { PILOT_DATABASE_URL: 'postgres://synthetic:synthetic@127.0.0.1:5432/p2_015_g2runtime_1234',
    PILOT_LOG_IDENTITY_HASH_KEY: 'synthetic-identity-key-at-least-32-bytes', WECOM_BOT_ID: 'synthetic-g2-bot',
    WECOM_BOT_SECRET: 'synthetic-g2-secret', WECOM_WS_URL: 'wss://openws.work.weixin.qq.com',
    P2_G2_REPORTER_HMAC_SECRET: 'synthetic-reporter-key-at-least-32-bytes' };
  const manifest = { schema_version: 1, gate: 'P2-G2', mode,
    run_id: '10000000-0000-4000-8000-000000000001', candidate_fingerprint: 'a'.repeat(64),
    feature_flags: Object.fromEntries([...required.map(k => [k, true]), ...forbidden.map(k => [k, false])]),
    listen_port: 43122, reporter_origin: mode === 'live' ? 'https://reporter.invalid' : 'http://127.0.0.1:43122',
    scope: { bot_hash: sha(env.WECOM_BOT_ID), group_hashes: [sha('synthetic-g2-group')],
      person_hashes: ['reporter-a', 'reporter-b', 'reporter-c'].map(sha), direct_organic_person_hash: sha('reporter-c'),
      principal_ids: ['10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004'],
      database_identity_hash: sha(JSON.stringify({ hostname: '127.0.0.1', port: '5432', database: 'p2_015_g2runtime_1234' })),
      test_prefix: '【p2-g2测试】', approved_inputs: ['@测试助手', '处方提交不了', '谢谢'], approved_replies: ['合成测试：已由人工接手。'],
      approved_templates: ['RULE_FIRST_ORCHESTRATOR', 'TICKET_LIFECYCLE', 'HUMAN_CONFIRMED_INCIDENT'],
      allowed_faults: ['G2-F01', 'G2-F02', 'G2-F03', 'G2-F04', 'G2-N03', 'G2-R02'],
      send_budget: { group: 40, person: 120, total: 160 } },
    approval: { approved: false, authority: null, source_ref: null, source_sha256: null,
      valid_from_epoch_ms: '1788800000000', expires_epoch_ms: '1788807200000' } };
  return { manifest, env, candidateFingerprint: 'a'.repeat(64), nowEpochMs: '1788800100000' };
}
