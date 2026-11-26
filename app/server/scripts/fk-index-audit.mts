import { FK_INDEX_TARGETS, FK_STRUCTURE_COUNT_SQL } from './fk-indexes-migrate.mjs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import type { PostgresPool, PostgresTransaction } from '../src/platform/postgres-pool.mjs';

/**
 * Card 42C-1: Audits all foreign keys in a migrated PostgreSQL database against
 * leading-column non-partial non-expression B-tree indexes, and classifies missing
 * indexes into 补 / 不补 using the card's three criteria:
 *   (a) referenced parent key column(s) are deleted or updated in application code;
 *   (b) child table is expected > 1,000 rows/year under the synthetic 1-year workload（合成）;
 *   (c) FK column appears in a hot JOIN (board/search/follow/reminders/detail/timeline/H5).
 */

export type ForeignKeyDecision = '已有' | '补' | '不补';
export type ForeignKeyAuditPhase = 'pre-076' | 'post-076' | 'auto';

export interface ForeignKeyRow {
  readonly schema_table: string;
  readonly constraint_name: string;
  readonly columns: readonly string[];
  readonly parent_table: string;
  readonly parent_columns?: readonly string[];
  readonly on_delete: string;
  readonly on_update: string;
  readonly supporting_index_name: string | null;
  readonly partial_only_index_name?: string | null;
}

export interface ForeignKeyAuditItem {
  readonly schema_table: string;
  readonly constraint_name: string;
  readonly columns: readonly string[];
  readonly parent_table: string;
  readonly parent_columns: readonly string[];
  readonly on_delete: string;
  readonly on_update: string;
  readonly supporting_index_name: string | null;
  readonly partial_only_index_name: string | null;
  readonly hot_join: boolean;
  readonly hot_join_detail: string;
  readonly decision: ForeignKeyDecision;
  readonly reason: string;
  readonly proposed_index_name: string | null;
}

export interface ForeignKeyAuditSummary {
  readonly total: number;
  readonly supported: number;
  readonly missing: number;
  readonly missing_with_partial_only: number;
  readonly missing_without_any_leading_index: number;
  readonly add_count: number;
  readonly skip_count: number;
  readonly distinct_indexes_proposed: number;
  readonly distinct_076_indexes_created: number;
}

export interface ForeignKeyAuditReport {
  readonly summary: ForeignKeyAuditSummary;
  readonly items: readonly ForeignKeyAuditItem[];
}

export interface FkAuditCliOptions {
  readonly format: 'markdown' | 'json';
  readonly phase: ForeignKeyAuditPhase;
  readonly writePath: string | null;
}

interface TableAuditRule {
  readonly expectedOver1kRows: boolean;
  readonly volumeReason: string;
  readonly skipReason: string;
}

function highVolumeRule(roleVolumeNote: string): TableAuditRule {
  return Object.freeze({
    expectedOver1kRows: true,
    volumeReason: `${roleVolumeNote}，年规模 >1,000 行（按 1 年合成工单 ~50.4k / 事件 ~302.4k / 受理 ~56k 推算）`,
    skipReason: '',
  });
}

function lowVolumeRule(volumeReason: string, skipReason: string): TableAuditRule {
  return Object.freeze({
    expectedOver1kRows: false,
    volumeReason,
    skipReason,
  });
}

/**
 * Explicit per-table annual volume assumptions derived from the Card 42 one-year
 * synthetic campus workload（合成）(~50.4k tickets, ~302.4k events, ~56k intakes).
 */
