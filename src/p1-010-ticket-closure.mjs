import { readFile } from 'node:fs/promises';
import { arch005MigrationApplied } from './platform/legacy-migration-guard.mjs';
import {
  createPilotTicketProcessor,
  publicPilotTicket,
} from './p1-005-pilot-ticket-core.mjs';
import { appendTicketEvent } from './p1-006-ticket-state-actions.mjs';
import { addEpochMilliseconds, formatEpochMsToShanghaiLocal } from './platform/time-contract.mjs';

const MIGRATION_URL = new URL('../database/migrations/007_p1_010_ticket_closure.sql', import.meta.url);
const REVIEW_HARDENING_MIGRATION_URL = new URL(
  '../database/migrations/008_p1_010_review_hardening.sql',
  import.meta.url,
);
const CARD_TO_ACTION = Object.freeze({
  confirm_resolved: 'confirm',
  still_broken: 'reopen',
});

class CardActionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function nonEmpty(value, code, maximum) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new CardActionError(code);
  }
  return value;
}

function validNow(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError('now must return a valid Date.');
  }
  const epochMs = String(value.getTime());
  return Object.freeze({ epoch_ms: epochMs, local_datetime: formatEpochMsToShanghaiLocal(epochMs) });
}

function cardError(code) {
  return { ok: false, error: { code, retryable: false } };
}

function ticketFields(prefix = 'ticket') {
  return `${prefix}.id::text AS id,
          ${prefix}.ticket_no,
          ${prefix}.source_intake_id::text AS source_intake_id,
          ${prefix}.title,
          ${prefix}.request_type,
          ${prefix}.status,
          ${prefix}.priority,
          ${prefix}.resolver_team_id,
          ${prefix}.assignee_id::text AS assignee_id,
          ${prefix}.external_result,
          ${prefix}.closure_reason,
          ${prefix}.created_at,
          ${prefix}.updated_at,
          ${prefix}.version,
          ${prefix}.auto_close_at,
          ${prefix}.auto_close_reminder_at`;
}

async function withTransaction(pool, operation) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
  const client = await pool.connect();
  let destroyClient = false;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      destroyClient = true;
    }
    throw error;
  } finally {
    client.release(destroyClient);
  }
}

async function reporterForTicket(transaction, ticket) {
  const reporter = await transaction.query(
    `SELECT reporter_wecom_userid
       FROM intake.service_intake
      WHERE id = $1::uuid`,
    [ticket.intake_id],
  );
  if (reporter.rowCount !== 1) {
    throw new Error('TICKET_INTAKE_NOT_FOUND');
  }
  return reporter.rows[0].reporter_wecom_userid;
}

export async function applyTicketClosureMigration({ pool }) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
  if (await arch005MigrationApplied(pool)) return Object.freeze({ status: 'LEGACY_MIGRATION_SUPERSEDED' });
  const sql = await readFile(MIGRATION_URL, 'utf8');
  await pool.query(sql);
  const reviewHardeningSql = await readFile(REVIEW_HARDENING_MIGRATION_URL, 'utf8');
  await pool.query(reviewHardeningSql);
}

