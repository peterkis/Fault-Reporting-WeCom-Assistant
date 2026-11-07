import {createHash} from 'node:crypto';
import {readFileSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import type {Plugin} from 'vite';

const CORE_SHA='f2717ebbbf5cc7ad587798d7b300166e93aa4181004d1c6c5115044174eaf016';
const STD_SHA='895c009c5b65393fc428f46fa0a35a23d3fe91650174f8025abd7b5de089e802';
const hash=(source:string)=>createHash('sha256').update(source).digest('hex');
const normalized=(file:string)=>{const value=path.normalize(file).replaceAll('\\','/');return process.platform==='win32'?value.toLowerCase():value;};
const reject=(reason:string):never=>{throw new Error('DESKTOP_LOGIN_PREPARE_SOURCE_REJECTED:'+reason);};

/** Exact installed inputs, including the bundled TypeGPU initAsync implementation. */
export function verifyDesktopLoginPrepareSource(version:string,core:string,std:string):void{
  if(version!=='4.0.5')reject('version');
  if(hash(core)!==CORE_SHA)reject('core-sha256');
  if(hash(std)!==STD_SHA)reject('std-sha256');
}

const PASS_PREPARE=`\tasync function prepareAsync() {
\t\tif (!current) throw new Error("DESKTOP_LOGIN_PREPARE_NO_COMPOSITION");
\t\tif (current.computeSteps.length !== 0) throw new Error("DESKTOP_LOGIN_PREPARE_COMPUTE_UNSUPPORTED");
\t\tconst pipelines = new Set([...current.rttPasses.map((pass) => pass.pipeline), current.finalPass.pipeline]);
\t\tawait Promise.all([...pipelines].map((pipeline) => pipeline.initAsync()));
\t}
`;
const RENDERER_PREPARE=`\tconst desktopLoginPrepareAsync = async () => {
\t\ttry {
\t\tif (failureReason || !canRender()) throw new Error("DESKTOP_LOGIN_PREPARE_NOT_INITIALIZED");
\t\tif (structuralDirty || desiredHash === null) {
\t\t\tdesiredHash = computeStructuralHash();
\t\t\tstructuralDirty = false;
\t\t}
\t\tif (desiredHash === null) throw new Error("DESKTOP_LOGIN_PREPARE_NO_ROOT");
\t\tconst hash = desiredHash;
\t\tconst prepared = pipelineCache.getOrBuild(hash, () => buildComposition(hash));
\t\tbindComposition(prepared);
\t\tawait prepared.passManager.prepareAsync();
\t\t} catch (error) {
\t\t\tauthorError("[gpu] prepare error:", error);
\t\t\tthrow error;
\t\t}
\t};
`;
function replaceOnce(source:string,before:string,after:string):string{
  const index=source.indexOf(before);
  if(index<0||source.lastIndexOf(before)!==index)reject('anchor');
  return source.slice(0,index)+after+source.slice(index+before.length);
}

/** Adds preparation beside the existing build/draw path; no frame, callback or logger changes. */
export function transformDesktopLoginPrepareCore(source:string):string{
  if(hash(source)!==CORE_SHA)reject('transform-core-sha256');
  let code=replaceOnce(source,'\tfunction render(canvasView, frameParams, afterCompute) {',PASS_PREPARE+'\tfunction render(canvasView, frameParams, afterCompute) {');
  code=replaceOnce(code,'\t\tsetComposition,\n\t\trender,','\t\tsetComposition,\n\t\tprepareAsync,\n\t\trender,');
  code=replaceOnce(code,'\tconst markStructuralDirty = () => {',RENDERER_PREPARE+'\tconst markStructuralDirty = () => {');
  return replaceOnce(code,'\t\trenderAndWait,\n\t\trenderSyntheticFrame,','\t\trenderAndWait,\n\t\tdesktopLoginPreparationVersion: 1,\n\t\tprepareAsync: desktopLoginPrepareAsync,\n\t\trenderSyntheticFrame,');
}

/** Registered only by vite.login.config.ts; never modifies the shared installed files. */
export function desktopLoginPreparePlugin():Plugin{
  const require=createRequire(import.meta.url),coreFile=realpathSync(require.resolve('shaders/core'));
  const directory=path.dirname(coreFile),packageFile=path.resolve(directory,'../../package.json');
  let transformed=0;
  const verifyInstalled=()=>{
    const metadata:unknown=JSON.parse(readFileSync(packageFile,'utf8'));
    if(!metadata||typeof metadata!=='object'||!('name'in metadata)||metadata.name!=='shaders'||!('version'in metadata)||typeof metadata.version!=='string')return reject('package');
    verifyDesktopLoginPrepareSource(metadata.version,readFileSync(coreFile,'utf8'),readFileSync(path.join(directory,'std-Bc4WfKLW.js'),'utf8'));
  };
  return {
    name:'desktop-login-prepare-4.0.5',apply:'build',enforce:'pre',
    configResolved(config){const entry=config.build.rolldownOptions.input;if(typeof entry!=='string'||normalized(entry)!==normalized(path.resolve(config.root,'src/login/main.ts')))reject('entry');},
    buildStart(){transformed=0;verifyInstalled();},
    transform(code,id){
      const file=id.split('?')[0]??id;
      if(normalized(file)!==normalized(coreFile)&&!normalized(file).endsWith('/shaders/dist/core/index.js'))return null;
      if(normalized(realpathSync(file))!==normalized(coreFile))reject('module-path');
      verifyInstalled();if(++transformed!==1)reject('duplicate-transform');
      return {code:transformDesktopLoginPrepareCore(code),map:null};
    },
    generateBundle(){if(transformed!==1)reject('missing-transform');}
  };
}