export const FK_AUDIT_TABLE_CLASSIFICATION: Readonly<Record<string, TableAuditRule>> = Object.freeze({
  'communication.delivery': highVolumeRule('对外沟通投递（每条消息 >=1 次投递）'),
  'communication.delivery_attempt': highVolumeRule('对外沟通投递尝试（含重试明细）'),
  'communication.incident_notification_binding': lowVolumeRule(
    '公共故障外部通知绑定：院级公共故障极少（预计 <20 起/年），即使每起绑定 ~10–30 条订阅推送，年总量仍 <600 行（<1,000 行）',
    '公共故障通知绑定按稀发公共故障 fan-out 估算年 <1,000 行，父键无删改且非高频看板主查询 JOIN',
  ),
  'communication.message': highVolumeRule('沟通消息与内部备注实体'),
  'communication.outbox': highVolumeRule('对外沟通发件箱（与 message 一一对应）'),
  'communication.ticket_notification_binding': highVolumeRule('工单节点通知绑定'),
  'communication.ticket_round_notification_binding': highVolumeRule('处理轮次通知绑定'),
  'conversation.assignment': highVolumeRule('会话归属分配'),
  'conversation.control_event': highVolumeRule('会话接管/交接控制事件'),
  'conversation.handoff': highVolumeRule('会话接管请求'),
  'conversation.item': highVolumeRule('会话时间线投影条目'),
  'conversation.item_source_binding': highVolumeRule('时间线投影源绑定'),
  'conversation.read_cursor': highVolumeRule('坐席已读游标'),
  'conversation.session': highVolumeRule('服务会话窗口'),
  'directory.membership_current': highVolumeRule('全院通讯录成员-部门当前映射（>1,000 关系行）'),
  'incident.candidate_review': lowVolumeRule(
    '公共故障候选复核：仅跨源聚簇触发，预计年 <500 行（<1,000 行）',
    '公共故障候选复核年规模预计 <1,000 行（候选仅在聚簇异常时生成），父键无删改且未进入高频看板主查询 JOIN',
  ),
  'incident.command_receipt': lowVolumeRule(
    '公共故障命令回执：仅确认故障及状态变更写入（预计 <20 起/年 × ~5 次操作 <200 行/年）',
    '公共故障命令回执按稀发公共故障操作数估算年 <1,000 行，父键无删改且仅按主键/幂等键查询',
  ),
  'incident.incident': lowVolumeRule(
    '已确认公共故障主表：稀发全院/楼宇级故障（预计 <50 行/年）',
    '公共故障主表预计年 <1,000 行，详情按主键与 ticket PK 关联，无父键删改且未进高频看板主查询 JOIN',
  ),
  'incident.incident_event': lowVolumeRule(
    '公共故障时间线事件：预计 <50 起/年 × ~10 事件/起 <500 行/年（<1,000 行）',
    '公共故障事件表预计年 <1,000 行，父键无删改；若该 FK 未被高频 JOIN，无需额外索引',
  ),
  'incident.incident_report': lowVolumeRule(
    '公共故障关联报修单：即使每起公共故障聚合 ~10–30 条报修，年规模仍预计 <1,000 行',
    '公共故障报修关联表预计年 <1,000 行，父键无删改；仅保留已有/高频 JOIN 列索引',
  ),
  'incident.reporter_subscription': lowVolumeRule(
    '公共故障报修人订阅：随关联报修单按直连来源生成，年规模预计 <1,000 行',
    '公共故障订阅表预计年 <1,000 行，父键无删改且主要按 incident_id 批量扫描',
  ),
  'intake.channel_leg': highVolumeRule('渠道接入段（每次受理 >=1 条）'),
  'intake.contact_journey': highVolumeRule('报修接触旅程'),
  'intake.continuation_ref': highVolumeRule('连续追问引导引用'),
  'intake.deterministic_decision': highVolumeRule('规则引擎受理判定（每条消息 >=1 次）'),
  'intake.manual_review_item': highVolumeRule('人工复核队列'),
  'intake.safe_action_suggestion': highVolumeRule('安全动作建议'),
  'intake.service_intake': highVolumeRule('服务受理主表（~56k/年）'),
  'intake.service_intake_event': highVolumeRule('受理生命周期事件'),
  'intake.service_intake_message': highVolumeRule('受理原始消息关联'),
  'intake.ticket_reporter_profile': highVolumeRule('工单报修人长期档案（与工单 ~50.4k 同量级）'),
  'intake.web_command_receipt': highVolumeRule('H5 网页端命令回执'),
  'intake.web_media_upload': highVolumeRule('H5 报修媒体附件记录'),
  'intake.web_report_evaluation': highVolumeRule('H5 报修人完工评价'),
  'intake.web_report_urge': highVolumeRule('H5 报修人催单记录'),
  'intake.web_request_binding': highVolumeRule('H5 报修请求 HMAC 绑定'),
  'intake.web_submission': highVolumeRule('H5 网页提交内容'),
  'notification.card_action_receipt': highVolumeRule('卡片动作回调幂等回执'),
  'notification.card_action_task': highVolumeRule('卡片更新后台任务'),
  'notification.delivery': highVolumeRule('节点通知投递记录'),
  'notification.delivery_attempt': highVolumeRule('节点通知投递尝试'),
  'notification.outbox': highVolumeRule('节点通知发件箱'),
  'operations.audit_event': highVolumeRule('安全与运维审计事件'),
  'operations.restore_drill': lowVolumeRule(
    '运维恢复演练记录（按定期演练频率预计 <365 行/年）',
    '运维恢复演练记录年 <1,000 行，已有 backup_checkpoint_id 支撑索引',
  ),
  'pilot_ticket.closure_record': highVolumeRule('Unified Closure 关闭/撤销记录'),
  'pilot_ticket.closure_supplement_termination': highVolumeRule('关闭后补充待跟进终止标记'),
  'pilot_ticket.follow_up_due_signal': highVolumeRule('共享预约到期信号'),
  'pilot_ticket.follow_up_schedule': highVolumeRule('工单共享跟进预约'),
  'pilot_ticket.follow_up_schedule_revision': highVolumeRule('跟进预约修订历史'),
  'pilot_ticket.personal_material_read_position': highVolumeRule('工作人员个人补充材料已读水位'),
  'pilot_ticket.pilot_principal_role': lowVolumeRule(
    '坐席角色授权表（全院坐席级 <500 行，但已被主键覆盖）',
    '坐席角色表 <1,000 行，已被主键覆盖',
  ),
  'pilot_ticket.pilot_team_member': lowVolumeRule(
    '处理组成员表（全院坐席级 <500 行，且已被索引覆盖）',
    '处理组成员表 <1,000 行，已被索引覆盖',
  ),
  'pilot_ticket.reporter_access_event': highVolumeRule('报修人查看令牌审计事件'),
  'pilot_ticket.reporter_access_grant': highVolumeRule('报修人查看链接授权'),
  'pilot_ticket.reporter_access_session': highVolumeRule('报修人查看访问会话'),
  'pilot_ticket.reporter_public_ref': highVolumeRule('报修人公共引用映射'),
  'pilot_ticket.staff_completion_notification_commitment': highVolumeRule('工作人员完工通知承诺边界'),
  'pilot_ticket.ticket': highVolumeRule('工单核心主表（~50.4k/年）'),
  'pilot_ticket.ticket_command_receipt': highVolumeRule('工作台命令幂等回执'),
  'pilot_ticket.ticket_cycle_reopen': highVolumeRule('完工后重开轮次关联记录'),
  'pilot_ticket.ticket_event': highVolumeRule('工单不可变事件流（~302.4k/年）'),
  'pilot_ticket.ticket_handling_cycle': highVolumeRule('工单处理轮次记录'),
  'pilot_ticket.ticket_handling_cycle_event': highVolumeRule('处理轮次与事件绑定'),
  'pilot_ticket.ticket_public_progress': highVolumeRule('H5 对外公开进展摘要'),
  'pilot_ticket.ticket_supplement': highVolumeRule('工单补充信息记录'),
  'pilot_ticket.workbench_auth_event': highVolumeRule('工作台企微扫码登录事件'),
  'pilot_ticket.workbench_auth_session': highVolumeRule('工作台活跃认证会话'),
  'pilot_ticket.workbench_item_follow': highVolumeRule('工作人员关注条目关系'),
  'pilot_ticket.workbench_supplement_disposition': highVolumeRule('补充材料处置状态'),
  'pilot_ticket.workbench_supplement_reply_binding': highVolumeRule('补充材料回复绑定'),
  'workbench.actor_avatar_cache': lowVolumeRule(
    '工作人员头像缓存（按坐席人数 <500 行，已有主键）',
    '头像缓存按坐席数量 <1,000 行，已有主键',
  ),
  'workbench.source_group_name': lowVolumeRule(
    '来源群展示名配置表：受配置群数量限制（通常 <100 行）',
    '来源群展示名配置表按群规模通常 <100 行（<1,000 行），父表不删改主键，且 inbox 按 ref 关联，不以 updated_by 做高频 JOIN',
  ),
  'workbench.source_group_name_change': lowVolumeRule(
    '来源群展示名变更审计：暂定假设按管理组偶发改名估算 <200 次/年（<1,000 行；群总数不单独封顶历史编辑次数，若将来高频同步群名需重评）',
    '来源群展示名变更表（暂定）：偶发改名审计预计年 <1,000 行（非群数上限保证，仅当前管理修改频率较低），父表不删改主键且非高频 JOIN',
  ),
  'workbench.source_group_name_receipt': lowVolumeRule(
    '来源群展示名命令回执：与展示名编辑同量级（<200 行/年），已有主键',
    '来源群展示名回执表年 <1,000 行',
  ),
});