export function createTicketClosureService({
  pool,
  outbox = null,
  resolveReporterActor,
  now = () => new Date(),
  cardTtlMs = 48 * 60 * 60 * 1_000,
  autoCloseAfterMs = 48 * 60 * 60 * 1_000,
  autoCloseReminderLeadMs = 4 * 60 * 60 * 1_000,
  beforeTransaction = null,
} = {}) {
  if(beforeTransaction!==null&&typeof beforeTransaction!=='function')throw new TypeError('beforeTransaction must be a function when supplied.');
  const transact=operation=>withTransaction(pool,async transaction=>{if(beforeTransaction)await beforeTransaction(transaction);return operation(transaction);});
  if (outbox !== null && typeof outbox.enqueueTicketEvent !== 'function') {
    throw new TypeError('outbox must expose enqueueTicketEvent when supplied.');
  }
  if (typeof resolveReporterActor !== 'function') {
    throw new TypeError('A Pilot reporter resolver is required.');
  }
  for (const [name, value] of Object.entries({
    cardTtlMs,
    autoCloseAfterMs,
    autoCloseReminderLeadMs,
  })) {
    if (!Number.isInteger(value) || value < 1) {
      throw new TypeError(`${name} must be a positive integer.`);
    }
  }
  if (autoCloseReminderLeadMs >= autoCloseAfterMs) {
    throw new TypeError('autoCloseReminderLeadMs must be shorter than autoCloseAfterMs.');
  }
  if (cardTtlMs < 1_000) {
    throw new TypeError('cardTtlMs must be at least one second.');
  }

  async function createCardTasks({ transaction, ticket, event, action }) {
    const cardActions = action === 'resolve'
      ? ['confirm_resolved', 'still_broken']
      : action === 'request-information'
        ? ['add_information']
        : [];
    if (cardActions.length === 0) {
      return [];
    }
    const reporterWeComUserId = await reporterForTicket(transaction, ticket);
    const createdAt = validNow(now);
    const expiresEpochMs = addEpochMilliseconds(createdAt.epoch_ms, cardTtlMs);
    const expiresAt = formatEpochMsToShanghaiLocal(expiresEpochMs);
    const tasks = [];
    for (const actionKey of cardActions) {
      const created = await transaction.query(
        `INSERT INTO notification.card_action_task (
            ticket_id, ticket_event_id, action_key, actor_wecom_user_id,
            expected_version, expires_at, expires_epoch_ms, created_at
         ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::timestamp without time zone, $7::bigint, $8::timestamp without time zone)
         ON CONFLICT (ticket_event_id, action_key, actor_wecom_user_id)
         DO UPDATE SET task_id = notification.card_action_task.task_id
         RETURNING task_id::text, action_key, expires_at`,
        [
          ticket.id,
          event.event_id,
          actionKey,
          reporterWeComUserId,
          ticket.version,
          expiresAt,
          expiresEpochMs,
          createdAt.local_datetime,
        ],
      );
      tasks.push({
        task_id: created.rows[0].task_id,
        action_key: created.rows[0].action_key,
        expires_at: created.rows[0].expires_at,
      });
    }
    return tasks;
  }

  async function setAutoCloseDeadline({ transaction, ticket, action }) {
    if (action === 'resolve') {
      await transaction.query(
        `UPDATE pilot_ticket.ticket
            SET auto_close_epoch_ms = $2::bigint,
                auto_close_reminder_at = NULL,
                auto_close_reminder_epoch_ms = NULL
          WHERE id = $1::uuid`,
        [ticket.id, addEpochMilliseconds(validNow(now).epoch_ms, autoCloseAfterMs)],
      );
      return;
    }
    if (['confirm', 'reopen', 'auto-close'].includes(action)) {
      await transaction.query(
        `UPDATE pilot_ticket.ticket
            SET auto_close_at = NULL,
                auto_close_epoch_ms = NULL,
                auto_close_reminder_at = NULL,
                auto_close_reminder_epoch_ms = NULL
          WHERE id = $1::uuid`,
        [ticket.id],
      );
    }
  }

  async function afterTicketAction({ transaction, ticket, event, action }) {
    const cardTasks = await createCardTasks({ transaction, ticket, event, action });
    await setAutoCloseDeadline({ transaction, ticket, action });
    const notification = outbox
      ? await outbox.enqueueTicketEvent({ transaction, ticket, event, cardTasks })
      : null;
    return { card_tasks: cardTasks, notification };
  }

  async function recordSupplement({
    transaction,
    ticket,
    intake,
    message,
    channelMessageId,
    traceId,
  }) {
    if (message.sender_user_id !== intake.reporter_wecom_userid) {
      throw new CardActionError('SUPPLEMENT_REPORTER_MISMATCH');
    }
    const current = await transaction.query(
      `SELECT ${ticketFields()}
         FROM pilot_ticket.ticket AS ticket
        WHERE ticket.id = $1::uuid
        FOR UPDATE`,
      [ticket.id],
    );
    if (current.rowCount !== 1) {
      throw new CardActionError('TICKET_NOT_FOUND');
    }
    if (current.rows[0].source_intake_id !== intake.id) {
      throw new CardActionError('SUPPLEMENT_INTAKE_MISMATCH');
    }
    const registered = await transaction.query(
      `INSERT INTO pilot_ticket.ticket_supplement (
          ticket_id, channel_message_id, reporter_wecom_user_id
       ) VALUES ($1::uuid, $2::bigint, $3)
       ON CONFLICT (channel_message_id) DO NOTHING
       RETURNING ticket_id::text`,
      [ticket.id, channelMessageId, message.sender_user_id],
    );
    const existingTicket = publicPilotTicket(current.rows[0]);
    if (registered.rowCount === 0) {
      return { ticket: existingTicket, event: null, side_effects: null };
    }
    const nextStatus = existingTicket.status === 'WAITING_REQUESTER'
      ? 'IN_PROGRESS'
      : existingTicket.status;
    const updated = await transaction.query(
      `UPDATE pilot_ticket.ticket
          SET status = $2,
              version = version + 1,
              updated_at = date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai')
        WHERE id = $1::uuid
        RETURNING ${ticketFields('pilot_ticket.ticket')}`,
      [ticket.id, nextStatus],
    );
    const nextTicket = publicPilotTicket(updated.rows[0]);
    const event = await appendTicketEvent({
      transaction,
      ticket: nextTicket,
      eventType: 'ticket.information_added',
      oldStatus: existingTicket.status,
      newStatus: nextStatus,
      actor: { type: 'REPORTER', id: message.sender_user_id },
      traceId,
    });
    const sideEffects = await afterTicketAction({
      transaction,
      ticket: nextTicket,
      event,
      action: 'add-information',
    });
    return { ticket: nextTicket, event, side_effects: sideEffects };
  }

  async function handleCardAction({
    taskId,
    actionKey,
    actorWecomUserId,
    eventReqId,
    traceId,
    actionService,
  }) {
    try {
      nonEmpty(taskId, 'VALIDATION_FAILED', 64);
      nonEmpty(actionKey, 'VALIDATION_FAILED', 64);
      nonEmpty(actorWecomUserId, 'VALIDATION_FAILED', 256);
      nonEmpty(eventReqId, 'VALIDATION_FAILED', 256);
      nonEmpty(traceId, 'VALIDATION_FAILED', 128);
      if (!actionService || typeof actionService.performInTransaction !== 'function') {
        throw new TypeError('A Ticket Action service is required.');
      }
      return await transact(async (transaction) => {
        const task = await transaction.query(
          `SELECT task_id::text, ticket_id::text, action_key, actor_wecom_user_id,
                   expected_version, expires_at, expires_epoch_ms::text, consumed_at
             FROM notification.card_action_task
            WHERE task_id = $1::uuid
            FOR UPDATE`,
          [taskId],
        );
        if (task.rowCount !== 1) {
          return cardError('CARD_ACTION_NOT_FOUND');
        }
        const receipt = await transaction.query(
          `SELECT response_snapshot
             FROM notification.card_action_receipt
            WHERE task_id = $1::uuid AND event_req_id = $2`,
          [taskId, eventReqId],
        );
        if (receipt.rowCount === 1) {
          return { ...receipt.rows[0].response_snapshot, duplicate: true };
        }
        const current = task.rows[0];
        if (current.action_key !== actionKey) {
          return cardError('CARD_ACTION_INVALID');
        }
        if (current.actor_wecom_user_id !== actorWecomUserId) {
          return cardError('CARD_ACTION_FORBIDDEN');
        }
        if (BigInt(current.expires_epoch_ms) < BigInt(validNow(now).epoch_ms)) {
          return cardError('CARD_ACTION_EXPIRED');
        }
        if (current.consumed_at !== null) {
          return cardError('CARD_ACTION_CONSUMED');
        }
        if (actionKey === 'add_information') {
          const response = { ok: true, update_card: { state: 'WAITING_INFORMATION' } };
          await transaction.query(
            `UPDATE notification.card_action_task
                SET consumed_at = $2::timestamp without time zone
              WHERE task_id = $1::uuid`,
            [taskId, validNow(now).local_datetime],
          );
          await transaction.query(
            `INSERT INTO notification.card_action_receipt (task_id, event_req_id, response_snapshot)
             VALUES ($1::uuid, $2, $3::jsonb)`,
            [taskId, eventReqId, JSON.stringify(response)],
          );
          return response;
        }
        const actor = await resolveReporterActor({ wecomUserId: actorWecomUserId });
        if (actor === null) {
          return cardError('CARD_ACTION_FORBIDDEN');
        }
        const result = await actionService.performInTransaction({
          ticketId: current.ticket_id,
          action: CARD_TO_ACTION[actionKey],
          actor,
          expectedVersion: current.expected_version,
          traceId,
        }, transaction);
        await transaction.query(
          `UPDATE notification.card_action_task
              SET consumed_at = $2::timestamp without time zone
            WHERE task_id = $1::uuid`,
          [taskId, validNow(now).local_datetime],
        );
        await transaction.query(
          `INSERT INTO notification.card_action_receipt (task_id, event_req_id, response_snapshot)
           VALUES ($1::uuid, $2, $3::jsonb)`,
          [taskId, eventReqId, JSON.stringify(result)],
        );
        return result;
      });
    } catch (error) {
      if (error instanceof CardActionError) {
        return cardError(error.code);
      }
      if (typeof error?.code === 'string') {
        return cardError(error.code);
      }
      throw error;
    }
  }

  async function runAutoClose({ actionService, limit = 50 } = {}) {
    if (!actionService || typeof actionService.performInTransaction !== 'function') {
      throw new TypeError('A Ticket Action service is required.');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('limit must be an integer from 1 through 100.');
    }
    const closingAt = validNow(now);
    return transact(async (transaction) => {
      const selected = await transaction.query(
        `SELECT id::text, version
           FROM pilot_ticket.ticket
          WHERE status = 'RESOLVED'
             AND auto_close_epoch_ms IS NOT NULL
             AND auto_close_epoch_ms <= $1::bigint
             AND auto_close_reminder_epoch_ms IS NOT NULL
           ORDER BY auto_close_epoch_ms, id
          FOR UPDATE SKIP LOCKED
          LIMIT $2`,
        [closingAt.epoch_ms, limit],
      );
      const closedTicketIds = [];
      for (const ticket of selected.rows) {
        const result = await actionService.performInTransaction({
          ticketId: ticket.id,
          action: 'auto-close',
          actor: { type: 'SYSTEM', id: null },
          expectedVersion: ticket.version,
          traceId: `auto-close:${ticket.id}:${ticket.version}`,
        }, transaction);
        if (result.ok) {
          closedTicketIds.push(ticket.id);
        }
      }
      return { closed_ticket_ids: closedTicketIds };
    });
  }

  return Object.freeze({
    afterTicketAction,
    handleCardAction,
    recordSupplement,
    runAutoCloseReminders: async ({ limit = 50 } = {}) => {
      if (!outbox) {
        throw new TypeError('A notification outbox is required for auto-close reminders.');
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new TypeError('limit must be an integer from 1 through 100.');
      }
      const reminderAt = validNow(now);
      const reminderDeadline = addEpochMilliseconds(reminderAt.epoch_ms, autoCloseReminderLeadMs);
      return transact(async (transaction) => {
        const selected = await transaction.query(
          `SELECT ${ticketFields()}
             FROM pilot_ticket.ticket AS ticket
            WHERE ticket.status = 'RESOLVED'
               AND ticket.auto_close_epoch_ms IS NOT NULL
               AND ticket.auto_close_epoch_ms > $1::bigint
               AND ticket.auto_close_epoch_ms <= $2::bigint
               AND ticket.auto_close_reminder_epoch_ms IS NULL
             ORDER BY ticket.auto_close_epoch_ms, ticket.id
            FOR UPDATE SKIP LOCKED
            LIMIT $3`,
          [reminderAt.epoch_ms, reminderDeadline, limit],
        );
        const remindedTicketIds = [];
        for (const row of selected.rows) {
          const marked = await transaction.query(
            `UPDATE pilot_ticket.ticket
                SET auto_close_reminder_epoch_ms = $2::bigint
              WHERE id = $1::uuid
                AND auto_close_reminder_at IS NULL
              RETURNING ${ticketFields('pilot_ticket.ticket')}`,
            [row.id, reminderAt.epoch_ms],
          );
          if (marked.rowCount !== 1) {
            continue;
          }
          const ticket = publicPilotTicket(marked.rows[0]);
          const event = await appendTicketEvent({
            transaction,
            ticket,
            eventType: 'ticket.auto_close_reminder',
            oldStatus: 'RESOLVED',
            newStatus: 'RESOLVED',
            actor: { type: 'SYSTEM', id: null },
            traceId: `auto-close-reminder:${ticket.id}:${ticket.version}`,
          });
          await afterTicketAction({
            transaction,
            ticket,
            event,
            action: 'auto-close-reminder',
          });
          remindedTicketIds.push(ticket.id);
        }
        return { reminded_ticket_ids: remindedTicketIds };
      });
    },
    runAutoClose,
  });
}

