# P2-016 human-assisted live validation — technical checks complete, owner acceptance pending

Historical run snapshot: owner acceptance was pending when this record closed. Subsequent explicit approval and DONE closeout are recorded in `evidence/p2-016-project-owner-approval.md` and `evidence/p2-016-ticket-lifecycle-workbench-report.md`; the observations below retain their original timing.

- Run: `3bdbe965-c4df-414b-bd5a-05d5f010ad53`.
- Started: `2026-09-04 16:16:05`, Asia/Shanghai. Minimum observation threshold: `16:31:05`; meeting time alone is not acceptance.
- Candidate: `3752596720f20524ff989ee9cf913b9e104e32a4c2095c48fc83804e7e75f863`.
- Scope: approved test group and user, synthetic data, process-only approvals, fresh disposable local database; no persistent feature-flag changes.
- Roles: App/Worker/Gateway, two native workbench browser sessions, one local controller/TLS process; Reporter origin `https://localhost:43117`.
- Disposable database: `p2_016_live_8d164bec_8e71_4c77_b329_4469ff36385e`. Deleted after this run; database and backend residuals verified zero.
- User chose to perform necessary UI operations manually. Native UI/client observations below are explicitly user-reported, not agent-observed screenshots. The agent controls only the approved backend/test workflow.
- One approved local Gateway-to-Worker IPC ACK-loss drill is armed for the first successful template-card ACK. This is not a natural provider/network failure and does not add a send or mutate Delivery state.
- Automated resource/events: `evidence/p2-016-live-e2e.jsonl`, filter by the exact run ID above.

## Observations

### 1. Group wake-up and private guidance

User performed a real native BOT mention without additional description and reported: “群内和单聊都收到提示”.

The `16:17:52` backend snapshot independently recorded: no Ticket; two SENT deliveries; one `GROUP_MENTION_TO_DIRECT_GUIDED` Journey with origin/current `WECOM_GROUP`, status `WAITING_DESCRIPTION`, and one Channel Leg. At `16:17:55`, Gateway authenticated=1, SSE clients=2, pending=0 and reconciliation-required=0.

### 2. Direct supplement and first card

User reported one card, suffix `0001`, receipt in both private and group conversations, private card title “已受理”, private card status “等待受理”, and group receipt “已受理”. This confirms reported receipt counts/statuses, but does not independently establish the exact source-label text on the private card.

At `16:18:47`, the controller's one-shot fault record confirmed that a successful real provider ACK was withheld from Worker over local IPC; no drill-side delivery mutation or repeat send occurred. At `16:21:04`, the backend recorded exactly one Ticket `IT-20260904-0001 / QUEUED / version=1`, one `TICKET_LINKED` Journey with origin `WECOM_GROUP`, current `WECOM_DIRECT`, entry mode `GROUP_MENTION_TO_DIRECT_GUIDED`, and two Channel Legs. Three deliveries were SENT and one was RECONCILIATION_REQUIRED. The latest resource sample showed pending=0, reconciliation-required=1 and two SSE clients. Reconciliation has not yet been performed.

### 3. Reporter card click and refresh

User reported that the new private card opened successfully, displaying `IT-20260904-0001`, suffix `0001`, title “信息系统故障报修”, status “等待受理”, reported/updated time `2026-09-04 16:18:46`, and one public timeline item “工单已受理” at that time. User refreshed and still saw the Ticket. These are human-reported client observations, not an automated browser substitute.

Independent read-only database verification recorded one CONSUMED grant and one ACTIVE session, both exchanged at `16:22:57`, with session last_seen at `16:23:27`. The Ticket remained `QUEUED / version=1`. Three deliveries were `SENT / ACKNOWLEDGED / attempt_count=1`; the deliberately ACK-lost card remained `RECONCILIATION_REQUIRED / UNKNOWN / attempt_count=1`. No manual Grant injection, token-copy instruction, TLS bypass, or query-token fallback was used.

### 4. Accept and notification

User accepted the Ticket through Workbench seat A and reported Workbench status `已接单`, resolver `P2-016 测试坐席 A / Pilot 信息保障组`, version 2, one newly received private-channel card, card title “工单状态更新” and visible status “已受理”. The Workbench showed exactly one accepted event and kept the earlier delivery as “发送结果未知，需核对”.