/** Hot-JOIN usage observed in workbench board/search/follow/reminders/detail/timeline/H5/incident queries. */
export const FK_HOT_JOIN_MAP: Readonly<Record<string, string>> = Object.freeze({
  'communication.incident_notification_binding|communication_message_id': '公共故障投递详情关联通信出站消息（p2-012-incident-query.mts）',
  'communication.incident_notification_binding|incident_event_id': '公共故障投递详情按发布事件过滤（p2-012-incident-query.mts）',
  'communication.incident_notification_binding|incident_id': '公共故障投递详情按故障过滤（p2-012-incident-query.mts）',
  'incident.reporter_subscription|incident_id': '公共故障详情按故障查询报修人订阅（p2-012-incident-query.mts）',
  'conversation.assignment|assigned_principal_id': '看板/详情/搜索读取会话责任人姓名',
  'conversation.control_event|actor_principal_id': '责任交接时间线读取操作人',
  'conversation.control_event|target_principal_id': '责任交接时间线读取目标处理人',
  'conversation.handoff|assigned_principal_id': '收件箱/详情读取接管请求责任人',
  'conversation.item_source_binding|item_id,session_id': '时间线投影器增量回溯源绑定',
  'conversation.session|service_intake_id': '提醒/看板/详情/时间线关联受理与会话（workbench-reminders.mts 等）',
  'incident.incident_event|actor_principal_id': '公共故障对外进展与内部备注详情读取操作人姓名（p2-012-incident-query.mts）',
  'incident.incident_event|incident_id': '公共故障详情/进展/备注按故障单过滤事件（p2-012-incident-query.mts）',
  'incident.incident_report|incident_id': '公共故障关联报修清单与候选列表过滤（p2-012-incident-query.mts）',
  'incident.incident_report|ticket_id': '工单时间线、故障权限与可关联报修过滤（p2-012-reporter-timeline-adapter.mts / p2-012-incident-query.mts）',
  'intake.channel_leg|conversation_thread_id': '详情/交接历史关联会话窗口',
  'intake.channel_leg|conversation_session_id': '卡片/详情/交接历史关联服务会话（web01-workbench-query.mts）',
  'intake.channel_leg|journey_id': '工作台搜索按旅程关联渠道段（workbench-search.mts）',
  'intake.channel_leg|web_submission_id,source_intake_id': '提醒查询关联网页提交与渠道段',
  'intake.contact_journey|linked_ticket_id': '关注/待复核/看板/关闭记录关联旅程与工单（workbench-follow.mts）',
  'intake.deterministic_decision|channel_leg_id': '关注/已读位置读取受理判定渠道段',
  'intake.deterministic_decision|conversation_session_id': '看板查询读取判定会话范围',
  'intake.deterministic_decision|linked_ticket_id': '看板/卡片投影/收件箱按工单查受理判定',
  'intake.manual_review_item|decision_id': '看板/关注投影读取复核依据判定（workbench-follow.mts）',
  'intake.manual_review_item|service_intake_id': '看板/关注/关闭记录读取受理关联人工复核（workbench-follow.mts）',
  'intake.manual_review_item|linked_ticket_id': '看板/卡片投影按工单读取关联复核（web01-workbench-query.mts）',
  'intake.manual_review_item|resolved_by_principal_id': '看板/关闭记录读取复核操作人',
  'intake.manual_review_item|resolution_decision_id': '关闭复核关联终判判定（web01-workbench-query.mts）',
  'intake.service_intake|primary_web_submission_id,id': '提醒/网页报修读取主网页提交',
  'intake.service_intake|manual_actor_principal_id': '代录报修详情读取代录工作人员',
  'intake.web_media_upload|intake_id': 'H5/工作台媒体读取按受理查已绑定附件（yxx-h5-media.mts）',
  'intake.web_media_upload|request_ref': 'H5 媒体读取按回执引用查附件',
  'intake.web_media_upload|submission_id,intake_id': 'H5 媒体读取按提交记录查附件',
  'intake.web_report_evaluation|ticket_id': 'H5 详情/生命周期读取工单评价',
  'intake.web_report_evaluation|completion_event_id': 'H5 详情按完工事件读取评价',
  'intake.web_report_evaluation|source_intake_id': 'H5 详情按受理读取评价',
  'intake.web_report_urge|cycle_id': 'H5 详情/关闭记录按处理轮次查催单',
  'intake.web_report_urge|source_intake_id': 'H5/提醒按受理查催单记录',
  'intake.web_submission|command_receipt_id': '补充待跟进关联网页提交命令回执',
  'intake.web_submission|intake_id,canonical_reporter_binding': 'H5 批量/提醒/网页报修按报修人绑定查提交',
  'notification.card_action_task|ticket_id': '关闭记录清理/取消关联卡片任务',
  'pilot_ticket.closure_record|ticket_id': '看板/关闭/通知查询工单关闭记录（web01-workbench-query.mts）',
  'pilot_ticket.closure_record|intake_id': '看板/关闭/通知查询受理关闭记录（web01-workbench-query.mts）',
  'pilot_ticket.closure_record|closure_ticket_event_id': '关闭通知/记录关联工单事件',
  'pilot_ticket.closure_record|closure_intake_event_id': '关闭通知/受理关闭关联受理事件',
  'pilot_ticket.closure_supplement_termination|source_intake_id': '关闭记录/补充待跟进按受理查终止标记',
  'pilot_ticket.follow_up_schedule|ticket_id,schedule_version': '提醒/跟进安排关联当前版本修订',
  'pilot_ticket.follow_up_schedule|ticket_id,scheduled_event_id': '提醒/跟进安排/关闭关联调度事件',
  'pilot_ticket.follow_up_schedule_revision|ticket_id,ticket_event_id': '跟进安排修订关联工单事件',
  'pilot_ticket.personal_material_read_position|source_intake_id': '个人已读位置按受理关联跟进状态',
  'pilot_ticket.staff_completion_notification_commitment|ticket_id,cycle_id,ticket_event_id,source_intake_id': '交接历史/H5 详情读取完工通知承诺',
  'pilot_ticket.ticket|id,current_handling_cycle_id': 'H5 详情/生命周期关联工单当前处理轮次',
  'pilot_ticket.ticket|source_intake_id': '看板/搜索/详情/H5 关联工单与原始受理',
  'pilot_ticket.ticket_command_receipt|source_intake_id': '关注/交接/受理关闭查命令回执',
  'pilot_ticket.ticket_command_receipt|closure_intake_id': '受理关闭查关闭命令回执',
  'pilot_ticket.ticket_cycle_reopen|ticket_id,completed_cycle_id,completion_event_id,source_intake_id': '交接历史/H5 详情关联重开前轮次',
  'pilot_ticket.ticket_cycle_reopen|ticket_id,reopen_event_id': '交接历史关联重开事件',
  'pilot_ticket.ticket_cycle_reopen|ticket_id,new_cycle_id,reopen_event_id': '交接历史关联重开后新轮次事件',
  'pilot_ticket.ticket_event|ticket_id': '看板/详情/时间线读取工单事件历史',
  'pilot_ticket.ticket_handling_cycle|source_intake_id': '工单详情/交接历史/H5 详情关联受理与轮次',
  'pilot_ticket.ticket_handling_cycle|first_responsibility_principal_id': '交接历史读取首次承接人员',
  'pilot_ticket.ticket_handling_cycle|first_responsibility_team_id': '交接历史读取首次承接处理组',
  'pilot_ticket.ticket_handling_cycle|ticket_id,first_responsibility_event_id': '工单详情/交接历史读取首次承接事件',
  'pilot_ticket.ticket_handling_cycle|ticket_id,cycle_start_event_id': '交接历史读取轮次开始事件',
  'pilot_ticket.ticket_handling_cycle|ticket_id': '工单详情/历史按工单关联处理轮次',
  'pilot_ticket.ticket_handling_cycle_event|ticket_id,ticket_event_id': '工单详情/交接历史关联轮次事件',
  'pilot_ticket.ticket_public_progress|ticket_event_id': 'H5 详情/时间线读取对外进展事件',
  'pilot_ticket.workbench_item_follow|source_intake_id': '看板/关注列表按受理查关注关系（workbench-follow.mts）',
  'pilot_ticket.workbench_supplement_disposition|source_intake_id': '补充待跟进/关闭记录按受理查处置状态',
  'pilot_ticket.workbench_supplement_disposition|actor_principal_id': '补充待跟进处置记录读取操作人',
  'pilot_ticket.workbench_supplement_reply_binding|source_intake_id': '补充待跟进按受理查回复绑定',
});

