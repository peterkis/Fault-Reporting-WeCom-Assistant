# ARCH-006 Capability Gap Inventory

- Inventory date: 2026-09-03
- Frozen baseline: `0a163528a94a15c5cbe6bc5e1e2063f5e0d746de`
- Method: read-only inspection of current repository documents, Evidence, and frozen Runtime files
- Classification rule: Contract, recommendation, pure function, mock seam, projection, or task plan is not reported as assembled production capability

## Existing verified capabilities

| # | Capability | Repository proof | Classification / boundary |
|---|---|---|---|
| 1 | P1 Channel Message persists first | `src/p1-003-channel-message-inbox.mjs`; `evidence/p1-003-channel-message-inbox-report.md`; P2-G1 approval | Assembled P1/P2-G1 durable inbound fact; persist-before-processing is verified |
| 2 | P1 Service Intake basic classification and 90-second aggregation | `src/p1-004-service-intake.mjs` (`DEFAULT_AGGREGATION_WINDOW_MS=90000`, deterministic request classification, advisory lock); P1-004 Evidence | Implemented compatibility intake; not the future Contact Journey orchestrator |
| 3 | Unified Ticket Core and Ticket Action state machine | `src/p1-005-pilot-ticket-core.mjs`; `src/p1-006-ticket-state-actions.mjs` | Implemented authoritative compatibility core; explicit actions only |
| 4 | Ticket Event, version, and audit | `appendTicketEvent`, optimistic `expectedVersion`, `event_ordinal` in P1-006 | Implemented append-only audit; UI coverage remains incomplete |
| 5 | Communication Message / Outbox / Delivery | `src/p2-004-communication-core.mjs`; `src/p2-004-communication-delivery-worker.mjs`; P2-G1 Evidence | Implemented and assembled for Human-only text/markdown; media/template_card Runtime remains unauthorized |
| 6 | Human takeover, Handoff, Read Cursor | `src/p2-005-conversation-control.mjs`; `docs/41_p2_005_assignment_handoff_generation_fence.md` | Implemented Conversation control facts and P2-G1 assembly |
| 7 | Workbench conversation list, Timeline, human reply, internal note | `src/p2-006-workbench-http.mjs`, command facade/query, P2-G1 approval | Implemented Internal Alpha; Ticket Panel is read-only and Incident unavailable |
| 8 | P2-G1 real Human-only conversation chain | `evidence/p2-g1-project-owner-approval.md` | Real test WeCom inbound/reply, replay, concurrency, privacy, 60-minute observation passed |
| 9 | P2-007 deterministic catalog, aliases, rules, Provenance, conflicts, clarification, Incident Candidate | `src/p2-007-rule-engine.mjs`; `evidence/p2-007-implementation-report.md` | Complete side-effect-free pure domain computation only; no DB/network/Ticket/Incident/send assembly |

## Required gaps

| # | Gap | Current evidence | Required future owner |
|---|---|---|---|
| 1 | P2-007 not formally assembled into persisted Intake/Conversation/Ticket main chain | P2-007 report says no DB, Ticket mutation, or integration seam | P2-015 |
| 2 | No Orchestrator from rule decision to safe system action | Rule engine returns `side_effects: []` and forbids Ticket/Incident/send/model effects | P2-015 |
| 3 | No first-class `MANUAL_REVIEW_REQUIRED` queue | P2-007 has `requires_human_review` boolean only; no durable review queue | P2-015 |
| 4 | No runtime assembly for group @Bot → proactive direct → Direct Organic journey | docs 44/45 are design; P2-G1 keeps group/direct Threads separate without Contact Journey Runtime | P2-015 |
| 5 | No persisted `continuation_ref` link or multi-open-Journey selection | docs 45/46 define HYBRID and selection but no migration/runtime | P2-015 |
| 6 | P2-006 does not expose full Ticket Actions | HTTP routes cover Conversation/Handoff/reply/note/delivery; no `/api/tickets/*` action routes | P2-016 |
| 7 | No dual responsibility view | Workbench shows Conversation assignment and read-only Ticket fields but not distinct communication seat/engineer/group contract | P2-016 |
| 8 | No complete Ticket-state UI loop | P2-006 Ticket Panel is read-only; no lifecycle commands or full transition UI | P2-016 |
| 9 | No Reporter-safe Timeline Runtime | docs 47 defines contract; P2-006 is internal only | P2-016 |
| 10 | No actual `template_card` Sender | P2-004 classifies template_card as unauthorized media; docs 47 says implementation pending | P2-016 |
| 11 | No Ticket Event-based user state notification policy on unified Communication path | P1 notification compatibility and P2-004 coexist; P2-004 explicitly does not rewire Ticket Event | P2-016 |
| 12 | P2-012 real Incident/Subscription not implemented | only future backlog/design exists; P2-007 creates Candidate only | P2-012 |
| 13 | Current P2-G2 is AI Shadow before complete human service loop | current plans/parallel/docs 37 define P2-G2 as AI Shadow | ARCH-006 rebaseline |

## Conclusions

The repository has a proven Human-only conversation chain and a deterministic P2-007 candidate layer, but not a complete rule-first service loop. The missing bridge is not “add a model”; it is durable deterministic orchestration, Manual Review, Contact Journey, complete Ticket lifecycle UX/notification, and human-confirmed Incident. ARCH-006 therefore inserts P2-015, P2-016, and reordered P2-012 before P2-008 and makes the new P2-G2 an AI-off full-loop Gate.

No existing completed task, tag, commit, migration, Runtime, or historical Evidence is reclassified or rewritten by this inventory.
