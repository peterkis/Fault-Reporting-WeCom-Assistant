# ADR-0013：P2-007 当前人员资料权威与长期 Person 身份模型

- 状态：`ACCEPTED_FOR_P2_007_DESIGN`
- 日期：2026-09-03
- 适用：P2-007 领域契约与后续人员目录 Adapter
- 不构成：真实目录接入、数据库迁移、P2-007 启动授权

## 背景

当前云端试点尚未接入医院内网，无法读取医院人员主数据或未来人员主索引。企业微信入站消息提供发送者 `userid`，但姓名与部门需要单独查询企业微信组织目录。后期医院可能建设人员主索引，同一人员还可能具备 HR 工号、SSO subject、执业身份和多院区组织关系。

## 决策

1. 系统内部生成稳定 `person_id`，作为长期人员实体主键。
2. 当前人员姓名、部门和在职状态以 `WECOM_DIRECTORY` 为资料权威。
3. 企业微信 `userid` 仅作为 `external_identity_binding`，不得成为 Ticket 永久主键。
4. 目录查询失败不得阻断消息受理、Intake 或最小 Ticket；使用 `DEFERRED` 状态并异步补齐。
5. 每次首次接触保存“上报当时”的人员资料与组织关系快照，不能用当前科室覆盖历史快照。
6. 支持一人多部门、轮转、兼岗和临时关系。
7. `reporter_department`、`occurrence_department/location` 与 `asset_registered_location` 独立建模。
8. 后期接入医院人员主索引时，以增加绑定、合并匹配和冲突审查方式演进，禁止破坏性重设历史 `person_id`。

## 当前权威链

```text
WECOM incoming from.userid
  → internal Person resolver
  → system person_id
  → WeCom external identity binding
  → WeCom Directory profile resolution
  → report-time ReporterProfileSnapshot
```

## 后期演进

```text
person_id
├── WECOM_USERID binding
├── HOSPITAL_PERSON_MASTER binding
├── HR_EMPLOYEE_ID binding
└── SSO_SUBJECT binding
```

企业微信目录和医院人员主数据描述同一个 Person 实体的不同来源与维度，而不是互相覆盖。

## 失败与隐私

- 查不到姓名/部门：仍受理，显示“待解析”。
- 停用用户或身份冲突：标记待人工审查，不静默合并。
- 原始 `userid` 不进入公共结果和普通日志。
- 普通日志只记录 opaque/HMAC 引用、查询状态、来源版本和时延。