/** Exact index names created in database/migrations/076_fk_indexes.sql for missing FKs classified as 补. */
export const FK_PROPOSED_INDEX_MAP: Readonly<Record<string, string>> = Object.freeze({
  'communication.message|reply_to_conversation_item_id': 'communication_message_reply_item_fk_idx',
  'conversation.assignment|assigned_principal_id': 'conversation_assignment_assigned_principal_fk_idx',
  'conversation.assignment|assigned_by_principal_id': 'conversation_assignment_assigned_by_fk_idx',
  'conversation.control_event|actor_principal_id': 'conversation_control_event_actor_fk_idx',
  'conversation.control_event|target_principal_id': 'conversation_control_event_target_fk_idx',
  'conversation.control_event|handoff_id': 'conversation_control_event_handoff_fk_idx',
  'conversation.handoff|requested_by_principal_id': 'conversation_handoff_requested_by_fk_idx',
  'conversation.handoff|assigned_principal_id': 'conversation_handoff_assigned_principal_fk_idx',
  'conversation.item_source_binding|item_id,session_id': 'conversation_item_source_binding_item_session_fk_idx',
  'conversation.session|service_intake_id': 'conversation_session_service_intake_fk_idx',
  'incident.incident_event|actor_principal_id': 'incident_event_actor_principal_fk_idx',
  'incident.incident_report|ticket_id': 'incident_report_ticket_fk_idx',
  'intake.channel_leg|conversation_thread_id': 'channel_leg_conversation_thread_fk_idx',
  'intake.channel_leg|conversation_session_id': 'channel_leg_conversation_session_fk_idx',
  'intake.channel_leg|origin_channel_message_id': 'channel_leg_origin_channel_message_fk_idx',
  'intake.channel_leg|web_submission_id,source_intake_id': 'channel_leg_web_submission_intake_fk_idx',
  'intake.contact_journey|origin_session_id': 'contact_journey_origin_session_fk_idx',
  'intake.contact_journey|current_session_id': 'contact_journey_current_session_fk_idx',
  'intake.contact_journey|linked_ticket_id': 'contact_journey_linked_ticket_fk_idx',
  'intake.continuation_ref|journey_id': 'continuation_ref_journey_fk_idx',
  'intake.continuation_ref|origin_leg_id': 'continuation_ref_origin_leg_fk_idx',
  'intake.continuation_ref|target_leg_id': 'continuation_ref_target_leg_fk_idx',
  'intake.deterministic_decision|channel_leg_id': 'deterministic_decision_leg_intake_sub_fk_idx',
  'intake.deterministic_decision|channel_leg_id,service_intake_id,primary_web_submission_id': 'deterministic_decision_leg_intake_sub_fk_idx',
  'intake.deterministic_decision|conversation_session_id': 'deterministic_decision_session_fk_idx',
  'intake.deterministic_decision|linked_ticket_id': 'deterministic_decision_linked_ticket_fk_idx',
  'intake.deterministic_decision|primary_web_submission_id': 'deterministic_decision_primary_web_sub_fk_idx',
  'intake.manual_review_item|decision_id': 'manual_review_item_decision_fk_idx',
  'intake.manual_review_item|service_intake_id': 'manual_review_item_service_intake_fk_idx',
  'intake.manual_review_item|linked_ticket_id': 'manual_review_item_linked_ticket_fk_idx',
  'intake.manual_review_item|resolved_by_principal_id': 'manual_review_item_resolved_by_fk_idx',
  'intake.manual_review_item|resolution_decision_id': 'manual_review_item_resolution_decision_fk_idx',
  'intake.service_intake|primary_web_submission_id,id': 'service_intake_primary_web_sub_id_fk_idx',
  'intake.service_intake|manual_actor_principal_id': 'service_intake_manual_actor_fk_idx',
  'intake.ticket_reporter_profile|source_intake_id': 'ticket_reporter_profile_source_intake_fk_idx',
  'intake.web_media_upload|intake_id': 'web_media_upload_intake_fk_idx',
  'intake.web_media_upload|request_ref': 'web_media_upload_request_ref_fk_idx',
  'intake.web_media_upload|submission_id,intake_id': 'web_media_upload_submission_intake_fk_idx',
  'intake.web_report_evaluation|ticket_id': 'web_report_evaluation_ticket_fk_idx',
  'intake.web_report_evaluation|completion_event_id': 'web_report_evaluation_completion_event_fk_idx',
  'intake.web_report_evaluation|source_intake_id': 'web_report_evaluation_source_intake_fk_idx',
  'intake.web_report_urge|cycle_id': 'web_report_urge_cycle_fk_idx',
  'intake.web_report_urge|source_intake_id': 'web_report_urge_source_intake_fk_idx',
  'intake.web_submission|command_receipt_id': 'web_submission_command_receipt_fk_idx',
  'intake.web_submission|intake_id,canonical_reporter_binding': 'web_submission_intake_reporter_fk_idx',
  'notification.card_action_task|ticket_id': 'card_action_task_ticket_fk_idx',
  'operations.audit_event|actor_principal_id': 'audit_event_actor_principal_fk_idx',
  'pilot_ticket.closure_record|ticket_id': 'closure_record_ticket_fk_idx',
  'pilot_ticket.closure_record|intake_id': 'closure_record_intake_fk_idx',
  'pilot_ticket.closure_record|closure_ticket_event_id': 'closure_record_ticket_event_fk_idx',
  'pilot_ticket.closure_record|closure_intake_event_id': 'closure_record_intake_event_fk_idx',
  'pilot_ticket.closure_record|aborted_cycle_event_id': 'closure_record_aborted_cycle_event_fk_idx',
  'pilot_ticket.closure_supplement_termination|source_intake_id': 'closure_supplement_term_source_intake_fk_idx',
  'pilot_ticket.follow_up_schedule|ticket_id,schedule_version': 'follow_up_schedule_ticket_version_fk_idx',
  'pilot_ticket.follow_up_schedule|ticket_id,scheduled_event_id': 'follow_up_schedule_ticket_event_fk_idx',
  'pilot_ticket.follow_up_schedule_revision|ticket_id,ticket_event_id': 'follow_up_schedule_rev_ticket_event_fk_idx',
  'pilot_ticket.personal_material_read_position|source_intake_id': 'personal_material_read_source_intake_fk_idx',
  'pilot_ticket.staff_completion_notification_commitment|ticket_id,cycle_id,ticket_event_id,source_intake_id': 'staff_completion_commit_cycle_fk_idx',
  'pilot_ticket.ticket|id,current_handling_cycle_id': 'ticket_id_current_handling_cycle_fk_idx',
  'pilot_ticket.ticket_command_receipt|source_intake_id': 'ticket_command_receipt_source_intake_fk_idx',
  'pilot_ticket.ticket_command_receipt|closure_intake_id': 'ticket_command_receipt_closure_intake_fk_idx',
  'pilot_ticket.ticket_cycle_reopen|ticket_id,completed_cycle_id,completion_event_id,source_intake_id': 'ticket_cycle_reopen_completed_cycle_fk_idx',
  'pilot_ticket.ticket_cycle_reopen|ticket_id,reopen_event_id': 'ticket_cycle_reopen_reopen_event_fk_idx',
  'pilot_ticket.ticket_cycle_reopen|ticket_id,new_cycle_id,reopen_event_id': 'ticket_cycle_reopen_new_cycle_event_fk_idx',
  'pilot_ticket.ticket_handling_cycle|source_intake_id': 'ticket_handling_cycle_source_intake_fk_idx',
  'pilot_ticket.ticket_handling_cycle|first_responsibility_principal_id': 'ticket_handling_cycle_first_principal_fk_idx',
  'pilot_ticket.ticket_handling_cycle|first_responsibility_team_id': 'ticket_handling_cycle_first_team_fk_idx',
  'pilot_ticket.ticket_handling_cycle|ticket_id,first_responsibility_event_id': 'ticket_handling_cycle_first_event_fk_idx',
  'pilot_ticket.ticket_handling_cycle|ticket_id,cycle_start_event_id': 'ticket_handling_cycle_start_event_fk_idx',
  'pilot_ticket.ticket_handling_cycle_event|ticket_id,ticket_event_id': 'ticket_handling_cycle_event_ticket_event_fk_idx',
  'pilot_ticket.ticket_public_progress|ticket_event_id': 'ticket_public_progress_ticket_event_fk_idx',
  'pilot_ticket.workbench_item_follow|source_intake_id': 'workbench_item_follow_source_intake_fk_idx',
  'pilot_ticket.workbench_supplement_disposition|source_intake_id': 'workbench_supp_disp_source_intake_fk_idx',
  'pilot_ticket.workbench_supplement_disposition|actor_principal_id': 'workbench_supp_disp_actor_fk_idx',
  'pilot_ticket.workbench_supplement_reply_binding|source_intake_id': 'workbench_supp_reply_source_intake_fk_idx',
});

