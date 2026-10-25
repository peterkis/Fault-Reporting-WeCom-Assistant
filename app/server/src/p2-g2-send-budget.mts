import type { G2Manifest } from './p2-g2-validation-config.mjs';
export type SendBudgetOutcome = 'ACKNOWLEDGED'|'REJECTED_NOT_APPLIED'|'UNKNOWN';
export interface SendBudgetEntry {delivery_id:string;target_type:'GROUP'|'PERSON';target_hash:string;message_hash:string;idempotency_hash:string}
export type SendBudgetReservation = {kind:'RESERVED';ordinal:number} | {kind:'REPLAY';outcome:SendBudgetOutcome};
interface Reservation {type:'RESERVE';ordinal:number;entry:SendBudgetEntry;outcome:SendBudgetOutcome|null}
type Reservations = Reservation[] & {findLast(predicate:(item:Reservation,index:number,array:Reservation[])=>unknown):Reservation|undefined};
interface BudgetState {previous:string|null;reservations:Reservation[];counts:Record<'group'|'person'|'total',number>}
type JournalInput = {previous?:unknown;hash?:unknown;payload?:{type?:unknown;schema_version?:unknown;binding?:unknown;ordinal?:unknown;entry?:unknown;outcome?:unknown}};
import { openSync, closeSync, fsyncSync, writeSync, readFileSync, lstatSync, unlinkSync } from 'node:fs';
import { g2Hash, validateG2Manifest, failG2 } from './p2-g2-validation-config.mjs';

const HASH = /^[a-f0-9]{64}$/u, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const OUTCOMES = ['ACKNOWLEDGED', 'REJECTED_NOT_APPLIED', 'UNKNOWN'];
const bindingFor = (manifest: unknown) => g2Hash(JSON.stringify(validateG2Manifest(manifest)));
function append(fd: number, previous: string|null, payload: unknown) {
  const row = { previous, payload, hash: g2Hash(JSON.stringify({ previous, payload })) };
  const bytes = Buffer.from(JSON.stringify(row) + '\n');
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
  fsyncSync(fd);
  return row.hash;
}

// Initialization is a separate controller operation. A restarted Gateway must
// open the existing journal; a missing/corrupt journal never resets the budget.
export function initializeG2SendBudget({ file, manifest }: {file:string;manifest:unknown}) {
  const binding = bindingFor(manifest);
  let fd;
  try { fd = openSync(file, 'wx', 0o600); } catch { failG2('SEND_BUDGET_EXISTS'); }
  try { append(fd, null, { type: 'HEADER', schema_version: 1, binding }); }
  finally { closeSync(fd); }
}

