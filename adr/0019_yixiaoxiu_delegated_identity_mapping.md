# ADR-0019: 医小修代开发身份的有界官方映射

Status: Accepted for the user-authorized minimal repair on 2026-09-15; not a Gate or deployment approval.

## Context

ADR-0018 assumed the OAuth and Bot userid shared one namespace. Live A/B checks instead established Bot plaintext userid → official `batch/userid_to_openuserid` → delegated-app OAuth userid. The current authorizer rejects the resulting cross-namespace identity. Do not label this `VERIFIED_SAME_NAMESPACE` or rewrite original Intake/Ticket bindings.

## Decision and contract

- Add `VERIFIED_DELEGATED_MAPPING` with `reporterUserIds`: 1–32 approved Bot plaintext member IDs, unique ignoring plaintext case. Existing config normalization and disabled examples remain unchanged when this mode is unused.
- Configuration acceptance has two mandatory stages: the published JSON Schema checks structure; `validateYxxEntryConfig` checks semantic constraints before deployment. JSON Schema `uniqueItems` only detects exactly equal values and does not establish case-insensitive roster uniqueness or the UTF-8 byte limit. Schema-only success is not deployment approval. Tooling must call `validateYxxEntryConfig` (or the standalone launcher's offline `--check`) and reject its errors before opening a Provider, database or listener. Keep the exact original member IDs; do not lowercase them to make schema uniqueness appear sufficient.
- Retain `memberIdsConfirmed`, application/enterprise/Bot scope, proofRef and LIVE/DEPLOYMENT requirements. Synthetic proofs remain isolated-test-only. Raw IDs belong only in protected runtime configuration.
- Before the standalone MEMBER_TICKET_READONLY server creates a database pool or listener, convert the entire configured roster with the same delegated application token provider used by OAuth. One official POST, 5-second total deadline, 64-KiB response ceiling, no automatic retry. Partial, duplicate, foreign, malformed or failed results reject startup.
- Retain an immutable, config-bound in-memory reverse map from encrypted OAuth ID to the exact original configured Bot ID. Encrypted IDs remain case-sensitive. No Provider call during a read transaction. Unknown users fail closed.
- Every read still validates OAuth, original Bot/source Intake ownership, original binding hash, retention and logout fencing. No schema, migration, Ticket/Intake identity rewrite, new persistent mapping table, Grant/session creation, SDK send or second Ticket Core.
- The mapped mode is supported only by the standalone readonly composition in this repair. FULL_SERVICE_LOOP continues rejecting it until independently integrated and authorized.
- Shutdown discards the in-memory map with its App instance; restart regenerates it. This map is identity correspondence, not a bearer credential or an independent permission grant.

## Verification and limits

The authorized test seams are official conversion adapter, member authorizer/config contract, readonly startup and existing HTTP/PostgreSQL member surface. Tests cover own access, other-member denial, unchanged business facts, scoped mapping, malformed/partial responses, deadlines, logout and legacy/conditional reads. Provider responses are simulated in automated tests; current live A/B evidence is a separate input, not proof of the repaired deployed candidate.

Keep frozen Evidence intact; append new candidate/run/review records. No push/merge/tag or complete P2-G2-LIVE/P2-008. Rollback: disable or stop the member App and restore the independently approved OAuth-only release, without legacy access fallback.

Sources: [official conversion](https://developer.work.weixin.qq.com/document/path/97106), [Bot namespace](https://developer.work.weixin.qq.com/document/path/101463). Live and preflight records: `evidence/p2-g2-yxx-identity-B-verified-1789435500033.json`, `evidence/p2-g2-yxx-identity-probe-observation-1789434282987.json`, `evidence/p2-g2-yxx-namespace-preflight-1789435859307.json`.