/**
 * Queries pg_constraint and pg_index using ordinality-based btree leading-key matching.
 * PostgreSQL stores indkey::int2[] as 0-based; unnest() WITH ORDINALITY ensures positional
 * key 1 is always compared (and INCLUDE columns are excluded via indnkeyatts).
 */
export const FK_AUDIT_SQL = `
WITH fk AS (
  SELECT
    c.oid AS constraint_oid,
    c.conrelid,
    n.nspname || '.' || r.relname AS schema_table,
    c.conname AS constraint_name,
    c.conkey,
    ARRAY(
      SELECT a.attname::text
      FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, pos)
      JOIN pg_attribute AS a
        ON a.attrelid = c.conrelid
       AND a.attnum = k.attnum
      ORDER BY k.pos
    ) AS columns,
    pn.nspname || '.' || pr.relname AS parent_table,
    ARRAY(
      SELECT pa.attname::text
      FROM unnest(c.confkey) WITH ORDINALITY AS pk(attnum, pos)
      JOIN pg_attribute AS pa
        ON pa.attrelid = c.confrelid
       AND pa.attnum = pk.attnum
      ORDER BY pk.pos
    ) AS parent_columns,
    CASE c.confdeltype
      WHEN 'a' THEN 'NO ACTION'
      WHEN 'r' THEN 'RESTRICT'
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN 'SET NULL'
      WHEN 'd' THEN 'SET DEFAULT'
      ELSE c.confdeltype::text
    END AS on_delete,
    CASE c.confupdtype
      WHEN 'a' THEN 'NO ACTION'
      WHEN 'r' THEN 'RESTRICT'
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN 'SET NULL'
      WHEN 'd' THEN 'SET DEFAULT'
      ELSE c.confupdtype::text
    END AS on_update
  FROM pg_constraint AS c
  JOIN pg_class AS r ON r.oid = c.conrelid
  JOIN pg_namespace AS n ON n.oid = r.relnamespace
  JOIN pg_class AS pr ON pr.oid = c.confrelid
  JOIN pg_namespace AS pn ON pn.oid = pr.relnamespace
  WHERE c.contype = 'f'
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg_toast%'
)
SELECT
  fk.schema_table,
  fk.constraint_name,
  fk.columns,
  fk.parent_table,
  fk.parent_columns,
  fk.on_delete,
  fk.on_update,
  (
    SELECT ic.relname::text
    FROM pg_index AS i
    JOIN pg_class AS ic ON ic.oid = i.indexrelid
    JOIN pg_am AS am ON am.oid = ic.relam AND am.amname = 'btree'
    WHERE i.indrelid = fk.conrelid
      AND i.indisvalid
      AND i.indisready
      AND i.indislive
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND i.indnkeyatts >= cardinality(fk.conkey)
      AND ARRAY(
        SELECT k.attnum
        FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS k(attnum, pos)
        WHERE k.pos <= cardinality(fk.conkey)
        ORDER BY k.pos
      ) = fk.conkey
    ORDER BY ic.relname
    LIMIT 1
  ) AS supporting_index_name,
  (
    SELECT ic.relname::text
    FROM pg_index AS i
    JOIN pg_class AS ic ON ic.oid = i.indexrelid
    JOIN pg_am AS am ON am.oid = ic.relam AND am.amname = 'btree'
    WHERE i.indrelid = fk.conrelid
      AND i.indisvalid
      AND i.indisready
      AND i.indislive
      AND i.indpred IS NOT NULL
      AND i.indexprs IS NULL
      AND i.indnkeyatts >= cardinality(fk.conkey)
      AND ARRAY(
        SELECT k.attnum
        FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS k(attnum, pos)
        WHERE k.pos <= cardinality(fk.conkey)
        ORDER BY k.pos
      ) = fk.conkey
    ORDER BY ic.relname
    LIMIT 1
  ) AS partial_only_index_name
FROM fk
ORDER BY fk.schema_table, fk.constraint_name
`;

