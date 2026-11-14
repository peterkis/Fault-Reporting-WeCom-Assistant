import {execFileSync,spawnSync} from 'node:child_process';
import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Entry,Routes,Selection} from './routing.mjs';

type Requirements={database:boolean;browser:boolean;pyyaml:boolean;ffmpeg:boolean;windows:boolean};
type Profile={selections:string[];tools:string[];build:boolean;pyyaml:boolean;windows:boolean};
export const HISTORY_CLASSES=['historical','on-demand','out-of-scope'] as const;
type HistoryClass=typeof HISTORY_CLASSES[number];
// applicable=true: the original risk is still current, so a direct edit selects the test.
// applicable=false: an edit alone (copy, selectors, wording) never selects it; only a change to its own
// risk area (triggers) does. Every changed registered test is either selected or reported with a reason.
type History={path:string;class:HistoryClass;risk:string;applicable:boolean;disposition:string;replacement:string[];triggers:string[]};
type Required={risk:string;paths:string[]};
export type Policy={schema_version:1;profiles:Record<string,Profile>;rules:{pattern:string;profiles:string[];reason:string}[];fallback:string[];required:Required[];history:History[]};
export type Change={status:string;paths:string[]};
export type Plan={base:string;head:string;changes:Change[];profiles:string[];reasons:{path:string;profiles:string[];reason:string}[];selection:Selection;selections:string[];tools:string[];build:boolean;requirements:Requirements;lane:'docs'|'no-database'|'database';not_selected:{profile:string;reason:string}[];history:{path:string;class:string;status:HistoryStatus;reason:string}[]};
export type HistoryStatus='DIRECT_CHANGE_REQUIRES_CHECK'|'RISK_AREA_CHANGED_SELECTED'|'EDITED_NOT_SELECTED'|'HISTORICAL_ONLY_NOT_SELECTED';

