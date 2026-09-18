# YXX-SS-007 current readiness v27

Status: LOCAL_VALIDATION_COMPLETE_REVIEW_PENDING. Tested implementation: d65f489a70cc5ba8e064f7d4e26e0786c58cf44e; tree: e23227802db557ffdf32b1d625df2df3e1eaccc6.

This aggregate supersedes v25 and incorporates the v26 bootstrap release repair. The JSON binds Git blob and executed working-tree hashes for all declared sources, including the current runbook and task pointers. Later evidence publication changes no runtime or test source.

Periodic session checks hide protected views before the request. Only confirmed same-member scope restores the prior view and draft. Changed scope reboots the route; 503, timeout and network errors clear content and leave views hidden. Detail refresh runs after successful session revalidation, preventing competing timers from bypassing checks.

Final validation: 61/61 HTTP/browser/contract and 7/7 isolated PostgreSQL; aggregate 68/68. Zero failures, skips, cancellations or todo. Syntax and implementation diff checks passed. Failed/interrupted raw TAP artifacts retain their original whitespace.

Six new browser cases cover slow new/list/detail views, same-scope recovery, member replacement, 503, timeout and late-response suppression. The failed targeted run and aborted preflight are retained and explicitly excluded from acceptance in the JSON.

YXX-SS-007 remains IN_REVIEW; SS-008 remains PLANNED. External current-head review is pending. No database/schema/API contract or feature-flag changes. Five-second periodic checks remain serialized. Live OAuth/SDK, production DB, sends and deployment were not run; SS-011/P2-G2-LIVE/P2-008 remain outside scope. Rollback: keep either self-service feature flag disabled.
