# SS010 development diagnostics (not acceptance runs)

These are preserved pre-freeze development outputs, not published candidates or
evidence of a failed final full regression. The accepted source and actual full
execution are bound by `yxx-ss-010-report.json`.
Raw diagnostic TAP retains Node's indented blank lines; whitespace checks exclude
only these development-failure TAP files rather than rewriting their output.

| Output | Observed problem and disposition |
|---|---|
| `yxx-ss-010-development-failure-01.tap` | Windows ESM preload needed a file URL; the test command used a lowercase reason code; an unused cleanup hook had the wrong argument. Fixed test setup. |
| `yxx-ss-010-development-failure-02.tap` | Real internal action exposed incompatibility between the initial Proxy transaction wrapper and the existing realtime module's Proxy rejection. |
| `yxx-ss-010-development-failure-03.tap` | Captured the realtime rejection; replaced Proxy wrappers with plain adapters. Temporary debug instrumentation was removed. |
| `yxx-ss-010-development-failure-04.tap` | A negative-route test omitted its idempotency header value. Corrected the request fixture. |
| `yxx-ss-010-development-failure-08.tap` | The ledger revocation fixture omitted the required target resource; replaced it with a real Web-created Ticket, then verified rollback of the swallowed business-error receipt. |

Independent reviews additionally identified startup/activation ordering,
Provider window guards, public/internal Origin separation, approval scope
binding, Worker health forwarding, bounded hard-stop escalation, incomplete
resume-state acceptance, pre-existing Incident roots and missing DDL-check
permission fields. These were repaired and reviewed before source freeze.

Final raw TAP and case trace are stored once; capacity and cleanup receipts stay
in that TAP instead of being repeated in new capacity/cleanup JSON reports.
Two final browser screenshots were visually inspected at 390 and 1440 pixels;
the synthetic member page shows the accepted supplement and original-workbench
Ticket outcome without horizontal overflow. This is local synthetic acceptance,
not a real user/site result.
