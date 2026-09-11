# Conversation Center

2026-09-11 P2-G2-YXX-TICKET-ENTRY 本地实现与隔离自动化完成：当前候选1044/1044、166测试文件及两轴独立审查通过。PR #7的976项仅为历史输入；交接先读 `evidence/p2-g2-yxx-entry-report.json`、父就绪报告及 `docs/runbooks/yixiaoxiu-member-ticket-entry.md`。真实身份对应仍未证明（IDENTITY_NAMESPACE_LIVE_VERIFICATION_PENDING），定向现场及P2-G2-LIVE未授权/未运行，P2-008继续阻断。

This context defines the domain language for the lightweight Conversation Center in V1.4. It keeps conversation identity, service topics, timeline entries, and the authoritative ticket lifecycle distinct.

For P2-002 timeline projection, source mapping, ordering, checkpoint, or rebuild work, read
`docs/38_p2_002_timeline_projector.md` before changing a Contract, migration, runtime, or test.

For P2-003 durable realtime replay, authorization clipping, SSE, backpressure, or retention work,
read `docs/39_p2_003_realtime_event_log_sse.md`. Realtime objects never become domain facts.

For P2-004 Communication Message, committed Outbox, per-target Delivery, Sender/Worker,
reconciliation, internal note, or P1 notification compatibility work, read
`docs/40_p2_004_unified_communication.md`. Communication facts never own Ticket state.

For P2-005 Assignment, Handoff, per-principal Read Cursor, Control Event, Generation Fence,
or assigned Communication authorization, read
`docs/41_p2_005_assignment_handoff_generation_fence.md`. Control facts never own Ticket state.

For P2-006 Workbench REST, Pilot authorization, Human-only commands, Delivery control,
SSE routing, Polling fallback, or the Internal Alpha / Reference Client, read
`docs/42_p2_006_realtime_web_workbench.md`. The reference client is replaceable and does
not authorize P2-G1 assembly or a production frontend.

For the post-ARCH-006 rule-first sequence, deterministic result contract, Contact Journey,
Manual Review, complete Ticket lifecycle, Reporter-safe Timeline, notification policy, or
human-confirmed Incident boundary, read `docs/50_arch_006_ai_optional_rule_first_service_loop.md`
through `docs/54_p2_g2_deterministic_full_service_loop_gate.md` before changing a future
Contract, migration, Runtime, UI, task dependency, or Gate.

P2-015 is implemented behind default-false flags. For its persisted Journey/Leg,
continuation, deterministic Decision, Manual Review, Safe Action, internal Query/Command
Port, or Worker behavior, read `docs/55_p2_015_rule_first_intake_orchestration.md` through
`docs/57_p2_015_manual_review_and_safe_actions.md`. This implementation does not authorize
P2-016 UI/REST, P2-012 Incident, P2-G2, AI/OCR, or production enablement.

P2-016 is DONE after owner-approved targeted live validation. For completion or handoff,
read `evidence/p2-016-ticket-lifecycle-workbench-report.md` and
`evidence/p2-016-project-owner-approval.md`. P2-012 is DONE after owner-approved targeted live validation. Read `evidence/p2-012-human-confirmed-incident-report.md`, `evidence/p2-012-project-owner-approval.md`, and docs 62–65 for implementation and source-summary limitations. P2-G2 preparation is independently authorized through READY_FOR_LIVE_E2E; read `evidence/p2-g2-start-authorization.md`. Live work and P2-008 require separate authorization.
P2-015 remains completed and its historical evidence is immutable. P2-016's separately
authorized implementation reuses narrow backward-compatible seams; this is not a second
P2-015 completion. For Workbench, Reporter access, and notification work, read
`docs/58_p2_016_manual_review_workbench.md` through `docs/61_p2_016_wecom_notifications_template_card.md`.

## Conversation identity

**Channel Account**:
The provider account through which a conversation is held, such as a WeCom bot identity.
_Avoid_: Bot implementation, application instance

**Chat Type**:
The kind of provider conversation, either a direct conversation with one participant or a group conversation.
_Avoid_: Message type, channel mode

**External Thread Key**:
The provider-issued identity of a long-lived conversation within a Channel Account and Chat Type.
_Avoid_: Message ID, Session ID

**Conversation Thread**:
A long-lived communication window identified by its provider, Channel Account, Chat Type, and External Thread Key.
_Avoid_: Conversation Session, Ticket, chat message

**Participant**:
The person whose service topic is being handled within a Conversation Thread, including one member of a group conversation.
_Avoid_: Chat, reporter account

## Service conversation

