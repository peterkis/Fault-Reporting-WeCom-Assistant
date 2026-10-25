# ADR-0046: Precisely scoped communication Thread-before-Session repair

Status: Accepted for implementation under the user's explicit remaining-failure repair-plan request of 2026-10-24. This records the existing local implementation authorization; it grants no business permission or Gate approval.

## Authority and observed problem

The approved plan requires actual transaction, backend PID, lock-object and projection evidence before unifying a proven lock order. Its instruction is: "T18／T41 先绑定原事务、backend PID、锁对象和投影驱动，证实锁序问题后统一顺序". The same shared communication transaction participates in that proven Thread/Session cycle.

The original PG evidence and the controlled T36 RED/GREEN record show that the communication query retained the original Session while waiting for Thread. G1 projection now acquires Thread before its Session foreign-key work. The shared communication core must acquire that original Thread first as well. The original command, version, authorization, retention and receipt checks still execute after the wait.

ARCH006 correctly rejects an executable change in the original T00 protected communication core unless it has its own narrow authorization. The final-03 local attempt exposed that missing recorded boundary: its normal validator and its owned scope/history refusal case both reported the protected-runtime denial. The implementation repair is already authorized by the plan; it must not be mislabeled a type-only migration or granted a whole-file exemption.

## Exact permitted delta

[The versioned repair record](../contracts/communication_lock_order_repair.v1.json) pins the original and replacement query strings and their SHA-256 hashes, the original logical module, function and predecessor. ARCH006 pins those two hashes independently. It accepts the repair only when the record is valid, the exact original query occurs once in the trusted predecessor, the exact replacement occurs once in the current module, and reverting only that query makes the complete canonical compiler-erased module equal to the predecessor.

This is an ordinary approved runtime repair. It is recorded separately from T00 suffix migrations. Missing or changed authorization data, extra SQL, changes elsewhere in the module, a different protected path and dual sources remain rejected. The application continues to use the same command/query/event Ports and Unified Ticket Core.

The 49 SQL files, six protected state files, two default configuration files, original migration inventory and all historical evidence remain unchanged. Persistent flags remain false. No new endpoint, role, capability, message type, receipt envelope or retry is introduced. ADR-0045 still governs current readiness; this ADR does not produce READY or relabel the uncommitted source as a tested commit.

## Validation and rollback

Preserve the final-03 failure, the exact source/artifact snapshot, the real forbidden-path observation and the query-only complete-runtime round trip. The existing ARCH006 entry must pass its full CLI and independently reject missing scope and changed historical evidence, with exactly those two denial messages. Its boundary test covers the approved pair and rejects missing/tampered authorization, extra SQL, unrelated executable changes and another protected path.

Run the final candidate's complete tools, strict checks, build, artifact checks and all registered entries again. The communication production bytes remain unchanged by this architecture repair. Incremental rollback restores this validator/record/resource/test change together; reverting the communication production fix is a separate explicit choice and restores the documented deadlock risk.

This remains local implementation and validation. P2-G2-LIVE, P2-008, P2-G3, P3, real sending, onsite database access, deployment, publication and Gate approval retain their existing stop lines.
