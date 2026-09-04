# P2-016 closeout regression — host standby interruption

- Date: 2026-09-04, Asia/Shanghai.
- Candidate: `b3592280fd02bb68cd9b63720f6d6b8fae88b86c81597bb730a3f7367e0f3117`.
- Command: `node --expose-gc --env-file=.env.pilot --test --test-concurrency=1 tests/*.test.mjs`.
- Isolated temporary root: `tmp/p2016-closeout-2a92faaeba914c789f71756e962b1563`.
- This attempt is **not PASS** and is not substituted with the earlier successful regression. No implementation commit is created from this attempt.

## Observed failures

The full runner reported the existing P2-004 Worker kill/restart case at `350150.9761 ms`, the 500-delivery case at `2237205.0194 ms`, and its cleanup assertion as failed. Final result: **535 tests / 532 pass / 1 fail / 2 cancelled / 0 skipped / 0 todo; exit 1; 3166230.2149 ms**. Both long cases were cancelled with `test timed out after 180000ms`. The cleanup assertion momentarily observed database_count=1/backend_count=0; subsequent independent audits found zero. The relevant business/test files are unchanged from the owner-approved live candidate; only the seven recorded closeout governance files differ.

## Read-only host evidence

Windows System log, Microsoft-Windows-Kernel-Power:

- `17:37:10`, event 506: entering modern standby, reason Screen Off Request.
- `17:37:16`–`17:37:17`, events 506/507: display/power and Lid transitions.
- `17:37:17`, event 506: entering modern standby, reason Lid.
- `17:43:11`, events 507/506: Austerity Battery Drain Budget Exceeded transition.
- `18:20:32`, event 507: leaving modern standby, reason Lid.

The standby intervals align with the unusually long test durations. This is evidence for a host suspension interruption, not proof of a new Ticket/Communication implementation defect. The next check is an isolated rerun of the failing P2-004 test scope while the host stays awake, followed by a new full run if it passes.

An independent read-only audit at about `18:24` found no `p2_004_*` databases or connections. No unowned databases, processes, old profile directories, or blocked deletion targets were removed. No power settings were changed or explicit user sleep overridden. The user was asked to keep the lid open and host awake for the rerun.

## Unmodified diagnostic rerun

```powershell
node --expose-gc --env-file=.env.pilot --test --test-concurrency=1 --test-name-pattern='real Worker kill/restart|500 deliveries remain bounded|P2-004 integration leaves' tests/p2-004-communication-core.integration.test.mjs
```

Actual result while awake: **3/3 pass**, fail/cancelled/skipped/todo=0, exit=0, `8825.0796 ms`. Worker restart took `2297.2802 ms`, 500-delivery capacity `6264.9911 ms`, cleanup `43.8964 ms`; blind resend=0; database/backend/child residuals=0. This is a diagnostic subset, not a substitute for the required full suite. No code, test timeout, or assertion was changed. A fresh full-suite run is required before commit.

## Fresh full-suite rerun and final cleanup

The owner confirmed that the lid would stay open and the computer awake. A new full run used the same command and unchanged candidate `b3592280fd02bb68cd9b63720f6d6b8fae88b86c81597bb730a3f7367e0f3117`, with isolated root `tmp/p2016-closeout-awake-a3aaf49f19a6470b83d0a7253a4addeb`.

Actual result: **535 tests / 535 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo; exit 0; 443441.2863 ms**. The required complete suite, including the previously interrupted P2-004 cases, passed without runtime, timeout, or assertion changes. This later run does not alter the failed historical result above.

Independent read-only audit at `18:40:56` found zero temporary test databases/backends, scoped test Node processes, owned browser processes and live listeners. All three new roots had zero browser profile directories; their non-profile residual items (3/0/5) and the older policy-blocked roots were retained. The audit pool was closed. The original configured database was not migrated; its read-only `P2_016_REQUIRES_030` status is expected.