export function createTicketLifecycleProcessor({
  serviceIntakeProcessor,
  ticketCore,
  closure,
} = {}) {
  if (!closure || typeof closure.afterTicketAction !== 'function' || typeof closure.recordSupplement !== 'function') {
    throw new TypeError('A Ticket closure service is required.');
  }
  const ticketProcessor = createPilotTicketProcessor({
    serviceIntakeProcessor,
    ticketCore,
    onTicketCreated: async ({ transaction, ticket, message }) => {
      const event = await appendTicketEvent({
        transaction,
        ticket,
        eventType: 'ticket.created',
        actor: { type: 'SYSTEM', id: null },
        traceId: `ticket-created:${message.idempotency_key}`,
      });
      const sideEffects = await closure.afterTicketAction({
        transaction,
        ticket,
        event,
        action: 'create',
      });
      return {
        created: true,
        ticket_event: event,
        ...sideEffects,
        delivery_ids: sideEffects.notification?.delivery_ids ?? [],
      };
    },
  });
  return async function processTicketLifecycle(input) {
    const result = await ticketProcessor(input);
    if (
      result.ticket === null
      || result.lifecycle?.created === true
      || !['SUPPLEMENT', 'CLARIFICATION'].includes(result.message.relation_type)
    ) {
      return result;
    }
    const supplement = await closure.recordSupplement({
      transaction: input.transaction,
      ticket: result.ticket,
      intake: result.intake,
      message: input.message,
      channelMessageId: input.channelMessageId,
      traceId: `ticket-supplement:${input.message.idempotency_key}`,
    });
    return supplement.event === null
      ? result
      : {
        ...result,
        ticket: supplement.ticket,
        ticket_event: supplement.event,
        ticket_side_effects: supplement.side_effects,
      };
  };
}
