# YXX-SS-007 current readiness v33

Status: LOCAL_VALIDATION_COMPLETE_REVIEW_PENDING. Tested implementation: f1680dbff0f8f8b732cc3f4d12e89ac3135b7cab; tree: fa1c9812144d60fd539105cb1ab2aa4d6f1803f9.

This aggregate supersedes v32 and binds 28 declared source files with Git blob and executed working-tree SHA-256. Both current pointers reference v33. Later publication changes evidence only.

The durable set now enforces the frozen global bound of 20 valid v3 records across all member/corp/app scopes in the same origin, both before and after insertion. Existing other-member records are never evicted. Malformed records remain ignored and retained. A capacity race rolls back only the attempted new record and prevents POST. The current runbook corrects the former per-scope interpretation.

Detail, timeline and supplement routes validate the entire request-reference path before business dispatch. Malformed input returns 400 without fallthrough; valid unknown references still receive 404 from the member query/command boundary.

Final validation: 74/74 HTTP/browser/contract plus 7/7 isolated PostgreSQL; aggregate 81/81, zero failures, skips, cancellations or todo. Syntax and implementation diff checks passed.

Both defects were reproduced before repair. Focused cases cover full cross-scope capacity, preservation of all existing records, one-slot recovery, interleaved insertion, malformed/null/overlong references, invalid characters and extra path segments. The full suite reran these checks on the bound source.

YXX-SS-007 remains IN_REVIEW; SS-008 remains PLANNED. Current-head external review is pending; CI/remote approval is not claimed. No database/schema/API shape or feature-flag changes; this repair enforces the documented resource bound. Real OAuth/SDK, production DB, sends/deployment, SS-011, P2-G2-LIVE and P2-008 were not run. Rollback: keep either self-service feature flag disabled.