At `16:33:35`, the backend independently recorded exactly one Ticket `ACCEPTED / version=2`, SENT deliveries increased from three to four, and reconciliation-required remained exactly one. At the preceding sample (`16:33:24`) the run had observed `1,038,704 ms`, exceeding 15 minutes, with Gateway authenticated=1, SSE clients=2, pending=0, projection backlog=0 and reconciliation-required=1. The minimum duration is met, but the live gate remains in progress until all scoped cases and cleanup complete.

### 5. Internal note — client clarification resolved

User reported no additional WeCom card after adding the internal-only synthetic note. Their pasted Workbench content records version 3 at `16:34:41` and event 3 “记录备注 · 已接单 … 含内部备注（不会进入 Reporter 时间线）”. This pasted evidence contradicts the user's initial statement that no internal-note marker appeared: the marker is present in their supplied text.

The page the user called Reporter is actually the internal Workbench (title “服务处理工作台”, seat A, action controls and Delivery controls). Therefore this paste is **not** evidence of the Reporter timeline and is not treated as an external privacy failure or a Reporter privacy pass. The user is being asked to return to the actual “报修处理进度” window and provide its timeline section.

The user subsequently supplied the actual Reporter page, titled “报修处理进度”, with bound read-only access and Ticket `IT-20260904-0001`. Its timeline contains only “工单已受理” (`16:18:46`) and “已接单” (`16:25:33`), and no note text or note event. The detail updated time is `16:34:41`, reflecting the Ticket's latest version; that timestamp is not an exposed note. Reporter privacy is now confirmed by the user's client observation. The independent database check recorded one `ticket.note_added` event at aggregate version 3, `has_internal_note=true`, `has_external_note=false`, zero notification bindings, and unchanged total Delivery counts (four SENT, one UNKNOWN, each attempt_count=1).

### 6. Start processing

User started processing from Workbench and reported exactly one newly received private card with status “处理中”, Workbench status “处理中”, and the Reporter timeline appended exactly “正在处理” at `16:39:05` after the two existing milestones. These are human-reported observations of all three surfaces.

### 7. Controlled disconnect, pending delivery and reauthentication

The pre-drill read-only snapshot verified `IN_PROGRESS / version=4`, five SENT deliveries and one `UNKNOWN / attempt_count=1` delivery. The agent instructed the user not to operate Workbench during the controlled fault and used the existing local driver and authenticated HTTP command path (not direct business SQL writes).

- `16:41:39`: Gateway disconnected, authenticated=false. The `wait-vendor` HTTP command returned 200 and committed `WAITING_VENDOR / version=5`; one new PENDING delivery was persisted while the five SENT and one UNKNOWN remained.
- Before reconnect, an independent read-only query found the new delivery `PENDING / NOT_ATTEMPTED / attempt_count=3`, while the original ACK-lost card remained `RECONCILIATION_REQUIRED / UNKNOWN / attempt_count=1`. These attempts occurred while disconnected and are not three provider sends.
- `16:41:44`: Gateway reconnected and authenticated=true. The SDK and product role implementation were not altered for this disconnect drill.

After reauthentication, the independent read-only query recorded the new delivery `SENT / ACKNOWLEDGED / attempt_count=4`: three prior NOT_ATTEMPTED failures while disconnected, followed by successful delivery. The original UNKNOWN remained at attempt_count=1. No manual retry was needed for the waiting-vendor delivery.

At `16:42:18`, replaying the exact same authenticated HTTP command returned 200 with `replayed=true`; Ticket remained `WAITING_VENDOR / version=5`, SENT count=6 and reconciliation-required=1, without another state transition or notification.

The user then reported exactly one new private card around `16:41`, with external status “处理中”, and Reporter timeline item 4 “已联系厂商协助” at `16:41:39`. This supplies human client receipt/timeline confirmation for the controlled disconnect case.

### 8. Human reconciliation of the ACK-lost card

User selected the Workbench ADMIN action “已核实发送成功” for the original `16:18:46` private card and confirmed no additional WeCom card appeared. Their supplied Workbench showed all five Ticket-bound deliveries SENT, including the original card at “尝试 2”; Ticket remained `WAITING_VENDOR / version=5` and no new Ticket event appeared.

The independent read-only database audit recorded seven total SENT deliveries (including the earlier two guidance messages), zero UNKNOWN/PENDING, and these two attempt-ledger entries for the original card:

- Attempt 1: `RECONCILIATION_REQUIRED / UNKNOWN / COMMUNICATION_SEND_TIMEOUT`.
- Attempt 2: `SENT / ACKNOWLEDGED / OPERATOR_VERIFIED`.

