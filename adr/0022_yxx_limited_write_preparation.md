# ADR-0022: Independent limited Web test runtime

Status: Accepted for local implementation by the SS-010 user plan (2026-09-21).

SS-010 starts at c1af81a86951054f4898f043c43381a5842abbf2. It prepares, but does
not authorize, SS-011. Reuse the original App/workbench and Worker process entry
functions with a dedicated two-role controller. Do not call the full G2 launcher:
that launcher owns Gateway, sending and unrelated background work.

Only a dedicated, initially business-empty test database is supported. A resumed
run retains its own approved Web facts. A different run cannot adopt those facts
or reset its budget. Existing staff/catalog setup is allowed; shared hospital
data, Bot queues and third-party writers are outside this contract.

The limited App uses the existing FULL_SERVICE_LOOP composition seam, not a
FULL G2 authorization. It has one Web Worker, no App pump, Gateway, sender, AI,
Incident maintenance or Bot processor. All business transactions share one
run-scoped advisory lock and recheck time/scope/budget before commit. Each new
intake reserves one possible Ticket; reservations are never recycled in a run.
No new table, migration, business API, Ticket state machine or permanent service.

Offline check never connects, starts children/listeners, or applies migration.
The existing migration --check executes transactional DDL and is not offline.
033 and 034 plus separately approved backup/application remain prerequisites.

The r7 record and SS009 validator remain historical and immutable. SS010 uses
its own candidate/result binding. Raw execution artifacts are retained once.
Local commits only; no push, PR, merge, deployment, real OAuth, sending or live
business writes. Parent Gate, SS011 and P2-008 stop lines remain in force.
