import type { G2Manifest, CandidateFingerprint, SourceSHA256, ApprovalScopeHash } from './p2-g2-validation-config.mjs';
import type { G2RegressionCounts, G2VerifiedRun } from './p2-g2-source-audit.mjs';
export interface G2CandidateFile {path:string;sha256:SourceSHA256;bytes:number;encoding:'BINARY'|'UTF8_LF'}
export interface CandidateInventory {schema_version:2;gate:'P2-G2';algorithm:'SHA256_SORTED_PATH_CONTENT_UTF8_LF_BUILD_INPUTS_V2';fingerprint:CandidateFingerprint;file_count:number;excluded_local_files:readonly string[];files:G2CandidateFile[]}
export interface PreparedG2Candidate {preparation_status:'READY_FOR_LIVE_E2E';candidate_fingerprint:CandidateFingerprint;
 gold_reference_count:202;scenario_matrix_complete:true;independent_review_passed:true;
 full_regression:G2RegressionCounts & {tap_path:string;tap_sha256:string;baseline_test_files_covered:true};source_evidence:Record<'regression_run'|'scenario_matrix'|'independent_review'|'source_execution',{path:string;sha256:string}>}
type ReportInput = Partial<Record<'preparation_status'|'candidate_fingerprint'|'gold_reference_count'|'scenario_matrix_complete'|'independent_review_passed',unknown>> & {
 full_regression?:Partial<Record<keyof G2RegressionCounts | "tap_path" | "tap_sha256" | "baseline_test_files_covered",unknown>>;source_evidence?:Partial<Record<'regression_run'|'scenario_matrix'|'independent_review'|'source_execution',{path?:unknown;sha256?:unknown}>>};
type FileInput = {path?:unknown;sha256?:unknown};
type RunInput = Partial<Record<'suite'|'mode'|'exit_code'|'error'|'signal'|'candidate_unchanged'|'stdout_sha256'|'candidate_fingerprint',unknown>> & {counts?:Record<string,unknown>;files?:FileInput[]};
type ReviewInput = {candidate_fingerprint?:unknown;reviews?:{axis?:unknown;verdict?:unknown;unresolved_findings?:unknown;reviewer?:unknown;source?:{path?:unknown;sha256?:unknown}}[]};
type MatrixInput = {candidate_fingerprint?:unknown;scenarios?:{scenario_id?:unknown;preparation_status?:unknown;test_names?:unknown[]}[]};
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { G2_SCENARIO_IDS } from './p2-g2-gate-evaluator.mjs';
import {createG2SourceAudit} from './p2-g2-source-audit.mjs';
import { g2Hash, failG2, validateG2Manifest } from './p2-g2-validation-config.mjs';
import {requirePreparedYxxCandidate} from './p2-g2-yixiaoxiu-readiness.mjs';
import {assertG2EvidenceTime} from './p2-g2-evidence-time.mjs';
import {readG2CurrentEvidence} from './p2-g2-current-evidence.mjs';

const entryRoot = fileURLToPath(new URL('../', import.meta.url));
// Execution stays in the verified runtime; candidate, manifest and approval facts belong to its source checkout.
export const G2_ROOT = path.basename(path.resolve(entryRoot)) === 'runtime'
  && path.basename(path.dirname(path.resolve(entryRoot))) === '.build'
  ? path.resolve(entryRoot, '../..') : entryRoot;
