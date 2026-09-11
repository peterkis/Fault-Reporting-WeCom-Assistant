# P2-G2-YXX-TICKET-ENTRY independent authorization

Date: 2026-09-11. Status: AUTHORIZED; implementation NOT_STARTED; automation NOT_RUN.

Authority: user explicitly authorized local design, member-to-reporter ownership bridging, new/old cards, read-only page, isolated PostgreSQL/HTTP/browser automation, candidate evidence and future targeted-live runbook. Full input: P2-G2_YiXiaoXiu_Member_Ticket_Entry_Codex_Prompt_v1.0.md (the supplied nested path does not exist; matching flat filename used), SHA256 e1df84313daf951f1b89434736da0f4cd5fc3708d25aa5f7e3c8b659220aa9fb.

Baseline commit and fetched origin/main: 4cecdb5551da455a8b0a6c877f7f0a63ffa6eec9. Tree: 113249f7a7ea50f9ce05ee242801ce7e3c184b8f. Branch: phase2/yixiaoxiu-member-ticket-entry. HTTPS origin fetch exit0 using the existing local credential helper after SSH authentication failed. The command-scoped URL rewrite does not change remote/global configuration.

Preexisting tracked modification: .gitignore only, unstaged. Raw byte SHA256 8852c9ee0697ae9926740b9fcce83326cfb88f2022a205e878bcd508c1c21233; index blob f30bbeadaa0304c2436e8298514c76d550c51246 (mode100644, stage0), index content SHA256 6cf8aa1b611688c5932006469e1bf245d3cad398c6f9a1285187a6a9b5936167. Preserve its bytes and index; never stage/commit it. No unknown untracked or staged work at start.

Historical PR #7 candidate verified using requirePreparedG2Candidate: 64c5a08a11bb4d140b02cf0c5e43758ea57d01e76f6bfaa3b34f819c188d249e,577 candidate files,976/976 tests across158 files. Snapshot evidence/p2-g2-yxx-entry-pr7-readiness-snapshot.json, SHA256 3cdff0bfca40cbd45ec0a7f5bd537fb43cf19689fc6ef99bdd773f8dafbe91dd. Original TAP/reviews/source facts are immutable. This verification is inherited historical readiness, not a new test run or permission to send.

Design: ADR-0018 and docs/p2-g2-yixiaoxiu-member-ticket-entry.md. MEMBER_REQUIRED never falls back to legacy; authentication is not ownership; each API/304 checks the source Intake reporter and trusted enterprise/Bot namespace. Legacy Grant links only locate after member authorization, without consuming/restoring Grant or minting persistent Sessions. Web login grants no Direct Leg or private-send qualification. Unknown real namespace remains IDENTITY_NAMESPACE_UNVERIFIED.

Governance: P2 IN_PROGRESS; last task P2-012, last Gate P2-G1, last architecture task ARCH-006; active P2-G2/ASSEMBLY. Existing ASSEMBLY_AUTHORIZED profile is used while the new candidate is not ready. Its next candidate P2-G2=true authorizes only local preparation; p2_g2_live_authorized=false and subtask live_authorized=false explicitly preserve the live stop. P2-008 stays TODO_BLOCKED_BY_P2_G2.

No DDL/new migrations, dependency/lock changes, real WeCom API/SDK, real Ticket data, sends, cloud switch, formal60-minute observation, P2-G2-LIVE, P2-008, push, PR, merge, tag or release. All persistent default flags stay false.

Commit1 includes only authorization/design/governance documents. Commit2 follows actual implementation, isolated automation, same-candidate evidence and independent SPEC/STANDARDS review. Stop before targeted live; unknown real identity correspondence is stated honestly.

Authorization checks: V1.4 407 checks PASS; ARCH-006 262 checks PASS; G2 source/preparation16 checks PASS (readiness_checked=false); architecture tests18/18 PASS, exit0, zero skip/cancel/todo. Initial document synchronization exposed stale nested candidate_authorized and assembly_gates status; these two ledger fields were corrected without changing validators or Runtime.
