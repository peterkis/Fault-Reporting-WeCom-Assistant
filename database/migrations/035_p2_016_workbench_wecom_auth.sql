BEGIN;

CREATE TABLE pilot_ticket.workbench_auth_session (
    session_id UUID PRIMARY KEY DEFAULT uuidv7(),
    session_token_hash TEXT NOT NULL UNIQUE CHECK (session_token_hash ~ '^[a-f0-9]{64}$'),
    csrf_token_hash TEXT NOT NULL CHECK (csrf_token_hash ~ '^[a-f0-9]{64}$'),
    principal_id UUID NOT NULL REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    identity_hash TEXT NOT NULL CHECK (identity_hash ~ '^[a-f0-9]{64}$'),
    state TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    created_epoch_ms BIGINT NOT NULL,
    last_seen_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    last_seen_epoch_ms BIGINT NOT NULL,
    expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    expires_epoch_ms BIGINT NOT NULL,
    revoked_at TIMESTAMP WITHOUT TIME ZONE,
    revoked_epoch_ms BIGINT,
    CONSTRAINT workbench_auth_session_created_time_check
      CHECK (created_at = platform.local_from_epoch_ms(created_epoch_ms)),
    CONSTRAINT workbench_auth_session_seen_time_check
      CHECK (last_seen_at = platform.local_from_epoch_ms(last_seen_epoch_ms)
        AND last_seen_epoch_ms >= created_epoch_ms),
    CONSTRAINT workbench_auth_session_expiry_check
      CHECK (expires_epoch_ms > created_epoch_ms
        AND expires_epoch_ms - created_epoch_ms <= 86400000
        AND expires_at = platform.local_from_epoch_ms(expires_epoch_ms)),
    CONSTRAINT workbench_auth_session_revoked_time_check
      CHECK ((revoked_at IS NULL AND revoked_epoch_ms IS NULL)
        OR (revoked_at = platform.local_from_epoch_ms(revoked_epoch_ms)
          AND revoked_epoch_ms >= created_epoch_ms)),
    CONSTRAINT workbench_auth_session_state_check
      CHECK ((state IN ('ACTIVE','EXPIRED') AND revoked_at IS NULL)
        OR (state = 'REVOKED' AND revoked_at IS NOT NULL))
);

CREATE INDEX workbench_auth_session_principal_idx
  ON pilot_ticket.workbench_auth_session(principal_id, state, expires_epoch_ms);
CREATE INDEX workbench_auth_session_expiry_idx
  ON pilot_ticket.workbench_auth_session(state, expires_epoch_ms);

CREATE TABLE pilot_ticket.workbench_login_intent (
    intent_id UUID PRIMARY KEY DEFAULT uuidv7(),
    state_hash TEXT NOT NULL UNIQUE CHECK (state_hash ~ '^[a-f0-9]{64}$'),
    browser_binding_hash TEXT NOT NULL CHECK (browser_binding_hash ~ '^[a-f0-9]{64}$'),
    return_path TEXT NOT NULL CHECK (return_path IN ('/workbench','/workbench/','/workbench/lifecycle','/workbench/incidents')),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    created_epoch_ms BIGINT NOT NULL,
    expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    expires_epoch_ms BIGINT NOT NULL,
    consumed_at TIMESTAMP WITHOUT TIME ZONE,
    consumed_epoch_ms BIGINT,
    CONSTRAINT workbench_login_intent_created_time_check
      CHECK (created_at = platform.local_from_epoch_ms(created_epoch_ms)),
    CONSTRAINT workbench_login_intent_expiry_check
      CHECK (expires_epoch_ms > created_epoch_ms
        AND expires_epoch_ms - created_epoch_ms <= 600000
        AND expires_at = platform.local_from_epoch_ms(expires_epoch_ms)),
    CONSTRAINT workbench_login_intent_consumed_time_check
      CHECK ((consumed_at IS NULL AND consumed_epoch_ms IS NULL)
        OR (consumed_at = platform.local_from_epoch_ms(consumed_epoch_ms)
          AND consumed_epoch_ms >= created_epoch_ms))
);

CREATE INDEX workbench_login_intent_expiry_idx
  ON pilot_ticket.workbench_login_intent(expires_epoch_ms, consumed_epoch_ms);

CREATE TABLE pilot_ticket.workbench_auth_event (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    session_id UUID REFERENCES pilot_ticket.workbench_auth_session(session_id) ON DELETE RESTRICT,
    principal_id UUID REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT,
    identity_hash TEXT CHECK (identity_hash IS NULL OR identity_hash ~ '^[a-f0-9]{64}$'),
    event_type TEXT NOT NULL CHECK (event_type IN (
      'LOGIN_STARTED','LOGIN_SUCCEEDED','LOGIN_REJECTED','OAUTH_FAILED','LOGOUT','SESSION_EXPIRED','SESSION_REVOKED'
    )),
    reason_code TEXT NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    provider_errcode INTEGER,
    occurred_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now()
);

CREATE INDEX workbench_auth_event_principal_idx
  ON pilot_ticket.workbench_auth_event(principal_id, occurred_at, id);
CREATE INDEX workbench_auth_event_session_idx
  ON pilot_ticket.workbench_auth_event(session_id, occurred_at, id);

COMMIT;
