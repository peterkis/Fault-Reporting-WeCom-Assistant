# PR #8 review repair authorization

Date: 2026-09-11. User explicitly authorized fixing review findings, pushing the repairs, requesting remote `@codex review`, and merging only after all merge conditions are satisfied.

Starting HEAD: `20af92bba7ddec0686639e9b50c7441ce3e4b392`; branch: `phase2/yixiaoxiu-member-ticket-entry`. PR: https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/8.

Scope: repair remote P1 comment 3987694573 (member card delivery incorrectly expires with the legacy Grant) and independent STANDARDS P2 (new structured Evidence time contract). Member delivery must validate the authoritative persisted notification/Delivery/Message/Ticket/source Intake/public reference binding without reading, extending or recreating a Grant. Explicit legacy delivery retains its Grant checks. Before-SDK database failure remains retryable; unknown SDK outcomes remain subject to reconciliation. No database migration.

Validation seams remain the authorized Sender/Communication Worker, real isolated PostgreSQL, member HTTP/browser and current-candidate full regression; final SPEC and STANDARDS reviews remain independent. Prior passing results are historical while repair is in progress. Immutable historical artifacts remain unchanged, with append-only time corrections where needed.

This supersedes the original local-only Git stop line solely for review repair, push, PR review and merge. It does not authorize cloud changes, real WeCom/provider calls, real business access or sends, live validation, formal observation, P2-008, AI/OCR, deployment or release. Persistent Feature Flags remain false; P2-G1 remains the last completed Gate.

The required full regression exposed an existing three-process startup failure. A repeated isolated topology reproduced projection failure and late-source rejection; a bounded transaction-barrier test then reproduced PostgreSQL `40P01` before implementation. This discovered regression blocks merge readiness and is included in the user's repair-until-merge scope. The repair unifies P2-016 projection lock order through an optional Timeline transaction-start hook, preserving default behavior for other assemblies, source ordering, failure counters, readiness checks and migration history. No live operation or authorized session rebuild is inferred.
