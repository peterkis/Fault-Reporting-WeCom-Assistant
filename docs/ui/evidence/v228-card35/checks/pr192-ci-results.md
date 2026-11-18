# PR 192 per-entry results (historical candidate)

Committed selection: 77 application entries and 7 tools. Supplement: 13 related entries. All application results use manifest `35173266a62b1981efa311577434ec87186b3550dc5b037e94e4d545d134d9de` and source input `f7340751b16afa7acd7089a6da975da02413612d5e308f6fb3ff2e558648f05a`.

## CI application entries

76/77 entries pass; 546/548 cases pass; 2 fail; 0 skipped; 0 cancelled.

| Entry | Result | Cases | Evidence |
| --- | --- | --- | --- |
| `tests/migration-canary.test.mts` | PASS | 1/1 | [TAP](pr192-ci-001-migration-canary.test.mts.tap) |
| `tests/mvp-application-members.integration.test.mts` | PASS | 1/1 | [TAP](pr192-ci-002-mvp-application-members.integration.test.mts.tap) |
| `tests/mvp-group-replies.integration.test.mts` | PASS | 4/4 | [TAP](pr192-ci-003-mvp-group-replies.integration.test.mts.tap) |
| `tests/mvp-notification-policy.integration.test.mts` | PASS | 8/8 | [TAP](pr192-ci-004-mvp-notification-policy.integration.test.mts.tap) |
| `tests/p2-003-realtime-event-log.integration.test.mjs` | PASS | 11/11 | [TAP](pr192-ci-005-p2-003-realtime-event-log.integration.test.mjs.tap) |
| `tests/p2-007-staff-directory-process-options.test.mjs` | PASS | 4/4 | [TAP](pr192-ci-006-p2-007-staff-directory-process-options.test.mjs.tap) |
| `tests/p2-007-staff-directory-process-role.test.mjs` | PASS | 1/1 | [TAP](pr192-ci-007-p2-007-staff-directory-process-role.test.mjs.tap) |
| `tests/p2-007-staff-directory-sync.test.mjs` | PASS | 3/3 | [TAP](pr192-ci-008-p2-007-staff-directory-sync.test.mjs.tap) |
| `tests/p2-007-staff-directory-worker.test.mjs` | PASS | 1/1 | [TAP](pr192-ci-009-p2-007-staff-directory-worker.test.mjs.tap) |
| `tests/p2-007-third-party-current-profile-query.test.mjs` | PASS | 3/3 | [TAP](pr192-ci-010-p2-007-third-party-current-profile-query.test.mjs.tap) |
| `tests/p2-007-third-party-reporter-directory.test.mjs` | PASS | 17/17 | [TAP](pr192-ci-011-p2-007-third-party-reporter-directory.test.mjs.tap) |
| `tests/p2-007-third-party-staff-directory.integration.test.mjs` | PASS | 6/6 | [TAP](pr192-ci-012-p2-007-third-party-staff-directory.integration.test.mjs.tap) |
| `tests/p2-007-third-party-staff-directory.test.mjs` | PASS | 30/30 | [TAP](pr192-ci-013-p2-007-third-party-staff-directory.test.mjs.tap) |
| `tests/p2-015-contact-journey.test.mjs` | PASS | 2/2 | [TAP](pr192-ci-014-p2-015-contact-journey.test.mjs.tap) |
| `tests/p2-015-manual-review.test.mjs` | PASS | 1/1 | [TAP](pr192-ci-015-p2-015-manual-review.test.mjs.tap) |
| `tests/p2-015-rule-first-orchestration.integration.test.mjs` | PASS | 5/5 | [TAP](pr192-ci-016-p2-015-rule-first-orchestration.integration.test.mjs.tap) |
| `tests/p2-015-rule-first-orchestration.test.mjs` | PASS | 7/7 | [TAP](pr192-ci-017-p2-015-rule-first-orchestration.test.mjs.tap) |
| `tests/p2-015-worker-restart.integration.test.mjs` | PASS | 2/2 | [TAP](pr192-ci-018-p2-015-worker-restart.integration.test.mjs.tap) |
| `tests/p2-015-worker.test.mjs` | PASS | 7/7 | [TAP](pr192-ci-019-p2-015-worker.test.mjs.tap) |
| `tests/p2-016-live-cluster.integration.test.mjs` | PASS | 1/1 | [TAP](pr192-ci-020-p2-016-live-cluster.integration.test.mjs.tap) |
| `tests/p2-016-schema-contract.test.mjs` | PASS | 6/6 | [TAP](pr192-ci-021-p2-016-schema-contract.test.mjs.tap) |
| `tests/p2-016-ticket-lifecycle.integration.test.mjs` | PASS | 1/1 | [TAP](pr192-ci-022-p2-016-ticket-lifecycle.integration.test.mjs.tap) |
| `tests/p2-016-workbench-auth.integration.test.mjs` | PASS | 6/6 | [TAP](pr192-ci-023-p2-016-workbench-auth.integration.test.mjs.tap) |
| `tests/p2-016-workbench-http.integration.test.mjs` | PASS | 2/2 | [TAP](pr192-ci-024-p2-016-workbench-http.integration.test.mjs.tap) |
| `tests/p2-016-workbench-wecom-auth.test.mjs` | PASS | 5/5 | [TAP](pr192-ci-025-p2-016-workbench-wecom-auth.test.mjs.tap) |
| `tests/p2-g2-yixiaoxiu-delegated-identity.integration.test.mjs` | PASS | 1/1 | [TAP](pr192-ci-026-p2-g2-yixiaoxiu-delegated-identity.integration.test.mjs.tap) |
| `tests/pc-admin-card12-review.browser.test.mts` | PASS | 7/7 | [TAP](pr192-ci-027-pc-admin-card12-review.browser.test.mts.tap) |
| `tests/pc-admin-card16.browser.test.mts` | PASS | 3/3 | [TAP](pr192-ci-028-pc-admin-card16.browser.test.mts.tap) |
| `tests/pc-admin-card35a-states.browser.test.mts` | PASS | 9/9 | [TAP](pr192-ci-029-pc-admin-card35a-states.browser.test.mts.tap) |
| `tests/pc-admin-copy-terms.test.mts` | PASS | 6/6 | [TAP](pr192-ci-030-pc-admin-copy-terms.test.mts.tap) |
| `tests/pc-admin-design-foundation.test.mts` | PASS | 75/75 | [TAP](pr192-ci-031-pc-admin-design-foundation.test.mts.tap) |
| `tests/pc-admin-legacy-retirement.browser.test.mts` | PASS | 2/2 | [TAP](pr192-ci-032-pc-admin-legacy-retirement.browser.test.mts.tap) |
| `tests/platform-boundary-contracts.test.mts` | PASS | 6/6 | [TAP](pr192-ci-033-platform-boundary-contracts.test.mts.tap) |
| `tests/platform-postgres-callback.integration.test.mts` | PASS | 4/4 | [TAP](pr192-ci-034-platform-postgres-callback.integration.test.mts.tap) |
| `tests/platform-postgres-time.integration.test.mjs` | PASS | 2/2 | [TAP](pr192-ci-035-platform-postgres-time.integration.test.mjs.tap) |
| `tests/platform-time-contract.test.mjs` | PASS | 4/4 | [TAP](pr192-ci-036-platform-time-contract.test.mjs.tap) |
| `tests/t10-atomic-rollback.integration.test.mts` | PASS | 4/4 | [TAP](pr192-ci-037-t10-atomic-rollback.integration.test.mts.tap) |
| `tests/t10-current-authority-wait.integration.test.mts` | PASS | 1/1 | [TAP](pr192-ci-038-t10-current-authority-wait.integration.test.mts.tap) |
| `tests/t10-unknown-recovery.browser.test.mts` | PASS | 2/2 | [TAP](pr192-ci-039-t10-unknown-recovery.browser.test.mts.tap) |
| `tests/t11-completion.integration.test.mts` | PASS | 8/8 | [TAP](pr192-ci-040-t11-completion.integration.test.mts.tap) |
| `tests/t24-round-notification-identity.integration.test.mts` | PASS | 1/1 | [TAP](pr192-ci-041-t24-round-notification-identity.integration.test.mts.tap) |
| `tests/t24-synthetic-sender-unknown.integration.test.mts` | PASS | 1/1 | [TAP](pr192-ci-042-t24-synthetic-sender-unknown.integration.test.mts.tap) |
| `tests/t25-app-delivery-http-recovery.integration.test.mts` | PASS | 1/1 | [TAP](pr192-ci-043-t25-app-delivery-http-recovery.integration.test.mts.tap) |
| `tests/t35-account-switch.browser.test.mts` | PASS | 1/1 | [TAP](pr192-ci-044-t35-account-switch.browser.test.mts.tap) |
| `tests/t35-current-authority-wait.integration.test.mts` | PASS | 1/1 | [TAP](pr192-ci-045-t35-current-authority-wait.integration.test.mts.tap) |
| `tests/t35-unknown-read.browser.test.mts` | PASS | 1/1 | [TAP](pr192-ci-046-t35-unknown-read.browser.test.mts.tap) |
| `tests/wbint-t17-manual-receipts.integration.test.mts` | PASS | 1/1 | [TAP](pr192-ci-047-wbint-t17-manual-receipts.integration.test.mts.tap) |
| `tests/wbint-t19-manual-self-handling-authority.integration.test.mts` | PASS | 1/1 | [TAP](pr192-ci-048-wbint-t19-manual-self-handling-authority.integration.test.mts.tap) |
| `tests/wbint-t19-manual-self-handling-contracts.test.mts` | PASS | 4/4 | [TAP](pr192-ci-049-wbint-t19-manual-self-handling-contracts.test.mts.tap) |
| `tests/wbint-t19-manual-self-handling-risks.integration.test.mts` | PASS | 4/4 | [TAP](pr192-ci-050-wbint-t19-manual-self-handling-risks.integration.test.mts.tap) |
| `tests/wbint-t19-manual-self-handling-unknown.browser.test.mts` | PASS | 1/1 | [TAP](pr192-ci-051-wbint-t19-manual-self-handling-unknown.browser.test.mts.tap) |
| `tests/wbint-t22-realtime-tracer.browser.test.mts` | PASS | 1/1 | [TAP](pr192-ci-052-wbint-t22-realtime-tracer.browser.test.mts.tap) |
| `tests/wbint-t32-exception-authorization.browser.test.mts` | PASS | 1/1 | [TAP](pr192-ci-053-wbint-t32-exception-authorization.browser.test.mts.tap) |
| `tests/wbint-t32-exception-compatibility.integration.test.mts` | PASS | 4/4 | [TAP](pr192-ci-054-wbint-t32-exception-compatibility.integration.test.mts.tap) |
| `tests/wbint-t32-exception-contract.test.mts` | PASS | 3/3 | [TAP](pr192-ci-055-wbint-t32-exception-contract.test.mts.tap) |
| `tests/wbint-t32-notification-exceptions.integration.test.mts` | PASS | 1/1 | [TAP](pr192-ci-056-wbint-t32-notification-exceptions.integration.test.mts.tap) |
| `tests/wbint-t32-session-exceptions.integration.test.mts` | PASS | 4/4 | [TAP](pr192-ci-057-wbint-t32-session-exceptions.integration.test.mts.tap) |
| `tests/wbint-t38-protocol.browser.test.mts` | PASS | 2/2 | [TAP](pr192-ci-058-wbint-t38-protocol.browser.test.mts.tap) |
| `tests/web01-workbench.integration.test.mjs` | PASS | 17/17 | [TAP](pr192-ci-059-web01-workbench.integration.test.mjs.tap) |
| `tests/web01-workbench.test.mts` | PASS | 9/9 | [TAP](pr192-ci-060-web01-workbench.test.mts.tap) |
| `tests/workbench-detail-restructure.browser.test.mts` | PASS | 2/2 | [TAP](pr192-ci-061-workbench-detail-restructure.browser.test.mts.tap) |
| `tests/workbench-toast-feedback.browser.test.mts` | PASS | 1/1 | [TAP](pr192-ci-062-workbench-toast-feedback.browser.test.mts.tap) |
| `tests/yxx-h5-admin-contracts.test.mts` | PASS | 7/7 | [TAP](pr192-ci-063-yxx-h5-admin-contracts.test.mts.tap) |
| `tests/yxx-h5-application-auth.test.mts` | PASS | 8/8 | [TAP](pr192-ci-064-yxx-h5-application-auth.test.mts.tap) |
| `tests/yxx-h5-flow.integration.test.mts` | PASS | 1/1 | [TAP](pr192-ci-065-yxx-h5-flow.integration.test.mts.tap) |
| `tests/yxx-h5-frontend.test.mts` | PASS | 81/81 | [TAP](pr192-ci-066-yxx-h5-frontend.test.mts.tap) |
| `tests/yxx-h5-http.test.mts` | PASS | 22/22 | [TAP](pr192-ci-067-yxx-h5-http.test.mts.tap) |
| `tests/yxx-h5-media.integration.test.mts` | PASS | 6/6 | [TAP](pr192-ci-068-yxx-h5-media.integration.test.mts.tap) |
| `tests/yxx-h5-media.test.mts` | PASS | 14/14 | [TAP](pr192-ci-069-yxx-h5-media.test.mts.tap) |
| `tests/yxx-h5-migrate.integration.test.mts` | PASS | 11/11 | [TAP](pr192-ci-070-yxx-h5-migrate.integration.test.mts.tap) |
| `tests/yxx-h5-runtime.test.mts` | PASS | 19/19 | [TAP](pr192-ci-071-yxx-h5-runtime.test.mts.tap) |
| `tests/yxx-h5-static.test.mts` | PASS | 14/14 | [TAP](pr192-ci-072-yxx-h5-static.test.mts.tap) |
| `tests/yxx-h5-v2-contract.test.mts` | PASS | 8/8 | [TAP](pr192-ci-073-yxx-h5-v2-contract.test.mts.tap) |
| `tests/yxx-h5-v2.integration.test.mts` | PASS | 3/3 | [TAP](pr192-ci-074-yxx-h5-v2.integration.test.mts.tap) |
| `tests/yxx-ss-007-native-http-errors.test.mjs` | PASS | 15/15 | [TAP](pr192-ci-075-yxx-ss-007-native-http-errors.test.mjs.tap) |
| `tests/yxx-ss-009-http-recovery.integration.test.mjs` | FAIL (pre-existing) | 0/2 | [TAP](pr192-ci-076-yxx-ss-009-http-recovery.integration.test.mjs.tap) |
| `tests/yxx-ss-010-runtime.integration.test.mjs` | PASS | 6/6 | [TAP](pr192-ci-077-yxx-ss-010-runtime.integration.test.mjs.tap) |

