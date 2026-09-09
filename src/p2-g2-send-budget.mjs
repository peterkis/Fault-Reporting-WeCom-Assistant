import { openSync, closeSync, fsyncSync, writeSync, readFileSync, lstatSync, unlinkSync } from 'node:fs';
import { g2Hash, validateG2Manifest, failG2 } from './p2-g2-validation-config.mjs';

const HASH = /^[a-f0-9]{64}$/u, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const OUTCOMES = ['ACKNOWLEDGED', 'REJECTED_NOT_APPLIED', 'UNKNOWN'];
const bindingFor = manifest => g2Hash(JSON.stringify(validateG2Manifest(manifest)));
function append(fd, previous, payload) {
  const row = { previous, payload, hash: g2Hash(JSON.stringify({ previous, payload })) };
  const bytes = Buffer.from(JSON.stringify(row) + '\n');
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
  fsyncSync(fd);
  return row.hash;
}

// Initialization is a separate controller operation. A restarted Gateway must
// open the existing journal; a missing/corrupt journal never resets the budget.
export function initializeG2SendBudget({ file, manifest }) {
  const binding = bindingFor(manifest);
  let fd;
  try { fd = openSync(file, 'wx', 0o600); } catch { failG2('SEND_BUDGET_EXISTS'); }
  try { append(fd, null, { type: 'HEADER', schema_version: 1, binding }); }
  finally { closeSync(fd); }
}

export function openG2SendBudget({ file, manifest }) {
  manifest = validateG2Manifest(manifest);
  const binding = bindingFor(manifest), limits = manifest.scope.send_budget;
  function read() {
    let text;
    try {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) failG2('SEND_BUDGET_CORRUPT');
      text = readFileSync(file, 'utf8');
    } catch { failG2('SEND_BUDGET_CORRUPT'); }
    if (!text.endsWith('\n')) failG2('SEND_BUDGET_CORRUPT');
    const lines = text.slice(0, -1).split('\n');
    if (lines.length < 1 || lines.length > 2001) failG2('SEND_BUDGET_CORRUPT');
    let previous = null;
    const reservations = [], counts = { group: 0, person: 0, total: 0 };
    for (const [index, line] of lines.entries()) {
      let row; try { row = JSON.parse(line); } catch { failG2('SEND_BUDGET_CORRUPT'); }
      if (!row || row.previous !== previous || row.hash !== g2Hash(JSON.stringify({ previous, payload: row.payload }))) failG2('SEND_BUDGET_CORRUPT');
      previous = row.hash;
      const p = row.payload;
      if (index === 0) {
        if (p?.type !== 'HEADER' || p.schema_version !== 1 || p.binding !== binding) failG2('SEND_BUDGET_BINDING');
      } else if (p?.type === 'RESERVE') {
        validateEntry(p.entry);
        if (p.ordinal !== reservations.length + 1) failG2('SEND_BUDGET_CORRUPT');
        const prior = reservations.findLast(r => r.entry.delivery_id === p.entry.delivery_id);
        if (prior && (prior.outcome !== 'REJECTED_NOT_APPLIED' || JSON.stringify(prior.entry) !== JSON.stringify(p.entry))) failG2('SEND_BUDGET_CORRUPT');
        reservations.push({ ...p, outcome: null });
        counts[p.entry.target_type.toLowerCase()]++; counts.total++;
      } else if (p?.type === 'RESULT') {
        const reservation = reservations[p.ordinal - 1];
        if (!reservation || reservation.outcome || !OUTCOMES.includes(p.outcome)) failG2('SEND_BUDGET_CORRUPT');
        reservation.outcome = p.outcome;
      } else failG2('SEND_BUDGET_CORRUPT');
    }
    if (Object.keys(counts).some(k => counts[k] > limits[k])) failG2('SEND_BUDGET_CORRUPT');
    return { previous, reservations, counts };
  }
  function locked(work) {
    let lock;
    try { lock = openSync(file + '.lock', 'wx', 0o600); } catch { failG2('SEND_BUDGET_LOCKED'); }
    try { return work(read()); }
    finally { closeSync(lock); unlinkSync(file + '.lock'); }
  }
  function record(state, payload) {
    const fd = openSync(file, 'a');
    try { append(fd, state.previous, payload); } finally { closeSync(fd); }
  }
  read();
  return Object.freeze({
    reserve(input) {
      const entry = validateEntry(input);
      return locked(state => {
        const prior = state.reservations.findLast(r => r.entry.delivery_id === entry.delivery_id);
        if (prior && JSON.stringify(prior.entry) !== JSON.stringify(entry)) failG2('SEND_BINDING_CHANGED');
        if (prior && prior.outcome !== 'REJECTED_NOT_APPLIED') return { kind: 'REPLAY', outcome: prior.outcome ?? 'UNKNOWN' };
        if (state.counts.total >= limits.total || state.counts[entry.target_type.toLowerCase()] >= limits[entry.target_type.toLowerCase()]) failG2('SEND_BUDGET_EXHAUSTED');
        const ordinal = state.reservations.length + 1;
        record(state, { type: 'RESERVE', ordinal, entry });
        return { kind: 'RESERVED', ordinal };
      });
    },
    complete(ordinal, outcome) {
      return locked(state => {
        const prior = state.reservations[ordinal - 1];
        if (!Number.isInteger(ordinal) || !prior || !OUTCOMES.includes(outcome) || (prior.outcome && prior.outcome !== outcome)) failG2('SEND_RESULT_CONFLICT');
        if (!prior.outcome) record(state, { type: 'RESULT', ordinal, outcome });
      });
    },
    counts: () => locked(state => Object.freeze({ ...state.counts })),
  });
}

function validateEntry(value) {
  if (!value || Object.keys(value).length !== 5 || !UUID.test(value.delivery_id ?? '')
    || !['GROUP', 'PERSON'].includes(value.target_type)
    || !['target_hash', 'message_hash', 'idempotency_hash'].every(k => HASH.test(value[k] ?? ''))) failG2('SEND_BINDING_INVALID');
  return { delivery_id: value.delivery_id, target_type: value.target_type, target_hash: value.target_hash,
    message_hash: value.message_hash, idempotency_hash: value.idempotency_hash };
}
