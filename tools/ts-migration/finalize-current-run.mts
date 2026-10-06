import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {git,hash,record,safeFile,sourceRoot} from './common.mjs';
import {verifyArtifact} from './verify-artifact.mjs';

type DockerResult={status:number|null;stdout:string;stderr:string};
type DockerCommand=DockerResult&{arguments:string[]};
const docker=(args:string[]):DockerResult=>{
  const result=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:60_000,maxBuffer:16*1024*1024});
  return {status:result.status,stdout:result.stdout??'',stderr:result.stderr??result.error?.message??''};
};

/** Close exactly the Actions-owned service and its verified anonymous data volume. */
export function closeOwnedPostgres(containerId:string,runDocker:(args:string[])=>DockerResult=docker){
  const commands:DockerCommand[]=[];
  const observed={container_id:containerId,volume_name:null as string|null,postgres_stop_exit_code:null as number|null,
    postgres_stopped:false,postgres_data_removed:false,owned_residuals:null as number|null,
    preexisting_resources_touched:false,error_code:null as string|null,commands};
  const command=(args:string[])=>{const result=runDocker(args);commands.push({...result,arguments:args});return result;};
  const checked=(args:string[])=>{const result=command(args);assert.equal(result.status,0,'OWNED_POSTGRES_COMMAND_FAILED');return result.stdout;};
  try{
    assert.match(containerId,/^[a-f0-9]{64}$/u);
    const identity=record(JSON.parse(checked(['inspect','--format','{"id":{{json .Id}},"image":{{json .Config.Image}},"mounts":{{json .Mounts}}}',containerId])) as unknown);
    assert.equal(identity.id,containerId);assert.equal(identity.image,'postgres:18');
    assert.ok(Array.isArray(identity.mounts)&&identity.mounts.length===1);
    const mount=record(identity.mounts[0]);assert.equal(mount.Type,'volume');
    assert.equal(mount.Destination,'/var/lib/postgresql');assert.equal(mount.RW,true);
    assert.ok(typeof mount.Name==='string');assert.match(mount.Name,/^[a-f0-9]{64}$/u);
    assert.equal(mount.Source,'/var/lib/docker/volumes/'+mount.Name+'/_data');observed.volume_name=mount.Name;
    const stop=command(['stop','--time','30',containerId]);observed.postgres_stop_exit_code=stop.status;
    assert.equal(stop.status,0,'OWNED_POSTGRES_STOP_FAILED');
    const state=record(JSON.parse(checked(['inspect','--format','{{json .State}}',containerId])) as unknown);
    observed.postgres_stopped=state.Running===false;assert.equal(observed.postgres_stopped,true);
    assert.equal(state.ExitCode,0,'OWNED_POSTGRES_UNCLEAN_EXIT');
    checked(['rm','--volumes',containerId]);
    const containers=checked(['ps','--all','--no-trunc','--quiet','--filter','id='+containerId]).trim().split('\n').filter(Boolean);
    const volumes=checked(['volume','ls','--quiet','--filter','name='+mount.Name]).trim().split('\n').filter(Boolean);
    observed.owned_residuals=containers.length+volumes.length;
    observed.postgres_data_removed=observed.owned_residuals===0;
    assert.equal(observed.owned_residuals,0,'OWNED_POSTGRES_RESIDUALS');
  }catch(error){
    observed.error_code=error instanceof Error&&/^OWNED_POSTGRES_[A-Z_]+$/u.test(error.message)?error.message:'OWNED_POSTGRES_CLOSE_REJECTED';
  }
  return observed;
}

/** Persist measured closure only after the original summary and database check exist. */
export function finalizeCurrentRun(root:string,directory:string,containerId:string,outcome:string){
  assert.equal(process.env.GITHUB_ACTIONS,'true');assert.match(process.env.SHARD??'',/^[1-4]$/u);
  assert.ok(process.env.RUNNER_TEMP);assert.equal(path.resolve(directory),path.resolve(process.env.RUNNER_TEMP,'current-shard-'+process.env.SHARD));
  let metadata:Record<string,unknown>={},metadataValid=false,remainingDatabases:number|null=null;
  try{
    const head=git(root,['rev-parse','HEAD']);assert.equal(head,process.env.EXPECTED_HEAD);
    assert.equal(git(root,['status','--porcelain']),'');
    const manifest=verifyArtifact(root),bytes=readFileSync(safeFile(directory,'tests/summary.json')),summary=record(JSON.parse(bytes.toString('utf8')) as unknown);
    assert.equal(summary.manifest_sha256,manifest);assert.equal(summary.selection,'yxx-current-shard-'+process.env.SHARD+'/4');
    const timeModule=record(createRequire(import.meta.url)(safeFile(root,'.build/runtime/src/p2-g2-evidence-time.mjs')));
    const candidateModule=record(createRequire(import.meta.url)(safeFile(root,'.build/runtime/src/p2-g2-candidate.mjs')));
    assert.ok(typeof timeModule.g2EvidenceTime==='function'&&typeof candidateModule.g2CandidateInventory==='function');
    const time:unknown=timeModule.g2EvidenceTime(),inventory:unknown=candidateModule.g2CandidateInventory(root);
    metadata={...record(time),tested_head:head,tested_tree:git(root,['rev-parse','HEAD^{tree}']),
      candidate_fingerprint:record(inventory).fingerprint,execution_summary_sha256:hash(bytes),
      test_exit_code:outcome==='success'&&summary.status==='SELECTED_TESTS_PASS'?0:1};
    const databaseLine=readFileSync(safeFile(directory,'database-cleanup.txt'),'utf8').split(/\r?\n/u).find(line=>line.startsWith('{"remaining_databases":'));
    assert.ok(databaseLine);const database=record(JSON.parse(databaseLine) as unknown);assert.ok(Array.isArray(database.remaining_databases));
    remainingDatabases=database.remaining_databases.length;assert.equal(remainingDatabases,0);metadataValid=true;
  }catch{metadataValid=false;}
  const closure=closeOwnedPostgres(containerId);
  writeFileSync(path.join(directory,'postgres-close.json'),JSON.stringify(closure,null,2)+'\n',{flag:'wx'});
  const confirmed=metadataValid&&closure.error_code===null&&closure.postgres_stopped&&closure.postgres_data_removed;
  const environment={schema_version:1,kind:'OWNED_TEST_ENVIRONMENT',status:confirmed?'CLEANUP_CONFIRMED':'FAILED',...metadata,
    test_outcome:outcome,remaining_databases_before_stop:remainingDatabases,
    postgres_stop_exit_code:closure.postgres_stop_exit_code,postgres_stopped:closure.postgres_stopped,
    postgres_data_removed:closure.postgres_data_removed,owned_residuals:closure.owned_residuals,
    preexisting_resources_touched:closure.preexisting_resources_touched};
  writeFileSync(path.join(directory,'environment.json'),JSON.stringify(environment,null,2)+'\n',{flag:'wx'});
  assert.equal(confirmed,true,'CURRENT_OWNED_ENVIRONMENT_INCOMPLETE');
  assert.equal(metadata.test_exit_code,0,'CURRENT_TEST_RUN_NOT_PASS');
  return environment;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [directoryFlag,directory,containerFlag,containerId,outcomeFlag,outcome,...extra]=process.argv.slice(2);
  assert.ok(directoryFlag==='--directory'&&directory&&containerFlag==='--container'&&containerId&&outcomeFlag==='--outcome'&&outcome&&extra.length===0);
  console.log(JSON.stringify(finalizeCurrentRun(sourceRoot(),path.resolve(directory),containerId,outcome)));
}