**Conversation Session**:
A continuous service topic inside a Conversation Thread, bounded by a topic change or the end of the topic.
_Avoid_: Thread, Ticket, chat window

**Session Scope**:
The combination of a Conversation Thread, a Participant, and an optional Service Intake that keeps one service topic’s context together.
_Avoid_: Ticket scope, global conversation

**Service Intake**:
A recorded request for service that captures one requester’s need and may be associated with the authoritative Unified Ticket.
_Avoid_: Conversation, Ticket event, Incident

**Control Mode**:
The declared human/AI operating mode of a Conversation Session: HUMAN, COPILOT, or AUTO.
_Avoid_: Session status, assignment state

**Human**:
The mode in which a person retains control of externally visible replies; it is the default Conversation Session mode.
_Avoid_: Agent, operator identity

**Copilot**:
The mode in which AI may suggest a draft while a person retains reply control.
_Avoid_: Automatic reply, delegated agent

**Auto**:
The mode name reserved for an approved controlled-automation policy; it is not permission for unrestricted automatic replies.
_Avoid_: AI enabled, autonomous operation

## Timeline and lifecycle

**Conversation Item**:
A deletable and rebuildable timeline projection associated with a Conversation Session, such as a user message, reply, note, or domain event.
_Avoid_: Channel Message, Ticket Event, Delivery fact, authoritative event

**Timeline Source Fact**:
An authoritative Channel Message, Ticket Event, Communication Message/Delivery, or future Handoff Event read without mutation by the projector.
_Avoid_: Conversation Item, projection input copy

**Timeline Source Record**:
A normalized, privacy-trimmed, versioned projector input that references one Source Fact and one Projection Variant.
_Avoid_: Source Fact, raw provider payload, second event store

**Projection Variant**:
The stable distinction between independently visible Items derived from one Source Fact, such as STATUS, EXTERNAL_NOTE, or INTERNAL_NOTE.
_Avoid_: Source Type, Item Type

**Source Binding**:
The one-to-one persisted relationship between a complete projector/source/variant/session identity and its Conversation Item. It is the idempotency defense, not ownership of the Source Fact.
_Avoid_: Source Fact, global cursor, Ticket binding

**Canonical Order**:
The deterministic Session ordering tuple of occurred time, fixed source rank, source ordinal, source type, source identity, and Projection Variant.
_Avoid_: Timestamp-only order, database row order

**Projection Checkpoint**:
The global scan-optimization cursor for one projector and source stream. Only incremental projectBatch advances it with compare-and-set semantics in the same transaction as corresponding Items and Bindings; a single-Session rebuild locks but preserves it.
_Avoid_: Business fact, idempotency key, Redis cursor

**Timeline Rebuild**:
An explicitly authorized, single-Session transaction that locks the relevant global checkpoints and Session, rejects a stale snapshot against every existing Binding identity/hash/privacy/retention fence, replaces only Item/Binding projection state, verifies the persisted canonical hash, and leaves global checkpoints unchanged.
_Avoid_: Source repair, Ticket replay, ordinary incremental append

**Timeline Audience**:
The explicit query boundary EXTERNAL, WORKBENCH, or RESTRICTED_ADMIN used to filter Item visibility; no privileged audience is implicit.
_Avoid_: Visibility stored on an Item, browser-only authorization

**Realtime Event**:
An immutable, retention-bounded communication projection appended after a source fact exists and used only for authorized workbench replay.
_Avoid_: Ticket Event, Timeline Source Fact, business event ownership

**Communication Message**:
An append-only externally intended message or internal note fact. It does not own Ticket or Session state.
_Avoid_: Conversation Item, Provider request, Ticket Event

**Communication Outbox**:
An immutable send intent committed with its Communication Message before external side effects.
_Avoid_: Delivery status, attempt log, in-memory queue

**Communication Delivery**:
The current per-target delivery state containing the internal target needed by the Worker.
_Avoid_: Outbox intent, Delivery Attempt, public API view

**Delivery Attempt**:
The audit fact for one started/finalized delivery attempt or explicit reconciliation resolution.
_Avoid_: Current Delivery state, retry scheduler

**Realtime Cursor**:
The canonical PostgreSQL BIGINT event ID string last observed by one client; it is compared with the durable high watermark and retention floor.
_Avoid_: Projection Checkpoint, identity sequence value, array offset

**Retention Floor**:
The monotonic per-stream event ID at or below which replay is no longer guaranteed after an atomic contiguous-prefix cleanup.
_Avoid_: Client cursor, deletion scheduler position, fact retention policy

**Wakeup Hub**:
A process-local, payload-free latency hint that asks connected SSE writers to query PostgreSQL again; it has no replay or delivery authority.
_Avoid_: Event queue, broker, source of truth