export const G2_CANDIDATE_ROOTS = Object.freeze(['src', 'scripts', 'web', 'contracts', 'config', 'config_examples', 'database/migrations', 'tests']);
export const G2_CANDIDATE_FILES = Object.freeze(['package.json', 'package-lock.json', '.env.example']);
// Optional on legacy fixtures; every present build control is part of the current candidate.
export const G2_CANDIDATE_CONTROL_ROOTS = Object.freeze(['tools/ts-migration', 'plans/typescript-migration', '.github/workflows']);
export const G2_CANDIDATE_CONTROL_FILES = Object.freeze(['.gitattributes', 'tsconfig.base.json', 'tsconfig.tools.json', 'tsconfig.migration.json', 'tsconfig.type-tests.json', 'build-manifest.json', 'plans/yxx-current-readiness-scope.json', 'plans/yxx-current-readiness-acceptance.json', 'plans/yxx-ss-009-acceptance.json', '.github/review/pr21-evidence-exceptions.json', '.github/review/yxx-current-evidence-adjudication.json', '.github/review/pr-evidence-delta.test.mjs', '.github/review/verify-published-history.test.mjs', '.github/review/pr-evidence-delta.mjs', '.github/review/verify-published-history.mjs']);
export function isG2CandidatePath(file: string) {
  return !G2_EXCLUDED_LOCAL_FILES.includes(file) && (G2_CANDIDATE_FILES.includes(file)
    || G2_CANDIDATE_CONTROL_FILES.includes(file) || [...G2_CANDIDATE_ROOTS, ...G2_CANDIDATE_CONTROL_ROOTS].some(dir => file.startsWith(dir + '/')));
}

// This ignored local example is not read by a Runtime. .env.example and Gate manifest semantics are included.
export const G2_EXCLUDED_LOCAL_FILES = Object.freeze(['config/pilot.env.example']);
export function g2CandidateInventory(root = G2_ROOT): CandidateInventory {
  const files: G2CandidateFile[] = [];
  function add(relative: string) {
    if(G2_EXCLUDED_LOCAL_FILES.includes(relative))return;
    const absolute = path.join(root, relative), stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) failG2('CANDIDATE_SYMLINK_FORBIDDEN');
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) add(relative + '/' + name);
      return;
    }
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024 || files.length >= 2048) failG2('CANDIDATE_INVENTORY_LIMIT');
    const binary = !/\.(mjs|cjs|js|mts|cts|ts|tsx|json|jsonl|yaml|yml|sql|css|html|md|txt|sh|py)$/u.test(relative) && !['.env.example','.gitattributes'].includes(relative);
    const raw = readFileSync(absolute);
    const content = binary ? raw : Buffer.from(new TextDecoder('utf-8', { fatal: true }).decode(raw).replaceAll('\r\n', '\n'));
    files.push({ path: relative, sha256: g2Hash(content) as SourceSHA256, bytes: content.length, encoding: binary ? 'BINARY' : 'UTF8_LF' });
  }
  for (const selected of [...G2_CANDIDATE_ROOTS, ...G2_CANDIDATE_FILES]) {
    if(selected==='config'&&!existsSync(path.join(root,selected)))continue;
    add(selected);
  }
  for (const selected of [...G2_CANDIDATE_CONTROL_ROOTS, ...G2_CANDIDATE_CONTROL_FILES]) {
    if (existsSync(path.join(root, selected))) add(selected);
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return Object.freeze({ schema_version: 2, gate: 'P2-G2', algorithm: 'SHA256_SORTED_PATH_CONTENT_UTF8_LF_BUILD_INPUTS_V2',
    fingerprint: g2Hash(JSON.stringify(files)) as CandidateFingerprint, file_count: files.length, excluded_local_files: G2_EXCLUDED_LOCAL_FILES, files });
}
export function verifyG2Candidate(expected: CandidateFingerprint, root = G2_ROOT) {
  const inventory = g2CandidateInventory(root);
  if (inventory.fingerprint !== expected) failG2('CANDIDATE_CHANGED');
  return inventory;
}
export function g2ApprovalScopeHash(manifest: unknown): ApprovalScopeHash {
  const m = validateG2Manifest(manifest);
  // Exclude only the approval document's own path/hash to avoid a circular hash.
  return g2Hash(JSON.stringify({ schema_version: m.schema_version, gate: m.gate, mode: m.mode,
    run_id: m.run_id, candidate_fingerprint: m.candidate_fingerprint, feature_flags: m.feature_flags,
    listen_port: m.listen_port, reporter_origin: m.reporter_origin, scope: m.scope,
    valid_from_epoch_ms: m.approval.valid_from_epoch_ms, expires_epoch_ms: m.approval.expires_epoch_ms })) as ApprovalScopeHash;
}
export function verifyG2ApprovalFile(manifest: G2Manifest, root = G2_ROOT) {
  if (manifest.mode !== 'live') return;
  const ref = manifest.approval.source_ref;
  if (typeof ref !== 'string' || !/^evidence\/p2-g2-live-start-approval(?:-[a-z0-9-]+)?\.md$/u.test(ref)) failG2('OWNER_START_APPROVAL_REQUIRED');
  const absolute = path.join(root, ref);
  let bytes;
  try {
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) failG2('OWNER_START_APPROVAL_REQUIRED');
    bytes = readFileSync(absolute);
  } catch { failG2('OWNER_START_APPROVAL_REQUIRED'); }
  if (g2Hash(bytes) !== manifest.approval.source_sha256) failG2('OWNER_APPROVAL_CHANGED');
  // A file hash is an integrity check, not proof that a human observed the run.
  // The owner must supply this file; no Gate command generates a positive approval.
  const text = bytes.toString('utf8');
  if (!text.includes(manifest.run_id) || !text.includes(manifest.candidate_fingerprint)
    || !text.includes('P2-G2') || !text.includes('PROJECT_OWNER')
    || !text.split(/\r?\n/u).includes('manifest_scope_sha256: ' + g2ApprovalScopeHash(manifest))) failG2('OWNER_APPROVAL_BINDING_MISMATCH');
}

