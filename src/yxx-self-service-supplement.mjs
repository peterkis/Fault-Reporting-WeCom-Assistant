function invalidConfiguration() {
  const error = new Error('YXX_SUPPLEMENT_CONFIG_INVALID');
  error.code = 'YXX_SUPPLEMENT_CONFIG_INVALID';
  return error;
}

/**
 * Fixed supplement boundary for the Web self-service surface.
 * Authentication, scope, CSRF, quota, idempotency and the database transaction
 * remain owned by the existing member command context; this adapter prevents
 * a supplement page from widening that command back into an initial submit.
 */
export function createYxxSelfServiceSupplement({ command } = {}) {
  if (!command || typeof command.accept !== 'function' || typeof command.acceptInTransaction !== 'function') {
    throw invalidConfiguration();
  }
  return Object.freeze({
    accept: ({ request, input, requestRef } = {}) => command.accept({
      request, input, requestRef, kind: 'SUPPLEMENT',
    }),
    acceptInTransaction: ({ request, input, requestRef, transaction } = {}) => command.acceptInTransaction({
      request, input, requestRef, transaction, kind: 'SUPPLEMENT',
    }),
  });
}
