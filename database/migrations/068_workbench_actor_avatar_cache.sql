BEGIN;
CREATE SCHEMA IF NOT EXISTS workbench;
CREATE TABLE workbench.actor_avatar_cache (
  principal_id UUID PRIMARY KEY REFERENCES pilot_ticket.pilot_principal(id) ON DELETE CASCADE,
  identity_hash TEXT NOT NULL CHECK(identity_hash ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL CHECK(status IN ('READY','UNAVAILABLE')),
  avatar_bytes BYTEA,
  avatar_sha256 TEXT CHECK(avatar_sha256 IS NULL OR avatar_sha256 ~ '^[a-f0-9]{64}$'),
  error_code TEXT CHECK(error_code IS NULL OR error_code ~ '^ACTOR_AVATAR_[A-Z_]{1,80}$'),
  attempted_epoch_ms BIGINT NOT NULL,
  expires_epoch_ms BIGINT NOT NULL,
  CHECK(expires_epoch_ms>attempted_epoch_ms AND expires_epoch_ms<=attempted_epoch_ms+86400000),
  CHECK((status='READY' AND avatar_bytes IS NOT NULL AND octet_length(avatar_bytes) BETWEEN 1 AND 32768 AND avatar_sha256 IS NOT NULL AND error_code IS NULL)
     OR (status='UNAVAILABLE' AND avatar_bytes IS NULL AND avatar_sha256 IS NULL AND error_code IS NOT NULL))
);
COMMIT;