/**
 * Checks whether the referenced parent key column(s) (`confkey`) are deleted or updated in app code.
 * Note: `workbench-ticket-completion.mts` updates `ticket_handling_cycle.staff_completion_event_id`,
 * NOT `ticket_handling_cycle.id`, so FKs referencing only `(id)` or `(ticket_id, id)` do NOT trigger (a).
 */
export function parentKeyMutatedReason(
  parentTable: string,
  parentColumns: readonly string[] = [],
): string | null {
  if (parentTable === 'conversation.item') {
    return '父表 conversation.item 在时间线重建（p2-002-timeline-projector.mts）时执行 DELETE';
  }
  if (
    parentTable === 'pilot_ticket.ticket_handling_cycle'
    && parentColumns.includes('staff_completion_event_id')
  ) {
    return '父表被引用唯一键列 staff_completion_event_id 在完工提交（workbench-ticket-completion.mts）时执行 UPDATE';
  }
  return null;
}

export function classifyForeignKey(row: ForeignKeyRow): ForeignKeyAuditItem {
  const key = `${row.schema_table}|${row.columns.join(',')}`;
  const hotDetail = FK_HOT_JOIN_MAP[key] ?? '';
  const hotJoin = hotDetail.length > 0;
  const partialOnly = row.partial_only_index_name ?? null;
  const parentCols = row.parent_columns ?? [];

  if (row.supporting_index_name) {
    return Object.freeze({
      schema_table: row.schema_table,
      constraint_name: row.constraint_name,
      columns: Object.freeze([...row.columns]),
      parent_table: row.parent_table,
      parent_columns: Object.freeze([...parentCols]),
      on_delete: row.on_delete,
      on_update: row.on_update,
      supporting_index_name: row.supporting_index_name,
      partial_only_index_name: null,
      hot_join: hotJoin,
      hot_join_detail: hotDetail,
      decision: '已有',
      reason: `已有完整前导列索引 ${row.supporting_index_name}`,
      proposed_index_name: null,
    });
  }

  const rule = FK_AUDIT_TABLE_CLASSIFICATION[row.schema_table];
  const parentMutated = parentKeyMutatedReason(row.parent_table, parentCols);
  const reasons: string[] = [];
  if (parentMutated) reasons.push(`(a) ${parentMutated}`);
  if (rule) {
    if (rule.expectedOver1kRows) {
      reasons.push(`(b) ${rule.volumeReason}`);
    }
  } else {
    reasons.push('(b-待确认) 未登记表：需人工核定年规模假设（暂按保守补齐）');
  }
  if (hotJoin) reasons.push(`(c) 高频 JOIN（${hotDetail}）`);
  if (partialOnly) reasons.push(`现有仅部分索引 ${partialOnly}，不计入完整 FK 支撑`);

  if (reasons.some((entry) => entry.startsWith('(a)') || entry.startsWith('(b') || entry.startsWith('(c)'))) {
    const proposed = FK_PROPOSED_INDEX_MAP[key] ?? `${row.schema_table.split('.')[1] ?? 'tbl'}_${row.columns.join('_')}_fk_idx`;
    const subsumedNote = key === 'intake.deterministic_decision|channel_leg_id'
      ? '；复用三列复合索引前导列'
      : '';
    return Object.freeze({
      schema_table: row.schema_table,
      constraint_name: row.constraint_name,
      columns: Object.freeze([...row.columns]),
      parent_table: row.parent_table,
      parent_columns: Object.freeze([...parentCols]),
      on_delete: row.on_delete,
      on_update: row.on_update,
      supporting_index_name: null,
      partial_only_index_name: partialOnly,
      hot_join: hotJoin,
      hot_join_detail: hotDetail,
      decision: '补',
      reason: `${reasons.join('；')} → 索引 ${proposed}${subsumedNote}`,
      proposed_index_name: proposed,
    });
  }

  return Object.freeze({
    schema_table: row.schema_table,
    constraint_name: row.constraint_name,
    columns: Object.freeze([...row.columns]),
    parent_table: row.parent_table,
    parent_columns: Object.freeze([...parentCols]),
    on_delete: row.on_delete,
    on_update: row.on_update,
    supporting_index_name: null,
    partial_only_index_name: partialOnly,
    hot_join: hotJoin,
    hot_join_detail: hotDetail,
    decision: '不补',
    reason: rule ? `${rule.skipReason}（${rule.volumeReason}）` : '低频表且无父键删改与高频 JOIN',
    proposed_index_name: null,
  });
}