**Generation Version**:
The monotonic generation marker for the current Conversation Session context.
_Avoid_: Model version, Session status

**Current Assignment**:
The single current internal Principal responsibility state for a Session; it is separate from Control Mode.
_Avoid_: Session owner, Ticket assignee copy

**Conversation Assignment**:
The authoritative answer to who is responsible for communicating with the requester. It is
owned by Conversation Control and must not copy or override Ticket Assignment.
_Avoid_: Ticket handler, resolver owner

**Ticket Assignment**:
The authoritative Unified Ticket Core responsibility for who resolves the fault and which
resolver team owns the work. It must not be inferred from Conversation Assignment.
_Avoid_: current communication seat, Conversation owner

**Contact Journey**:
The persisted business association across one or more independent group/direct Channel Legs
for one service contact. It never merges raw Threads or owns Ticket state.
_Avoid_: Conversation Thread merge, time-only correlation

**Manual Review Item**:
The first-class durable safe-routing outcome for ambiguous, conflicting, high-risk, or
otherwise non-automatable input. It is a valid rule result, not a classification failure.
_Avoid_: ignored message, boolean-only warning

**Handoff**:
An independently audited request/accept/release/cancel lifecycle for transferring a Session to human control.
_Avoid_: Assignment history row, mode flag

**Read Cursor**:
One Principal's monotonic last-visible Item sequence for one Session.
_Avoid_: global unread count, Realtime cursor

**Control Event**:
An append-only Assignment/Handoff/Cursor/Generation audit and command-idempotency fact.
_Avoid_: Realtime Event, Ticket Event

**Row Version**:
The revision marker for a Conversation Session representation.
_Avoid_: Generation Version, Ticket version

**Workbench Authentication Port**:
The injected boundary that establishes an internal Principal, authentication method,
expiry, and Cookie-mode CSRF context without creating a password or login store.
_Avoid_: browser-provided role, local identity database, hospital SSO implementation

**Internal Alpha / Reference Client**:
The replaceable native HTML/CSS/ES Module client used to exercise the P2-006 REST,
authorization, command, Timeline, Delivery, SSE, and Polling contracts.
_Avoid_: final production frontend, approved design system, production deployment

**Unified Ticket**:
The authoritative record of service handling lifecycle, separate from conversation identity and communication history.
_Avoid_: Conversation Session, Service Intake, second ticket

**Reporter Access Grant**:
A short-lived, single-use capability delivered to the original reporter for one Ticket's safe progress view.
_Avoid_: Ticket number credential, permanent public link, hospital identity

**Bound Reporter Session**:
A read-only access session bound to one Reporter Access Grant and one Unified Ticket; it confers no internal Workbench role or Ticket action authority.
_Avoid_: hospital SSO session, internal agent session, verified clinical identity

**Ticket Command Receipt**:
The durable outcome of one principal's identified Ticket command, preserving a single outcome when that command is retried.
_Avoid_: Ticket Event, Delivery Attempt, global command ownership

## Human-confirmed Incident

**Incident Candidate Review**:
The internal review of one persisted deterministic Decision and its immutable result hash; confirmation requires a human decision about scope and selected reports.
_Avoid_: Incident, automatic merge, cluster hash identity

**Incident**:
A human-confirmed shared fault with its own scope, responsibility and lifecycle. It preserves each reporter's individual Intake and Ticket.
_Avoid_: primary Ticket, merged Ticket, Candidate

**Incident Report**:
One individual report's audited relationship to a Candidate Review or Incident, with independent link and impact states.
_Avoid_: deduplicated reporter, Subscription, shared recovery

**Reporter Subscription**:
One reporter's notification relationship to an Incident across their reports and channels, using the established internal reporter binding.
_Avoid_: personnel master record, raw WeCom identity, Ticket ownership

**Primary Ticket Reference**:
An optional, explicitly selected linked Ticket that serves as the Incident's internal handling reference.
_Avoid_: only surviving Ticket, Incident owner, automatic Ticket closure

For P2-G2 readiness handoff or a separately authorized live run, read `evidence/p2-g2-automated-readiness-report.json`, its current `source_evidence` references and `evidence/p2-g2-yxx-entry-report.json`, and `prompts/P2-G2_rule_first_service_loop_runbook.md`. PR #7 preparation was READY_FOR_LIVE_E2E; current member-entry preparation is READY_FOR_LIVE_E2E with live identity correspondence and targeted-live authorization still pending; P2-G1 remains the last completed Gate, P2-G2-LIVE is not authorized, and P2-008 remains blocked.
