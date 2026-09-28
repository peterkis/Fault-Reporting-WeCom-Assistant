import { readJson, record, safeFile, strings, git } from './common.mjs';
import { loadRoutes, logical, type Selection } from './routing.mjs';

export function batchSelection(root: string, id: string): Selection {
  const doc = record(readJson(safeFile(root, 'plans/typescript-migration/batches.json')));
  if (doc.schema_version !== 1 || !Array.isArray(doc.batches)) throw new Error('MIGRATION_BATCH_SCHEMA');
  const matches = doc.batches.map(record).filter(b => b.id === id);
  if (matches.length !== 1) throw new Error('MIGRATION_UNKNOWN_BATCH: ' + id);
  const batch = matches[0];
  if (!batch || typeof batch.reference_sha !== 'string' || !/^[a-f0-9]{40}$/u.test(batch.reference_sha)) throw new Error('MIGRATION_BATCH_REFERENCE');
  git(root, ['merge-base', '--is-ancestor', batch.reference_sha, 'HEAD']);
  const paths = strings(batch.paths), targets = strings(batch.target_paths);
  if (!paths.length || JSON.stringify(paths.map(p => p.replace(/\.mjs$/u, '.mts'))) !== JSON.stringify(targets)) throw new Error('MIGRATION_BATCH_TARGETS');
  const groups = ['direct_tests', 'impacted_tests', 'baseline_tests', 'supplemental_tests'].map(key => strings(batch[key]));
  if (groups.slice(0, 3).some(group => !group.length)) throw new Error('MIGRATION_EMPTY_BATCH');
  const routes = loadRoutes(root);
  const names = [...new Set(groups.flat())].sort();
  return { label: id, flags: [], entries: names.map(name => {
    const entry = routes.entries.find(e => logical(e.path) === logical(name));
    if (!entry) throw new Error('MIGRATION_BATCH_UNKNOWN_TEST: ' + name);
    return entry;
  }) };
}
