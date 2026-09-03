import { createPostgresPool } from '../src/platform/postgres-pool.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    error: {
      code: 'PILOT_DATABASE_URL_REQUIRED',
      retryable: false,
    },
  })}\n`);
  process.exitCode = 1;
} else {
  const pool = createPostgresPool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 2_000,
  });
  try {
    const version = await pool.query('SHOW server_version');
    const inventory = await pool.query(
      `SELECT to_regclass('channel.message_inbox')::text AS channel_inbox,
              to_regclass('intake.service_intake')::text AS service_intake,
              to_regclass('intake.service_intake_message')::text AS intake_message,
              to_regclass('intake.service_intake_event')::text AS intake_event,
              to_regclass('intake.service_intake_event_ordinal_unique')::text AS event_ordinal_unique,
              (
                  SELECT count(*) = 2
                    FROM information_schema.columns
                   WHERE table_schema = 'intake'
                     AND table_name = 'service_intake'
                     AND column_name IN ('privacy_class', 'retention_until')
              ) AS intake_privacy_boundary_exists,
              (
                  SELECT count(*) = 1
                    FROM information_schema.columns
                   WHERE table_schema = 'intake'
                     AND table_name = 'service_intake_event'
                     AND column_name = 'event_ordinal'
              ) AS event_ordinal_exists,
              (
                  SELECT count(*) = 1
                    FROM information_schema.columns
                   WHERE table_schema = 'intake'
                     AND table_name = 'service_intake'
                     AND column_name = 'explicit_aggregation_boundary'
              ) AS explicit_aggregation_boundary_exists,
              NOT EXISTS (
                  SELECT 1
                    FROM channel.message_inbox AS message_inbox
                   WHERE jsonb_typeof(message_inbox.response_snapshot -> 'intake') = 'object'
                     AND (message_inbox.response_snapshot -> 'intake') ? 'summary'
                     AND message_inbox.response_snapshot #> '{intake,summary}'
                         IS DISTINCT FROM 'null'::jsonb
                     AND (
                         EXISTS (
                             SELECT 1
                               FROM intake.service_intake_message AS relation
                              WHERE relation.channel_message_id = message_inbox.id
                         )
                         OR EXISTS (
                             SELECT 1
                               FROM intake.service_intake AS service_intake
                              WHERE service_intake.primary_message_id = message_inbox.id
                         )
                     )
              ) AS inbox_summary_safe,
              to_regnamespace('pilot_ticket') IS NOT NULL AS pilot_ticket_schema_exists`,
    );
    const residue = await pool.query(
      `SELECT
          (SELECT count(*)::integer
             FROM channel.message_inbox
            WHERE msg_id LIKE 'p1-004-%') AS channel_messages,
          (SELECT count(DISTINCT i.id)::integer
             FROM intake.service_intake AS i
             JOIN intake.service_intake_message AS r ON r.intake_id = i.id
             JOIN channel.message_inbox AS m ON m.id = r.channel_message_id
            WHERE m.msg_id LIKE 'p1-004-%') AS intakes,
          (SELECT count(*)::integer
             FROM intake.service_intake_message AS r
             JOIN channel.message_inbox AS m ON m.id = r.channel_message_id
            WHERE m.msg_id LIKE 'p1-004-%') AS message_relations,
          (SELECT count(DISTINCT e.event_id)::integer
             FROM intake.service_intake_event AS e
             JOIN intake.service_intake_message AS r ON r.intake_id = e.intake_id
             JOIN channel.message_inbox AS m ON m.id = r.channel_message_id
            WHERE m.msg_id LIKE 'p1-004-%') AS events`,
    );
    const expectedCoreInventory = {
      channel_inbox: 'channel.message_inbox',
      service_intake: 'intake.service_intake',
      intake_message: 'intake.service_intake_message',
      intake_event: 'intake.service_intake_event',
      event_ordinal_unique: 'intake.service_intake_event_ordinal_unique',
      intake_privacy_boundary_exists: true,
      event_ordinal_exists: true,
      explicit_aggregation_boundary_exists: true,
      inbox_summary_safe: true,
      pilot_ticket_schema_exists: false,
    };
    const expectedResidue = {
      channel_messages: 0,
      intakes: 0,
      message_relations: 0,
      events: 0,
    };
    const result = {
      ok: Object.entries(expectedCoreInventory).every(
        ([key, value]) => inventory.rows[0][key] === value,
      )
        && JSON.stringify(residue.rows[0]) === JSON.stringify(expectedResidue),
      task: 'P1-004',
      server_version: version.rows[0].server_version,
      inventory: inventory.rows[0],
      p1_004_test_residue: residue.rows[0],
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      error: {
        code: 'P1_004_VERIFICATION_FAILED',
        retryable: true,
      },
    })}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
