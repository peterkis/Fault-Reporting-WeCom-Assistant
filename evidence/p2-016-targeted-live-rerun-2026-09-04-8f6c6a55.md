# P2-016 targeted live rerun — interrupted

- Run: `8f6c6a55-56d2-4060-9f73-1cd883cbf4b2`.
- Candidate: `3752596720f20524ff989ee9cf913b9e104e32a4c2095c48fc83804e7e75f863`.
- Scope: approved test group and user only, synthetic fault description, local disposable PostgreSQL database, AI disabled. User confirmed the message rerun and controlled ACK-loss drill before sending.
- Start/end: `2026-09-04 15:45:31`–`2026-09-04 15:48:52`, Asia/Shanghai; observed `201546 ms`. **The 15-minute gate was NOT met. This run is NOT PASS and P2-016 remains READY_FOR_TARGETED_LIVE_VALIDATION.**
- Evidence: appended records for this run in `evidence/p2-016-live-e2e.jsonl`; native client observations in the execution transcript. Earlier failed run evidence was not overwritten.

## Observed results

1. A real native group BOT mention without fault description produced the fixed group guidance and one private prompt. At `15:46:35`, there was one `GROUP_MENTION_TO_DIRECT_GUIDED` Journey, one group leg, `WAITING_DESCRIPTION`, no Ticket and two SENT deliveries.
2. A real native direct message containing the synthetic description `P2-016 合成演练：3楼护士站HIS登录报错` created only `IT-20260904-0001`. At `15:47:17`, the same single Journey was `TICKET_LINKED`, origin `WECOM_GROUP`, current `WECOM_DIRECT`, with two Channel Legs. The actual private card showed source “群聊报修”, suffix `0001`, QUEUED and update time `15:47:07`. This confirms the previously failed group-to-direct association for the repaired candidate.
3. Exactly one actual successful template-card provider ACK was withheld on Gateway-to-Worker IPC at `15:47:07`. This was a **controlled local IPC fault**, not a natural provider/network failure. The drill made no extra provider call and did not mutate Delivery rows. The existing Worker reached `RECONCILIATION_REQUIRED / UNKNOWN / attempt_count=1`; three other deliveries were `SENT / ACKNOWLEDGED / attempt_count=1`. The card was observed once in the real client. Pending remained zero and reconciliation-required remained one through the final resource sample. No CONFIRMED_SENT command was executed before interruption; long-duration no-resend and reconciliation closure remain pending.
4. Clicking that actual card opened the WeCom embedded Reporter over trusted local HTTPS `https://localhost:43117`. The page displayed the bound session and the synthetic Ticket. Read-only DB verification showed one CONSUMED grant and one ACTIVE session, both exchanged at `15:47:34`. Native refresh retained the Reporter view. No token was manually injected/copied, no query-token fallback or TLS warning bypass was used.
5. Two native workbench browser sessions were launched by the existing helper, and resource samples recorded two SSE clients. Visual inspection of the first workbench browser was interrupted before it could be accepted as a verified UI action.

## Interruption and cleanup

Computer Use stopped the turn because it could not determine the current Windows browser URL confidently enough to enforce policy. No further Computer Use/browser actions were attempted. Only safe shutdown, cleanup checks and this handoff record followed. This is not a user rejection or a product-runtime failure, and it cannot be bypassed by switching UI mechanisms in this turn.

- The controller received `stop`; it exited **1** because observation was below 15 minutes.
- At `15:48:54`, cleanup reported role processes zero, SSE closed, controller pool closed, and both newly created browser profiles removed; old profiles untouched.
- The exact disposable database `p2_016_live_0c3dc930_60dd_4274_97cc_42d75b995a31` was dropped under the previously approved exact-name guard. Post-drop database count and backend count were both zero. Synthetic database records are not recoverable from that database; redacted evidence remains.
- TLS closed and process-only approvals/secrets were cleared. Persistent `.env.pilot` was not edited. No second implementation commit, status advancement, push or release occurred.
- The WeCom main client and its embedded Reporter window were not closed via UI after the policy stop. The Reporter service is stopped. Earlier protected/blocked temporary directories remain untouched; complete filesystem cleanup is not claimed.
- Initial HTTPS preparation attempts used the existing certificate, but the old port failed with `EADDRINUSE`; no database or Gateway was started by those attempts. Port `43117` passed a local bind check and hostname/trust-verified HTTPS probes before this run. No unrelated process was stopped.

## Remaining gates

Fresh authorized UI session; representative lifecycle notifications; UNKNOWN no-blind-resend observation and explicit reconciliation; disconnect/reauthentication checks for the current candidate; at least 15 minutes of uninterrupted controlled observation; final regression; explicit owner acceptance. Do not create the second commit or mark DONE from these partial results.
