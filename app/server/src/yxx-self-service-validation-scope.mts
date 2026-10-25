export interface YxxLocalValidationScope {
 authorization_evidence:'evidence/yxx-ss-007-completion-reconciliation.json';base_head:string;base_tree:string;
 live_authorized:false;parent_readiness:'HISTORICAL_CREATION_V2_NOT_CURRENT_WEB_READINESS';
 status:'LOCAL_IMPLEMENTATION_AND_VALIDATION';work_item:'YXX-SS-008';migration_files:string[];
}
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const BASE='2d9fda2065b1303620f247a9e4d9754f0a3472d9';
const TREE='b1397a10f7c11ec74c85d3582fd44a5e234302c4';
const FILE='plans/yxx-self-service-validation-scope.json';
const STATES=['MANIFEST.json','plans/current_phase.json','plans/master_backlog.json','plans/parallel_workstreams.json','tasks/master_backlog.json','project_summary.json'];
const fail=()=>{throw Object.assign(new Error('YXX_LOCAL_VALIDATION_SCOPE_INVALID'),{code:'YXX_LOCAL_VALIDATION_SCOPE_INVALID'});};

// A local successor scope separates frozen parent readiness from new Web work.
// It cannot approve a current candidate or relax any historical file checksum.
export function readYxxLocalValidationScope(root: string){
  if(!existsSync(path.join(root,FILE)))return null;
  const git=(args: string[])=>execFileSync('git',args,{cwd:root,windowsHide:true});
  const read=(file: string)=>readFileSync(path.join(root,file));
  const lf=(bytes: Buffer)=>bytes.toString('utf8').replaceAll('\r\n','\n');
  const scope=JSON.parse(read(FILE).toString('utf8')) as Record<string,unknown>;
  if(Object.keys(scope).sort().join(',')!=='authorization_evidence,base_head,base_tree,live_authorized,parent_readiness,status,work_item'
    ||scope.work_item!=='YXX-SS-008'||scope.status!=='LOCAL_IMPLEMENTATION_AND_VALIDATION'
    ||scope.base_head!==BASE||scope.base_tree!==TREE||scope.live_authorized!==false
    ||scope.parent_readiness!=='HISTORICAL_CREATION_V2_NOT_CURRENT_WEB_READINESS'
    ||scope.authorization_evidence!=='evidence/yxx-ss-007-completion-reconciliation.json')fail();
  if(git(['merge-base',BASE,'HEAD']).toString().trim()!==BASE||git(['rev-parse',BASE+'^{tree}']).toString().trim()!==TREE)fail();
  const authorization=JSON.parse(read(scope.authorization_evidence as string).toString('utf8')) as Record<string,unknown>;
  if(authorization.status!=='COMPLETE'||authorization.base_head!==BASE||authorization.live!=='NOT_RUN')fail();
  // Parent state stays historical, not silently rewritten to approve the new candidate.
  for(const file of STATES)if(lf(read(file))!==lf(git(['show',BASE+':'+file])))fail();
  const migrations=git(['ls-tree','--name-only',BASE+':database/migrations']).toString().trim().split(/\r?\n/u).sort();
  if(JSON.stringify(readdirSync(path.join(root,'database/migrations')).sort())!==JSON.stringify(migrations))fail();
  for(const name of migrations)if(lf(read('database/migrations/'+name))!==lf(git(['show',BASE+':database/migrations/'+name])))fail();
  if(git(['diff','--name-only','--diff-filter=MDR',BASE,'--','evidence']).toString().trim())fail();
  return Object.freeze({...scope,migration_files:migrations}) as Readonly<YxxLocalValidationScope>;
}
