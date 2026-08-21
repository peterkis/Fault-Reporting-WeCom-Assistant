-- 医院信息故障智能报修助手：增量数据模型草案
-- 版本：1.0.0
-- 注意：
-- 1. 本文件不创建现有 Tickets 核心表。
-- 2. ticket_id / incident_id 外键需在对齐现有数据库后补充。
-- 3. 生产执行前必须拆分为可审查的迁移文件。
-- 4. 需要 pgcrypto 的 gen_random_uuid()；也可改为应用层生成 UUID。

CREATE SCHEMA IF NOT EXISTS intake;
CREATE SCHEMA IF NOT EXISTS incident;
CREATE SCHEMA IF NOT EXISTS notification;

CREATE TABLE IF NOT EXISTS intake.channel_message (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider varchar(32) NOT NULL,
    msg_id varchar(256) NOT NULL,
    req_id varchar(256),
    bot_id varchar(256),
    chat_type varchar(16) NOT NULL CHECK (chat_type IN ('single','group')),
    chat_id varchar(256),
    sender_user_id varchar(256) NOT NULL,
    msg_type varchar(32) NOT NULL,
    create_time timestamptz NOT NULL,
    raw_text text,
    clean_text text,
    raw_payload_encrypted bytea,
    processing_status varchar(32) NOT NULL DEFAULT 'RECEIVED',
    privacy_class varchar(32) NOT NULL DEFAULT 'INTERNAL',
    trace_id varchar(128) NOT NULL,
    retention_until timestamptz,
    received_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_channel_message_provider_msg UNIQUE (provider, msg_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_message_sender_time
    ON intake.channel_message (sender_user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_message_chat_time
    ON intake.channel_message (chat_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_message_status
    ON intake.channel_message (processing_status, received_at);

CREATE TABLE IF NOT EXISTS intake.service_intake (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    intake_no varchar(64) NOT NULL UNIQUE,
    source_channel varchar(32) NOT NULL,
    primary_message_id uuid NOT NULL REFERENCES intake.channel_message(id),
    reporter_wecom_userid varchar(256) NOT NULL,
    reporter_person_id uuid,
    reporter_org_assignment_id uuid,
    request_type varchar(32) NOT NULL DEFAULT 'UNKNOWN',
    summary varchar(500),
    reported_campus_id varchar(64),
    reported_department_id varchar(64),
    reported_location_text varchar(500),
    status varchar(32) NOT NULL DEFAULT 'RECEIVED',
    ticket_id uuid,
    incident_id uuid,
    version integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (request_type IN (
        'INCIDENT','SERVICE_REQUEST','QUESTION','COMPLAINT',
        'STATUS_QUERY','FOLLOW_UP','CHATTER','UNKNOWN'
    )),
    CHECK (status IN (
        'RECEIVED','TICKET_CREATED','WAITING_DESCRIPTION','WAITING_TRIAGE',
        'LINKED_INCIDENT','COMPLETED','IGNORED','FAILED'
    ))
);

CREATE INDEX IF NOT EXISTS idx_service_intake_reporter_time
    ON intake.service_intake (reporter_wecom_userid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_intake_ticket
    ON intake.service_intake (ticket_id);
CREATE INDEX IF NOT EXISTS idx_service_intake_status
    ON intake.service_intake (status, created_at);

CREATE TABLE IF NOT EXISTS intake.intake_message_rel (
    intake_id uuid NOT NULL REFERENCES intake.service_intake(id) ON DELETE CASCADE,
    message_id uuid NOT NULL REFERENCES intake.channel_message(id) ON DELETE RESTRICT,
    relation_type varchar(32) NOT NULL,
    sequence_no integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (intake_id, message_id),
    UNIQUE (intake_id, sequence_no),
    CHECK (relation_type IN ('PRIMARY','FOLLOW_UP','CLARIFICATION','STATUS_QUERY'))
);

CREATE TABLE IF NOT EXISTS intake.media_asset (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id uuid NOT NULL REFERENCES intake.channel_message(id) ON DELETE RESTRICT,
    object_key varchar(1024) NOT NULL UNIQUE,
    original_filename varchar(512),
    mime_type varchar(256) NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
    sha256 char(64) NOT NULL,
    security_scan_status varchar(32) NOT NULL DEFAULT 'PENDING',
    sensitivity_level varchar(32) NOT NULL DEFAULT 'UNKNOWN',
    external_visible boolean NOT NULL DEFAULT false,
    retention_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (security_scan_status IN ('PENDING','PASSED','REJECTED','FAILED')),
    CHECK (sensitivity_level IN (
        'UNKNOWN','INTERNAL','SENSITIVE_INTERNAL','PERSONAL','PATIENT_SENSITIVE','SECRET'
    ))
);

CREATE INDEX IF NOT EXISTS idx_media_asset_message
    ON intake.media_asset (message_id);
CREATE INDEX IF NOT EXISTS idx_media_asset_retention
    ON intake.media_asset (retention_until)
    WHERE retention_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS intake.identity_binding (
    wecom_userid varchar(256) NOT NULL,
    person_id uuid NOT NULL,
    sso_username varchar(256),
    org_assignment_id uuid,
    department_id varchar(64),
    campus_id varchar(64),
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_to timestamptz,
    status varchar(16) NOT NULL DEFAULT 'ACTIVE',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (wecom_userid, valid_from),
    CHECK (status IN ('ACTIVE','INACTIVE','PENDING','REVOKED'))
);

CREATE INDEX IF NOT EXISTS idx_identity_binding_active
    ON intake.identity_binding (wecom_userid, status, valid_from DESC);

CREATE TABLE IF NOT EXISTS intake.ai_decision (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    intake_id uuid NOT NULL REFERENCES intake.service_intake(id) ON DELETE CASCADE,
    pipeline_version varchar(128) NOT NULL,
    model_name varchar(128) NOT NULL,
    model_version varchar(128) NOT NULL,
    prompt_version varchar(128),
    rule_version varchar(128),
    catalog_version varchar(128),
    input_hash char(64) NOT NULL,
    ocr_text_redacted text,
    structured_output jsonb NOT NULL,
    decision_band varchar(32) NOT NULL,
    human_corrected boolean NOT NULL DEFAULT false,
    corrected_by uuid,
    corrected_fields jsonb,
    latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (decision_band IN (
        'MANUAL_TRIAGE','SUGGEST_ROUTE','AUTO_ROUTE','CRITICAL_REVIEW'
    ))
);

CREATE INDEX IF NOT EXISTS idx_ai_decision_intake_time
    ON intake.ai_decision (intake_id, created_at DESC);

-- Incident 核心表可与现有 Ticketing schema 合并；此处给出独立草案。
CREATE TABLE IF NOT EXISTS incident.incident (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_no varchar(64) NOT NULL UNIQUE,
    title varchar(500) NOT NULL,
    system_code varchar(64),
    module_code varchar(64),
    symptom_code varchar(64),
    status varchar(32) NOT NULL DEFAULT 'CANDIDATE',
    severity varchar(16),
    affected_scope varchar(32),
    primary_ticket_id uuid,
    summary_external text,
    version integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    CHECK (status IN ('CANDIDATE','CONFIRMED','IN_PROGRESS','MITIGATED','RESOLVED','CLOSED','REJECTED'))
);

CREATE TABLE IF NOT EXISTS incident.incident_report (
    incident_id uuid NOT NULL REFERENCES incident.incident(id) ON DELETE CASCADE,
    intake_id uuid NOT NULL REFERENCES intake.service_intake(id) ON DELETE RESTRICT,
    match_method varchar(32) NOT NULL,
    match_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    match_score numeric(6,5),
    confirmed_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (incident_id, intake_id)
);

CREATE TABLE IF NOT EXISTS incident.reporter_subscription (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid,
    incident_id uuid REFERENCES incident.incident(id) ON DELETE CASCADE,
    wecom_userid varchar(256) NOT NULL,
    notification_channel varchar(32) NOT NULL,
    last_notified_version integer NOT NULL DEFAULT 0,
    notification_preference jsonb NOT NULL DEFAULT '{}'::jsonb,
    status varchar(16) NOT NULL DEFAULT 'ACTIVE',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ticket_id IS NOT NULL OR incident_id IS NOT NULL),
    CHECK (status IN ('ACTIVE','PAUSED','UNSUBSCRIBED','UNREACHABLE'))
);

CREATE INDEX IF NOT EXISTS idx_subscription_ticket
    ON incident.reporter_subscription (ticket_id, status);
CREATE INDEX IF NOT EXISTS idx_subscription_incident
    ON incident.reporter_subscription (incident_id, status);

-- 若现有 notification_outbox 已存在，应扩展原表，不重复创建。
CREATE TABLE IF NOT EXISTS notification.outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type varchar(128) NOT NULL,
    aggregate_type varchar(64) NOT NULL,
    aggregate_id uuid NOT NULL,
    aggregate_version integer NOT NULL,
    target_key varchar(512) NOT NULL,
    payload jsonb NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'PENDING',
    available_at timestamptz NOT NULL DEFAULT now(),
    attempt_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED','DEAD')),
    UNIQUE (event_type, aggregate_id, aggregate_version, target_key)
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON notification.outbox (status, available_at)
    WHERE status IN ('PENDING','FAILED');

CREATE TABLE IF NOT EXISTS notification.delivery (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    outbox_id uuid NOT NULL REFERENCES notification.outbox(id) ON DELETE CASCADE,
    target_type varchar(32) NOT NULL,
    target_id varchar(512) NOT NULL,
    channel varchar(32) NOT NULL,
    template_code varchar(128) NOT NULL,
    payload_hash char(64) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'PENDING',
    attempt_count integer NOT NULL DEFAULT 0,
    last_error_code varchar(128),
    last_error_message_redacted varchar(1000),
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (status IN ('PENDING','SENDING','SENT','FAILED','DEAD')),
    UNIQUE (outbox_id, target_type, target_id, channel, template_code)
);

CREATE INDEX IF NOT EXISTS idx_delivery_status
    ON notification.delivery (status, updated_at);
