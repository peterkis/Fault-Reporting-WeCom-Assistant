import { sha256Text } from './p2-007-domain-utils.mjs';

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function withTransaction(pool, operation) {
  const client = await pool.connect();
  let destroy = false;
  try {
    await client.query('BEGIN');
    const value = await operation(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { destroy = true; }
    throw error;
  } finally {
    client.release(destroy);
  }
}

function jsonValue(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : fallback; } catch { return fallback; }
  }
  return fallback;
}

function profileRow(row) {
  if (!row) return null;
  return {
    snapshot_version: row.snapshot_version,
    fetched_at: row.fetched_at,
    provider_user_id: row.provider_user_id,
    employee_id: row.employee_id,
    nickname: row.nickname,
    phone: row.phone,
    sex: row.sex,
    avatar_url: row.avatar_url,
    provider_wecom_id: row.provider_wecom_id,
    account_status: row.account_status,
    memberships: jsonValue(row.memberships),
  };
}

async function selectMember(transaction, sourceScope, providerUserId, lock = false) {
  if (lock) await transaction.query('SELECT 1 FROM directory.member_current WHERE source_scope=$1 AND provider_user_id=$2 FOR UPDATE', [sourceScope, providerUserId]);
  const result = await transaction.query(`
    SELECT m.snapshot_version,m.fetched_at,m.provider_user_id,m.employee_id,m.nickname,m.phone,m.sex,
           m.avatar_url,m.provider_wecom_id,m.account_status,
           COALESCE(jsonb_agg(jsonb_build_object('department_ref',d.provider_department_id,'name',d.name,'role','MEMBER')
             ORDER BY d.provider_department_id) FILTER (WHERE d.provider_department_id IS NOT NULL), '[]'::jsonb) AS memberships
      FROM directory.member_current m
      LEFT JOIN directory.membership_current x
        ON x.source_scope=m.source_scope AND x.provider_user_id=m.provider_user_id
      LEFT JOIN directory.department_current d
        ON d.source_scope=x.source_scope AND d.provider_department_id=x.provider_department_id
     WHERE m.source_scope=$1 AND m.provider_user_id=$2
     GROUP BY m.snapshot_version,m.fetched_at,m.provider_user_id,m.employee_id,m.nickname,m.phone,m.sex,
              m.avatar_url,m.provider_wecom_id,m.account_status`,
  [sourceScope, providerUserId]);
  return profileRow(result.rows[0]);
}