## CI tool entries

7/7 entries pass; 138/138 cases pass; 0 fail; 0 skipped; 0 cancelled.

| Entry | Result | Cases | Evidence |
| --- | --- | --- | --- |
| `tools/ts-migration/backend-layout.test.mts` | PASS | 13/13 | [TAP](pr192-ci-078-backend-layout.test.mts.tap) |
| `tools/ts-migration/check-agent-docs.test.mts` | PASS | 20/20 | [TAP](pr192-ci-079-check-agent-docs.test.mts.tap) |
| `tools/ts-migration/design-system.test.mts` | PASS | 2/2 | [TAP](pr192-ci-080-design-system.test.mts.tap) |
| `tools/ts-migration/h5.test.mts` | PASS | 13/13 | [TAP](pr192-ci-081-h5.test.mts.tap) |
| `tools/ts-migration/hosts.test.mts` | PASS | 29/29 | [TAP](pr192-ci-082-hosts.test.mts.tap) |
| `tools/ts-migration/pr-plan.test.mts` | PASS | 22/22 | [TAP](pr192-ci-083-pr-plan.test.mts.tap) |
| `tools/ts-migration/tooling.test.mts` | PASS | 39/39 | [TAP](pr192-ci-084-tooling.test.mts.tap) |

## Additional workbench and drawer regressions

