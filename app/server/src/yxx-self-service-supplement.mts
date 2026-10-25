import type {YxxSelfServiceCommand,YxxHttpCommandInput} from './yxx-self-service-command.mjs';
import type {PostgresTransaction} from './platform/postgres-pool.mjs';
function invalidConfiguration() {
  const error = new Error('YXX_SUPPLEMENT_CONFIG_INVALID') as Error & {code:string};
  error.code = 'YXX_SUPPLEMENT_CONFIG_INVALID';
  return error;
}

/**
 * Fixed supplement boundary for the Web self-service surface.
 * Authentication, scope, CSRF, quota, idempotency and the database transaction
 * remain owned by the existing member command context; this adapter prevents
 * a supplement page from widening that command back into an initial submit.
 */
export function createYxxSelfServiceSupplement({ command }:{command:YxxSelfServiceCommand}={} as {command:YxxSelfServiceCommand}) {
  if (!command || typeof command.accept !== 'function' || typeof command.acceptInTransaction !== 'function') {
    throw invalidConfiguration();
  }
  return Object.freeze({
    accept: ({ request, input, requestRef }:Omit<YxxHttpCommandInput,'kind'>={} as Omit<YxxHttpCommandInput,'kind'>) => command.accept({
      request, input, requestRef, kind: 'SUPPLEMENT',
    }),
    acceptInTransaction: ({ request, input, requestRef, transaction }:Omit<YxxHttpCommandInput,'kind'> & {transaction:PostgresTransaction}={} as Omit<YxxHttpCommandInput,'kind'> & {transaction:PostgresTransaction}) => command.acceptInTransaction({
      request, input, requestRef, transaction, kind: 'SUPPLEMENT',
    }),
  });
}
