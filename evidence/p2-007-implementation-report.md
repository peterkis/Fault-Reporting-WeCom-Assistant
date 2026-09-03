# P2-007 Runtime Implementation Report

## Result

P2-007 Hospital IT Domain Model is complete as a deterministic, side-effect-free domain computation layer. The implementation uses the already-authorized v1.2 catalog, alias dictionary, deterministic rules, JSON Schema contracts, and synthetic fixtures. It does not authorize or implement P2-008 or P2-G2.

## Inputs and outputs

Inputs are bounded plain JSON containing message text, a safe source reference, an injected Asia/Shanghai LocalDateTime, normalized context, and optional deterministic correlation facts. Proxy, accessor, symbol, `toJSON`, cyclic, polluted-key, non-finite, oversized, and non-plain inputs fail closed with stable P2-007 error codes.

Outputs are immutable plain domain results containing:

- canonical service candidates and selected service;
- fault taxonomy and matched deterministic rules;
- provenance-bearing facts and stable SHA-256 result hashes;
- append-only conflict resolution;
- at most one highest-value clarification;
- Incident Candidate data requiring human confirmation;
- notification recommendations with `send_authorized=false`.

## Configuration and contract inventory

- Service catalog: 11 domains and 55 services, version `0.1.0-draft`.
- Alias dictionary: 291 service aliases and 154 symptom aliases, version `0.1.0-draft`.
- Deterministic rule set: 73 versioned rules, version `0.1.0-draft`.
- Existing synthetic fixtures retained: 96 hospital IT cases, 42 multichannel cases, and 64 decision cases.
- Existing P2-007 JSON Schema and TypeScript contracts remain unchanged.
- Database changes: none. No P2-007 migration exists.

## Determinism and time contract

The runtime does not call `Date.now()`, `new Date()`, `toISOString()`, randomness, network APIs, providers, SDKs, or databases. Business time is mandatory caller input and is validated by the frozen ARCH-005 LocalDateTime implementation as `YYYY-MM-DD HH:mm:ss`. Same input, catalog version, rule version, source reference, and injected time produce the same canonical result and hash.

The targeted suite executes one identical input 100 times and observes one output hash. A bounded 2,000-turn synthetic loop completes without queues, external seams, or retained batch state.

## Test evidence

Commands and final results on 2026-09-03:

```text
node scripts/validate-p2-007-runtime.mjs
PASS: 48 checks; 10 modules; 55 services

node --test --test-concurrency=1 tests/p2-007/*.test.mjs
PASS: 21 tests; fail=0; cancelled=0; skipped=0; todo=0
Data-driven coverage: 50 catalog Alias cases and 50 deterministic Rule Engine cases

npm run validate:architecture:v1.4
PASS: 361 checks

npm run test:architecture:v1.4
PASS: 14 tests; fail=0; cancelled=0; skipped=0; todo=0

node --env-file=.env.pilot --test --test-concurrency=1 tests/*.test.mjs
PASS: 438 tests; fail=0; cancelled=0; skipped=0; todo=0
Duration: 289432.5644 ms
```

The first full-regression attempt truthfully reported 437/438 with one stale ARCH-005 assertion that still required P2-007 to be unauthorized. The assertion and lifecycle validator were updated for the separately authorized and now-completed P2-007 state; the complete suite was then rerun from the start and passed 438/438.

## Safety, privacy, and ownership

- DeepSeek/model calls: 0.
- OCR calls: 0.
- WeCom SDK/API/sender calls: 0.
- Enterprise directory network calls: 0.
- Ticket Core mutations: 0.
- Incident creation/link/broadcast: 0.
- Notification sending: 0; recommendations only.
- Facts without source reference/provenance: 0 in targeted coverage.
- Feature Flags enabled: 0; all committed P2/P3 defaults remain `false`.
- P2-G2 status: `NOT_STARTED`.

Incident grouping excludes raw message text and patient identifiers from the cluster hash. Reporter references are used only for deterministic distinct-count calculation and are not emitted in Incident Candidate output. Error codes do not contain user text, identifiers, IP addresses, tokens, or secrets.

## Resource limits

Input traversal is bounded by depth, node, string, and array limits. Catalog/rule loading has separate finite configuration limits. Rule evaluation is synchronous and does not create a worker, queue, timer, database pool, or network connection. Existing full-regression 2C4G capacity checks passed, including bounded projection, delivery, SSE, workbench, and control workloads.

## Feature Flag and rollback

P2-007 has no runtime integration seam and enables no Feature Flag. Its modules are inert unless explicitly imported and called. Operational rollback is therefore to stop importing the pure modules; repository rollback is the single P2-007 implementation commit. No data rollback is required because no migration or state mutation was introduced.

## Stop line

P2-007 is `DONE`. P2-008 and later tasks remain unauthorized. P2-G2 remains `NOT_STARTED`. DeepSeek is not integrated, WeCom is not connected, no Incident is created, and Unified Ticket Core behavior is unchanged.
