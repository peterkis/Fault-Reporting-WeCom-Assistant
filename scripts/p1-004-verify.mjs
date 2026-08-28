import { Pool } from 'pg';

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
  const pool = new Pool({
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
    const expectedInventory = {
      channel_inbox: 'channel.message_inbox',
      service_intake: 'intake.service_intake',
      intake_message: 'intake.service_intake_message',
      intake_event: 'intake.service_intake_event',
      pilot_ticket_schema_exists: false,
    };
    const expectedResidue = {
      channel_messages: 0,
      intakes: 0,
      message_relations: 0,
      events: 0,
    };
    const result = {
      ok: JSON.stringify(inventory.rows[0]) === JSON.stringify(expectedInventory)
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
