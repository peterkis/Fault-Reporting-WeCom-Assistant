# Workbench authentication review fixes — 2026-09-22

Base: `627d5f72959b4b2a085d734c311712363f87a3f8`. User authorized fixes, commit, push, PR creation and a remote `@codex review` request; confirmed the HTTP, PostgreSQL callback/audit and browser recovery test boundaries.

## Reproduction and correction

| Finding | Observed RED | Correction / GREEN |
| --- | --- | --- |
| Ticket delivery gate ignored | Actual Ticket retry HTTP returned 200 with external sending disabled | Ticket retry and reconcile now return 403 / WORKBENCH_EXTERNAL_SEND_DISABLED before executing a receipt; original explicitly enabled delivery tests still pass |
| Unknown command could be forgotten | After an accepted POST timed out, clearing the pending record re-enabled submission | Removed the discard action; original command UUID persists and new submission stays disabled while GET-only recovery remains available |
| Busy OAuth consumed another login intent | Second callback returned 502 / WORKBENCH_AUTH_FAILED | Reserve callback execution before consuming state; return retryable 503 while busy, including a provider still running after timeout; retry then succeeds without replaying a consumed code |
| Identity audit lacked keyed pseudonyms | Changing the supplied audit key did not change newly written identity hashes | HMAC-SHA256 with required identity key and corp/app/purpose binding; same key is stable, another key changes the pseudonym |
| Anonymous writes / expired technical records unbounded | Fourth login exceeded test budget but still wrote records; 206 intent rows remained instead of expected 6 after a 200-row sweep | Separate global start/callback budgets (30 per minute each); serial minute maintenance, maximum 200 rows per table, 30-day audit retention, live sessions/recent audit retained |
| Deployment documentation stale | Runbook/index claimed cloud migration had not occurred | Link the actual 2026-09-22 deployment evidence and distinguish that deployed version from subsequent fixes |

The earlier review's claim that the saved identifier was necessarily a low-entropy plaintext userid was too broad: the implementation records the converted open_userid. HMAC is defense in depth and aligns new audit pseudonyms with the configured identity key. Historical hashes are not rewritten.

## Validation

- Auth unit + real PostgreSQL auth, HTTP assembly and delivery integration: **10/10 PASS**. Command: `node --env-file=.env.pilot --test --test-concurrency=1 tests/p2-016-workbench-wecom-auth.test.mjs tests/p2-016-workbench-auth.integration.test.mjs tests/p2-016-workbench-http.integration.test.mjs tests/p2-016-delivery-control.integration.test.mjs`.
- Existing OAuth / member-homepage / base workbench / human-only assembly regression: **53/53 PASS** across seven files.
- Unknown accepted POST browser regression: **PASS**, both new-report and supplement surfaces.
- Full native UI browser file: **47/48 PASS** before correcting one inherited timing assertion. It asserted immediate concealment despite the preceding commit's 250ms anti-flicker delay. The test now waits for actual concealment while holding the response, then verifies cross-member data clearing. Targeted rerun: **1/1 PASS**. No claim of a second complete 48-case run.
- Changed JavaScript syntax checks and `git diff --check`: PASS.

## Existing validation blocker

`node scripts/validate-yxx-self-service.mjs` rejects with `YXX_LOCAL_VALIDATION_SCOPE_INVALID` at `src/yxx-self-service-validation-scope.mjs:30`. The SS-008 frozen migration directory does not contain migration 035, already added by the base commit. This fix does not change the migration directory. The existing evidence suites report **32/33 PASS**, with the same scope failure. No historical scope, protected evidence, tested_head or assertion was relaxed to hide it. Required CI may therefore remain blocked pending a separately scoped reconciliation of the newer work with that historical validator.

## Deployment and limits

This is source/isolated-test validation, not a new cloud release or Gate approval. Existing migration 035 and live evidence remain unchanged. The App consumes the existing private `PILOT_LOG_IDENTITY_HASH_KEY`; no credentials were recorded. Limits are per process and restart resets the minute counters. Maintenance deletes only expired authentication technical records according to the documented retention policy; it never deletes business facts. Rollback uses the prior release; disabling external delivery remains independent of Sender/Gateway activation.
