import { readFileSync, writeFileSync, mkdirSync, lstatSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Package an explicitly non-ready, credential-free staging snapshot. No SSH or activation.
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
try {
  if (process.argv.length !== 2) throw new Error('ARGS_INVALID');
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const head = git(['rev-parse', 'HEAD']);
  const roots = ['src', 'scripts', 'web', 'contracts', 'config', 'config_examples', 'database', 'tests', 'package.json', 'package-lock.json'];
  const tracked = git(['ls-files', '--', ...roots]).split(/\r?\n/u).filter(Boolean);
  const additions = ['scripts/p2-g2-route-preflight.mjs', 'scripts/p2-g2-cloud-package.mjs',
    'tests/p2-g2-service-route-readiness.integration.test.mjs', 'docs/runbooks/p2-g2-cloud-deployment-operations.md',
    'scripts/p2-g2-postgres-native.sh', 'docs/runbooks/p2-g2-postgresql-deployment-decision.md',
    'evidence/p2-g2-domain-gap-report.md', 'evidence/p2-g2-service-route-red-run.json'];
  const paths = [...new Set([...tracked, ...additions])].sort();
  const settings = parseEnv(readFileSync(path.join(root, '.env.pilot'), 'utf8'));
  const secretValues = Object.entries(settings).filter(([k, v]) => /secret|password|_pwd|token|api_key|database_url|server_ip/iu.test(k)
    && typeof v === 'string' && v.length >= 8).map(([, v]) => v);
  const files = paths.map(relative => {
    if (relative.startsWith('/') || relative.includes('..') || relative.includes('\\')
      || relative.split('/').some(p => p.startsWith('.env') || ['node_modules', '.git', 'secrets', 'tmp'].includes(p))
      || /\.(pem|key|p12|pfx)$/iu.test(relative)) throw new Error('UNSAFE_PACKAGE_PATH');
    const absolute = path.join(root, relative);
    if (!lstatSync(absolute).isFile()) throw new Error('REGULAR_FILES_ONLY');
    const data = readFileSync(absolute);
    if (secretValues.some(value => data.includes(Buffer.from(value)))) throw new Error('SECRET_SCAN_FAILED');
    return { path: relative, sha256: sha(data), bytes: data.length };
  });
  const runId = randomUUID();
  const releaseId = 'prep-' + head.slice(0, 12) + '-' + runId.slice(0, 8);
  const dir = path.join(root, 'tmp', 'p2-g2-cloud-' + runId);
  mkdirSync(dir);
  const manifest = { task: 'P2-G2', deployment_state: 'STAGED_NOT_ACTIVATED', preparation_result: 'BLOCKED_BY_DOMAIN_GAP',
    source_head: head, includes_uncommitted_preparation_files: true, release_id: releaseId,
    ready_candidate: false, gateway_enabled: false, sender_enabled: false, application_database_provisioned: false,
    postgres_infrastructure: 'SEPARATE_NATIVE_INSTALL_RECORD',
    secrets_included: false, secret_scan_passed: true, historical_live_evidence_included: false, files };
  writeFileSync(path.join(dir, 'DEPLOYMENT-STAGE.json'), JSON.stringify(manifest, null, 2) + '\n');
  const python = 'import json,sys,tarfile,pathlib\nx=json.load(sys.stdin)\nwith tarfile.open(x["archive"],"w:gz") as t:\n for p in x["files"]: t.add(pathlib.Path(x["root"])/p,arcname=p,recursive=False)\n t.add(x["manifest"],arcname="DEPLOYMENT-STAGE.json",recursive=False)\n';
  const archive = path.join(dir, 'source.tar.gz');
  const packed = spawnSync('python', ['-c', python], { cwd: root, input: JSON.stringify({ root, files: paths,
    archive, manifest: path.join(dir, 'DEPLOYMENT-STAGE.json') }), encoding: 'utf8', windowsHide: true });
  if (packed.status !== 0) throw new Error('ARCHIVE_FAILED');
  const result = { release_id: releaseId, source_head: head, archive, archive_sha256: sha(readFileSync(archive)),
    files: files.length, deployment_state: 'STAGED_NOT_ACTIVATED', ready_candidate: false, secrets_included: false };
  writeFileSync(path.join(dir, 'package-result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch {
  console.error('P2_G2_CLOUD_PACKAGE_FAILED'); process.exitCode = 1;
}
