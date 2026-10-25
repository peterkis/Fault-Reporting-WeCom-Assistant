import { runWebhookCapabilityProbe } from '../src/g0-webhook-message-capability.mjs';

if (!process.argv.includes('--live')) {
  console.log(JSON.stringify({ test_id: 'G0-WEBHOOK-001', event: 'live_flag_required' }));
  process.exitCode = 2;
} else if (!process.env.WECOM_GROUP_WEBHOOK_URL || !process.env.WECOM_GROUP_MENTION_USERID) {
  console.log(JSON.stringify({ test_id: 'G0-WEBHOOK-001', event: 'configuration_failed' }));
  process.exitCode = 2;
} else {
  const report = await runWebhookCapabilityProbe({
    webhookUrl: process.env.WECOM_GROUP_WEBHOOK_URL,
    mentionedUserId: process.env.WECOM_GROUP_MENTION_USERID,
  });
  console.log(JSON.stringify(report));
  process.exitCode = report.results.some((result) => ['rejected', 'transport_failed'].includes(result.status)) ? 2 : 0;
}
