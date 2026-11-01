import path from 'node:path';
import {readFileSync} from 'node:fs';
import {runNode,workspaceFiles} from './common.mjs';

/** Check application CSS only; login is an independent, unchanged visual surface. */
export function designVariables(root:string):void {
  const files=workspaceFiles(root).filter(file=>/^app\/pc-admin\/src\/(?!login\/).*\.css$/u.test(file));
  if(!files.length)throw Error('DESIGN_CSS_SCOPE_EMPTY');
  const sources=files.map(file=>({file,text:readFileSync(path.join(root,file),'utf8').replace(/\/\*[\s\S]*?\*\//gu,'')}));
  const definitions=new Set(sources.flatMap(({text})=>[...text.matchAll(/(--[\w-]+)\s*:/gu)].map(match=>match[1])));
  // React Aria sets this geometry variable on Select popovers at runtime.
  const provider=readFileSync(path.join(root,'node_modules/react-aria-components/dist/private/Popover.cjs'),'utf8');
  if(!/['"]--trigger-width['"]\s*:/u.test(provider))throw Error('DESIGN_VENDOR_VARIABLE_CONTRACT_MISSING');
  definitions.add('--trigger-width');
  const errors:string[]=[];
  for(const {file,text} of sources)for(const match of text.matchAll(/var\(\s*(--[\w-]+)/gu)){
    const name=match[1];
    if(!definitions.has(name))errors.push(file+': undefined '+name);
    if(!file.endsWith('/design/tokens.css')&&/^--(?:gray|blue|yellow|sky|green|orange|red|purple)-/u.test(name??''))errors.push(file+': primitive palette '+name);
  }
  if(errors.length)throw Error('DESIGN_VARIABLE_VIOLATION\n'+errors.join('\n'));
  console.log(JSON.stringify({event:'DESIGN_VARIABLES',files:files.length,undefined:0,primitive_leaks:0}));
}

export function featureSyntax(root:string):void {
  runNode(path.join(root,'app/pc-admin'),[path.join(root,'node_modules/eslint/bin/eslint.js'),'src/features/**/*.{ts,tsx}','--max-warnings','0']);
}
