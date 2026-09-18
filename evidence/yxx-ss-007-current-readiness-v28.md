# YXX-SS-007 current readiness v28

Status: LOCAL_VALIDATION_COMPLETE_REVIEW_PENDING. Tested implementation: 1dd56ddc623cf944cd9d962b18e90d5c21c359e3; tree: efe80198040b511d5e6d48ff62e3d17aabffcea4.

The JSON binds 28 declared source files with Git blob and executed working-tree SHA-256. This aggregate supersedes v27; both the runbook and task ledger point here. Later publication adds evidence only.

Native write pages, bootstrap and POSTs require an explicit boolean member write_flag=true. False, missing and string values deny the native write UI with 403 under MEMBER_SELF_SERVICE and FULL_SERVICE_LOOP. Existing read APIs retain their own query authorization. Command recovery reads reject query strings with 400 before business dispatch or fallthrough.

Final validation: 64/64 HTTP/browser/contract plus 7/7 isolated PostgreSQL; aggregate 71/71, zero failures, skips, cancellations or todo. Syntax and implementation diff checks passed.

Both HTTP defects were reproduced before repair. Added browser coverage for member write permission removal while a form is open. The first full run was 63/64 with a closed-tab recovery timeout; the test control tab was isolated from application recovery, then focused and full regression were rerun. Original diagnostic logs are retained and excluded from acceptance.

YXX-SS-007 remains IN_REVIEW; SS-008 remains PLANNED. Current-head external review is pending; CI/remote approval is not claimed. No database/schema/API contract or feature-flag changes. Resource bounds remain unchanged. Real OAuth/SDK, production DB, send/deploy, SS-011, P2-G2-LIVE and P2-008 were not run. Rollback: keep either self-service feature flag disabled.
