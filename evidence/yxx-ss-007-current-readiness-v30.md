# YXX-SS-007 current readiness v30

Status: LOCAL_VALIDATION_COMPLETE_REVIEW_PENDING. Tested implementation: 4d2ab75cc3973f26b0bd15265268c3a36df64c6c; tree: 0ab59a66f964e6dc3e92f396ef053cb235903eed.

This aggregate supersedes v29 and binds 28 declared source files with Git blob and executed working-tree SHA-256. Both current pointers reference v30. Later publication changes evidence only.

Periodic same-member session revalidation restores the previous active control and selection (including direction), while keeping the view hidden until confirmation. A user-selected different control is not overridden; failure or member change never restores the old focus. Detail pages render needs_action and safe_clarification using textContent. Null values and all existing protected-detail cleanup paths remove stale guidance.

Final validation: 67/67 HTTP/browser/contract plus 7/7 isolated PostgreSQL; aggregate 74/74, zero failures, skips, cancellations or todo. Syntax and implementation diff checks passed.

Both issues were reproduced before repair. Eight targeted browser cases passed, then the full suite reran them on the bound source. Coverage includes new-report/supplement focus, backward selection, slow authentication, deliberate focus movement, changed member, timeout, escaped markup, null guidance refresh and 404 cleanup.

YXX-SS-007 remains IN_REVIEW; SS-008 remains PLANNED. Current-head external review is pending; CI/remote approval is not claimed. No database/schema/API contract, feature-flag or resource-limit changes. Real OAuth/SDK, production DB, sends/deployment, SS-011, P2-G2-LIVE and P2-008 were not run. Rollback: keep either self-service feature flag disabled.
