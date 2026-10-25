import path from 'node:path';
import { createHash } from 'node:crypto';

function filePath(value) {
  if (typeof value !== 'string') return null;
  return path.relative(process.cwd(), path.resolve(value)).replaceAll('\\', '/');
}

export default async function* fileCoverage(events) {
  const files = new Map();
  for await (const event of events) {
    if (!['test:pass', 'test:fail'].includes(event.type)) continue;
    const file = filePath(event.data?.file);
    if (file === null) continue;
    const row = files.get(file) ?? { path: file, total: 0, pass: 0, fail: 0, skipped: 0, todo: 0, identities: [] };
    row.total++;
    if (event.type === 'test:fail') row.fail++;
    else if (event.data?.skip === true) row.skipped++;
    else if (event.data?.todo === true) row.todo++;
    else {
      row.pass++;
      row.identities.push(JSON.stringify([event.data?.nesting ?? 0, event.data?.name, event.data?.line ?? null]));
    }
    files.set(file, row);
  }
  const result = [...files.values()].sort((a, b) => a.path.localeCompare(b.path)).map(({ identities, ...row }) => ({
    ...row,
    identity_sha256: createHash('sha256').update(JSON.stringify(identities.sort())).digest('hex'),
  }));
  yield JSON.stringify({ schema_version: 2, files: result }) + '\n';
}