The second row is the explicit administrative reconciliation audit, not a second SDK transmission. The reconciliation port increments the attempt ledger and marks SENT in its transaction; it does not invoke the provider. The user confirmed no new card, and the first delivery had remained UNKNOWN with attempt_count=1 across observation and the disconnect/reauthentication drill. At `16:48:30`, Gateway authenticated=1, SSE clients=2, pending=0 and reconciliation-required=0.

### 9. Resume and wait for requester

User performed “恢复处理” followed by “请上报人补充” in Workbench and reported exactly two new private cards, with statuses “处理中” then “待您补充”. Workbench displayed “等待上报人”. The user reported the latest Reporter timeline item “等待您补充信息” at `16:50:23`. The user did not quote the preceding Reporter item in this response, so that item is not separately claimed as client-observed here.

### 10. Resume and resolve

User performed “恢复处理” followed by “登记解决” and reported exactly two new private cards: “处理中” then “已处理，待确认”. Workbench displayed “已解决待确认”, and the latest Reporter milestone was “已处理，等待确认”. This is resolution of the synthetic Ticket only, not owner acceptance of P2-016.

### 11. Confirm closure

User confirmed closure of the synthetic Ticket through Workbench, reported exactly one new private card with status “已关闭”, Workbench status “已关闭”, and Reporter milestone “工单已关闭” at `16:55:35`. The task's final owner acceptance remains separate and pending.

### 12. Reopen

User reopened the synthetic Ticket and reported exactly one new private card with status “重新处理中”, Workbench status “重新打开”, and Reporter item 10 “已重新受理” at `16:59:39`. The final independent database audit recorded one `REOPENED / version=11` Ticket, 11 ordered Ticket events (including one internal-only note), one linked guided Journey, two Channel Legs, and 13 SENT deliveries with zero pending/dead-letter/reconciliation-required. The note had zero notification bindings. The final audit is in the matching JSON.

## Observation and cleanup

- Actual observation: `2,780,329 ms` (46 min 20.329 sec), from local `16:16:05` through `17:02:26`, 180 resource samples. This satisfies the 15-minute targeted gate, not P2-G2's separate gate or a 24-hour soak.
- App/Worker/Gateway remained three roles, plus the controller/TLS process; two native SSE sessions. Role pools 4/2/1 plus persistent controller 1. Short-lived independent read-only audit pools were max=1 and immediately closed; observed database connection peak was 7. This is not a claim of real 2C4G hardware certification.
- Runtime RSS peak/final: 247,738,368 / 236,457,984 bytes; runtime plus controller RSS peak 326,844,416 bytes. Heap peak/final: 55,783,240 / 51,810,120 bytes. Runtime CPU sample peak 18.85%. Pool-waiting, projection-backlog and projection-failure peaks were zero.
- Per-role timer peaks 4/2/3, socket peaks 14/2/3; actual role processes and owned listeners were zero after stop. Explicit disconnect/reauthentication events establish the manual drill; the automatic reconnect counter is not used to count that manual operation.
- At `17:02:27`, the controller exited 0; three roles, SSE, TLS and controller pool were closed. Both newly created browser profiles were removed. Independent OS checks found zero owned runtime/browser processes, zero listeners on 43116/43117, and zero current-run browser profiles.
- The exact authorized temporary database was dropped, with post-drop database count=0 and backend count=0. Its synthetic rows cannot be recovered from the deleted database; redacted evidence is retained. Original `.env.pilot` was not edited, and process approvals were cleared.
- Earlier policy-blocked profile/root deletions were not retried, indirectly cleaned, or bypassed. Non-profile temporary roots remain. The user's WeCom/Reporter windows were left alone; the Reporter service is stopped. Complete filesystem cleanup is not claimed.

## Pending

Post-live full regression completed: 533/533, fail/cancelled/skipped/todo=0, exit=0, duration `555687.2561 ms`, in the fresh isolated root `tmp/p2016-regression-final-e239f28ed5974ad9a98ce58e6af566b8`. See `evidence/p2-016-post-live-regression-report.json`. Explicit final owner acceptance is still pending. Successful cancellation, transfer, combined takeover, Manual Review, concurrency and SYSTEM auto-close branches are covered by automated native-browser/integration tests, not all repeated in this targeted live run. Group strong-mention capability remains UNVERIFIED and is not required. Task remains READY_FOR_TARGETED_LIVE_VALIDATION; no second implementation commit is authorized by this record alone.
