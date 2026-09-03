export async function arch005MigrationApplied(queryable) {
  if (!queryable || typeof queryable.query !== 'function') {
    throw new TypeError('LEGACY_MIGRATION_QUERYABLE_REQUIRED');
  }
  const result = await queryable.query(
    `SELECT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_class AS relation
         JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'platform'
          AND relation.relname = 'schema_migration'
          AND relation.relkind = 'r'
     ) AS marker_table_exists`,
  );
  if (result.rows[0]?.marker_table_exists !== true) return false;
  const marker = await queryable.query(
    `SELECT EXISTS (
       SELECT 1 FROM platform.schema_migration
        WHERE migration_id = '022_arch_005_asia_shanghai_time_contract'
     ) AS applied`,
  );
  return marker.rows[0]?.applied === true;
}

export async function stopLegacyMigrationAfterArch005(queryable, migrationId) {
  if (await arch005MigrationApplied(queryable)) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      status: 'LEGACY_MIGRATION_SUPERSEDED',
      migration_id: migrationId,
      superseded_by: '022_arch_005_asia_shanghai_time_contract',
      write_performed: false,
    })}\n`);
    const error = new Error('LEGACY_MIGRATION_SUPERSEDED');
    error.code = 'LEGACY_MIGRATION_SUPERSEDED';
    error.migration_id = migrationId;
    throw error;
  }
}
