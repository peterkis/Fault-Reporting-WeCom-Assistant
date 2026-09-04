# P2-016 targeted live validation — not passed

## Scope and identity

- Local synthetic test only; Asia/Shanghai. No clinical data, production approval, Phase 2 Go or P2-G2 acceptance.
- Run: `eaf9e6fe-86bd-49de-b185-321ae4b0e7fb`.
- Runtime input SHA-256: `0ecff720b9f5119895fcfa0a954131d3c43ccfdde191689ea7eb4d3b9c287f6a` (unchanged before/after this run).
- HEAD: `3599fa479c752ed75cd4652e5ffdaee2b212ad24`; authorization commit only. Index empty. No implementation commit, push, merge or tag.
- Owner explicitly delegated temporary local database setup/deletion, process approval variables, reuse of the configured test group/user and local Reporter hosting. Subsequent message confirmed the scoped test messages and Chrome DevTools access. This is execution authorization, not final acceptance.
- Credential/target material stayed in ignored environment or memory. No raw target IDs, connection URLs, cookies, Grant tokens, HMAC or private key are included here.

## Topology and observation

- Three product roles: APP/WORKER/GATEWAY, pools 4/2/1. Controller/TLS proxy used one additional pool connection; setup pool closed before role startup.
- Two authenticated HTTP SSE streams. These were not two native Workbench browser sessions and are not claimed as such.
- Reporter `https://localhost:44316` bound to 127.0.0.1, with an existing system-trusted localhost certificate. TLS material stayed in memory. Only Reporter routes were proxied; internal API/health probes returned 404.
- Chrome DevTools verified the unauthenticated Reporter page. Actual card click and authenticated progress rendering were verified in the real Windows WeCom embedded browser, not by copying a Grant into Chrome.
- Start 14:33:49; end 14:50:48; measured duration **1,018,504 ms** (16m 58.504s), 67 resource samples. Minimum 15-minute observation met, but that does not make this run pass.
- Peak product-role RSS 245,837,824 bytes; peak controller RSS 82,882,560 bytes; peak sampled database connections 6; SSE clients 2. Final projection backlog/failures, pending Delivery, dead letter and reconciliation-required counts all 0. Peak dead letter was 1 during the intentional disconnect.

## Observed passes

1. A real group synthetic report produced one group-safe suffix-only receipt and one private `template_card` for Ticket `IT-20260904-0001` at 14:35:56. The initial wording included a fault keyword and directly created the Ticket; it is not evidence for the missing-description case.
2. The card displayed suffix 0001, fixed external status/time and the progress link without a full Ticket UUID, raw reporter/group identity, internal note or free-text report. WeCom added its platform footer “内容由AI生成”; no AI provider was invoked or enabled.
3. Clicking that real card opened the WeCom embedded Reporter page. The database recorded one CONSUMED Grant and one ACTIVE bound Session, issued 14:37:48. The page showed the Ticket number and safe timeline. This establishes successful real-client fragment exchange; no query-token workaround was used.
4. Authenticated HTTP actions exercised ACCEPTED, IN_PROGRESS, WAITING_REQUESTER, resumed IN_PROGRESS, WAITING_VENDOR, resumed IN_PROGRESS, RESOLVED, CLOSED and REOPENED. Each corresponding private card was visually observed once with its event time. Provider delivery facts were ACKNOWLEDGED/SENT. WAITING_VENDOR intentionally uses the same safe external “处理中” status.
5. Replaying the acceptance command returned HTTP 200 / replayed=true; version stayed 2 and Delivery count stayed 3. The real client did not show a duplicate acceptance card.
6. Adding the synthetic internal note increased the Ticket version but left Delivery count unchanged at 8. The real Reporter timeline contained 10 public entries through reopening and did not contain the internal note. Page refresh retained the bound read-only session.
7. A cancel command from REOPENED returned HTTP 409 / INVALID_STATE_TRANSITION, preserving version 11 and Delivery count 11. Successful cancellation was not tested in this run.
8. A real bare bot mention at about 14:48:57 produced one safe group guidance and one fixed private single question. No second Ticket was created by the wakeup alone.

## Disconnect result — manual recovery, not automatic recovery

