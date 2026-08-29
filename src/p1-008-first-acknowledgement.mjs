function validNow(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError('now must return a valid Date.');
  }
  return value;
}

function acknowledgementMetrics(committedAt, completedAt) {
  return {
    first_ack_delivery_latency_ms: completedAt.getTime() - committedAt.getTime(),
  };
}

function ticketCreatedReply(ticket) {
  return {
    template_code: 'TICKET_CREATED',
    ticket_no: ticket.ticket_no,
    external_status: ticket.external_status,
  };
}

function ticketCreatedPendingReply(ticket) {
  return {
    template_code: 'TICKET_CREATED_DELIVERY_PENDING',
    ticket_no: ticket.ticket_no,
    external_status: ticket.external_status,
    temporary: true,
  };
}

export function createFirstAcknowledgementService({
  inbox,
  processor,
  deliveryWorker,
  now = () => new Date(),
} = {}) {
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
    accept: async (request) => {
      const accepted = await inbox.accept(request, processor);
      if (!accepted.ok) {
        return accepted;
      }
      const committedAt = validNow(now);
      const ticket = accepted.result?.ticket ?? null;
      if (ticket === null) {
        return {
          ...accepted,
          acknowledgement: { state: 'NO_TICKET' },
          reply: null,
          metrics: { first_ack_delivery_latency_ms: null },
        };
      }
      const deliveryIds = accepted.result?.lifecycle?.delivery_ids;
      if (!Array.isArray(deliveryIds) || deliveryIds.length === 0) {
        return {
          ...accepted,
          acknowledgement: { state: 'PENDING', reason: 'ACK_DELIVERY_NOT_ENQUEUED' },
          reply: ticketCreatedPendingReply(ticket),
          metrics: { first_ack_delivery_latency_ms: null },
        };
      }
      const delivery = await deliveryWorker.deliver({ deliveryId: deliveryIds[0] });
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
        ? await deliveryWorker.getDelivery({ deliveryId: deliveryIds[0] })
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
          delivery_id: existing?.id ?? deliveryIds[0],
          error_code: existing?.last_error_code ?? null,
        },
        reply: ticketCreatedPendingReply(ticket),
        metrics: acknowledgementMetrics(committedAt, completedAt),
      };
    },
  });
}