export function openG2SendBudget({ file, manifest }: {file:string;manifest:unknown}) {
  manifest = validateG2Manifest(manifest);
  const binding = bindingFor(manifest), limits = (manifest as G2Manifest).scope.send_budget;
  function read(): BudgetState {
    let text;
    try {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) failG2('SEND_BUDGET_CORRUPT');
      text = readFileSync(file, 'utf8');
    } catch { failG2('SEND_BUDGET_CORRUPT'); }
    if (!text.endsWith('\n')) failG2('SEND_BUDGET_CORRUPT');
    const lines = text.slice(0, -1).split('\n');
    if (lines.length < 1 || lines.length > 2001) failG2('SEND_BUDGET_CORRUPT');
    let previous: string|null = null;
    const reservations:Reservation[] = [], counts = { group: 0, person: 0, total: 0 };
    for (const [index, line] of lines.entries()) {
      let row: JournalInput; try { row = JSON.parse(line); } catch { failG2('SEND_BUDGET_CORRUPT'); }
      if (!row || row.previous !== previous || row.hash !== g2Hash(JSON.stringify({ previous, payload: row.payload }))) failG2('SEND_BUDGET_CORRUPT');
      previous = row.hash as string;
      const p = row.payload;
      if (index === 0) {
        if (p?.type !== 'HEADER' || p.schema_version !== 1 || p.binding !== binding) failG2('SEND_BUDGET_BINDING');
      } else if (p?.type === 'RESERVE') {
        validateEntry(p.entry);
        if (p.ordinal !== reservations.length + 1) failG2('SEND_BUDGET_CORRUPT');
        const prior = (reservations as Reservations).findLast(r => r.entry.delivery_id === (p.entry as SendBudgetEntry).delivery_id);
        if (prior && (prior.outcome !== 'REJECTED_NOT_APPLIED' || JSON.stringify(prior.entry) !== JSON.stringify(p.entry))) failG2('SEND_BUDGET_CORRUPT');
        reservations.push({ ...p, outcome: null } as Reservation);
        counts[(p.entry as SendBudgetEntry).target_type.toLowerCase() as 'group'|'person']++; counts.total++;
      } else if (p?.type === 'RESULT') {
        const reservation = reservations[(p.ordinal as number) - 1];
        if (!reservation || reservation.outcome || !(OUTCOMES as readonly unknown[]).includes(p.outcome)) failG2('SEND_BUDGET_CORRUPT');
        reservation.outcome = p.outcome as SendBudgetOutcome;
      } else failG2('SEND_BUDGET_CORRUPT');
    }
    if (Object.keys(counts).some(k => counts[k as keyof typeof counts] > limits[k as keyof typeof limits])) failG2('SEND_BUDGET_CORRUPT');
    return { previous, reservations, counts };
  }
  function locked<T>(work: (state:BudgetState)=>T): T {
    let lock;
    try { lock = openSync(file + '.lock', 'wx', 0o600); } catch { failG2('SEND_BUDGET_LOCKED'); }
    try { return work(read()); }
    finally { closeSync(lock); unlinkSync(file + '.lock'); }
  }
  function record(state: BudgetState, payload: unknown) {
    const fd = openSync(file, 'a');
    try { append(fd, state.previous, payload); } finally { closeSync(fd); }
  }
  read();
  return Object.freeze({
    reserve(input: SendBudgetEntry): SendBudgetReservation {
      const entry = validateEntry(input);
      return locked(state => {
        const prior = (state.reservations as Reservations).findLast(r => r.entry.delivery_id === entry.delivery_id);
        if (prior && JSON.stringify(prior.entry) !== JSON.stringify(entry)) failG2('SEND_BINDING_CHANGED');
        if (prior && prior.outcome !== 'REJECTED_NOT_APPLIED') return { kind: 'REPLAY', outcome: prior.outcome ?? 'UNKNOWN' };
        if (state.counts.total >= limits.total || state.counts[entry.target_type.toLowerCase() as 'group'|'person'] >= limits[entry.target_type.toLowerCase() as 'group'|'person']) failG2('SEND_BUDGET_EXHAUSTED');
        const ordinal = state.reservations.length + 1;
        record(state, { type: 'RESERVE', ordinal, entry });
        return { kind: 'RESERVED', ordinal };
      });
    },
    complete(ordinal: number, outcome: SendBudgetOutcome) {
      return locked(state => {
        const prior = state.reservations[ordinal - 1];
        if (!Number.isInteger(ordinal) || !prior || !OUTCOMES.includes(outcome) || (prior.outcome && prior.outcome !== outcome)) failG2('SEND_RESULT_CONFLICT');
        if (!prior.outcome) record(state, { type: 'RESULT', ordinal, outcome });
      });
    },
    counts: () => locked(state => Object.freeze({ ...state.counts })),
  });
}

function validateEntry(value: unknown): SendBudgetEntry {
  if (!value || Object.keys(value).length !== 5 || !UUID.test(((value as Partial<Record<keyof SendBudgetEntry,unknown>>).delivery_id ?? '') as string)
    || !['GROUP', 'PERSON'].includes((value as Partial<Record<keyof SendBudgetEntry,unknown>>).target_type as string)
    || !['target_hash', 'message_hash', 'idempotency_hash'].every(k => HASH.test(((value as Partial<Record<keyof SendBudgetEntry,unknown>>)[k as keyof SendBudgetEntry] ?? '') as string))) failG2('SEND_BINDING_INVALID');
  return { delivery_id: (value as Partial<Record<keyof SendBudgetEntry,unknown>>).delivery_id, target_type: (value as Partial<Record<keyof SendBudgetEntry,unknown>>).target_type, target_hash: (value as Partial<Record<keyof SendBudgetEntry,unknown>>).target_hash,
    message_hash: (value as Partial<Record<keyof SendBudgetEntry,unknown>>).message_hash, idempotency_hash: (value as Partial<Record<keyof SendBudgetEntry,unknown>>).idempotency_hash } as SendBudgetEntry;
}
