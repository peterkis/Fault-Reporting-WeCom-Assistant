BEGIN;

CREATE TABLE IF NOT EXISTS pilot_ticket.pilot_principal (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    wecom_user_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pilot_principal_wecom_user_check CHECK (char_length(wecom_user_id) BETWEEN 1 AND 256),
    CONSTRAINT pilot_principal_display_name_check CHECK (char_length(display_name) BETWEEN 1 AND 128)
);

CREATE TABLE IF NOT EXISTS pilot_ticket.pilot_principal_role (
    principal_id UUID NOT NULL REFERENCES pilot_ticket.pilot_principal(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    PRIMARY KEY (principal_id, role),
    CONSTRAINT pilot_principal_role_check CHECK (
        role IN ('REPORTER', 'HANDLER', 'DISPATCHER', 'ADMIN')
    )
);

CREATE TABLE IF NOT EXISTS pilot_ticket.pilot_team_member (
    team_id TEXT NOT NULL REFERENCES pilot_ticket.resolver_team(team_id) ON DELETE CASCADE,
    principal_id UUID NOT NULL REFERENCES pilot_ticket.pilot_principal(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (team_id, principal_id)
);

CREATE INDEX IF NOT EXISTS pilot_team_member_principal_idx
    ON pilot_ticket.pilot_team_member (principal_id, team_id);

COMMENT ON TABLE pilot_ticket.pilot_principal IS
    'P1-009 Pilot-local identity. It intentionally has no Hospital person, SSO, or organization mapping.';
COMMENT ON TABLE pilot_ticket.pilot_principal_role IS
    'Explicit Pilot role grants; role changes do not rewrite Ticket history.';

COMMIT;
