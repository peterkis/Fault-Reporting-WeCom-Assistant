import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface PerfEvidencePlan {file:string; scenario:string; complete:boolean; text:string|undefined}

const planKeys = ['pending','active','handled','handled-all','handled-page2','item','search','search-text','search-text-all'];
const planName = (key:string) => '42a-explain-' + key + '.txt';
const summaryName = '42a-perf-board.txt';
const filenames = [...planKeys.map(planName), summaryName];
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const header = new RegExp('^-- run_id=(' + uuid + ')\\r?\\n', 'u');
const tempName = new RegExp('^\\.(.+)\\.' + uuid + '\\.tmp$', 'u');

export function checkEvidenceGeneration(directory:string):string {
  const ids = new Set<string|undefined>();
  for (const name of filenames) {
    const file = path.join(directory, name);
    if (!fs.lstatSync(file, {throwIfNoEntry:false})?.isFile()) throw Error('PERF_BOARD_INCOMPLETE_EVIDENCE:' + name);
    ids.add(header.exec(fs.readFileSync(file, 'utf8'))?.[1]);
  }
  if (ids.size !== 1) throw Error('PERF_BOARD_EVIDENCE_MIXED_GENERATION');
  const [id] = ids;
  if (!id) throw Error('PERF_BOARD_EVIDENCE_RUN_ID_MISSING');
  return id;
}

export function publishPerfEvidence(directory:string, summary:string, version:string, plans:readonly PerfEvidencePlan[]) {
  const files = new Map<string,string>();
  for (const key of planKeys) {
    const plan = plans.find(entry => entry.file === key);
    if (!plan?.complete || !plan.text?.trim()) throw Error('PERF_BOARD_INCOMPLETE_EVIDENCE:' + key);
    files.set(planName(key), `-- scenario ${plan.scenario}; EXPLAIN (ANALYZE, BUFFERS) of the exact statement it sent; ${version}\n${plan.text}\n`);
  }
  files.set(summaryName, summary + '\n');

  fs.mkdirSync(directory, {recursive:true});
  for (const name of filenames) {
    const target = fs.lstatSync(path.join(directory, name), {throwIfNoEntry:false});
    if (target && !target.isFile()) throw Error('PERF_BOARD_EVIDENCE_TARGET_INVALID:' + name);
  }
  // One benchmark writer per evidence directory. Other files there may be hand-maintained.
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    const name = tempName.exec(entry.name)?.[1];
    if (entry.isFile() && name && filenames.includes(name)) fs.unlinkSync(path.join(directory, entry.name));
  }

  const id = randomUUID();
  const staged = (name:string) => path.join(directory, '.' + name + '.' + id + '.tmp');
  for (const [name, content] of files) {
    fs.writeFileSync(staged(name), '-- run_id=' + id + '\n' + content, {flag:'wx', flush:true});
  }
  // Replace each original directly. The summary is the last published file.
  for (const name of filenames) fs.renameSync(staged(name), path.join(directory, name));
  return checkEvidenceGeneration(directory);
}