export function evaluateForeignKeyAudit(rows: readonly ForeignKeyRow[], installed076: number): ForeignKeyAuditReport {
  const sorted = [...rows].sort((a, b) =>
    `${a.schema_table}|${a.constraint_name}`.localeCompare(`${b.schema_table}|${b.constraint_name}`),
  );
  const items = sorted.map(classifyForeignKey);
  const supported = items.filter((item) => item.decision === '已有').length;
  const missingItems = items.filter((item) => item.decision !== '已有');
  const addItems = missingItems.filter((item) => item.decision === '补');
  const skipItems = missingItems.filter((item) => item.decision === '不补');
  const missingWithPartial = missingItems.filter((item) => item.partial_only_index_name !== null).length;
  const distinctProposed = new Set(
    addItems
      .filter((item) => item.proposed_index_name !== null)
      .map((item) => `${item.schema_table.split('.')[0] ?? ''}.${item.proposed_index_name}`),
  ).size;
  return Object.freeze({
    summary: Object.freeze({
      total: items.length,
      supported,
      missing: missingItems.length,
      missing_with_partial_only: missingWithPartial,
      missing_without_any_leading_index: missingItems.length - missingWithPartial,
      add_count: addItems.length,
      skip_count: skipItems.length,
      distinct_indexes_proposed: distinctProposed,
      distinct_076_indexes_created: installed076,
    }),
    items: Object.freeze(items),
  });
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function renderForeignKeyAuditMarkdown(
  report: ForeignKeyAuditReport,
  options: { readonly phase?: ForeignKeyAuditPhase; readonly sourceNote?: string } = {},
): string {
  const { summary, items } = report;
  const resolvedPhase: 'pre-076' | 'post-076' = options.phase && options.phase !== 'auto'
    ? options.phase
    : summary.add_count === 0 && summary.distinct_076_indexes_created > 0
      ? 'post-076'
      : 'pre-076';
  const phaseLabel = resolvedPhase === 'post-076'
    ? 'post-076（已应用 `076_fk_indexes.sql` 复核阶段）'
    : 'pre-076（迁移 `076_fk_indexes.sql` 前基线审计阶段）';
  const addDescription = resolvedPhase === 'post-076'
    ? `本次复核残留「补」项为 ${summary.add_count} 条；` + (summary.distinct_076_indexes_created > 0
      ? `实测已有 ${summary.distinct_076_indexes_created} 个 \`076_fk_indexes.sql\` 索引投入支撑`
      : '请核对 `076_fk_indexes.sql` 是否已应用')
    : `拟在 \`076_fk_indexes.sql\` 新增 ${summary.distinct_indexes_proposed} 个物理索引（含 1 组三列复合前导列复用）`;
  const lines: string[] = [
    '# Card 42C-1 外键支撑索引审计清单',
    '',
    options.sourceNote ??
      `> 数据来源：\`app/server/scripts/fk-index-audit.mts\` 对已迁移 PG18 数据库 \`pg_constraint\` / \`pg_index\` 的实时审计输出（审计阶段：${phaseLabel}；年量级依据卡 42 一年合成工作负载（合成）推算）。`,
    '',
    '## 汇总统计',
    '',
    '| 指标 | 数值 | 说明 |',
    '| --- | ---: | --- |',
    `| 审计阶段 | ${resolvedPhase} | ${phaseLabel} |`,
    `| 外键约束总数 | ${summary.total} | 全库非系统 Schema 外键约束 |`,
    `| 已有完整前导列索引 | ${summary.supported} | 完整 B-tree（\`amname = 'btree'\`、非部分、非表达式）且前导列顺序一致 |`,
    `| 缺少完整支撑索引（缺失合计） | ${summary.missing} | 其中 ${summary.missing_with_partial_only} 条仅有部分索引（不计入完整支撑），${summary.missing_without_any_leading_index} 条无任何前导索引 |`,
    `| 结论：补（待补/残留） | ${summary.add_count} | ${addDescription} |`,
    `| 已物理创建 076 索引数 | ${summary.distinct_076_indexes_created} | 实测已在 \`pg_index\` 生效的 \`076_fk_indexes.sql\` 索引数 |`,
    `| 结论：不补 | ${summary.skip_count} | 低频表（公共故障低频子表 / 来源群名，按（合成）年 <1,000 行）且无父键删改与高频 JOIN |`,
    '',
    '## 判断规则',
    '',
    '- **(a) 父表被引用列（`confkey`）删改**：仅当外键直接引用的父表列存在业务 `DELETE`（如 `conversation.item` 在时间线重建时删除）或业务 `UPDATE`（如 `pilot_ticket.ticket_handling_cycle.staff_completion_event_id`）时记为 (a)；仅引用 `ticket_handling_cycle(id)` 或 `(ticket_id, id)` 的外键不触发 (a)。',
    '- **(b) 子表规模 > 1,000 行**：按卡 42 一年合成工作负载（合成）（`ticket` ~50.4k、`ticket_event` ~302.4k、`service_intake` ~56k）结合各子表业务角色逐表评估；公共故障与来源群名配置表在当前（合成）假设下 <1,000 行（`source_group_name_change` 为暂定编辑频率假设）。',
    '- **(c) 高频 JOIN**：出现在看板/搜索/关注/提醒/详情/时间线/H5/公共故障详情读取路径的 `JOIN` 或 `WHERE` 关联列（含已有索引列及 `incident_event.actor_principal_id`、`incident_report.ticket_id`）。',
    '- **部分/表达式/非 B-tree 索引不计入支撑**：仅 `amname = \'btree\'`、无 `WHERE` 谓词（`indpred IS NULL`）、非表达式（`indexprs IS NULL`）、且 `unnest(indkey::smallint[]) WITH ORDINALITY` 前缀完全匹配 `conkey` 的有效/就绪/存活索引计为「已有」。',
    '',
    '## 全量外键清单',
    '',
    '| # | 子表 (`schema.table`) | 约束名 | 外键列 | 父表 | ON DELETE / ON UPDATE | 高频 JOIN | 结论 | 原因 / 索引名 |',
    '| ---: | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  items.forEach((item, index) => {
    const cols = item.columns.join(', ');
    const actions = `${item.on_delete} / ${item.on_update}`;
    const hotLabel = item.hot_join ? `是（${item.hot_join_detail}）` : '否';
    lines.push(
      `| ${index + 1} | \`${escapeCell(item.schema_table)}\` | \`${escapeCell(item.constraint_name)}\` | \`${escapeCell(cols)}\` | \`${escapeCell(item.parent_table)}\` | ${escapeCell(actions)} | ${escapeCell(hotLabel)} | ${item.decision} | ${escapeCell(item.reason)} |`,
    );
  });

  lines.push('');
  return lines.join('\n');
}

