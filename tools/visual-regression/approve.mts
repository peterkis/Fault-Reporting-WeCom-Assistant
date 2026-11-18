import { createInterface } from 'node:readline/promises';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { manifest } from '../../tests/visual/manifest.mjs';
import { assertHumanApproval } from './model.mjs';
import type { CaptureMeta } from './model.mjs';
export async function approve(
  names: string[],
  currentDir: string,
  baselineDir: string,
  platform: string,
): Promise<void> {
  assertHumanApproval(process.stdin.isTTY, process.env);
  const all = names.length === 1 && names[0] === '--all';
  if (
    !names.length ||
    (!all && names.some((n) => !manifest.some((s) => s.name === n))) ||
    new Set(names).size !== names.length
  )
    throw Error('Use visual:approve -- <name…|--all>. No confirmation bypass is supported.');
  const selected = all ? manifest.map((s) => s.name) : names,
    meta = JSON.parse(await readFile(path.join(currentDir, 'meta.json'), 'utf8')) as CaptureMeta;
  if (meta.platform !== platform || !meta.os_version || !meta.browser_version || meta.dpr !== 1)
    throw Error('Current metadata does not match platform. Capture again.');
  let prior: CaptureMeta | undefined;
  try {
    prior = JSON.parse(await readFile(path.join(baselineDir, 'meta.json'), 'utf8')) as CaptureMeta;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  if (
    prior &&
    !all &&
    (prior.platform !== meta.platform ||
      prior.os_version !== meta.os_version ||
      prior.browser_version !== meta.browser_version ||
      prior.dpr !== meta.dpr)
  )
    throw Error('Environment changed: review the complete set and approve --all manually.');
  // Validate all inputs before confirmation or the first baseline write.
  const hashes = new Map<string, string>();
  for (const name of selected) {
    const bytes = await readFile(path.join(currentDir, name + '.png'));
    PNG.sync.read(bytes);
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (meta.screens[name] !== sha) throw Error('Current capture hash mismatch: ' + name);
    hashes.set(name, sha);
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await prompt.question(
      `Review ${selected.join(', ')} (${platform}). Only intentional design changes confirmed by the product owner may update baselines. Type APPROVE to copy these images: `,
    );
  } finally {
    prompt.close();
  }
  if (answer !== 'APPROVE') throw Error('Approval cancelled; no baseline written.');
  assertHumanApproval(process.stdin.isTTY, process.env);
  for (const [name, sha] of hashes)
    if (
      createHash('sha256')
        .update(await readFile(path.join(currentDir, name + '.png')))
        .digest('hex') !== sha
    )
      throw Error('Capture changed during confirmation. No baseline written.');
  await mkdir(baselineDir, { recursive: true });
  for (const name of selected)
    await copyFile(path.join(currentDir, name + '.png'), path.join(baselineDir, name + '.png'));
  await writeFile(
    path.join(baselineDir, 'meta.json'),
    JSON.stringify(
      {
        ...meta,
        screens: {
          ...(all ? {} : prior?.screens),
          ...Object.fromEntries(selected.map((name) => [name, meta.screens[name]])),
        },
        viewports: {
          ...(all ? {} : prior?.viewports),
          ...Object.fromEntries(selected.map((name) => [name, meta.viewports[name]])),
        },
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Approved ${selected.length} screenshots for ${platform}.`);
}
