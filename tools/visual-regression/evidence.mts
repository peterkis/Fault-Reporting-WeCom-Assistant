import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/** Prepare writers before experiments, including cleanup/error-path logs. */
export async function prepareVisualEvidence(
  root: string,
): Promise<{ directory: string; logs: string }> {
  const directory = path.join(root, 'docs/ui/evidence/v228-card35/35b');
  const logs = path.join(directory, 'logs');
  await mkdir(logs, { recursive: true });
  return { directory, logs };
}
