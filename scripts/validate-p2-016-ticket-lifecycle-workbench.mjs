import { readFile,readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath,pathToFileURL } from 'node:url';
import path from 'node:path';
import {isG2SuccessorState,verifyG2Predecessor} from '../src/p2-g2-predecessor-verification.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const base='b1b8e4deb14e6290ca45aea12d92baaef4728c11',authorization='3599fa479c752ed75cd4652e5ffdaee2b212ad24';
const git=(...args)=>execFileSync('git',['-c','safe.directory='+root.replaceAll('\\','/'),'-c','core.safecrlf=false',...args],{cwd:root,encoding:'utf8',maxBuffer:8000000});
const read=p=>readFile(path.join(root,p),'utf8');
const liveCandidate='3752596720f20524ff989ee9cf913b9e104e32a4c2095c48fc83804e7e75f863';
const completionPath='evidence/p2-016-ticket-lifecycle-workbench-report.json';
const closeoutOnly=new Set(['scripts/validate-p2-016-ticket-lifecycle-workbench.mjs','scripts/validate-v1-4-architecture.mjs',
  'scripts/validate-arch-006-rule-first-service-loop.mjs','tests/p2-016-schema-contract.test.mjs',
  'tests/v1-4-architecture-baseline.test.mjs','tests/arch-006-rule-first-service-loop.test.mjs','tests/arch-005-time-contract-architecture.test.mjs']);
