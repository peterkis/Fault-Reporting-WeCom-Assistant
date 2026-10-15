# 补充待跟进（WBINT-T36，默认关闭）

来源：[原 #91](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/91)、WBINT-12/A12、ADR-0031 §5。下列是本地已挂载能力；部署、真实外发和 Gate 未授权。原 SOURCE typed/五 Schema 字节及其历史注释保留，运行状态以本文件和逐票记录为准。

## 输入、输出与当前材料权限

宿主 W，同一 App/Cookie。Ticket Core、原 Conversation/Message/Outbox/Delivery 和原 receipt 仍为各自唯一事实源。处置目标是精确 `{source_ref, revision}`：WEB `web:<submission UUID>` + input_revision，BOT `channel:<message bigint>` + 实际 Intake relation sequence_no。数字保留 decimal string；源关系/规范关联与即时保留期限由服务器核验。MANUAL 没有补充入口，不构造修订。

| 方法和路径 | 真实合同 |
| --- | --- |
| GET `/api/tickets/{ticketId}/supplement-follow-up` | 仅 limit（默认50，上限100）/cursor；200 closed page |
| GET `/api/tickets/{ticketId}/supplement-follow-up/material` | 必须且仅 source_ref/revision；200 closed `{ticket_id,item}`，精确目标不依赖首个分页 |
| POST `/api/tickets/{ticketId}/supplement-follow-up` | 原 closed disposition command；200 recorded result |
| GET `/api/tickets/{ticketId}/supplement-follow-up/commands/{commandId}` | 无 query/body；200 当前原主体/用途 UUID 的 UNKNOWN、COMMITTED 或实际安全 FAILED |
| POST `/api/workbench/conversations/{sessionId}/messages` | 原 T22 command 加显式 follow_up_target；仍202原 Message/Outbox/Delivery受理 |
| GET `/api/workbench/conversations/{sessionId}/messages/commands/{commandId}` | 原 Message receipt；已有真实 bound target 另外核当前 exact材料 READ/留存 |

对应原 `workbench_supplement_follow_up_contracts.d.ts` 与五 Schema；新增闭合 `workbench_supplement_follow_up_material_contracts.d.ts`/material Schema。读 page、exact、summary 均先当前 Ticket READ/Schema，再材料留存/规范关系过滤；cursor 绑定主体、当前roles/team/责任范围和Ticket，排序 at/kind/intake/ordinal/source 在 LIMIT 前过滤。has_pending_supplements 是完整当前授权留存范围 EXISTS，不用页大小推断。DTO 无正文、内部处置 note、身份、provider receipt或SDK参数。

当前活动 ADMIN/DISPATCHER/HANDLER 且精确材料当前 READ/留存允许明确处置；无 assignee/Conversation owner 前提。仅 READ/REPORTER 不授写权。POST 必须 UUID、Idempotency-Key一致、Origin、CSRF、closed JSON，action=RECORD_DISPOSITION、mark_followed_up=true、非空白 disposition_note≤2000 Unicode code points。无需 Ticket If-Match：不修改 Ticket version/lifecycle。先授权再 receipt，在 receipt/材料/相关权威锁等待后重新授权及即时 epoch 留存核验；同 UUID 异正文/目标409，不清较新材料。

## 内部处置与可靠回复

062 只新增追加处置证据（原 ticket_command_receipt FK）和原 Message 的精确目标 binding。原 WORKBENCH_SUPPLEMENT_FOLLOW_UP ledger、scope/principal/UUID/hash、savepoint与事务复用；不新增第二 ledger、材料正文、负责人、状态或“全部已清”字段。处置正文仅内部留存，不能进入 Delivery。Ticket/事件/责任/个人READ不变。

可选回复仅真实已有 Session、原 REPLY权限和独立人工正文；无Session不显示或制造Conversation。目标纳入原 HUMAN_REPLY Message hash，在原 Message/Outbox/必要Delivery 同事务 commit。锁后当前 staff/READ/retention与原 REPLY再次核验。未绑定旧消息不追加追认，原 target 不可丢失/换目标。技术/schema/storage失败保503及 rollback，真实拒绝保持原403/404。

FOLLOWED_UP 的 VERIFIED_REPLY 只派生非空、全部必要原 Delivery 的 SENT/ACKNOWLEDGED、sent epoch和真实 attempt证明。202/PENDING/SENDING/FAILED/UNKNOWN/部分成功/空集合都不清；普通 READ/承接/内部备注不清。Worker使用原受控隔离Sender，旧r2发送或重放不清新r3；不生成第二 Delivery或另存清除状态。

## 恢复、隐私和关闭

正式bundle card/list/detail共享安全pending bool，未领取仍显示“补充待跟进”，与个人未读和Ticket/沟通责任分离。处置与外发正文独立。独立 encrypted purpose：处置原 Ticket scope；bound回复完整 SHA256(Session/Ticket/ref/revision) 的 sr-55字母 scope和 schema2 的原principal/Session/purpose/Ticket/ref/revision，未提交和UNKNOWN全部绑定。恢复前读取原 exact材料与当前用途授权，不能用首50contains当权限，也不把r2敏感内容迁到r3/另一Session。旧 unbound schema/hash不变。

响应丢失保原UUID/body/version/target，重载只读原receipt，不自动POST。REPLY-only失权只清该sr回复输入；仍获权Ticket/内部处置保持。真正身份/会话失效沿既有全局边界，材料失权按相关材料范围清敏感内容，opaque原操作仍只能核对。技术503保输入和原操作，不能当权限撤销。

两个开关 workbenchSupplementFollowUpEnabled/workbenchDraftRecoveryEnabled 组合得到 bootstrap supplement_follow_up_enabled/supplement_follow_up_draft_recovery_enabled，默认false，recovery⇒enabled。关闭拒绝新T36写/页面404、关闭新提醒；旧 bound Message 的安全只读receipt在原Session READ且exact材料READ/留存仍有效时继续200，过期或失权拒绝。原从未应用062的OFF宿主无需新Schema、不查询新处置表。已登记062后必需binding关系缺失属于503服务故障，不能退成旧未绑定Message的成功receipt。

## 迁移、资源、证据和回退

`062_workbench_supplement_follow_up.sql` 是唯一新DDL。现行迁移器默认check，可 `--check/--apply/--status`；check rollback、apply一次、已应用各mode要求原checksum+own完整PG18 catalog+原shared receipt精确guard。复用当前031→042→047/optional050及059合法receipt组合，不改旧45SQL/guard或接受 CHECK(true)。own catalog包括logged非partition关系、列type/default/null/identity/generated、validated constraints、valid/ready indexes与0自定义trigger。

单App/Worker、Gateway无真实连接、SSE32，fixture pool≤4/总≤8、communication/native concurrency1、有界page≤100、原HTTP32KiB/URL2048预算，无逐材料timer/新poller。关闭开关可回退新入口，保留证据/Message及原业务事实；不执行drop/倒迁移。定向Unit/Contract/PG/HTTP/productionbrowser及原clone工具证据见本票执行记录；原RED、技术失败、NOT_REACHED、物理/canonical/制品身份分开。整票当前 PENDING_PARENT，不表示真实外发、上线或Gate通过。
