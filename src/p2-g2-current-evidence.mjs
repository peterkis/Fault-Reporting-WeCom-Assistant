import {readFileSync,existsSync,lstatSync} from 'node:fs';
import path from 'node:path';

// New candidates select append-only reports; frozen historical report paths stay readable.
export function readG2CurrentEvidence(root,kind){
  if(!['parent','member'].includes(kind))throw Error('CURRENT_EVIDENCE_KIND_INVALID');
  const phase=path.join(root,'plans/current_phase.json');
  const pointers=existsSync(phase)?JSON.parse(readFileSync(phase,'utf8')).p2_g2_current_readiness:undefined;
  if(pointers!==undefined&&(!pointers||typeof pointers!=='object'||Array.isArray(pointers)
    ||Object.keys(pointers).some(key=>!['parent','member'].includes(key))
    ||['parent','member'].some(key=>typeof pointers[key]!=='string')))throw Error('CURRENT_EVIDENCE_SELECTION_INVALID');
  const selected=pointers?.[kind];
  const ref=selected??(kind==='parent'?'evidence/p2-g2-automated-readiness-report.json':'evidence/p2-g2-yxx-entry-report.json');
  const pattern=kind==='parent'?/^evidence\/p2-g2-(?:automated-readiness-report|yxx-entry-[a-z0-9-]+-parent-report)\.json$/u
    :/^evidence\/p2-g2-yxx-entry-(?:report|[a-z0-9-]+-report)\.json$/u;
  if(typeof ref!=='string'||!pattern.test(ref))throw Error('CURRENT_EVIDENCE_PATH_INVALID');
  const file=path.join(root,ref),stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw Error('CURRENT_EVIDENCE_FILE_INVALID');
  return JSON.parse(readFileSync(file,'utf8'));
}
