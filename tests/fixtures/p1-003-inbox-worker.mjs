import { createPostgresPool } from '../../src/platform/postgres-pool.mjs';
import { adaptWeComSdkFrame } from '../../src/p1-002-wecom-sdk-adapter.mjs';
import { createChannelMessageInbox } from '../../src/p1-003-channel-message-inbox.mjs';
import { formatEpochMsToShanghaiLocal } from '../../src/platform/time-contract.mjs';

const [mode, msgId] = process.argv.slice(2);
if (!['first', 'replay'].includes(mode) || !/^p1-003-restart-[a-f0-9-]{36}$/.test(msgId ?? '')) {
  process.exitCode = 2;
} else {
  const adapted = adaptWeComSdkFrame({
    cmd: 'aibot_msg_callback',
    headers: { req_id: `req-${mode}-${msgId}` },
    body: {
      msgid: msgId,
      aibotid: 'bot-p1-003-restart-test',
      chattype: 'single',
      from: { userid: 'user-p1-003-restart-test' },
      msgtype: 'text',
      text: { content: 'Process restart persistence test' },
    },
  }, { receivedAt: new Date().toISOString() });

  const pool = createPostgresPool({
    connectionString: process.env.PILOT_DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 2_000,
  });
  try {
    const inbox = createChannelMessageInbox({ pool });
    const retentionUntilEpochMs = String(Date.now() + 7 * 24 * 60 * 60 * 1_000);
    const response = await inbox.accept({
      message: adapted.message,
      traceId: `trace-${mode}-${msgId}`,
      privacyClass: 'INTERNAL',
      retentionUntil: formatEpochMsToShanghaiLocal(retentionUntilEpochMs),
      retentionUntilEpochMs,
    }, async () => ({
      receipt_id: mode === 'first' ? `receipt-${msgId}` : 'must-not-run-after-restart',
    }));
    process.stdout.write(JSON.stringify(response));
  } finally {
    await pool.end();
  }
}
