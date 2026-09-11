#!/usr/bin/env bash
# New-host PostgreSQL infrastructure only. Does not create an application database or run repository migrations.
set -euo pipefail
umask 027
mode="${1:---check}"
if [[ "$#" -gt 1 || ( "$mode" != '--check' && "$mode" != '--apply' ) ]]; then
  echo P2_G2_POSTGRES_ARGUMENTS_INVALID >&2; exit 2
fi
. /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || { echo P2_G2_UBUNTU_2404_REQUIRED >&2; exit 2; }
[[ "$(dpkg --print-architecture)" == amd64 ]] || { echo P2_G2_AMD64_REQUIRED >&2; exit 2; }
marker=/etc/postgresql/p2-g2-native-infrastructure.marker
data=/var/lib/postgresql/18/main
if [[ "$mode" == '--check' ]]; then
  printf 'mode=READ_ONLY\nos=ubuntu-24.04\n'
  if command -v pg_lsclusters >/dev/null; then pg_lsclusters; else echo postgresql_installed=false; fi
  if [[ -f "$marker" ]]; then echo owned_native_install=true; else echo owned_native_install=false; fi
  exit 0
fi
[[ "$EUID" -eq 0 ]] || { echo P2_G2_ROOT_REQUIRED_FOR_INSTALL >&2; exit 2; }
if [[ -f "$marker" ]]; then
  grep -qx 'P2_G2_NATIVE_INFRASTRUCTURE_V1' "$marker" || { echo P2_G2_INSTALL_MARKER_INVALID >&2; exit 2; }
  [[ "$(sudo -u postgres psql -XAt -d postgres -c 'SHOW data_directory')" == "$data" ]] || { echo P2_G2_DATA_DIRECTORY_MISMATCH >&2; exit 2; }
  echo P2_G2_NATIVE_INFRASTRUCTURE_ALREADY_INSTALLED
  exit 0
fi
if command -v pg_lsclusters >/dev/null || [[ -e /etc/postgresql/18 || -e "$data" ]]; then
  echo P2_G2_EXISTING_POSTGRES_REQUIRES_SEPARATE_REVIEW >&2; exit 2
fi
[[ ! -e /etc/apt/sources.list.d/pgdg.sources && ! -e /etc/apt/sources.list.d/pgdg.list ]] || { echo P2_G2_EXISTING_PGDG_SOURCE >&2; exit 2; }
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=l
apt-get update
apt-get install -y --no-install-recommends curl ca-certificates
install -d -m 0755 /usr/share/postgresql-common/pgdg
curl --proto '=https' --tlsv1.2 --fail --show-error --silent \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
chmod 0644 /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
cat > /etc/apt/sources.list.d/pgdg.sources <<'EOF'
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: noble-pgdg
Architectures: amd64
Components: main
Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
EOF
apt-get update
apt-get install -y --no-install-recommends postgresql-18 postgresql-client-18
[[ -f "$data/PG_VERSION" && "$(cat "$data/PG_VERSION")" == 18 ]] || { echo P2_G2_CLUSTER_NOT_CREATED >&2; exit 2; }
[[ ! -L "$data" ]] || { echo P2_G2_DATA_SYMLINK_REQUIRES_REVIEW >&2; exit 2; }
cat > /etc/postgresql/18/main/conf.d/p2-g2-personal.conf <<'EOF'
# Conservative starting configuration for this 2-vCPU / 4-GB single host, not performance acceptance.
listen_addresses = 'localhost'
max_connections = 40
shared_buffers = '256MB'
effective_cache_size = '2GB'
work_mem = '4MB'
maintenance_work_mem = '64MB'
password_encryption = 'scram-sha-256'
log_statement = 'none'
log_min_duration_statement = -1
log_min_error_statement = 'panic'
log_parameter_max_length_on_error = 0
log_error_verbosity = 'terse'
EOF
chown postgres:postgres /etc/postgresql/18/main/conf.d/p2-g2-personal.conf
chmod 0640 /etc/postgresql/18/main/conf.d/p2-g2-personal.conf
systemctl restart postgresql@18-main
systemctl enable postgresql
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres <<'SQL'
BEGIN READ ONLY;
SELECT current_setting('server_version') AS server_version,
       current_setting('data_directory') AS data_directory,
       current_setting('listen_addresses') AS listen_addresses,
       current_setting('max_connections') AS max_connections,
       current_setting('shared_buffers') AS shared_buffers;
SELECT count(*) AS non_system_databases FROM pg_database WHERE datname NOT IN ('postgres','template0','template1');
COMMIT;
SQL
[[ "$(sudo -u postgres psql -XAt -d postgres -c 'SHOW data_directory')" == "$data" ]] || { echo P2_G2_DATA_DIRECTORY_MISMATCH >&2; exit 2; }
[[ "$(sudo -u postgres psql -XAt -d postgres -c 'SHOW listen_addresses')" == localhost ]] || { echo P2_G2_LOOPBACK_REQUIRED >&2; exit 2; }
[[ "$(sudo -u postgres psql -XAt -d postgres -c "SELECT count(*) FROM pg_database WHERE datname NOT IN ('postgres','template0','template1')")" == 0 ]] || { echo P2_G2_UNEXPECTED_APPLICATION_DATABASE >&2; exit 2; }
printf '%s\n' P2_G2_NATIVE_INFRASTRUCTURE_V1 > "$marker"
chmod 0644 "$marker"
echo P2_G2_NATIVE_INFRASTRUCTURE_INSTALLED_NO_APPLICATION_DATABASE