function candidateFiles(){return git('ls-files','--cached','--others','--exclude-standard').split(/\r?\n/u).filter(p=>/^(?:src\/|web\/|contracts\/|scripts\/|tests\/|package(?:-lock)?\.json$|database\/|\.env\.(?:example|pilot\.example)$)/u.test(p)).sort();}
export function p2016FrozenInputsMatch(before,after){
  if(!Array.isArray(before)||!Array.isArray(after)||before.length!==after.length)return false;
  const old=new Map(before.map(r=>[r.path,r.sha256])),current=new Map(after.map(r=>[r.path,r.sha256]));
  return old.size===before.length&&current.size===after.length&&after.every(r=>old.has(r.path)
    &&/^[a-f0-9]{64}$/u.test(r.sha256)&&/^[a-f0-9]{64}$/u.test(old.get(r.path))
    &&(closeoutOnly.has(r.path)||old.get(r.path)===r.sha256));
}
export function p2016CompletionEvidenceValid({completion,live,postLive,ownerText,hash}){
  const r=completion?.closeout_regression;
  return completion?.status==='DONE'&&completion.runtime_input_sha256===hash
    &&completion.validated_live_candidate_sha256===liveCandidate&&completion.owner_approval==='APPROVED'
    &&typeof ownerText==='string'&&ownerText.includes('P2_016_TARGETED_LIVE_VALIDATION=APPROVED')&&ownerText.includes(liveCandidate)
    &&live?.status==='PASSED'&&live.runtime_input_sha256===liveCandidate&&live.owner_approval==='APPROVED'
    &&Number.isSafeInteger(live.summary?.observed_ms)&&live.summary.observed_ms>=900000&&live.summary?.final_pending===0&&live.summary?.final_dead_letter===0&&live.summary?.final_unknown===0
    &&postLive?.runtime_input_sha256===liveCandidate&&postLive.regression?.exit_code===0&&Number.isSafeInteger(postLive.regression?.pass)&&postLive.regression.pass>=533
    &&['fail','cancelled','skipped','todo'].every(k=>postLive.regression?.[k]===0)
    &&r?.status==='PASS'&&r.exit_code===0&&Number.isSafeInteger(r.pass)&&r.pass>=533&&r.tests===r.pass
    &&['fail','cancelled','skipped','todo'].every(k=>r[k]===0);
}
export async function p2016CandidateHash(){
  const files=candidateFiles();
  const h=createHash('sha256');for(const p of files){h.update(p+'\0');h.update((await read(p)).replaceAll('\r\n','\n'));h.update('\0');}return h.digest('hex');
}
export async function validateP2016({includeReadinessEvidence=true}={}){
  if(typeof includeReadinessEvidence!=='boolean')throw new Error('P2_016_VALIDATION_MODE_INVALID');
  const errors=[];let checks=0;const check=(ok,message)=>{checks++;if(!ok)errors.push(message);};
  const state=JSON.parse(await read('plans/current_phase.json'));
  if(isG2SuccessorState(state)){
    const result=verifyG2Predecessor('P2-016',includeReadinessEvidence);
    // Preserve the strict failure and its evidence; classify only this known
    // successor mismatch. The separate frozen checkout proves historical PASS.
    if(result.errors?.length===1&&result.errors[0]==='P2_G2_HISTORICAL_EVIDENCE_CHANGED')
      return {...result,status:'HISTORICAL_PREDECESSOR_CHECK_NOT_APPLICABLE_ON_SUCCESSOR_CHECKOUT',
        current_runtime_verified:false,historical_validation_command:'npm run validate:p2:016:historical'};
    return result;
  }
  const successorActive=['P2_012_AUTHORIZED','P2_012_READY_FOR_TARGETED_LIVE_VALIDATION'].includes(state.implementation_authorization_status);
  const successorDone=state.implementation_authorization_status==='P2_012_DONE_AWAITING_P2_G2_AUTHORIZATION';
  const successor=successorActive||successorDone;
  const completedRevision='30a394e85973f5a300b841b23d2c358998796ba6';
  const revision=successor?completedRevision:'HEAD';
  let historicalContent=null;
  const candidateRead=p=>successor?historicalContent.get(p):read(p);
  const files=()=>successor?git('ls-tree','-r','--name-only',revision).split(/\r?\n/u).filter(p=>/^(?:src\/|web\/|contracts\/|scripts\/|tests\/|package(?:-lock)?\.json$|database\/|\.env\.(?:example|pilot\.example)$)/u.test(p)).sort():candidateFiles();
  if(successor){
    const names=files(),raw=execFileSync('git',['-c','safe.directory='+root.replaceAll('\\','/'),'cat-file','--batch'],{cwd:root,input:names.map(p=>revision+':'+p).join('\n')+'\n',maxBuffer:32000000});
    historicalContent=new Map();let offset=0;for(const p of names){const end=raw.indexOf(10,offset),header=raw.subarray(offset,end).toString('utf8');if(!/^[a-f0-9]+ blob [0-9]+$/u.test(header))throw new Error('P2_016_HISTORICAL_INPUT_INVALID');const bytes=Number(header.split(' ').at(-1));historicalContent.set(p,raw.subarray(end+1,end+1+bytes).toString('utf8'));offset=end+bytes+2;}
    check(git('merge-base',completedRevision,'HEAD').trim()===completedRevision,'P2-012 descends from the completed P2-016 commit');
    check(successorDone?state.active_task===null&&state.active_lane===null&&state.p2_012_status==='DONE'
      :state.active_task==='P2-012'&&state.active_lane==='P2-D'&&['AUTHORIZED','READY_FOR_TARGETED_LIVE_VALIDATION'].includes(state.p2_012_status),'successor lifecycle is explicit');
    check((await read('evidence/p2-012-start-authorization.md')).includes(completedRevision),'successor authorization identifies the immutable predecessor');
  }
  const done=state.p2_016_status==='DONE';
  check(['AUTHORIZED','READY_FOR_TARGETED_LIVE_VALIDATION','DONE'].includes(state.p2_016_status),'P2-016 has a recognized lifecycle state');
  check(state.last_completed_task===(successorDone?'P2-012':done?'P2-016':'P2-015')&&state.p2_015_status==='DONE','completed task pointer and P2-015 history are preserved');
  check(state.last_completed_gate==='P2-G1'&&state.last_completed_architecture_task==='ARCH-006','task and Gate/architecture pointers remain separate');
  check(state.active_task===(successorActive?'P2-012':done?null:'P2-016')&&state.active_lane===(successorActive?'P2-D':done?null:'P2-B'),'active task and lane follow the successor lifecycle');
  check(state.next_task_candidate===(successorDone?'P2-G2':successorActive&&state.p2_012_status==='READY_FOR_TARGETED_LIVE_VALIDATION'?'P2-012-LIVE':successorActive?'P2-012':done?'P2-012':'P2-016')
    &&state.next_task_authorized===(successorActive?state.p2_012_status==='AUTHORIZED':!done&&!successorDone),'completion does not authorize the next candidate or Gate');
  check((successor||state.p2_012_status==='TODO_REQUIRES_SEPARATE_AUTHORIZATION')&&state.p2_g2_status==='NOT_STARTED'&&state.p2_008_status==='TODO_BLOCKED_BY_P2_G2','adjacent task and Gate boundaries remain closed');
  const first=git('show','--format=','--name-only',authorization).trim().split(/\r?\n/u);
  check(first.every(p=>! /^(?:src\/|web\/|database\/|contracts\/|tests\/p2-016)/u.test(p)),'first commit is authorization and ledger reconciliation only');
  const subjects=git('log','--no-merges','--reverse','--format=%s',base+'..'+revision).trim().split(/\r?\n/u);
  check(subjects[0]==='chore(p2): authorize P2-016 ticket lifecycle workbench'
    &&(subjects.length===1&&git('rev-parse','HEAD').trim()===authorization||done&&subjects.length===2&&subjects[1]==='feat(p2): implement P2-016 full ticket lifecycle workbench and notifications'
      &&git('rev-parse',revision+(successor?'^2^':'^')).trim()===authorization),'exact authorization then one owner-approved implementation commit');
  check((await read('evidence/p2-016-start-authorization.md')).replaceAll('\r\n','\n')===git('show',authorization+':evidence/p2-016-start-authorization.md').replaceAll('\r\n','\n'),'authorization Evidence is immutable');
  const migrations=(await readdir(path.join(root,'database/migrations'))).filter(p=>/^\d{3}_.*\.sql$/u.test(p)&&Number(p.slice(0,3))<=30);
  for(const name of migrations)check((await read('database/migrations/'+name)).replaceAll('\r\n','\n')===git('show',base+':database/migrations/'+name).replaceAll('\r\n','\n'),'historical migration unchanged: '+name);
  for(const name of (await readdir(path.join(root,'src'))).filter(p=>p.startsWith('p2-007')&&p.endsWith('.mjs')))
    check((await read('src/'+name)).replaceAll('\r\n','\n')===git('show',base+':src/'+name).replaceAll('\r\n','\n'),'P2-007 runtime unchanged: '+name);
  const sql=await read('database/migrations/031_p2_016_ticket_lifecycle_workbench_notifications.sql');
  check((sql.match(/CREATE TABLE /gu)??[]).length===6,'031 creates exactly six supporting relations');
  check(!/CREATE\s+(?:OR REPLACE\s+)?(?:FUNCTION|TRIGGER|EXTENSION)|TIMESTAMPTZ|TIMESTAMP\s+WITH\s+TIME\s+ZONE/iu.test(sql),'031 has no function/trigger/extension or offset time type');
  check(!/CREATE TABLE\s+\w+\.ticket\s*\(/iu.test(sql),'no second Ticket Core');
  for(const filename of ['.env.example'])for(const flag of ['TICKET_LIFECYCLE_WORKBENCH_ENABLED','REPORTER_TIMELINE_ENABLED','WECOM_TEMPLATE_CARD_ENABLED'])
    check(new RegExp('^'+flag+'=false$','mu').test(await read(filename)),flag+' defaults false in '+filename);
  const pkg=JSON.parse(await read('package.json')),oldPkg=JSON.parse(git('show',base+':package.json'));
  check(JSON.stringify(pkg.dependencies)===JSON.stringify(oldPkg.dependencies),'no dependency or frontend framework change');
  const schemas=(await readdir(path.join(root,'contracts'))).filter(p=>/^p2_016_.*\.schema\.json$/u.test(p));check(schemas.length>=15,'P2-016 has all fifteen required schemas');
  for(const name of schemas){
    const text=await read('contracts/'+name),schema=JSON.parse(text);check(schema.$schema==='https://json-schema.org/draft/2020-12/schema','schema version: '+name);
    check(schema.additionalProperties===false,'closed root object: '+name);
    check(!/"format"\s*:\s*"date-time"/u.test(text),'no offset date-time format: '+name);
    const visit=(s,p)=>{if(!s||typeof s!=='object')return;if(s.type==='object')check(s.additionalProperties===false,'closed nested object: '+name+p);if(s.type==='array')check(Number.isInteger(s.maxItems)&&s.maxItems<=1000,'bounded array: '+name+p);for(const [k,v]of Object.entries(s))visit(v,p+'/'+k);};visit(schema,'');
  }
  for(const p of ['docs/58_p2_016_manual_review_workbench.md','docs/59_p2_016_ticket_lifecycle_and_responsibility.md','docs/60_p2_016_reporter_timeline_security.md','docs/61_p2_016_wecom_notifications_template_card.md','contracts/p2_016_contracts.d.ts'])check((await read(p)).length>100,'required implementation documentation: '+p);
  for(const name of ['p2-016-workbench-http.mjs','p2-016-reporter-http.mjs'])check(!/\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:pilot_ticket|communication)\./u.test(await read('src/'+name)),'HTTP does not directly mutate business tables: '+name);
  for(const name of ['web/p2-workbench/lifecycle.js','web/p2-reporter/reporter.js'])check(!/\.innerHTML\s*=|eval\(|new Date\(|localStorage\.setItem|sessionStorage\.setItem/u.test(await read(name)),'safe native DOM, time and storage: '+name);
  const protectedEvidence=git('diff','--name-only','--diff-filter=MDR',base,'--','evidence').trim();check(!protectedEvidence,'historical completion Evidence remains unchanged');
  const digest=createHash('sha256');for(const p of files()){digest.update(p+'\0');digest.update((await candidateRead(p)).replaceAll('\r\n','\n'));digest.update('\0');}const hash=digest.digest('hex');
  if(done){
    const frozen=JSON.parse(await read('evidence/p2-016-validated-candidate-inventory.json'));
    const actual=[];for(const p of files())actual.push({path:p,sha256:createHash('sha256').update((await candidateRead(p)).replaceAll('\r\n','\n')).digest('hex')});
    check(frozen.live_candidate_sha256===liveCandidate&&frozen.captured_before_closeout_changes===true
      &&p2016FrozenInputsMatch(frozen.files,actual),'owner-approved business inputs unchanged; only seven explicit closeout governance files may differ');
    check(state.p2_016_completed_at==='2026-09-04'&&state.p2_016_completion_evidence==='evidence/p2-016-ticket-lifecycle-workbench-report.md','DONE has completion date and report');
  }
  const readinessEvidenceChecked=includeReadinessEvidence&&state.p2_016_status==='READY_FOR_TARGETED_LIVE_VALIDATION';
  if(readinessEvidenceChecked){
    const report=JSON.parse(await read('evidence/p2-016-automated-readiness-report.json'));
    check(report.status===state.p2_016_status&&report.all_automated_checks_passed===true,'readiness has successful automated Evidence');
    check(report.regression.pass>=462&&report.regression.fail===0&&report.regression.skipped===0&&report.regression.cancelled===0&&report.regression.todo===0,'readiness preserves complete regression with zero skips');
    check(report.runtime_input_sha256===hash,'readiness identifies the current verified code and contracts');
    check(report.live_validation==='NOT_RUN'&&report.second_commit_created===false,'readiness does not claim live validation or implementation commit');
  }
  const completionEvidenceChecked=includeReadinessEvidence&&done;
  if(completionEvidenceChecked)check(p2016CompletionEvidenceValid({completion:JSON.parse(await read(completionPath)),
    live:JSON.parse(await read('evidence/p2-016-targeted-live-validation.json')),
    postLive:JSON.parse(await read('evidence/p2-016-post-live-regression-report.json')),
    ownerText:await read('evidence/p2-016-project-owner-approval.md'),hash}),'DONE requires exact candidate, approved live Evidence and complete closeout regression');
  return {task:'P2-016',verification_revision:revision,successor_task:successor?'P2-012':null,state:state.p2_016_status,ok:errors.length===0,checks,errors,runtime_input_sha256:hash,readiness_evidence_checked:readinessEvidenceChecked,completion_evidence_checked:completionEvidenceChecked};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const result=await validateP2016();console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;}catch{console.log(JSON.stringify({task:'P2-016',ok:false,error_code:'P2_016_VALIDATION_FAILED'}));process.exitCode=1;}}
