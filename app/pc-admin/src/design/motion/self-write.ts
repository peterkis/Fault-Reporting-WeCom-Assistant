export interface SelfWriteTarget {
  kind?: 'ticket' | 'review' | 'intake';
  id?: string;
  intakeId?: string;
}

const TTL_MS = 15_000;
const MAX_ENTRIES = 100;
interface SelfWriteRecord {
  expiresAt: number;
  peers: readonly string[];
}
const entries = new Map<string, SelfWriteRecord>();

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function prune(now: number): void {
  for (const [key, record] of entries) {
    if (record.expiresAt <= now) entries.delete(key);
  }
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

function keysFor(principalId: string, target: SelfWriteTarget): string[] {
  const result: string[] = [];
  if (target.kind && target.id) result.push(`${principalId}|${target.kind}:${target.id.toLowerCase()}`);
  if (target.intakeId) result.push(`${principalId}|intake_id:${target.intakeId.toLowerCase()}`);
  return result;
}

/** Presentation-only registry: marks an item identity just confirmed written by the current user. */
export function markSelfWrite(principalId: string, target: SelfWriteTarget, now = nowMs()): void {
  if (!principalId) return;
  prune(now);
  const keys = keysFor(principalId, target);
  if (!keys.length) return;
  const expiresAt = now + TTL_MS;
  for (const key of keys) {
    entries.delete(key);
    entries.set(key, { expiresAt, peers: keys });
  }
  prune(now);
}

/** Consumes the self-write mark on the next confirmed column/group change or arrival. Unknown -> false (treat as other). */
export function consumeSelfWrite(principalId: string, target: SelfWriteTarget, now = nowMs()): boolean {
  if (!principalId) return false;
  prune(now);
  let matched = false;
  const toRemove = new Set<string>();
  for (const key of keysFor(principalId, target)) {
    const record = entries.get(key);
    if (record !== undefined && record.expiresAt > now) {
      matched = true;
      for (const peer of record.peers) toRemove.add(peer);
    }
  }
  for (const key of toRemove) entries.delete(key);
  return matched;
}

/** Clears presentation marks for a principal (or all principals) on session change/logout. */
export function clearSelfWrites(principalId?: string): void {
  if (!principalId) {
    entries.clear();
    return;
  }
  const prefix = `${principalId}|`;
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}
