# YXX-SS-007 current readiness v29

Status: LOCAL_VALIDATION_COMPLETE_REVIEW_PENDING. Tested implementation: f6ff904a00d5147fa3a4712a0e6f2fee8db4d067; tree: f4b7e5ccffa4cea1e7eb4b2730b6a1b768ddc57c.

This aggregate supersedes v28 and binds 28 declared source files with Git blob and executed working-tree SHA-256. Both current pointers reference v29. Later publication changes evidence only.

GET receipt-recovery scheduling no longer captures or compares the write-only CSRF token. It retains command ID, page generation, visibility/stopped state and recovery-scope checks. The same shared scheduler covers new-report failures, supplement failures and subsequent GET recovery. Five automatic attempts and explicit manual restart remain bounded.

Final validation: 65/65 HTTP/browser/contract plus 7/7 isolated PostgreSQL; aggregate 72/72, zero failures, skips, cancellations or todo. Syntax and implementation diff checks passed.

The new browser regression failed before repair. Targeted coverage then passed 2/2: periodic same-scope CSRF rotation reaches the manual retry button and recovers with the original command ID, while identity changes still stop old-member recovery. The full suite reran these checks on the bound implementation.

YXX-SS-007 remains IN_REVIEW; SS-008 remains PLANNED. Current-head external review is pending; CI/remote approval is not claimed. No database/schema/API contract, feature-flag or resource-limit changes. Real OAuth/SDK, production DB, sends/deployment, SS-011, P2-G2-LIVE and P2-008 were not run. Rollback: keep either self-service feature flag disabled.
