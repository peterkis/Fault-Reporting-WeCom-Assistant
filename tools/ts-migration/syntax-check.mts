import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {controlledBuildRoot,mappings,sourceRoot} from './common.mjs';

export interface SyntaxCheckState {started:number;checked:number;active:number;max_active:number}
// Parse-only jobs retain the original Node --check and every emitted MJS. Two
// small children use the two-core budget; compiler and frontend phases stay serial.
export async function checkCompiledSyntax(root:string,files:readonly string[]):Promise<SyntaxCheckState> {
 const runtime=path.join(root,'.build/runtime');
 if(!files.length||files.some(file=>{const rel=path.relative(runtime,path.resolve(file));return !rel||rel.startsWith('..')||path.isAbsolute(rel)||!rel.endsWith('.mjs');}))throw new Error('MIGRATION_SYNTAX_CHECK_INPUT');
 const state:SyntaxCheckState={started:0,checked:0,active:0,max_active:0};
 let next=0,failure:Error|null=null;
 const worker=async():Promise<void>=>{
  while(failure===null&&next<files.length){
   const file=files[next++];if(!file)throw new Error('MIGRATION_SYNTAX_CHECK_INPUT');
   state.started++;state.active++;state.max_active=Math.max(state.max_active,state.active);
   await new Promise<void>(resolve=>{
    let settled=false;
    const finish=(error?:Error):void=>{if(settled)return;settled=true;state.active--;if(error){failure??=error;}else state.checked++;resolve();};
    try{
     const child=spawn(process.execPath,['--check',file],{cwd:root,env:{...process.env,NODE_V8_COVERAGE:''},stdio:'inherit',windowsHide:true});
     child.once('error',error=>finish(error));
     child.once('close',(code,signal)=>finish(code===0&&signal===null?undefined:new Error('MIGRATION_COMMAND_FAILED: '+String(code))));
    }catch(error){finish(error instanceof Error?error:new Error('MIGRATION_SYNTAX_CHECK_FAILED'));}
   });
  }
 };
 // Workers settle their already-started children even if the other job fails.
 await Promise.all([worker(),worker()]);
 if(failure!==null)throw Object.assign(failure,{syntax_state:{...state}});
 if(state.checked!==files.length||state.active!==0)throw new Error('MIGRATION_SYNTAX_CHECK_INCOMPLETE');
 return state;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.length!==2||args[0]!=='--root'||!args[1]||!path.isAbsolute(args[1]))throw new Error('MIGRATION_SYNTAX_CHECK_ARGUMENTS');
 const root=sourceRoot(args[1]);
 const files=mappings(root).filter(f=>f.kind==='COMPILED'&&f.path.endsWith('.mjs')).map(f=>path.join(controlledBuildRoot(root),'runtime',f.path));
 const state=await checkCompiledSyntax(root,files);
 console.log(JSON.stringify({status:'MIGRATION_ALL_COMPILED_NODE_SYNTAX_CHECKS_PASS',...state,concurrency_limit:2}));
}