export function parseFkAuditArgs(argv: readonly string[]): FkAuditCliOptions {
  let format: 'markdown' | 'json' = 'markdown';
  let phase: ForeignKeyAuditPhase = 'auto';
  let writePath: string | null = null;
  for (const arg of argv) {
    if (arg === '--format=markdown') {
      format = 'markdown';
    } else if (arg === '--format=json') {
      format = 'json';
    } else if (arg === '--phase=pre-076') {
      phase = 'pre-076';
    } else if (arg === '--phase=post-076') {
      phase = 'post-076';
    } else if (arg === '--phase=auto') {
      phase = 'auto';
    } else if (arg.startsWith('--write=')) {
      const value = arg.slice('--write='.length).trim();
      if (!value) throw Error('FK_INDEX_AUDIT_ARGUMENT_INVALID');
      writePath = value;
    } else {
      throw Error('FK_INDEX_AUDIT_ARGUMENT_INVALID');
    }
  }
  return Object.freeze({ format, phase, writePath });
}

export async function runForeignKeyIndexAudit(options: {
  readonly databaseUrl?: string;
  readonly pool?: PostgresPool | PostgresTransaction;
}): Promise<ForeignKeyAuditReport> {
  const ownPool = options.pool ? null : createPostgresPool({
    connectionString: options.databaseUrl ?? '',
    max: 1,
    application_name: 'fk_index_audit',
  });
  const queryable = options.pool ?? ownPool;
  if (!queryable) throw Error('FK_INDEX_AUDIT_DATABASE_URL_REQUIRED');
  try {
    // Both inventories use one catalog snapshot, including when there are no FK rows.
    const { rows: [inventory] } = await queryable.query<{ fks: ForeignKeyRow[]; installed: number }>(
      `SELECT ARRAY(SELECT row_to_json(fk) FROM (${FK_AUDIT_SQL}) AS fk) AS fks,
              ${FK_STRUCTURE_COUNT_SQL} AS installed`,
      [JSON.stringify(FK_INDEX_TARGETS)],
    );
    if (!inventory) throw Error('FK_INDEX_AUDIT_INVENTORY_MISSING');
    return evaluateForeignKeyAudit(inventory.fks, inventory.installed);
  } finally {
    if (ownPool) await ownPool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseFkAuditArgs(process.argv.slice(2));
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) throw Error('FK_INDEX_AUDIT_DATABASE_URL_REQUIRED');
  const report = await runForeignKeyIndexAudit({ databaseUrl });
  const output = options.format === 'json'
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderForeignKeyAuditMarkdown(report, { phase: options.phase });
  if (options.writePath) {
    await writeFile(resolve(process.cwd(), options.writePath), output, 'utf8');
    console.log(JSON.stringify({ ok: true, wrote: options.writePath, phase: options.phase, summary: report.summary }));
  } else {
    process.stdout.write(output);
  }
}