13/13 entries pass; 26/26 cases pass; 0 fail; 0 skipped; 0 cancelled.

| Entry | Result | Cases | Evidence |
| --- | --- | --- | --- |
| `tests/pc-admin-card32a.browser.test.mts` | PASS | 1/1 | [TAP](pr192-extra-001-pc-admin-card32a.browser.test.mts.tap) |
| `tests/pc-admin-card32b.browser.test.mts` | PASS | 1/1 | [TAP](pr192-extra-002-pc-admin-card32b.browser.test.mts.tap) |
| `tests/pc-admin-card32c-d.browser.test.mts` | PASS | 1/1 | [TAP](pr192-extra-003-pc-admin-card32c-d.browser.test.mts.tap) |
| `tests/pc-admin-card32d-toast.browser.test.mts` | PASS | 2/2 | [TAP](pr192-extra-004-pc-admin-card32d-toast.browser.test.mts.tap) |
| `tests/pc-admin-card34a-toast-modal.browser.test.mts` | PASS | 2/2 | [TAP](pr192-extra-005-pc-admin-card34a-toast-modal.browser.test.mts.tap) |
| `tests/pc-admin-card34b-detail.browser.test.mts` | PASS | 1/1 | [TAP](pr192-extra-006-pc-admin-card34b-detail.browser.test.mts.tap) |
| `tests/pc-admin-card34c-copy.browser.test.mts` | PASS | 1/1 | [TAP](pr192-extra-007-pc-admin-card34c-copy.browser.test.mts.tap) |
| `tests/wbint-t38-realtime.test.mts` | PASS | 6/6 | [TAP](pr192-extra-008-wbint-t38-realtime.test.mts.tap) |
| `tests/wbint-t38-realtime.browser.test.mts` | PASS | 2/2 | [TAP](pr192-extra-009-wbint-t38-realtime.browser.test.mts.tap) |
| `tests/wbint-t38-offline.browser.test.mts` | PASS | 2/2 | [TAP](pr192-extra-010-wbint-t38-offline.browser.test.mts.tap) |
| `tests/wbint-t38-unknown.browser.test.mts` | PASS | 1/1 | [TAP](pr192-extra-011-wbint-t38-unknown.browser.test.mts.tap) |
| `tests/wbint-t38-gap.browser.test.mts` | PASS | 2/2 | [TAP](pr192-extra-012-wbint-t38-gap.browser.test.mts.tap) |
| `tests/wbint-t38-authority.browser.test.mts` | PASS | 4/4 | [TAP](pr192-extra-013-wbint-t38-authority.browser.test.mts.tap) |

## Failures

- `tests/yxx-ss-009-http-recovery.integration.test.mjs`: PRE_EXISTING: missing service-closure migration in SS009 fixture; user assigned its fix to PR 191. Original failure is retained; no test weakening or migration repair here.

The original clean-HEAD CLI run guard cannot accept authorized uncommitted fixes. Each selected entry ran through its existing runSelection API, compiled host, flags and ownership checks. Database fixtures own their UUID databases; no baseline migration or global cleanup was run against shared postgres. The entire selected set was attempted, continuing after failures.

[Machine-readable historical results](../runs/21-before-linux-timing/checks/regressions.json)