export function requirePreparedG2Candidate(fingerprint: CandidateFingerprint, root=G2_ROOT): PreparedG2Candidate{
  const reject: () => never=()=>failG2('READY_CANDIDATE_REQUIRED');
  const readEvidence=(ref: {path?:unknown;sha256?:unknown} | undefined)=>{
    if(!ref||!/^evidence\/p2-g2-[a-z0-9-]+\.(json|tap|md)$/u.test((ref.path??'') as string))reject();
    let raw;try{
      const file=path.join(root,ref.path as string),stat=lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024)reject();
      raw=readFileSync(file);
    }catch{reject();}
    if(g2Hash(raw)!==ref.sha256)failG2('REGRESSION_EVIDENCE_CHANGED');
    return raw.toString('utf8');
  };
  let r: ReportInput;try{r=readG2CurrentEvidence(root,'parent') as ReportInput;}catch{reject();}
  try{assertG2EvidenceTime(r);}catch{reject();}
  const f=r?.full_regression,keys=['tests','pass','fail','skipped','cancelled','todo'] as const;
  if(r?.preparation_status!=='READY_FOR_LIVE_E2E'||r.candidate_fingerprint!==fingerprint||r.gold_reference_count!==202
    ||r.scenario_matrix_complete!==true||r.independent_review_passed!==true||!f
    ||keys.some(k=>!Number.isSafeInteger(f[k])||(f[k] as number)<0)||(f.tests as number)<577||f.tests!==f.pass
    ||f.baseline_test_files_covered!==true||keys.slice(2).some(k=>f[k]!==0))reject();
  const tap=readEvidence({path:f.tap_path,sha256:f.tap_sha256}),counts: Record<string,number>={},passedNames=new Set<string>();
  for(const line of tap.split(/\r?\n/u)){
    if(/^\s*not ok \d+/u.test(line))reject();
    const passed=/^\s*ok \d+ - (.+)$/u.exec(line);if(passed)passedNames.add((passed[1] as string));
    const m=/^# (tests|pass|fail|skipped|cancelled|todo) (\d+)$/u.exec(line);if(m)counts[(m[1] as string)]=Number(m[2]);
  }
  if(keys.some(k=>counts[k]!==f[k])||(tap.match(/^\s*ok \d+ - /gmu)??[]).length!==f.tests)reject();
  let run:RunInput,matrix:MatrixInput,review:ReviewInput,sourceAudit:{candidate_fingerprint?:unknown};try{
    run=JSON.parse(readEvidence(r.source_evidence?.regression_run));
    matrix=JSON.parse(readEvidence(r.source_evidence?.scenario_matrix));
    review=JSON.parse(readEvidence(r.source_evidence?.independent_review));
    sourceAudit=JSON.parse(readEvidence(r.source_evidence?.source_execution));
  }catch(e){if((e as {code?:string} | null)?.code)throw e;reject();}
  if([run,matrix,review,sourceAudit].some(v=>v?.candidate_fingerprint!==fingerprint))reject();
  const inventory=g2CandidateInventory(root);
  if(inventory.fingerprint!==fingerprint)failG2('CANDIDATE_CHANGED');
  const files=inventory.files.filter(f=>/^tests\/(?:[^/]+\/)*[^/]+\.test\.(?:mjs|mts)$/u.test(f.path));
  if(run.suite!=='full'||run.mode!=='SYNTHETIC_AUTOMATION'||run.exit_code!==0||run.error!==null
    ||run.signal!==null||run.candidate_unchanged!==true||run.stdout_sha256!==f.tap_sha256
    ||keys.some(k=>run.counts?.[k]!==f[k])||!Array.isArray(run.files)||run.files.length!==files.length
    ||new Set((run.files as FileInput[]).map(f=>f.path)).size!==files.length
    ||files.some(f=>!(run.files as FileInput[]).some(actual=>actual.path===f.path&&actual.sha256===f.sha256)))reject();
  let computedAudit;try{computedAudit=createG2SourceAudit({tap,run,root});}catch{reject();}
  if(g2Hash(JSON.stringify(sourceAudit))!==g2Hash(JSON.stringify(computedAudit))||!computedAudit.accounting_complete
    ||computedAudit.observed_normal_pass_cases!==122||computedAudit.manual_review_observation_missing.length)reject();
  if(!Array.isArray(matrix.scenarios)||matrix.scenarios.length!==G2_SCENARIO_IDS.length
    ||new Set(matrix.scenarios.map(s=>s.scenario_id)).size!==G2_SCENARIO_IDS.length
    ||matrix.scenarios.some(s=>!(G2_SCENARIO_IDS as readonly unknown[]).includes(s.scenario_id)||s.preparation_status!=='VERIFIED'
      ||!Array.isArray(s.test_names)||!s.test_names.length||s.test_names.some(name=>
        typeof name!=='string'||!passedNames.has(name as string))))reject();
  if(!Array.isArray(review.reviews)||review.reviews.length!==2
    ||!['STANDARDS','SPEC'].every(axis=>(review.reviews as { axis?: unknown; verdict?: unknown; unresolved_findings?: unknown; reviewer?: unknown; source?: { path?: unknown; sha256?: unknown; }; }[]).some(v=>v.axis===axis&&v.verdict==='PASS'
      &&v.unresolved_findings===0&&typeof v.reviewer==='string'&&v.reviewer.length>0)))reject();
  for(const v of review.reviews){
    let source:Record<string,unknown>;try{source=JSON.parse(readEvidence(v.source));}catch(e){if((e as {code?:string} | null)?.code)throw e;reject();}
    if(source.candidate_fingerprint!==fingerprint||['axis','verdict','unresolved_findings','reviewer'].some(k=>source[k]!==v[k as keyof typeof v])
      ||source.source_execution_sha256!==((r.source_evidence as Partial<Record<"regression_run" | "scenario_matrix" | "independent_review" | "source_execution", { path?: unknown; sha256?: unknown; }>>).source_execution as { path?: unknown; sha256?: unknown; }).sha256
      ||source.scenario_matrix_sha256!==((r.source_evidence as Partial<Record<"regression_run" | "scenario_matrix" | "independent_review" | "source_execution", { path?: unknown; sha256?: unknown; }>>).scenario_matrix as { path?: unknown; sha256?: unknown; }).sha256
      ||!Array.isArray(source.findings)||source.findings.some((f: {resolved?:unknown})=>f.resolved!==true))reject();
  }
  if(inventory.files.some(file=>/^src\/p2-g2-yixiaoxiu-authorizer\.(?:mjs|mts)$/u.test(file.path))){
    requirePreparedYxxCandidate({fingerprint,root,fullRegression:f,passedNames,verifiedRun:run,verifiedRunReference:((r.source_evidence as Partial<Record<"regression_run" | "scenario_matrix" | "independent_review" | "source_execution", { path?: unknown; sha256?: unknown; }>>).regression_run as { path?: unknown; sha256?: unknown; })});
  }
  return r as ReportInput & PreparedG2Candidate;
}