- 14:43:41 Gateway deliberately disconnected; WAITING_VENDOR committed normally.
- Notification stayed NOT_ATTEMPTED: four RETRY_SCHEDULED attempts followed by DEAD_LETTER on attempt 5. No Provider call and no new client card occurred during the disconnect.
- 14:44:09 Gateway reauthenticated. The exhausted Delivery did not automatically return to pending.
- 14:45:30 a narrowly scoped synthetic ADMIN invoked the existing authorized Delivery command facade (not HTTP, not raw SQL mutation) with reason LIVE_GATEWAY_RESTORED_NOT_ATTEMPTED. The only NOT_ATTEMPTED dead letter became pending and was sent once; the real client showed that waiting-vendor card, retaining event time 14:43:41.
- Therefore bounded retries and explicit manual recovery were observed. Automatic recovery after retry exhaustion is **not** a passed claim. The reconnect counter remained 0 for this explicit disconnect/connect control despite authentication changing false→true; do not treat it as an automatic network reconnect metric.

## Failure: group-to-direct Journey association

After the pure group wakeup and its actual private guidance, the same approved user sent a synthetic HIS login-error description in the bot direct chat at 14:50:26.

Expected: the direct Channel Leg belongs to that eligible group-guided Contact Journey, preserving GROUP origin and one contact association.

Observed before cleanup:

- Group wakeup Journey: GROUP_MENTION_INLINE / WECOM_GROUP → WECOM_GROUP / WAITING_DESCRIPTION.
- Follow-up Journey: DIRECT_ORGANIC / WECOM_DIRECT → WECOM_DIRECT / TICKET_LINKED.
- Three Journeys existed (including the earlier Ticket 0001), each with only one Channel Leg; the expected two-leg guided Journey did not exist.
- Ticket `IT-20260904-0002` was created for the direct follow-up, and its actual card displayed “主动单聊”, not a preserved group-guided source.
- Decision aggregates: NEEDS_DESCRIPTION / ONE_DESCRIPTION_REQUIRED = 1; TICKET_ELIGIBLE / EXPLICIT_TECHNICAL_FAULT = 2.
- Final Delivery total 14 SENT / ACKNOWLEDGED; no lost intake or dead letter remained. This does not excuse the lost association.

This is a real-client integration failure, not a confirmed root-cause diagnosis. No historical Journey was rewritten, no post-hoc binding was inserted and no runtime code was changed during the frozen run. A real-input public-interface regression and a fresh live rerun are required.

## Remaining gates

- Group-to-direct association repair and regression/live rerun.
- Real controlled Provider-invoked / ACK-unknown failure and explicit client reconciliation **NOT_RUN**. Prior synthetic tests are not substituted for this gate.
- Two authenticated native Workbench browser sessions **NOT_RUN** in this observer variant.
- Final full regression after fixes/live and explicit owner acceptance **PENDING**.
- The tdd skill requires confirmation of the proposed public regression seam before a new test is written: real-format inbound message → orchestration → Journey/Channel Leg query. Confirmation was requested; runtime code remains unchanged while pending.

## Cleanup, verified

- Temporary database `p2_016_live_bcd263fa_bc1e_4334_bbe3_da22024a3351` was checked for exact ownership/name and non-template identity, then dropped under the owner's explicit cleanup instruction. Post-drop database and backend counts both 0. No backup was made; this synthetic data is not recoverable from this run. The original configured database was not migrated or deleted.
- APP/WORKER/GATEWAY/controller stopped; loopback ports 43116/44316 no longer listen; role/controller process checks returned 0. Wrapper exit code 0 means orderly shutdown only, not scenario PASS.
- Both test Reporter windows (Chrome DevTools page and WeCom embedded page) closed; existing WeCom main window and unrelated browser tabs preserved.
- Process approvals/HMAC/TLS material expired with the process. Persistent enabled-flag count 0; no P2_016 approval variable present in the original env. Certificate store untouched.
- No browser profiles created by this run. Two earlier Edge profile directories whose deletion was blocked by tool policy remain untouched, as recorded in `evidence/p2-016-live-preparation.md`. Do not indirectly remove them through global stale-profile cleanup.
- Source state remains READY_FOR_TARGETED_LIVE_VALIDATION, **not DONE and not live-validated**. No second commit. P2-015 remains DONE; P2-012, P2-G2, P2-008 and P3 remain outside authority.

Raw aggregate observation record: `evidence/p2-016-live-e2e.jsonl`. Native UI observations above were made directly in this task; no screenshots containing private desktop surroundings were added to the repository.

## Post-cleanup static checks

`npm run validate:architecture:v1.4` passed 395 checks; `npm run test:architecture:v1.4` passed 16/16, exit 0. `git diff --check` and the companion JSON parse passed; index remained empty and the runtime fingerprint remained unchanged. These checks do not override the failed live Journey scenario or replace the outstanding full regression.