export function createThirdPartyStaffDirectoryStore({ pool } = {}) {
  if (!pool?.query || !pool?.connect) throw failure('THIRD_STAFF_DIRECTORY_STORE_INVALID');

  async function findByReporterHash({ source_scope: sourceScope, reporter_identity_hash: reporterHash }) {
    const result = await pool.query(`
      SELECT m.snapshot_version,m.fetched_at,m.provider_user_id,m.employee_id,m.nickname,m.phone,m.sex,
             m.avatar_url,m.provider_wecom_id,m.account_status,
             COALESCE(jsonb_agg(jsonb_build_object('department_ref',d.provider_department_id,'name',d.name,'role','MEMBER')
               ORDER BY d.provider_department_id) FILTER (WHERE d.provider_department_id IS NOT NULL), '[]'::jsonb) AS memberships
        FROM directory.identity_binding b
        JOIN directory.member_current m
          ON m.source_scope=b.source_scope AND m.provider_user_id=b.provider_user_id
        LEFT JOIN directory.membership_current x
          ON x.source_scope=m.source_scope AND x.provider_user_id=m.provider_user_id
        LEFT JOIN directory.department_current d
          ON d.source_scope=x.source_scope AND d.provider_department_id=x.provider_department_id
       WHERE b.source_scope=$1 AND b.reporter_identity_hash=$2 AND b.binding_status='ACTIVE'
       GROUP BY m.snapshot_version,m.fetched_at,m.provider_user_id,m.employee_id,m.nickname,m.phone,m.sex,
                m.avatar_url,m.provider_wecom_id,m.account_status`,
    [sourceScope, reporterHash]);
    return profileRow(result.rows[0]);
  }

  async function findMemberByProviderUserId({ source_scope: sourceScope, provider_user_id: providerUserId }) {
    return selectMember(pool, sourceScope, providerUserId);
  }

  async function saveResolvedProfile({ source_scope: sourceScope, reporter_identity_hash: reporterHash,
    source_namespace: sourceNamespace = 'WECOM_AIBOT', profile, member, resolution_method: resolutionMethod = 'EXPLICIT_UID_RESOLVER' }) {
    if (!profile?.provider_user_id || !member?.provider_user_id || profile.provider_user_id !== member.provider_user_id) {
      throw failure('THIRD_STAFF_DIRECTORY_IDENTITY_CONFLICT');
    }
    return withTransaction(pool, async transaction => {
      await transaction.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`THIRD_STAFF_DIRECTORY_SYNC:${sourceScope}`]);
      await transaction.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`THIRD_STAFF_DIRECTORY_BINDING:${sourceScope}:${reporterHash}`]);
      const current = await selectMember(transaction, sourceScope, profile.provider_user_id, true);
      if (!current) throw failure('THIRD_STAFF_DIRECTORY_MEMBER_NOT_CURRENT');
      const expectedEmployee = current.employee_id;
      if (profile.employee_id !== expectedEmployee
        || (profile.display_name && current.nickname && profile.display_name !== current.nickname)
        || (profile.phone && current.phone && profile.phone !== current.phone)) {
        throw failure('THIRD_STAFF_DIRECTORY_IDENTITY_CONFLICT');
      }
      const existing = await transaction.query(`SELECT provider_user_id FROM directory.identity_binding
        WHERE source_scope=$1 AND reporter_identity_hash=$2 FOR UPDATE`, [sourceScope, reporterHash]);
      if (existing.rowCount === 1 && existing.rows[0].provider_user_id !== profile.provider_user_id) {
        throw failure('THIRD_STAFF_DIRECTORY_IDENTITY_CONFLICT');
      }
      await transaction.query(`UPDATE directory.member_current
        SET nickname=COALESCE($3,nickname), phone=COALESCE($4,phone), sex=COALESCE($5,sex),
            avatar_url=COALESCE($6,avatar_url), updated_at=platform.local_now()
        WHERE source_scope=$1 AND provider_user_id=$2`, [sourceScope, profile.provider_user_id,
        profile.display_name ?? null, profile.phone ?? null, profile.sex ?? null, profile.avatar_url ?? null]);
      await transaction.query(`INSERT INTO directory.identity_binding(
          source_scope,reporter_identity_hash,source_namespace,provider_user_id,binding_status,
          resolution_method,bound_snapshot_version,created_at,last_verified_at)
        VALUES ($1,$2,$3,$4,'ACTIVE',$5,$6,platform.local_now(),platform.local_now())
        ON CONFLICT (source_scope,reporter_identity_hash) DO UPDATE SET
          source_namespace=EXCLUDED.source_namespace,provider_user_id=EXCLUDED.provider_user_id,
          binding_status='ACTIVE',resolution_method=EXCLUDED.resolution_method,
          bound_snapshot_version=EXCLUDED.bound_snapshot_version,last_verified_at=platform.local_now()`,
      [sourceScope, reporterHash, sourceNamespace, profile.provider_user_id, resolutionMethod, current.snapshot_version]);
      return selectMember(transaction, sourceScope, profile.provider_user_id);
    });
  }

  async function publishSnapshot({ source_scope: sourceScope, root_ref: rootRef, snapshot }) {
    if (!snapshot?.snapshot_version || !Array.isArray(snapshot.departments) || !Array.isArray(snapshot.members)
      || !Array.isArray(snapshot.memberships)) throw failure('THIRD_STAFF_DIRECTORY_SNAPSHOT_INVALID');
    const rootHash = sha256Text(rootRef);
    return withTransaction(pool, async transaction => {
      await transaction.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`THIRD_STAFF_DIRECTORY_SYNC:${sourceScope}`]);
      const run = await transaction.query(`INSERT INTO directory.sync_run(
          source_scope,root_ref_hash,status,snapshot_version,department_count,member_count,membership_count,protocol_warnings)
        VALUES ($1,$2,'RUNNING',$3,$4,$5,$6,$7::jsonb) RETURNING run_id::text`,
      [sourceScope, rootHash, snapshot.snapshot_version, snapshot.counts.departments, snapshot.counts.members,
        snapshot.counts.memberships, JSON.stringify(snapshot.protocol_warnings ?? [])]);
      await transaction.query('DELETE FROM directory.membership_current WHERE source_scope=$1', [sourceScope]);
      // Compare identities before replacing tree fields. A reused provider ID
      // must neither inherit enrichment nor retain an old reporter binding.
      await transaction.query(`UPDATE directory.identity_binding b SET binding_status='STALE'
        WHERE b.source_scope=$1 AND b.binding_status='ACTIVE' AND NOT EXISTS (
          SELECT 1 FROM directory.member_current m
          JOIN jsonb_to_recordset($2::jsonb) AS r(provider_user_id text,employee_id text)
            ON r.provider_user_id=m.provider_user_id AND r.employee_id=m.employee_id
          WHERE m.source_scope=b.source_scope AND m.provider_user_id=b.provider_user_id)`,
      [sourceScope, JSON.stringify(snapshot.members)]);
      await transaction.query(`DELETE FROM directory.member_current m WHERE m.source_scope=$1 AND NOT EXISTS (
        SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS r(provider_user_id text)
        WHERE r.provider_user_id=m.provider_user_id)`, [sourceScope, JSON.stringify(snapshot.members)]);
      await transaction.query('DELETE FROM directory.department_current WHERE source_scope=$1', [sourceScope]);
      await transaction.query(`INSERT INTO directory.department_current(
          source_scope,provider_department_id,parent_provider_department_id,name,provider_gid,provider_gid_type,
          depth,snapshot_version)
        SELECT $1,r.provider_department_id,r.parent_provider_department_id,r.name,r.provider_gid,r.provider_gid_type,
          r.depth,$2
          FROM jsonb_to_recordset($3::jsonb) AS r(provider_department_id text,parent_provider_department_id text,
            name text,provider_gid text,provider_gid_type text,depth integer)`,
      [sourceScope, snapshot.snapshot_version, JSON.stringify(snapshot.departments)]);
      await transaction.query(`INSERT INTO directory.member_current AS existing(
          source_scope,provider_user_id,employee_id,nickname,phone,provider_wecom_id,snapshot_version,fetched_at)
        SELECT $1,r.provider_user_id,r.employee_id,r.nickname,r.phone,r.provider_wecom_id,$2,platform.local_now()
          FROM jsonb_to_recordset($3::jsonb) AS r(provider_user_id text,employee_id text,nickname text,phone text,provider_wecom_id text)
        ON CONFLICT (source_scope,provider_user_id) DO UPDATE SET
          sex=CASE WHEN existing.employee_id=EXCLUDED.employee_id THEN existing.sex ELSE NULL END,
          avatar_url=CASE WHEN existing.employee_id=EXCLUDED.employee_id THEN existing.avatar_url ELSE NULL END,
          employee_id=EXCLUDED.employee_id,nickname=EXCLUDED.nickname,phone=EXCLUDED.phone,
          provider_wecom_id=EXCLUDED.provider_wecom_id,
          account_status=CASE WHEN existing.employee_id=EXCLUDED.employee_id THEN existing.account_status ELSE EXCLUDED.account_status END,
          snapshot_version=EXCLUDED.snapshot_version,fetched_at=EXCLUDED.fetched_at,updated_at=platform.local_now()`,
      [sourceScope, snapshot.snapshot_version, JSON.stringify(snapshot.members)]);
      await transaction.query(`INSERT INTO directory.membership_current(
          source_scope,provider_user_id,provider_department_id,snapshot_version)
        SELECT $1,r.provider_user_id,r.provider_department_id,$2
          FROM jsonb_to_recordset($3::jsonb) AS r(provider_user_id text,provider_department_id text)`,
      [sourceScope, snapshot.snapshot_version, JSON.stringify(snapshot.memberships)]);
      await transaction.query(`INSERT INTO directory.current_snapshot(
          source_scope,snapshot_version,root_ref_hash,department_count,member_count,membership_count,fetched_at,published_at)
        VALUES ($1,$2,$3,$4,$5,$6,platform.local_now(),platform.local_now())
        ON CONFLICT (source_scope) DO UPDATE SET snapshot_version=EXCLUDED.snapshot_version,
          root_ref_hash=EXCLUDED.root_ref_hash,department_count=EXCLUDED.department_count,
          member_count=EXCLUDED.member_count,membership_count=EXCLUDED.membership_count,
          fetched_at=EXCLUDED.fetched_at,published_at=EXCLUDED.published_at`,
      [sourceScope, snapshot.snapshot_version, rootHash, snapshot.counts.departments, snapshot.counts.members,
        snapshot.counts.memberships]);
      await transaction.query(`UPDATE directory.identity_binding SET
          bound_snapshot_version=$2,last_verified_at=platform.local_now()
        WHERE source_scope=$1 AND binding_status='ACTIVE'`, [sourceScope, snapshot.snapshot_version]);
      await transaction.query(`UPDATE directory.sync_run SET status='SUCCEEDED',completed_at=platform.local_now()
        WHERE run_id=$1::uuid`, [run.rows[0].run_id]);
      return Object.freeze({ run_id: run.rows[0].run_id, status: 'SUCCEEDED', snapshot_version: snapshot.snapshot_version, counts: snapshot.counts });
    });
  }

  async function recordSyncFailure({ source_scope: sourceScope, root_ref: rootRef, error_code: errorCode }) {
    const safeCode = typeof errorCode === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/u.test(errorCode) ? errorCode : 'SYNC_FAILED';
    await pool.query(`INSERT INTO directory.sync_run(source_scope,root_ref_hash,status,error_code,started_at,completed_at)
      VALUES ($1,$2,'FAILED',$3,platform.local_now(),platform.local_now())`, [sourceScope, sha256Text(rootRef), safeCode]);
    return Object.freeze({ status: 'FAILED', error_code: safeCode });
  }

  return Object.freeze({ findByReporterHash, findMemberByProviderUserId, saveResolvedProfile, publishSnapshot, recordSyncFailure });
}
