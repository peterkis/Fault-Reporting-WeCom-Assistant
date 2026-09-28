# T03 blocking baseline defect: Pool callback query guard

This is a separately authorized behavior fix, not the four-module TypeScript migration.
Base: PR #27 merge `16312fd6cc9149f89f6cad866da5e3cf7b3ba023`.

On both the authentic T02 checkout and this base, a fresh `pool.connect(callback)` client accepts a Date query parameter and sends SQL. Promise acquisition rejects it synchronously with `POSTGRES_DATE_PARAMETER_FORBIDDEN`. The callback client bypasses the shared guard because the previous wrapper guards only the return from `connect()`.

The fix guards the client before forwarding the original callback, preserving callback receiver, argument count/order, error identity, release function, and the existing async wrapper return form. It does not redesign `Client.connect`, change query signatures, rename production files, or upgrade PG. This does not claim complete native callback-return compatibility: the existing pool wrapper still returns a Promise on callback calls.

Support files are limited to the new compiled `.mts` regression, its explicit staged-runtime route/selection, the existing batch supplement, the registry-count test, and these progress/receipt documents. Original entries and 72 aliases remain. The new regression runs in the full 180-file batch; it is not a skip-capable test and requires isolated PG18. Its real PG cases verify synchronous rejection, valid Promise/config/callback queries, callback count, release and same-client transaction use. External Pool-boundary doubles verify receiver/argument forwarding and connection-error behavior.

## Validation and state

- Authentic T02 and current-base observation: identical Date guard bypass on fresh callback clients.
- Compiled regression before fix: expected failure, missing synchronous exception; failed-query cleanup retained.
- After the seven-line production fix: targeted four-case regression passes with real PG18 and external Pool-boundary probes.
- Full batch, Windows/Ubuntu tools, exact published-head CI and external review must be read from the current PR artifacts. This document does not certify those future results.

Raw local records: `D:/Agent-Prompts/T03_Implementation_20260928/logs`; original failed attempts are retained. No SQL, frozen Evidence, dependency lock, business Schema or Feature Flag changes. No production services or Provider calls. Pool max remains 1 in the targeted database tests, all acquired clients are released and their disconnections awaited.

Rollback: dedicated revert PR for this fix and associated test registration. No database rollback. Stop after this PR is validated; obtain separate merge authorization before resuming T03-01. No deployment or T04 work.
