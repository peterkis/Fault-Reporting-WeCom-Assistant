import type { createChannelMessageInbox } from './p1-003-channel-message-inbox.mjs';
import type { NotificationDeliveryWorker } from './p1-007-notification-outbox.mjs';

type Inbox = ReturnType<typeof createChannelMessageInbox>;
type InboxResult = Awaited<ReturnType<Inbox['accept']>>;
type InboxSuccess = Extract<InboxResult, { ok: true }>;
export interface FirstAcknowledgementOptions {
  inbox: { accept: (...args: Parameters<Inbox['accept']>) => ReturnType<Inbox['accept']> };
  processor: Parameters<Inbox['accept']>[1];
  deliveryWorker: {
    deliver: (...args: Parameters<NotificationDeliveryWorker['deliver']>) => ReturnType<NotificationDeliveryWorker['deliver']>;
    getDelivery?: (...args: Parameters<NotificationDeliveryWorker['getDelivery']>) => ReturnType<NotificationDeliveryWorker['getDelivery']>;
  };
  now?: () => Date;
}
interface TicketReplyFields { ticket_no: unknown; external_status: unknown }
// A consumed view of the internal JSON snapshot, not a replacement Inbox domain contract.
// Snapshot fields stay unknown until an existing consumer guard validates them.
interface AcknowledgementSnapshot { ticket?: TicketReplyFields | null; lifecycle?: { delivery_ids?: unknown } | null }
type TicketReply = TicketReplyFields & { template_code: 'TICKET_CREATED' };
type PendingReply = TicketReplyFields & { template_code: 'TICKET_CREATED_DELIVERY_PENDING'; temporary: true };
export type FirstAcknowledgementResult = Exclude<InboxResult, InboxSuccess> | (InboxSuccess & (
  | { acknowledgement: { state: 'NO_TICKET' }; reply: null; metrics: { first_ack_delivery_latency_ms: null } }
  | { acknowledgement: { state: 'PENDING'; reason: 'ACK_DELIVERY_NOT_ENQUEUED' }; reply: PendingReply; metrics: { first_ack_delivery_latency_ms: null } }
  | { acknowledgement: { state: 'SENT'; delivery_id: string }; reply: TicketReply; metrics: { first_ack_delivery_latency_ms: number } }
  | { acknowledgement: { state: 'ALREADY_DELIVERED'; delivery_id: string }; reply: null; metrics: { first_ack_delivery_latency_ms: number } }
  | { acknowledgement: { state: 'PENDING'; delivery_id: unknown; error_code: string | null }; reply: PendingReply; metrics: { first_ack_delivery_latency_ms: number } }
));
export interface FirstAcknowledgementService { accept(request: unknown): Promise<FirstAcknowledgementResult> }

function validNow(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError('now must return a valid Date.');
  }
  return value;
}

function acknowledgementMetrics(committedAt: Date, completedAt: Date): { first_ack_delivery_latency_ms: number } {
  return {
    first_ack_delivery_latency_ms: completedAt.getTime() - committedAt.getTime(),
  };
}

function ticketCreatedReply(ticket: TicketReplyFields): TicketReply {
  return {
    template_code: 'TICKET_CREATED',
    ticket_no: ticket.ticket_no,
    external_status: ticket.external_status,
  };
}

function ticketCreatedPendingReply(ticket: TicketReplyFields): PendingReply {
  return {
    template_code: 'TICKET_CREATED_DELIVERY_PENDING',
    ticket_no: ticket.ticket_no,
    external_status: ticket.external_status,
    temporary: true,
  };
}

export function createFirstAcknowledgementService(options: FirstAcknowledgementOptions): FirstAcknowledgementService;
export function createFirstAcknowledgementService({
  inbox,
  processor,
  deliveryWorker,
  now = () => new Date(),
}: Partial<FirstAcknowledgementOptions> = {}): FirstAcknowledgementService {
  if (!inbox || typeof inbox.accept !== 'function') {
    throw new TypeError('A Channel Message Inbox is required.');
  }
  if (typeof processor !== 'function') {
    throw new TypeError('A persisted Intake processor is required.');
  }
  if (!deliveryWorker || typeof deliveryWorker.deliver !== 'function') {
    throw new TypeError('A notification delivery worker is required.');
  }

  return Object.freeze({
    accept: async (request: unknown): Promise<FirstAcknowledgementResult> => {
      const accepted = await inbox.accept(request, processor);
      if (!accepted.ok) {
        return accepted;
      }
      const committedAt = validNow(now);
      const ticket = (accepted.result as AcknowledgementSnapshot)?.ticket ?? null;
      if (ticket === null) {
        return {
          ...accepted,
          acknowledgement: { state: 'NO_TICKET' },
          reply: null,
          metrics: { first_ack_delivery_latency_ms: null },
        };
      }
      const deliveryIds: unknown = (accepted.result as AcknowledgementSnapshot)?.lifecycle?.delivery_ids;
      if (!Array.isArray(deliveryIds) || deliveryIds.length === 0) {
        return {
          ...accepted,
          acknowledgement: { state: 'PENDING', reason: 'ACK_DELIVERY_NOT_ENQUEUED' },
          reply: ticketCreatedPendingReply(ticket),
          metrics: { first_ack_delivery_latency_ms: null },
        };
      }
      const delivery = await deliveryWorker.deliver({ deliveryId: (deliveryIds as readonly unknown[])[0] });
      const completedAt = validNow(now);
      if (delivery?.status === 'SENT') {
        return {
          ...accepted,
          acknowledgement: { state: 'SENT', delivery_id: delivery.id },
          reply: ticketCreatedReply(ticket),
          metrics: acknowledgementMetrics(committedAt, completedAt),
        };
      }
      const existing = delivery === null && typeof deliveryWorker.getDelivery === 'function'
        ? await deliveryWorker.getDelivery({ deliveryId: (deliveryIds as readonly unknown[])[0] })
        : delivery;
      if (existing?.status === 'SENT') {
        return {
          ...accepted,
          acknowledgement: { state: 'ALREADY_DELIVERED', delivery_id: existing.id },
          reply: null,
          metrics: acknowledgementMetrics(committedAt, completedAt),
        };
      }
      return {
        ...accepted,
        acknowledgement: {
          state: 'PENDING',
          delivery_id: existing?.id ?? (deliveryIds as readonly unknown[])[0],
          error_code: existing?.last_error_code ?? null,
        },
        reply: ticketCreatedPendingReply(ticket),
        metrics: acknowledgementMetrics(committedAt, completedAt),
      };
    },
  });
}