export function isWindowsDesktopGraphics(entryPath:string):boolean {
  return entryPath==='tests/workbench-desktop-session.browser.test.mts'
    ||entryPath==='tests/workbench-desktop-session.gpu.browser.test.mts';
}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('PR_POLICY_OBJECT');return value as Record<string,unknown>;}
function strings(value:unknown):string[]{if(!Array.isArray(value)||!value.every((v:unknown)=>typeof v==='string'&&v.length>0)||new Set(value).size!==value.length)throw Error('PR_POLICY_STRINGS');return value;}
export function parsePolicy(input:unknown):Policy{
  const raw=object(input);if(raw.schema_version!==1)throw Error('PR_POLICY_VERSION');
  const profiles:Record<string,Profile>={};
  for(const [name,value] of Object.entries(object(raw.profiles))){
    const p=object(value);if(!/^[a-z][a-z0-9-]*$/u.test(name)||['build','pyyaml','windows'].some(k=>typeof p[k]!=='boolean'))throw Error('PR_PROFILE_INVALID');
    const tools=strings(p.tools);if(tools.some(t=>!/^tools\/ts-migration\/[a-z0-9-]+\.test\.mts$/u.test(t)))throw Error('PR_TOOL_PATH');
    profiles[name]={selections:strings(p.selections),tools,build:p.build===true,pyyaml:p.pyyaml===true,windows:p.windows===true};
  }
  if(!Array.isArray(raw.rules)||!raw.rules.length||!Array.isArray(raw.history)||!Array.isArray(raw.required)||!raw.required.length)throw Error('PR_POLICY_RULES');
  const rules=raw.rules.map((v:unknown)=>{const r=object(v);if(typeof r.pattern!=='string'||typeof r.reason!=='string'||!r.reason)throw Error('PR_POLICY_RULE');new RegExp(r.pattern,'u');return {pattern:r.pattern,profiles:strings(r.profiles),reason:r.reason};});
  const history=raw.history.map((v:unknown)=>{const h=object(v);
    if(typeof h.path!=='string'||!h.path||typeof h.risk!=='string'||!h.risk.trim()||typeof h.applicable!=='boolean'||typeof h.disposition!=='string'||!h.disposition.trim())throw Error('PR_HISTORY_REASON_REQUIRED: '+String(h.path));
    if(!HISTORY_CLASSES.includes(h.class as HistoryClass))throw Error('PR_HISTORY_CLASS: '+h.path);
    const replacement=strings(h.replacement),triggers=strings(h.triggers);if(h.applicable&&!replacement.length)throw Error('PR_HISTORY_REPLACEMENT_REQUIRED');
    // On-demand and out-of-scope features still exist in the product: their own code must reach them.
    if(h.class!=='historical'&&!triggers.length)throw Error('PR_HISTORY_TRIGGER_REQUIRED: '+h.path);
    for(const t of triggers){new RegExp(t,'u');if(t.startsWith('^tests/')&&new RegExp(t,'u').test(h.path))throw Error('PR_HISTORY_SELF_TRIGGER: '+h.path);}
    return {path:h.path,class:h.class as HistoryClass,risk:h.risk,applicable:h.applicable,disposition:h.disposition,replacement,triggers};});
  const required=raw.required.map((v:unknown)=>{const r=object(v);if(typeof r.risk!=='string'||!r.risk.trim())throw Error('PR_REQUIRED_INVALID');const paths=strings(r.paths);if(!paths.length)throw Error('PR_REQUIRED_INVALID');return {risk:r.risk,paths};});
  const fallback=strings(raw.fallback);
  if(!fallback.length||rules.some(r=>!r.profiles.length))throw Error('PR_POLICY_EMPTY');
  for(const name of [...fallback,...rules.flatMap(r=>r.profiles)])if(!Object.hasOwn(profiles,name))throw Error('PR_UNKNOWN_PROFILE: '+name);
  if(new Set(history.map(h=>h.path)).size!==history.length)throw Error('PR_HISTORY_DUPLICATE');
  return {schema_version:1,profiles,rules,fallback,required,history};
}
export function parseDiff(raw:string):Change[]{
  const fields=raw.split('\0');if(fields.pop()!=='')throw Error('PR_DIFF_NOT_NUL_TERMINATED');
  const changes:Change[]=[];
  for(let i=0;i<fields.length;){const status=fields[i++];if(!status||!/^(?:[ADMT]|R\d{1,3}|C\d{1,3})$/u.test(status))throw Error('PR_DIFF_STATUS');const paths=fields.slice(i,i+(/^[RC]/u.test(status)?2:1));i+=paths.length;
    if(paths.length!==(/^[RC]/u.test(status)?2:1)||paths.some(p=>!p||p.includes('\0')||p.startsWith('/')||p.split('/').some(s=>s==='..'||s==='.')))throw Error('PR_DIFF_PATH');changes.push({status,paths});}
  return changes;
}
export function diff(root:string,base:string,head='HEAD'):{base:string;head:string;changes:Change[]}{
  const git=(args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
  const resolve=(ref:string)=>{if(!ref||ref.startsWith('-')||/[\x00-\x20\x7f]/u.test(ref))throw Error('PR_BASE_HEAD_REQUIRED');try{return git(['rev-parse','--verify',ref+'^{commit}']).trim();}catch{throw Error('PR_BASE_HEAD_INVALID: '+ref);}};
  const b=resolve(base),h=resolve(head);
  return {base:b,head:h,changes:parseDiff(git(['diff','--name-status','--find-renames','-z',b,h,'--']))};
}
export function planChanges(policy:Policy,routes:Routes,changes:Change[],base='sample-base',head='sample-head'):Plan{
  const selected=new Set<string>(),direct=new Set<string>(),reasons:Plan['reasons']=[];
  const historyPaths=new Set(policy.history.map(h=>h.path));
  const entries=new Map<string,Entry>();const selections=new Set<string>(),tools=new Set<string>();
  const resolve=(name:string):Entry[]=>{
    const names=strings(routes.selections[name]);if(!names.length)throw Error('PR_EMPTY_SELECTION: '+name);
    return names.map(p=>{const e=routes.entries.find(e=>e.path.replace(/\.mts$/u,'.mjs')===p.replace(/\.mts$/u,'.mjs'));if(!e)throw Error('PR_MISSING_ENTRY: '+p);return e;});
  };
  // Validate all profiles, including dormant ones, so policy drift cannot hide behind a path filter.
  for(const [name,p] of Object.entries(policy.profiles)){
    if(!p.build&&(p.selections.length||p.tools.length||p.windows||p.pyyaml))throw Error('PR_SELECTION_REQUIRES_BUILD');
    if(p.build&&!p.selections.length)throw Error('PR_EMPTY_PROFILE: '+name);
    for(const selection of p.selections)for(const e of resolve(selection))if(historyPaths.has(e.path))throw Error('PR_HISTORY_IN_DEFAULT: '+e.path);
  }
  if(!policy.fallback.some(name=>policy.profiles[name]?.build))throw Error('PR_FALLBACK_MUST_EXECUTE');
  for(const h of policy.history){if(!routes.entries.some(e=>e.path===h.path)||h.replacement.some(p=>!routes.entries.some(e=>e.path===p)))throw Error('PR_HISTORY_MISSING_ENTRY');}
  // MVP bottom lines must stay in the default (fallback) union and can never be classified away.
  const fallbackPaths=new Set(policy.fallback.flatMap(n=>policy.profiles[n]?.selections??[]).flatMap(s=>resolve(s).map(e=>e.path)));
  for(const r of policy.required)for(const p of r.paths){if(historyPaths.has(p))throw Error('PR_REQUIRED_IN_HISTORY: '+p);if(!fallbackPaths.has(p))throw Error('PR_REQUIRED_NOT_DEFAULT: '+p);}
  const changedPaths=[...new Set(changes.flatMap(c=>c.paths))];
  const triggered=new Set(policy.history.filter(h=>h.triggers.some(t=>changedPaths.some(p=>new RegExp(t,'u').test(p)))).map(h=>h.path));
  const historyByPath=new Map(policy.history.map(h=>[h.path,h]));
  for(const p of changedPaths){
    const rule=policy.rules.find(r=>new RegExp(r.pattern,'u').test(p));const names=rule?.profiles??policy.fallback;
    for(const name of names){if(!policy.profiles[name])throw Error('PR_UNKNOWN_PROFILE: '+name);selected.add(name);}
    const existing=routes.entries.find(e=>e.path===p);
    if(existing&&!changes.some(c=>c.status==='D'&&c.paths.includes(p))){direct.add(p);const h=historyByPath.get(p);if(!h||h.applicable)entries.set(existing.path,existing);}
    reasons.push({path:p,profiles:names,reason:rule?.reason??'Unknown path: current MVP fallback; never an empty production pass'});
  }
  for(const p of triggered){const e=routes.entries.find(e=>e.path===p);if(e)entries.set(e.path,e);}
  let build=false;const requirements:Requirements={database:false,browser:false,pyyaml:false,ffmpeg:false,windows:false};
  for(const name of selected){const p=policy.profiles[name];if(!p)throw Error('PR_UNKNOWN_PROFILE');build ||= p.build;requirements.pyyaml ||= p.pyyaml;requirements.windows ||= p.windows;
    for(const tool of p.tools)tools.add(tool);
    for(const s of p.selections){selections.add(s);for(const e of resolve(s))entries.set(e.path,e);}}
  const sorted=[...entries.values()].sort((a,b)=>a.path.localeCompare(b.path,'en'));
  for(const e of sorted){requirements.database ||= e.requires_database;requirements.browser ||= e.requires_browser;requirements.pyyaml ||= e.requires_pyyaml;requirements.ffmpeg ||= e.requires_ffmpeg===true;requirements.windows ||= e.requires_powershell;}
  if(sorted.some(e=>e.path==='tests/pc-admin-electron.browser.test.mts')&&!requirements.windows)throw Error('PR_NATIVE_RESOURCE_REQUIRED');
  if(sorted.some(e=>isWindowsDesktopGraphics(e.path)))requirements.windows=true;
  if(sorted.length&&!build)throw Error('PR_ENTRIES_REQUIRE_BUILD');
  if(build&&!sorted.length)throw Error('PR_EMPTY_EXECUTION');
  const status=(h:History):HistoryStatus=>direct.has(h.path)&&h.applicable?'DIRECT_CHANGE_REQUIRES_CHECK':triggered.has(h.path)?'RISK_AREA_CHANGED_SELECTED':direct.has(h.path)?'EDITED_NOT_SELECTED':'HISTORICAL_ONLY_NOT_SELECTED';
  const history=policy.history.map(h=>({path:h.path,class:h.class,status:status(h),reason:h.disposition}));
  // No silent drop: a changed registered test is either executed or reported as an explained, classified exclusion.
  const chosen=new Set(sorted.map(e=>e.path));
  for(const p of direct)if(!chosen.has(p)&&history.find(h=>h.path===p)?.status!=='EDITED_NOT_SELECTED')throw Error('PR_SILENT_DROP: '+p);
  return {base,head,changes,profiles:[...selected].sort(),reasons,selection:{entries:sorted,flags:[],label:'pr-impact'},selections:[...selections].sort(),tools:[...tools].sort(),build,requirements,lane:!build?'docs':requirements.database?'database':'no-database',
    not_selected:Object.keys(policy.profiles).filter(n=>!selected.has(n)).map(profile=>({profile,reason:'NOT_SELECTED: no matching change; not a test pass'})),
    history};
}
export async function createPlan(root:string,base:string,head='HEAD'):Promise<Plan>{
  const {loadRoutes}=await import('./routing.mjs');
  const delta=diff(root,base,head),policy=parsePolicy(JSON.parse(readFileSync(path.join(root,'plans/testing-policy.json'),'utf8')) as unknown);
  const checkout=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
  if(delta.head!==checkout)throw Error('PR_HEAD_CHECKOUT_MISMATCH');
  const plan=planChanges(policy,loadRoutes(root),delta.changes,delta.base,delta.head);
  for(const tool of plan.tools)readFileSync(path.join(root,tool));
  return plan;
}
async function run(root:string,plan:Plan,reportDir:string):Promise<void>{
  const {runSelection}=await import('./run-tests.mjs');
  // The caller has built once; runSelection retains exact artifact/host/flags/cleanup checks.
  const entries=plan.selection.entries.filter(e=>e.path!=='tests/pc-admin-electron.browser.test.mts'&&!isWindowsDesktopGraphics(e.path));
  if(entries.length)runSelection(root,{...plan.selection,entries},{reportDir});
  if(plan.tools.length){const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-concurrency=1',...plan.tools.map(p=>path.join(root,'.build/tools',path.basename(p).replace(/\.mts$/u,'.mjs')))],{cwd:root,stdio:'inherit',windowsHide:true});if(result.error||result.status!==0)throw Error('PR_TOOL_TESTS_FAILED');}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),options=new Map<string,string>();let execute=false,docs=false;
  while(args.length){const key=args.shift();if(key==='--run'){if(execute)throw Error('PR_ARGUMENTS');execute=true;continue;}if(key==='--check-docs'){if(docs)throw Error('PR_ARGUMENTS');docs=true;continue;}if(!key||!['--base','--head','--out','--report-dir'].includes(key)||options.has(key))throw Error('PR_ARGUMENTS');const value=args.shift();if(!value||value.startsWith('--'))throw Error('PR_ARGUMENTS');options.set(key,value);}
  const base=options.get('--base');if(!base)throw Error('PR_BASE_REQUIRED');
  if(execute&&execFileSync('git',['status','--porcelain','-z'],{cwd:process.cwd(),encoding:'utf8',windowsHide:true}).length)throw Error('PR_EXECUTION_REQUIRES_CLEAN_HEAD');
  const plan=await createPlan(process.cwd(),base,options.get('--head'));
  if(docs){const {checkAgentDocs}=await import('./check-agent-docs.mjs');const issues=checkAgentDocs(process.cwd(),plan.changes.flatMap(c=>c.paths));if(issues.length)throw Error('PR_DOCUMENT_LINKS: '+JSON.stringify(issues));}
  const json=JSON.stringify(plan,null,2)+'\n';const out=options.get('--out');if(out)writeFileSync(out,json);else process.stdout.write(json);
  if(process.env.GITHUB_OUTPUT&&!execute){appendFileSync(process.env.GITHUB_OUTPUT,`lane=${plan.lane}\nwindows=${plan.requirements.windows}\ndatabase=${plan.requirements.database}\nbrowser=${plan.requirements.browser}\npyyaml=${plan.requirements.pyyaml}\nffmpeg=${plan.requirements.ffmpeg}\n`);}
  if(execute){const report=options.get('--report-dir');if(!report)throw Error('PR_REPORT_DIR_REQUIRED');await run(process.cwd(),plan,report);}
}
