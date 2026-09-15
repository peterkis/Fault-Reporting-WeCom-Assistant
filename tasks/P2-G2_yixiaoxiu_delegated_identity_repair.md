# 医小修代开发身份映射最小修补

- Status: LOCAL_VERIFIED / CURRENT_TARGETED_LIVE_NOT_RUN
- Authorization: user instruction “允许修补”; `evidence/p2-g2-yxx-entry-mapping-authorization.json`.
- Decision: ADR-0019. No new migration, dependency or persistent identity table.
- Input: protected enterprise/Agent/Bot scope, LIVE identity proof reference and approved original Bot member IDs (1–32).
- Output: config-bound, in-memory reverse mapping from official delegated OAuth ID to exact original Bot ID; original Ticket/Intake ownership and binding hashes remain authoritative.
- Entry: standalone MEMBER_TICKET_READONLY only. Defaults remain disabled. FULL_SERVICE_LOOP mapped mode is rejected.
- Limits: one startup conversion POST, 5 seconds, 64 KiB; full bijection required. No Provider calls in read transactions, no SDK sends or business mutations. Unknown, partial, malformed and ambiguous mappings fail closed.
- Validation: complete isolated full run 1053/1053, 169 files, no skip/fail/cancel, same candidate; independent SPEC/STANDARDS review PASS. Includes conversion, config, startup, own/other-member HTTP/PG access, legacy locator, logout, cross-user ETag and business-fact preservation.
- Candidate: c62464fe53392de7ea49e63da12cf4b097687ee1edffd20145aa3806e693f5f9, based on local HEAD 9aa2428c85fbd28d34eaf5a795be85046afc59a7; no commit/push/merge/tag.
- Evidence: `evidence/p2-g2-yxx-entry-mapping-v1-report.json`, `evidence/p2-g2-yxx-entry-mapping-v1-parent-report.json`; selected via `plans/current_phase.json`.
- History: initial RED and preliminary/aborted runs retained. The inherited browser test temporarily overwrote two frozen screenshots; current images were archived, HEAD bytes restored, and the test now writes unique tmp outputs. Exact aborted-run temporary database cleanup has its own receipt. See mapping-v1 failure history.
- Rollback: stop the member App, restore the separately approved OAuth-only release and reauthenticate. No legacy-policy fallback, down migration, Ticket/Grant deletion or identity rewrite.
- Remaining field gate: repaired candidate not yet deployed or tested against A1/A2/B1; earlier A/B identity probes are separate evidence. Full P2-G2-LIVE, P2-008, formal observation and production approval remain outside this repair.
