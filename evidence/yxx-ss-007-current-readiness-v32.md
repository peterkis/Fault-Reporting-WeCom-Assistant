# YXX-SS-007 current readiness v32

Status: LOCAL_VALIDATION_COMPLETE_REVIEW_PENDING. Tested implementation: 14fada41cdac4836e33dca94f78c57077e8624be; tree: 429290c66be969c7d2955c8eed58a929ecb0bb7d.

This aggregate supersedes v31 and binds 28 declared source files with Git blob and executed working-tree SHA-256. Both current pointers reference v32. Later publication changes evidence only.

Session timer expiry immediately hides the protected container even while submission, detail or recovery is busy. The existing operation is not cancelled; an overdue session check gets priority at completion. Ordinary completion does not reset an armed deadline, and bootstrap cannot reveal a view while revalidation is due. Same-member focus and selection are restored after confirmation. Terminal supplement feedback survives background refresh.

Command paths are claimed by prefix, then the entire UUID segment is validated. Missing/malformed IDs and extra segments return 400 before business queries or fallthrough. Valid UUID behavior and query rejection are preserved.

Final validation: 72/72 HTTP/browser/contract plus 7/7 isolated PostgreSQL; aggregate 79/79, zero failures, skips, cancellations or todo. Syntax and implementation diff checks passed.

Both reported defects were reproduced before repair. Busy-read/write/recovery and same-member focus cases are included in the final suite. The first targeted run (9/10) and first aggregate (70/72) are retained as diagnostic history, excluded from final acceptance; their corrections and focused reruns are documented in the JSON.

YXX-SS-007 remains IN_REVIEW; SS-008 remains PLANNED. Current-head external review is pending; CI/remote approval is not claimed. No database/schema/API contract or feature-flag changes; request deadlines, recovery counts and concurrency bounds remain unchanged. Real OAuth/SDK, production DB, sends/deployment, SS-011, P2-G2-LIVE and P2-008 were not run. Rollback: keep either self-service feature flag disabled.
