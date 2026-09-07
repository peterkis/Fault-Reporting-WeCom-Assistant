import { readFile,readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { P2012_RELATIONS,p2012CatalogHash } from './p2-012-migrate.mjs';
const BASE='30a394e85973f5a300b841b23d2c358998796ba6',AUTH='f8d29caf50816ab90f3debf14995085158460784';
const LIVE='55b89664e18c761d31b073fc2e279991e8543507b99ef55080d2ed9f6e2e6740';
const COMPLETION='evidence/p2-012-human-confirmed-incident-report.json';
const IMPLEMENTATION='044ce68dce5422b377d27cbbb432e78f94797478';
const REVIEW_SUBJECT='fix(p2): require direct leg and expire due incident candidates';
const HTTP_BASE='14557b9f6191a08434652550127f42360c97bffe';
const HTTP_SUBJECT='fix(p2): preserve service errors and align destination OpenAPI';
const REFRESH_BASE='724085ed09c07fdd3adbd0c998dd46794dca446a';
const REFRESH_SUBJECT='fix(p2): retry incomplete reporter refreshes';
const REFRESH_EVIDENCE='evidence/p2-012-pr-review-reporter-refresh-hardening.json';
const refreshPaths=new Set(['CHANGELOG.md','FILE_INDEX.md','MANIFEST.json',COMPLETION,REFRESH_EVIDENCE,
  'evidence/p2-012-pr-review-reporter-refresh-hardening.md','web/p2-reporter/reporter.js',
  'tests/p2-012-reporter-refresh-browser.test.mjs','tests/p2-012-schema-live-guards.test.mjs','scripts/validate-p2-012-human-confirmed-incident.mjs']);
export const p2012RefreshReviewPathsValid=paths=>Array.isArray(paths)&&paths.length>0&&paths.every(p=>refreshPaths.has(p));
export function p2012RefreshReviewEvidenceValid(r,hash){return r?.baseline_commit===REFRESH_BASE&&r.commit_subject===REFRESH_SUBJECT
  &&r.review_comment_id===3951493832&&r.status==='PASS'&&r.runtime_input_sha256===hash&&r.live_validation==='NOT_RUN'
  &&Number.isSafeInteger(r.regression?.tests)&&r.regression.tests>=576&&r.regression.pass===r.regression.tests
  &&['fail','cancelled','skipped','todo','exit_code'].every(k=>r.regression[k]===0)
  &&['database_count','backend_count','child_count','listener_count','browser_process_count','browser_profile_count'].every(k=>r.cleanup?.[k]===0);}
const PAUSED_BASE='711269b8780e8edfad3011e78df5e2e6e986c9af';
const PAUSED_SUBJECT='fix(p2): replace paused subscription destinations';
const PAUSED_EVIDENCE='evidence/p2-012-pr-review-paused-destination-hardening.json';
const pausedPaths=new Set(['CHANGELOG.md','FILE_INDEX.md','MANIFEST.json',COMPLETION,PAUSED_EVIDENCE,
  'evidence/p2-012-pr-review-paused-destination-hardening.md','web/p2-workbench/incidents.js',
  'tests/p2-012-workbench-browser.test.mjs','tests/p2-012-schema-live-guards.test.mjs','scripts/validate-p2-012-human-confirmed-incident.mjs']);
export const p2012PausedReviewPathsValid=paths=>Array.isArray(paths)&&paths.length>0&&paths.every(p=>pausedPaths.has(p));
export function p2012PausedReviewEvidenceValid(r,hash){return r?.baseline_commit===PAUSED_BASE&&r.commit_subject===PAUSED_SUBJECT
  &&r.review_comment_id===3951285976&&r.status==='PASS'&&r.runtime_input_sha256===hash&&r.live_validation==='NOT_RUN'
  &&Number.isSafeInteger(r.regression?.tests)&&r.regression.tests>=574&&r.regression.pass===r.regression.tests
  &&['fail','cancelled','skipped','todo','exit_code'].every(k=>r.regression[k]===0)
  &&['database_count','backend_count','child_count','listener_count','browser_process_count','browser_profile_count'].every(k=>r.cleanup?.[k]===0);}
const SUB_BASE='21414a42ecc454a0079ab60801148acab0d7f247';
const SUB_SUBJECT='fix(p2): align subscription retention and client contracts';
const SUB_EVIDENCE='evidence/p2-012-pr-review-subscription-contract-hardening.json';
const subPaths=new Set(['CHANGELOG.md','FILE_INDEX.md','MANIFEST.json',COMPLETION,SUB_EVIDENCE,
  'evidence/p2-012-pr-review-subscription-contract-hardening.md','scripts/validate-p2-012-human-confirmed-incident.mjs',
  'src/p2-012-incident-command-service.mjs','src/p2-012-incident-query.mjs','src/p2-012-notification-policy.mjs',
  'contracts/p2_012_contracts.d.ts','contracts/openapi.yaml','contracts/conversation_center.openapi.yaml',
  'docs/64_p2_012_reporter_subscription_recovery.md','tests/p2-012-subscription-review.integration.test.mjs',
  'tests/p2-012-client-contract-review.test.mjs','tests/p2-012-schema-live-guards.test.mjs']);
export const p2012SubscriptionReviewPathsValid=paths=>Array.isArray(paths)&&paths.length>0&&paths.every(p=>subPaths.has(p));
export function p2012SubscriptionReviewEvidenceValid(r,hash){return r?.baseline_commit===SUB_BASE&&r.commit_subject===SUB_SUBJECT
  &&r.status==='PASS'&&r.runtime_input_sha256===hash&&r.live_validation==='NOT_RUN'
  &&JSON.stringify(r.review_comment_ids)===JSON.stringify([3950900504,3950900513,3950900523,3950900528])
  &&Number.isSafeInteger(r.regression?.tests)&&r.regression.tests>=570&&r.regression.tests===r.regression.pass&&r.regression.exit_code===0
  &&['fail','cancelled','skipped','todo'].every(k=>r.regression[k]===0)
  &&['database_count','backend_count','child_count','listener_count','browser_profile_count','browser_process_count'].every(k=>r.cleanup?.[k]===0);}
const HTTP_EVIDENCE='evidence/p2-012-pr-review-http-openapi-hardening.json';
const httpPaths=new Set(['CHANGELOG.md','FILE_INDEX.md','MANIFEST.json',
  'contracts/openapi.yaml','contracts/conversation_center.openapi.yaml',
  'evidence/p2-012-pr-review-http-openapi-hardening.md',HTTP_EVIDENCE,COMPLETION,
  'scripts/validate-p2-012-human-confirmed-incident.mjs','src/p2-012-domain-contracts.mjs','src/p2-012-workbench-http.mjs',
  'web/p2-workbench/incidents.js','tests/p2-012-domain-contracts.test.mjs','tests/p2-012-workbench.integration.test.mjs',
  'tests/p2-012-schema-live-guards.test.mjs','tests/p2-012-workbench-browser.test.mjs']);
export const p2012HttpOpenApiHardeningPathsValid=paths=>Array.isArray(paths)&&paths.length>0&&new Set(paths).size===paths.length&&paths.every(p=>httpPaths.has(p));
export function p2012HttpOpenApiHardeningEvidenceValid(report,hash){
  const r=report?.regression;
  return report?.baseline_commit===HTTP_BASE&&report.commit_subject===HTTP_SUBJECT&&report.status==='PASS'
    &&report.runtime_input_sha256===hash&&report.live_validation==='NOT_RUN'
    &&JSON.stringify(report.review_comment_ids)===JSON.stringify([3948007171,3948007180])
    &&r?.exit_code===0&&Number.isSafeInteger(r.tests)&&r.tests>=566&&r.pass===r.tests
    &&['fail','cancelled','skipped','todo'].every(k=>r[k]===0)
    &&['database_count','backend_count','child_count','listener_count','browser_process_count','browser_profile_count'].every(k=>report.cleanup?.[k]===0);
}
const reviewPaths=new Set(['src/p2-012-live-reporter-scope.mjs','src/p2-012-workbench-assembly.mjs',
  'src/p2-012-live-cluster.mjs','scripts/p2-012-process-role.mjs','src/p2-016-ticket-notification-projector.mjs','src/p2-016-runtime.mjs',
  'tests/p2-012-live-dynamic-reporter-scope.test.mjs','tests/p2-012-process-assembly.integration.test.mjs',
  'tests/p2-012-incident.integration.test.mjs','tests/p2-012-scope-candidate.integration.test.mjs',
  'scripts/validate-p2-012-human-confirmed-incident.mjs','tests/p2-012-schema-live-guards.test.mjs',
  'evidence/p2-012-human-confirmed-incident-report.md',COMPLETION,'evidence/p2-012-pr-review-hardening.md',
  'CHANGELOG.md','FILE_INDEX.md','MANIFEST.json']);
export const p2012ReviewPathsValid=paths=>Array.isArray(paths)&&paths.length>0&&paths.every(p=>reviewPaths.has(p));
export function p2012ReviewHardeningValid(report,hash){
  const r=report?.regression;
  return report?.baseline_commit===IMPLEMENTATION&&report.commit_subject===REVIEW_SUBJECT&&report.status==='PASS'
    &&report.runtime_input_sha256===hash&&report.live_validation==='NOT_RUN'
    &&r?.exit_code===0&&Number.isSafeInteger(r.pass)&&r.pass>=561&&r.tests===r.pass
    &&['fail','cancelled','skipped','todo'].every(k=>r[k]===0)
    &&['database_count','backend_count','child_count','listener_count','browser_profile_count'].every(k=>report.cleanup?.[k]===0);
}
const closeoutOnly=new Set(['scripts/validate-p2-012-human-confirmed-incident.mjs','scripts/validate-p2-016-ticket-lifecycle-workbench.mjs',
  'scripts/validate-v1-4-architecture.mjs','scripts/validate-arch-006-rule-first-service-loop.mjs',
  'tests/p2-012-schema-live-guards.test.mjs','tests/v1-4-architecture-baseline.test.mjs',
  'tests/arch-006-rule-first-service-loop.test.mjs','tests/arch-005-time-contract-architecture.test.mjs']);
const git=(...args)=>execFileSync('git',['-c','core.safecrlf=false','-c','safe.directory='+process.cwd().replaceAll('\\','/'),...args],{encoding:'utf8',maxBuffer:16000000});
const read=p=>readFile(p,'utf8'),json=async p=>JSON.parse(await read(p));
const sha=v=>createHash('sha256').update(v).digest('hex');
const isInput=p=>/^(?:src\/|web\/|contracts\/|scripts\/|tests\/|database\/|package(?:-lock)?\.json$|\.env\.example$)/u.test(p);
function implementationInputs(revision=IMPLEMENTATION){
  const paths=git('ls-tree','-r','--name-only',revision).trim().split(/\r?\n/u).filter(isInput).sort();
  const raw=execFileSync('git',['-c','safe.directory='+process.cwd().replaceAll('\\','/'),'cat-file','--batch'],
    {input:paths.map(p=>revision+':'+p).join('\n')+'\n',maxBuffer:32000000});
  const files=new Map();let offset=0;
  for(const p of paths){const end=raw.indexOf(10,offset),header=raw.subarray(offset,end).toString('utf8');
    if(!/^[a-f0-9]+ blob [0-9]+$/u.test(header))throw new Error('P2_012_HISTORICAL_INPUT_INVALID');
    const bytes=Number(header.split(' ').at(-1));files.set(p,raw.subarray(end+1,end+1+bytes).toString('utf8'));offset=end+bytes+2;
  }
  return files;
}
function historicalInputHash(revision){const digest=createHash('sha256');for(const [p,content] of implementationInputs(revision)){digest.update(p+'\0');digest.update(content.replaceAll('\r\n','\n'));digest.update('\0');}return digest.digest('hex');}
export function p2012InputPaths(){return [...new Set(git('ls-files','--cached','--others','--exclude-standard').trim().split(/\r?\n/u))].filter(isInput).sort();}
export async function p2012CandidateHash(){const h=createHash('sha256');for(const p of p2012InputPaths()){h.update(p+'\0');h.update((await read(p)).replaceAll('\r\n','\n'));h.update('\0');}return h.digest('hex');}
export function p2012ReadinessValid(report,hash){return report?.status==='READY_FOR_TARGETED_LIVE_VALIDATION'&&report.all_automated_checks_passed===true
  &&report.runtime_input_sha256===hash&&report.live_validation==='NOT_RUN'&&report.second_commit_created===false
  &&report.regression?.exit_code===0&&Number.isSafeInteger(report.regression.pass)&&report.regression.pass>=535&&report.regression.tests===report.regression.pass
  &&['fail','cancelled','skipped','todo'].every(k=>report.regression[k]===0)
  &&report.cleanup?.database_count===0&&report.cleanup?.backend_count===0&&report.cleanup?.child_count===0;
}
export function p2012FrozenInputsMatch(before,after){
  if(!Array.isArray(before)||!Array.isArray(after)||before.length!==after.length)return false;
  const old=new Map(before.map(r=>[r.path,r.sha256])),current=new Map(after.map(r=>[r.path,r.sha256]));
  return old.size===before.length&&current.size===after.length&&after.every(r=>old.has(r.path)
    &&/^[a-f0-9]{64}$/u.test(r.sha256)&&/^[a-f0-9]{64}$/u.test(old.get(r.path))
    &&(closeoutOnly.has(r.path)||old.get(r.path)===r.sha256));
}
export function p2012CompletionEvidenceValid({completion,live,postLive,ownerText,hash}){
  const r=completion?.closeout_regression;
  return completion?.status==='DONE'&&completion.runtime_input_sha256===hash
    &&completion.validated_live_candidate_sha256===LIVE&&completion.owner_approval==='APPROVED'
    &&typeof ownerText==='string'&&ownerText.includes('P2_012_TARGETED_LIVE_VALIDATION=APPROVED')&&ownerText.includes(LIVE)
    &&live?.status==='PASSED'&&live.runtime_input_sha256===LIVE&&live.owner_approval==='APPROVED'
    &&live.observation?.observed_ms>=900000&&live.matrix?.incident_sent===10&&live.matrix?.incident_pending===0
    &&live.matrix?.incident_unknown===0&&live.matrix?.incident_dead_letter===0&&live.non_incident_delivery_audit?.owner_explicitly_accepted===true
    &&live.client_observations?.wecom_group_visible==='CONFIRMED_BY_PROJECT_OWNER'
    &&live.client_observations?.wecom_reporter_private_visible==='CONFIRMED_BY_PROJECT_OWNER'
    &&postLive?.status==='PASS'&&postLive.runtime_input_sha256===LIVE&&postLive.exit_code===0
    &&Number.isSafeInteger(postLive.pass)&&postLive.pass>=559&&postLive.tests===postLive.pass
    &&['fail','cancelled','skipped','todo'].every(k=>postLive[k]===0)&&postLive.cleanup?.cleanup_passed===true
    &&r?.status==='PASS'&&r.exit_code===0&&Number.isSafeInteger(r.pass)&&r.pass>=559&&r.tests===r.pass
    &&['fail','cancelled','skipped','todo'].every(k=>r[k]===0);
}
const seams=new Set(['.env.example','package.json','database/schema_draft.sql','scripts/migrate-current-baseline.mjs',
  'src/p2-003-realtime-event-log.mjs','src/p2-016-runtime.mjs','src/p2-016-reporter-timeline.mjs',
  'web/p2-workbench/workbench.js','web/p2-workbench/lifecycle.html','web/p2-workbench/lifecycle.js','web/p2-reporter/reporter.js',
  'contracts/conversation_realtime_contracts.d.ts','contracts/conversation_realtime_event.schema.json','contracts/p2_016_reporter_ticket_view.schema.json',
  'contracts/openapi.yaml','contracts/conversation_center.openapi.yaml','contracts/domain_events.md',
  'scripts/validate-p2-016-ticket-lifecycle-workbench.mjs','scripts/validate-arch-006-rule-first-service-loop.mjs','scripts/validate-v1-4-architecture.mjs',
  'tests/p2-016-capacity.integration.test.mjs','tests/p2-015-rule-first-orchestration.integration.test.mjs','tests/p2-003-realtime-event-log.test.mjs','tests/arch-005-time-contract-architecture.test.mjs','tests/arch-006-rule-first-service-loop.test.mjs','tests/v1-4-architecture-baseline.test.mjs']);
export async function validateP2012({includeReadinessEvidence=true}={}){
  if(typeof includeReadinessEvidence!=='boolean')throw new Error('P2_012_VALIDATION_MODE_INVALID');
  const errors=[];let checks=0;const check=(ok,message)=>{checks++;if(!ok)errors.push(message);};
  const state=await json('plans/current_phase.json'),ready=state.p2_012_status==='READY_FOR_TARGETED_LIVE_VALIDATION',done=state.p2_012_status==='DONE';
  const completion=done?await json(COMPLETION):null,hardening=completion?.pr_review_hardening,httpHardening=completion?.pr_review_http_openapi_hardening,subHardening=completion?.pr_review_subscription_contract_hardening,pausedHardening=completion?.pr_review_paused_destination_hardening,refreshHardening=completion?.pr_review_reporter_refresh_hardening;
  check(['AUTHORIZED','READY_FOR_TARGETED_LIVE_VALIDATION','DONE'].includes(state.p2_012_status),'P2-012 has a recognized lifecycle state');
  const files=['MANIFEST.json','plans/current_phase.json','plans/master_backlog.json','plans/parallel_workstreams.json','tasks/master_backlog.json','project_summary.json'];
  for(const p of files){const data=await json(p),v=p==='project_summary.json'?data.project:data;
    check(v.last_completed_task===(done?'P2-012':'P2-016')&&v.last_completed_gate==='P2-G1'&&v.last_completed_architecture_task==='ARCH-006',p+' preserves task, Gate and architecture pointers');
    check(v.active_task===(done?null:'P2-012')&&v.active_lane===(done?null:'P2-D')&&v.p2_012_status===state.p2_012_status,p+' active scope');
    check((v.next_task_candidate??v.next_task)===(done?'P2-G2':ready?'P2-012-LIVE':'P2-012')&&v.next_task_authorized===(!ready&&!done),p+' separates task and Gate authorization');
    check(v.p2_g2_status==='NOT_STARTED'&&v.p2_008_status==='TODO_BLOCKED_BY_P2_G2',p+' keeps subsequent tasks closed');
    if(done)check(v.p2_012_completed_at==='2026-09-07'&&v.p2_012_completion_evidence==='evidence/p2-012-human-confirmed-incident-report.md'
      &&v.p2_012_owner_approval_evidence==='evidence/p2-012-project-owner-approval.md',p+' links approved completion');
  }
  const subjects=git('log','--no-merges','--reverse','--format=%s',BASE+'..HEAD').trim().split(/\r?\n/u);
  check(subjects[0]==='chore(p2): authorize P2-012 human-confirmed incident'
    &&(subjects.length===1&&git('rev-parse','HEAD').trim()===AUTH||done
      &&subjects[1]==='feat(p2): implement P2-012 human-confirmed incident and notifications'
      &&(subjects.length===2&&git('rev-parse','HEAD^').trim()===AUTH
        ||hardening&&subjects.length===3&&subjects[2]===REVIEW_SUBJECT&&git('rev-parse','HEAD').trim()===HTTP_BASE
        ||hardening&&httpHardening&&subjects.length===4&&subjects[2]===REVIEW_SUBJECT&&subjects[3]===HTTP_SUBJECT&&git('rev-parse','HEAD^').trim()===HTTP_BASE
        ||subHardening&&subjects.length===5&&subjects[2]===REVIEW_SUBJECT&&subjects[3]===HTTP_SUBJECT&&subjects[4]===SUB_SUBJECT
          &&git('merge-base',SUB_BASE,'HEAD').trim()===SUB_BASE
        ||pausedHardening&&subjects.length===6&&subjects[2]===REVIEW_SUBJECT&&subjects[3]===HTTP_SUBJECT&&subjects[4]===SUB_SUBJECT&&subjects[5]===PAUSED_SUBJECT
          &&git('merge-base',PAUSED_BASE,'HEAD').trim()===PAUSED_BASE
        ||refreshHardening&&subjects.length===7&&subjects[2]===REVIEW_SUBJECT&&subjects[3]===HTTP_SUBJECT&&subjects[4]===SUB_SUBJECT&&subjects[5]===PAUSED_SUBJECT&&subjects[6]===REFRESH_SUBJECT
          &&git('merge-base',REFRESH_BASE,'HEAD').trim()===REFRESH_BASE)),
    'exact authorization, implementation and optional independently authorized review-fix commit');
  check(git('rev-parse',AUTH+'^').trim()===BASE,'first commit starts from approved P2-016 merge');
  check(git('show','-s','--format=%s',AUTH).trim()==='chore(p2): authorize P2-012 human-confirmed incident','exact authorization commit subject');
  check(!git('diff','--name-only','--diff-filter=MDR',BASE,'--','evidence').trim(),'historical Evidence is immutable');
  const changed=git('diff','--name-only',AUTH).trim().split(/\r?\n/u).filter(Boolean);
  for(const p of changed.filter(isInput))check(seams.has(p)||(hardening&&reviewPaths.has(p))||/^(?:(?:src|tests)\/p2-012-|scripts\/(?:validate-)?p2-012-|tests\/helpers\/p2-012-|tests\/fixtures\/p2-012\/|contracts\/p2_012_|database\/migrations\/032_|web\/p2-workbench\/incidents\.)/u.test(p),'authorized runtime seam: '+p);
  if(hardening){
    check(git('merge-base',IMPLEMENTATION,'HEAD').trim()===IMPLEMENTATION,'review fix descends from the exact PR head');
    const reviewChanged=httpHardening?git('diff','--name-only',IMPLEMENTATION,HTTP_BASE).trim().split(/\r?\n/u)
      :[...git('diff','--name-only',IMPLEMENTATION).trim().split(/\r?\n/u),...git('ls-files','--others','--exclude-standard').trim().split(/\r?\n/u)].filter(Boolean);
    check(p2012ReviewPathsValid(reviewChanged),'review changes stay within the exact approved path set, including all migrations and historical Evidence');
    const {pr_review_hardening,pr_review_http_openapi_hardening,pr_review_subscription_contract_hardening,pr_review_paused_destination_hardening,pr_review_reporter_refresh_hardening,...historical}=completion;
    check(JSON.stringify(historical)===JSON.stringify(JSON.parse(git('show',IMPLEMENTATION+':'+COMPLETION))),'review evidence does not rewrite historical completion facts');
  }
  if(httpHardening){
    check(git('merge-base',HTTP_BASE,'HEAD').trim()===HTTP_BASE,'v2 descends from the exact third PR commit');
    const paths=subHardening?git('diff','--name-only',HTTP_BASE,SUB_BASE).trim().split(/\r?\n/u):[...new Set([...git('diff','--name-only',HTTP_BASE).trim().split(/\r?\n/u),
      ...git('ls-files','--others','--exclude-standard').trim().split(/\r?\n/u)].filter(Boolean))];
    check(p2012HttpOpenApiHardeningPathsValid(paths),'v2 exact path allowlist freezes migrations 001-032, catalog, live evidence, Direct Leg and maintenance');
    const {pr_review_http_openapi_hardening,pr_review_subscription_contract_hardening,pr_review_paused_destination_hardening,pr_review_reporter_refresh_hardening,...historical}=completion;
    check(JSON.stringify(historical)===JSON.stringify(JSON.parse(git('show',HTTP_BASE+':'+COMPLETION))),'v2 only appends evidence and preserves all v1 and original completion facts');
    check(JSON.stringify(httpHardening)===JSON.stringify(await json(HTTP_EVIDENCE)),'v2 standalone evidence equals completion appendix');
    check((await read('evidence/p2-012-pr-review-hardening.md')).replaceAll('\r\n','\n')===git('show',HTTP_BASE+':evidence/p2-012-pr-review-hardening.md').replaceAll('\r\n','\n'),'v1 hardening evidence remains immutable');
    for(const p of ['contracts/openapi.yaml','contracts/conversation_center.openapi.yaml'])check(httpHardening.openapi_sha256?.[p]===sha((subHardening?git('show',SUB_BASE+':'+p):await read(p)).replaceAll('\r\n','\n')),'v2 exact OpenAPI hash '+p);
  }
  if(subHardening){
    const changed=pausedHardening?git('diff','--name-only',SUB_BASE,PAUSED_BASE).trim().split(/\r?\n/u):[...new Set([...git('diff','--name-only',SUB_BASE).trim().split(/\r?\n/u),...git('ls-files','--others','--exclude-standard').trim().split(/\r?\n/u)].filter(Boolean))];
    check(p2012SubscriptionReviewPathsValid(changed),'v3 exact subscription/client review scope');
    const {pr_review_subscription_contract_hardening,pr_review_paused_destination_hardening,pr_review_reporter_refresh_hardening,...historical}=completion;
    check(JSON.stringify(historical)===JSON.stringify(JSON.parse(git('show',SUB_BASE+':'+COMPLETION))),'v3 preserves all preceding completion and review evidence');
    check(JSON.stringify(subHardening)===JSON.stringify(await json(SUB_EVIDENCE)),'v3 standalone evidence matches its appendix');
  }
  if(pausedHardening){
    const changed=refreshHardening?git('diff','--name-only',PAUSED_BASE,REFRESH_BASE).trim().split(/\r?\n/u):[...new Set([...git('diff','--name-only',PAUSED_BASE).trim().split(/\r?\n/u),...git('ls-files','--others','--exclude-standard').trim().split(/\r?\n/u)].filter(Boolean))];
    check(p2012PausedReviewPathsValid(changed),'v4 exact UI destination replacement scope');
    const {pr_review_paused_destination_hardening,pr_review_reporter_refresh_hardening,...historical}=completion;
    check(JSON.stringify(historical)===JSON.stringify(JSON.parse(git('show',PAUSED_BASE+':'+COMPLETION))),'v4 preserves all previous evidence');
    check(JSON.stringify(pausedHardening)===JSON.stringify(await json(PAUSED_EVIDENCE)),'v4 standalone evidence matches appendix');
  }
  if(refreshHardening){
    const changed=[...new Set([...git('diff','--name-only',REFRESH_BASE).trim().split(/\r?\n/u),...git('ls-files','--others','--exclude-standard').trim().split(/\r?\n/u)].filter(Boolean))];
    check(p2012RefreshReviewPathsValid(changed),'v5 exact reporter refresh scope');
    const {pr_review_reporter_refresh_hardening,...historical}=completion;
    check(JSON.stringify(historical)===JSON.stringify(JSON.parse(git('show',REFRESH_BASE+':'+COMPLETION))),'v5 preserves all previous evidence');
    check(JSON.stringify(refreshHardening)===JSON.stringify(await json(REFRESH_EVIDENCE)),'v5 standalone evidence matches appendix');
  }
  for(const p of git('ls-tree','-r','--name-only',BASE,'database/migrations','src').trim().split(/\r?\n/u).filter(p=>/^database\/migrations\/(?:00[1-9]|0[12][0-9]|03[01])_|^src\/p2-007/u.test(p))){
    check((await read(p)).replaceAll('\r\n','\n')===git('show',BASE+':'+p).replaceAll('\r\n','\n'),'frozen predecessor '+p);
  }
  const sql=await read('database/migrations/032_p2_012_human_confirmed_incident.sql');
  check((sql.match(/CREATE TABLE /gu)??[]).length===7,'exactly seven new relations');
  check(!/CREATE\s+(?:OR REPLACE\s+)?(?:TRIGGER|FUNCTION|EXTENSION)|TIMESTAMPTZ|TIMESTAMP\s+WITH\s+TIME\s+ZONE/iu.test(sql),'no persistent function, trigger, extension or offset time');
  const catalog=await json('evidence/p2-012-migration-catalog.json');check(catalog.catalog_sha256===p2012CatalogHash(catalog.inventory),'catalog evidence hash');
  check(catalog.inventory.relations.length===P2012_RELATIONS.length&&catalog.inventory.triggers.length===0&&catalog.inventory.routines.length===0,'catalog has seven relations and no routines');
  const env=await read('.env.example');for(const f of ['INCIDENT_CORRELATION_ENABLED','INCIDENT_PUBLIC_NOTICE_ENABLED','INCIDENT_PRIVATE_NOTICE_ENABLED'])check(new RegExp('^'+f+'=false$','mu').test(env),f+' defaults false');
  const parallel=await json('plans/parallel_workstreams.json');check(Object.values(parallel.feature_flag_defaults).every(v=>v===false)&&parallel.feature_flags_enabled.length===0,'all persistent flags false');
  check(JSON.stringify((await json('package.json')).dependencies)===JSON.stringify(JSON.parse(git('show',BASE+':package.json')).dependencies),'no new dependency or framework');
  const schemas=(await readdir('contracts')).filter(p=>/^p2_012_.*\.schema\.json$/u.test(p));check(schemas.length>=10,'required closed schemas');
  for(const name of schemas){const s=await json('contracts/'+name);check(s.$schema==='https://json-schema.org/draft/2020-12/schema'&&s.additionalProperties===false,'closed 2020-12 root '+name);
    const visit=v=>{if(!v||typeof v!=='object')return;if(v.type==='object')check(v.additionalProperties===false,'closed nested object '+name);if(v.type==='array')check(Number.isInteger(v.maxItems)&&v.maxItems<=1000&&v.items,'bounded array '+name);for(const x of Object.values(v))visit(x);};visit(s);
    check(!/"format"\s*:\s*"date-time"/u.test(JSON.stringify(s)),'local timestamps '+name);
  }
  for(const p of ['docs/62_p2_012_human_confirmed_incident_lifecycle.md','docs/63_p2_012_candidate_review_link_unlink.md','docs/64_p2_012_reporter_subscription_recovery.md','docs/65_p2_012_incident_notifications_workbench.md'])check((await read(p)).length>500,'implementation contract '+p);
  const fixtures=await read('tests/fixtures/p2-012/incident-scenarios.v1.jsonl'),manifest=await json('tests/fixtures/p2-012/incident-scenarios-manifest.v1.json');
  check(sha(fixtures)===manifest.sha256&&fixtures.trim().split('\n').length===manifest.count&&manifest.synthetic===true,'synthetic fixture provenance');
  const unsafe=/\.innerHTML\s*=|eval\(|new Date\(|Date\.now\(|toISOString\(|localStorage\.setItem|sessionStorage\.setItem/u;
  for(const p of p2012InputPaths().filter(p=>/^src\/p2-012-|^web\/p2-workbench\/incidents\./u.test(p)))check(!unsafe.test(await read(p)),'safe DOM/time boundary '+p);
  const hash=await p2012CandidateHash(),checked=ready&&includeReadinessEvidence;
  if(checked)check(p2012ReadinessValid(await json('evidence/p2-012-automated-readiness-report.json'),hash),'READY identifies complete current regression and cleanup, never live success');
  if(done){
    const frozen=await json('evidence/p2-012-validated-candidate-inventory.json'),actual=[];
    let completionHash=hash;
    if(hardening){
      const digest=createHash('sha256');
      for(const [p,content] of implementationInputs()){actual.push({path:p,sha256:sha(content)});digest.update(p+'\0');digest.update(content.replaceAll('\r\n','\n'));digest.update('\0');}
      completionHash=digest.digest('hex');
      let reviewHash=hash;
      if(httpHardening){const digest=createHash('sha256');for(const [p,content] of implementationInputs(HTTP_BASE)){digest.update(p+'\0');digest.update(content.replaceAll('\r\n','\n'));digest.update('\0');}reviewHash=digest.digest('hex');}
      check(hardening.baseline_commit===IMPLEMENTATION&&hardening.commit_subject===REVIEW_SUBJECT&&hardening.runtime_input_sha256===reviewHash,
        'review candidate has its own exact input identity, separate from approved live inputs');
      if(includeReadinessEvidence)check(p2012ReviewHardeningValid(hardening,reviewHash),'review fix requires its own full serial regression and cleanup; live validation is not rerun');
      if(httpHardening){
        let httpHash=hash;
        if(subHardening){const digest=createHash('sha256');for(const [p,content] of implementationInputs(SUB_BASE)){digest.update(p+'\0');digest.update(content.replaceAll('\r\n','\n'));digest.update('\0');}httpHash=digest.digest('hex');}
        check(httpHardening.baseline_commit===HTTP_BASE&&httpHardening.commit_subject===HTTP_SUBJECT&&httpHardening.runtime_input_sha256===httpHash,'v2 has independent current input identity');
        if(includeReadinessEvidence)check(p2012HttpOpenApiHardeningEvidenceValid(httpHardening,httpHash),'v2 requires at least 566 full serial passes and independent cleanup; no live rerun');
      }
    }else for(const p of p2012InputPaths())actual.push({path:p,sha256:sha(await read(p))});
    // The old inventory hashes raw working-tree bytes (including mixed CRLF/LF).
    // Git preserves canonical content. Review mode verifies the immutable historical inventory
    // and the original completion's canonical input hash instead of inventing raw checkout bytes.
    const frozenValid=hardening
      ?sha((await read('evidence/p2-012-validated-candidate-inventory.json')).replaceAll('\r\n','\n'))
        ===sha(git('show',IMPLEMENTATION+':evidence/p2-012-validated-candidate-inventory.json').replaceAll('\r\n','\n'))
      :p2012FrozenInputsMatch(frozen.files,actual);
    check(frozen.runtime_input_sha256===LIVE&&frozen.captured_before_closeout_changes===true&&frozenValid,
      hardening?'historical live inventory is unchanged at the exact implementation commit':'owner-approved business inputs unchanged; only exact closeout governance files may differ');
    check(p2012CompletionEvidenceValid({completion,live:await json('evidence/p2-012-targeted-live-validation.json'),
      postLive:await json('evidence/p2-012-post-live-regression-report.json'),ownerText:await read('evidence/p2-012-project-owner-approval.md'),hash:completionHash}),
    'DONE requires approved live evidence, client confirmation, complete regressions and cleanup');
  }
  if(subHardening){const subHash=pausedHardening?historicalInputHash(PAUSED_BASE):hash;check(subHardening.runtime_input_sha256===subHash,'v3 input identity');if(includeReadinessEvidence)check(p2012SubscriptionReviewEvidenceValid(subHardening,subHash),'v3 full regression and cleanup');}
  if(pausedHardening){const pausedHash=refreshHardening?historicalInputHash(REFRESH_BASE):hash;check(pausedHardening.runtime_input_sha256===pausedHash,'v4 input identity');if(includeReadinessEvidence)check(p2012PausedReviewEvidenceValid(pausedHardening,pausedHash),'v4 full regression and cleanup');}
  if(refreshHardening){check(refreshHardening.runtime_input_sha256===hash,'v5 current input identity');if(includeReadinessEvidence)check(p2012RefreshReviewEvidenceValid(refreshHardening,hash),'v5 full regression and cleanup');}
  return {task:'P2-012',state:state.p2_012_status,ok:errors.length===0,checks,errors,runtime_input_sha256:hash,
    readiness_evidence_checked:checked,completion_evidence_checked:done,review_evidence_checked:Boolean(hardening)&&includeReadinessEvidence,
    live_validation:done&&!hardening?'PASSED':'NOT_RUN',historical_live_validation:done?'PASSED':'NOT_RUN',
    second_commit_created:subjects.length>=2,review_fix_commit_created:subjects.length>=3,http_openapi_review_fix_commit_created:subjects.length>=4,subscription_review_fix_commit_created:subjects.length>=5,paused_destination_fix_commit_created:subjects.length>=6,reporter_refresh_fix_commit_created:subjects.length>=7};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const r=await validateP2012();console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1;}catch{console.log(JSON.stringify({task:'P2-012',ok:false,error_code:'P2_012_VALIDATION_FAILED'}));process.exitCode=1;}}
