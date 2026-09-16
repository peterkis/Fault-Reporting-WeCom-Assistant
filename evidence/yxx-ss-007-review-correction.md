# SS-007 review correction

The original `yxx-ss-007-native-ui-report.json` is retained as historical evidence.
Its COMPLETE status and complete acceptance coverage are not current readiness proof.
PR #17 review found functional gaps after that report; SS-007 remains IN_REVIEW,
and SS-008 must not start until the current candidate passes review and acceptance.

The original browser suite used synthetic command/query adapters. It did not prove
all logout, BFCache, hidden-tab, late-response, command-recovery or keyboard flows.
Static source matches do not establish those runtime behaviors. Separate browser
instances prove separate sessions, not two tabs sharing one browser session.

The SS-005 498/500 pagination failure is unresolved evidence requiring diagnosis;
a successful rerun does not establish its cause or prove that it was transient.

Current focused additions reproduce two review findings before fixes:

- Known store validation TypeErrors returned 503 instead of 400.
- A refreshed CSRF token became undefined after clearing the previous form.

After the targeted fixes, `node --test tests/yxx-ss-007-native-ui.browser.test.mjs`
passed 3 tests without skips. The browser regression submits successfully after
the server changes the CSRF token. These results do not substitute for the
remaining acceptance scenarios or SS-008 real database assembly.

## Subsequent operation recovery verification

Independent review found additional detail-cache, list-cursor, identity-refresh
and stale-operation ownership gaps. The implementation now preserves complete
detail/ETag pairs, refreshes the first list page without an old cursor, validates
the session before pending-command recovery, and permits only the current
controller/generation to release busy state or clear authenticated DOM state.

The combined SS-005 and SS-007 run passed **10/10**, with zero skipped, failed,
cancelled or todo tests. The six SS-007 tests now include CSRF refresh, detail
304 after visibility restoration, first-page restoration, GET-only recovery
through 404 and an in-memory identity change, stale 401 responses and the UUID
route guard. Visibility is controlled through a deterministic browser test seam;
this is not evidence of operating-system backgrounding.

After a full reload, there is no in-memory CSRF comparison available to identify
a changed account. Pending IDs remain scoped by server-side GET authorization;
a 404 conservatively retains the fence and never triggers an automatic POST.
The current contract has no persistent opaque session generation field.

Real OAuth/SDK, production databases, SSH, deployment and message sends remain
NOT_RUN. SS-011, P2-G2-LIVE and P2-008 remain outside the authorized scope.
