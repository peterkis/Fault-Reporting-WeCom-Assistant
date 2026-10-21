import {readFile} from 'node:fs/promises';
import {isAbsolute,resolve,dirname,relative} from 'node:path';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';

const sourceRoot=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd();
let nextLoader=0;
export interface H5ModuleLoaderOptions {overrides?:Readonly<Record<string,string>>}
/** Loads the actual pure frontend source, with one isolated dependency graph per test. */
export function createH5PureModuleLoader({overrides={}}:H5ModuleLoaderOptions={}){
 const identity=++nextLoader,root=resolve(sourceRoot,'h5/src'),cache=new Map<string,Promise<string>>();
 async function moduleUrl(path:string):Promise<string>{
  const absolute=isAbsolute(path)?path:resolve(root,path),known=cache.get(absolute);if(known)return known;
  const task=(async()=>{
   const key=relative(root,absolute).replace(/\\/g,'/');
   const source=overrides[key]??await readFile(absolute,'utf8');
   let output=transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022,verbatimModuleSyntax:true}}).outputText;
   const imports=[...output.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)];
   for(const item of imports){const specifier=item[1];if(!specifier)continue;let target:string;
    if(specifier.startsWith('.')){const candidate=resolve(dirname(absolute),specifier);target=await moduleUrl(/\.(?:ts|tsx|mts)$/.test(candidate)?candidate:candidate+'.ts');}
    else target=import.meta.resolve(specifier);
    output=output.replaceAll("'"+specifier+"'",JSON.stringify(target)).replaceAll('"'+specifier+'"',JSON.stringify(target));
   }
   return'data:text/javascript;base64,'+Buffer.from(output+'\n// h5-pure-loader '+identity+' '+key+'\n').toString('base64');
  })();cache.set(absolute,task);return task;
 }
 return{moduleUrl};
}
export const h5ModuleUrl=createH5PureModuleLoader().moduleUrl;
