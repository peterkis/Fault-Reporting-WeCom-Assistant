# PR #17 bootstrap operation release

Review: https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/17#discussion_r4044386406

Base: `b3660e8543eff1c480c423755957cb785ad9430d`.

The home and new-report bootstrap paths left their operation controller active
when no recovery command existed. Periodic member-session checks then skipped
every interval. Bootstrap now releases its operation in `finally` before
scheduling session revalidation. The existing ownership guard prevents an older
bootstrap from releasing a newer operation.

Two browser regressions exercise the real five-second timer on home and
new-report routes, without visibility events or pending commands. They verify
same-member CSRF rotation preserves the in-memory draft, a shared-cookie member
change clears it, and no business command or command-status recovery is sent.

## Validation record

- `yxx-ss-007-bootstrap-release-v26-red.tap`: old runtime; home failed waiting
  for periodic CSRF refresh. The new-report case failed earlier because direct
  startup navigated before the synthetic cookie was installed; that failure is
  a fixture issue, not additional proof of the runtime defect.
- The fixture now follows the existing suite pattern: establish the synthetic
  session on home, then navigate to the new-report route.
- `yxx-ss-007-bootstrap-release-v26-aborted.tap`: incomplete first aggregate,
  deliberately interrupted to correct that fixture; not acceptance evidence.
- `yxx-ss-007-bootstrap-release-v26-targeted.tap`: corrected regressions, 2/2
  passed, zero failures, skips, cancellations or todo.
- `yxx-ss-007-bootstrap-release-v26-regression.tap`: SS-001 + SS-002 + SS-007,
  **55/55 passed**, zero failures, skips, cancellations or todo; exit code 0.
  Command: `node --test --test-reporter=tap --test-concurrency=1 tests/yxx-ss-001-homepage-oauth.test.mjs tests/yxx-ss-002-contract.test.mjs tests/yxx-ss-007-*.test.mjs`.
- Runtime/test syntax checks and `git diff --check`: passed. No runtime or test
  changes after the final regression. Database suites were not rerun for this
  browser-only repair.

Tested working-tree SHA-256 bindings (before Git line-ending normalization):

- `web/p2-reporter/self-service.js`: `8237bdaaa4023115a4417d46970ab22b64f31df9bb87d444ebc286775d9fce17`
- `tests/yxx-ss-007-native-ui.browser.test.mjs`: `f2a3eff2ce4363c956f874500a4fd4597a8ad56d7a530c44d8949b52334160f7`
- Final regression TAP: `b2a71fb568a1d304463a6ab727e3eeb1d74920fa453e54a813e3d26c0b6f869f`

## Scope

No database, schema, API contract, feature flag or resource-limit change.
Existing five-second interval and one active-operation guard remain in place.
YXX-SS-007 remains `IN_REVIEW`; YXX-SS-008 remains `PLANNED`.
External review of the repaired head is pending; no CI or remote approval is
claimed. Real OAuth/SDK, production database, sends and deployment were not run.
SS-011, P2-G2-LIVE and P2-008 remain outside this repair.
Rollback uses the existing disabled self-service flags; the historical v25
aggregate remains immutable and is not claimed as validation of this repair.
