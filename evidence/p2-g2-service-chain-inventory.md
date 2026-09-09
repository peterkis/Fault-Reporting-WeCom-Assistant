# P2-G2 能力链路盘点

当前实现已装配，定向验证采用真实 PostgreSQL、HTTP、浏览器和三业务进程/Mock SDK。当前954/954全仓回归及两轴最终独立审查已通过；真实企业微信、客户端和2C4G自然GC60分钟观察均为 NOT_RUN。早期领域缺口的RED与后续独立授权/修复另见各修复Evidence，不覆盖旧结果。

JSON逐节点保留实际模块/导出、调用者、事务、持久表、开关/授权、幂等、失败结果、场景与源码hash。

| 节点 | 当前行为 | 场景 |
|---|---|---|
| INBOUND | Normal group/direct Frames and duplicate concurrent ingress use one persistent path; current full run954/954 passed. | G2-E01, G2-E03, G2-E04, G2-E08 |
| INTAKE | Source-ordered same-second ingress, explicit new fault, bounded Direct session and group continuation implemented; no eager second Ticket path. | G2-E05, G2-E08, G2-J01 |
| CONVERSATION | Late projection fills only null bindings with identity checks and bounded cursor; 12-way replay and rollback tested. | G2-E08, G2-F04 |
| DECISION | 202 frozen source references accounted separately; 122 normal input cases and original-path limitations require current TAP/source audit and semantic review. | G2-E06, G2-E07, G2-I01 |
| SAFE_ACTION | STATUS_QUERY and BUSINESS_CONSULTATION reach human fallback; Review enqueue failure preserves Inbox and rolls back the current Decision/Action/Ticket transaction. | G2-E07, G2-F03 |
| MANUAL_REVIEW | Actual high-risk normal inbound Review is resolved via browser without rewriting original Decision/Ticket. | G2-E07, G2-J01 |
| TICKET | Normal-source browser lifecycle and independent Ticket/Conversation responsibility exercised. | G2-T01, G2-T02 |
| HUMAN_ACTION | Existing explicit human and SYSTEM commands, durable replay, rollback and uncertain response preserved. | G2-T01, G2-T03, G2-T04 |
| PRIVATE_PERMISSION | Shared retained Direct Leg authorizer at generation and actual Gateway Guard; first inbound admission remains independent. | G2-N01, G2-N02 |
| FIXED_GUIDANCE | Group-only clarification and App manual-review route suppress all private artifacts before Direct Leg; actual eligible guidance uses existing sender. | G2-E02, G2-N01 |
| HUMAN_REPLY | Existing Communication reply path now applies shared generation guard and actual three-process transport binding. | G2-N01, G2-T03 |
| INCIDENT_CANDIDATE | Three independent normal reports derive candidate from persisted source decisions; private bounded expiry maintenance retained. | G2-I01, G2-I04 |
| INCIDENT_COMMAND | Human confirm/link/unlink/recovery preserve personal Tickets; retention/PAUSED/ENDED semantics exercised via existing HTTP/browser. | G2-I01, G2-I02, G2-I03, G2-I05, G2-I06, G2-I07 |
| NOTIFICATION | Group created and Webhook closed profile; private accepted/closed defaults, optional explicit extra events; no old created-card backfill. | G2-N01, G2-N02, G2-N04 |
| DELIVERY | Mock SDK numeric ACK, disconnect/reconnect and UNKNOWN separate; actual receipt journal cannot manufacture client observation. | G2-N03, G2-F01, G2-F02 |
| REPORTER | Real grants/session and actual browser full-render ETag add/remove retry, unauthorized polling stop and re-exchange tested. | G2-R01, G2-R02, G2-R03 |

PERSON生成前预检和Gateway发送前复核使用同一目的地权威；入站资格独立。App/Worker/Gateway各一进程，池4/2/1，控制器最多另1；晚到关联维护使用已有Worker有界周期。无新数据库迁移、第二Ticket Core或第二Sender。
