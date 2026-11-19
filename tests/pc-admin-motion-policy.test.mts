import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';
import stylelint from 'stylelint';

const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd(),src=join(root,'app/pc-admin/src');
async function filesAt(directory:string):Promise<string[]>{return (await Promise.all((await readdir(directory,{withFileTypes:true})).map(entry=>entry.isDirectory()?filesAt(join(directory,entry.name)):Promise.resolve([join(directory,entry.name)])))).flat();}
const files=(await filesAt(src)).filter(file=>/\.(?:css|ts|tsx)$/.test(file)&&!relative(src,file).startsWith('login/'));

/** Resolve variables and options objects, rather than allowing literals hidden behind an identifier. */
function checkWaapi(file:string,source:string):string[]{
  const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const declarations=new Map<string,ts.Expression>(),tokenImports=new Set<string>(),errors:string[]=[];
  const collect=(node:ts.Node)=>{
    if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&/(?:motion\/tokens|^\.\/tokens)$/.test(node.moduleSpecifier.text)){
      const bindings=node.importClause?.namedBindings;if(bindings&&ts.isNamedImports(bindings))for(const item of bindings.elements)if((item.propertyName??item.name).text==='motionToken')tokenImports.add(item.name.text);
    }
    if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer)declarations.set(node.name.text,node.initializer);
    ts.forEachChild(node,collect);
  };collect(tree);
  const tokenOrigin=(expression:ts.Expression|undefined,seen=new Set<string>()):boolean=>{
    if(!expression)return false;
    if(ts.isCallExpression(expression)&&ts.isIdentifier(expression.expression))return tokenImports.has(expression.expression.text);
    if(ts.isIdentifier(expression)&&!seen.has(expression.text)){seen.add(expression.text);return tokenOrigin(declarations.get(expression.text),seen);}
    return false;
  };
  const objectOrigin=(expression:ts.Expression|undefined,seen=new Set<string>()):ts.ObjectLiteralExpression|undefined=>{
    if(!expression)return;
    if(ts.isObjectLiteralExpression(expression))return expression;
    if(ts.isIdentifier(expression)&&!seen.has(expression.text)){seen.add(expression.text);return objectOrigin(declarations.get(expression.text),seen);}
    return;
  };
  const timerOrigin=(expression:ts.Expression|undefined,seen=new Set<string>()):boolean=>{
    if(!expression)return false;
    if(ts.isNumericLiteral(expression)&&expression.text==='0'||tokenOrigin(expression))return true;
    if(ts.isConditionalExpression(expression))return timerOrigin(expression.whenTrue,new Set(seen))&&timerOrigin(expression.whenFalse,new Set(seen));
    if(ts.isIdentifier(expression)&&!seen.has(expression.text)){seen.add(expression.text);return timerOrigin(declarations.get(expression.text),seen);}
    return false;
  };
  const inspect=(node:ts.Node)=>{
    if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&/^(?:motion|framer-motion)(?:\/|$)/.test(node.moduleSpecifier.text))errors.push('animation library import');
    if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])&&/^(?:motion|framer-motion)(?:\/|$)/.test(node.arguments[0].text))errors.push('dynamic animation library import');
    if(ts.isCallExpression(node)&&(ts.isIdentifier(node.expression)&&node.expression.text==='setTimeout'||ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='setTimeout')){
      const motionScope=/design\/(?:motion\/|components\/(?:Tooltip|Popover|Collapse)\/)/.test(file.replaceAll('\\','/'))||/setHighlighted/.test(node.arguments[0]?.getText(tree)??'');
      if(motionScope&&!timerOrigin(node.arguments[1]))errors.push('motion timer must originate in motionToken');
    }
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='animate'){
      const object=objectOrigin(node.arguments[1]);
      for(const key of ['duration','easing']){
        const property=object?.properties.find(prop=>prop.name?.getText(tree)===key);
        const value=property&&ts.isPropertyAssignment(property)?property.initializer:property&&ts.isShorthandPropertyAssignment(property)?property.name:undefined;
        if(!tokenOrigin(value))errors.push('WAAPI '+key+' must originate in motionToken');
      }
    }
    if(ts.isPropertyAssignment(node)&&/^(?:transition|animation)/.test(node.name.getText(tree))){
      const value=node.initializer.getText(tree).replace(/var\([^)]*\)/g,'TOKEN');
      if(/(?:\d(?:ms|s)\b|ease(?:-out|-in)?\b|cubic-bezier\s*\()/.test(value))errors.push('inline motion literal');
    }
    ts.forEachChild(node,inspect);
  };inspect(tree);return errors;
}
test('Card36A motion source sweep: no bare CSS/inline/WAAPI timing or animation-library imports',async()=>{
  const errors:string[]=[];
  for(const file of files){const text=await readFile(file,'utf8');if(file.endsWith('.css'))continue;for(const error of checkWaapi(file,text))errors.push(relative(root,file)+': '+error);}
  assert.deepEqual(errors,[]);
  const result=await stylelint.lint({files:files.filter(file=>file.endsWith('.css')),configFile:join(root,'app/pc-admin/.stylelintrc.json')});
  const violations=result.results.flatMap(file=>file.warnings.filter(warning=>warning.rule==='design/motion-tokens').map(warning=>file.source+':'+warning.line+' '+warning.text));
  assert.deepEqual(violations,[]);
  console.log('MOTION_SWEEP '+JSON.stringify({files:files.length,cssBareTiming:violations.length,inlineOrWaapiViolations:errors.length,whitelist:'login/** only; --load-pulse ambient duration preserved'}));
});
test('Card36A policy rejects indirect literals, missing curves, inline timing and library aliases',()=>{
  for(const text of ['el.animate([], {duration: 80,easing:"ease-out"})','const duration=80;const options={duration,easing:"linear"};el.animate([],options)','<div style={{transition:"transform 150ms ease-out"}}/>','setTimeout(()=>setHighlighted(null),1200)','import {animate as go} from "motion/mini";'])assert.ok(checkWaapi('probe.tsx',text).length,text);
  assert.deepEqual(checkWaapi('probe.ts',"import {motionToken as token} from './motion/tokens';const duration=token('--dur-base');const options={duration,easing:token('--ease-standard')};el.animate([],options)"),[]);
});
test('Card36A Stylelint rejects bare shorthand and longhand; permits zero and state timing tokens',async()=>{
  const lint=(code:string,file='probe.css')=>stylelint.lint({code,codeFilename:join(root,'app/pc-admin/src',file),configFile:join(root,'app/pc-admin/.stylelintrc.json')});
  for(const value of ['transition:opacity 150ms ease-out','animation:probe .3s linear','transition:transform var(--dur-base)','transition:transform var(--dur-base),opacity var(--dur-fast) var(--ease-standard)','animation-duration:2000ms','transition-duration:var(--arbitrary)','animation-timing-function:var(--arbitrary)','animation:probe var(--load-pulse) var(--ease-ambient) infinite']){
    assert.ok((await lint('.probe{'+value+'}')).results.some(file=>file.warnings.some(warning=>warning.rule==='design/motion-tokens')),value);
  }
  for(const value of ['transition:none','transition:opacity 0s','transition:transform var(--dur-base) var(--ease-standard)'])assert.equal((await lint('.probe{'+value+'}')).errored,false,value);
  assert.equal((await lint('.probe{animation:ds-skeleton-pulse var(--load-pulse) var(--ease-ambient) infinite}','design/components/Skeleton/skeleton.css')).errored,false);
});
test('Card36A ESLint restricts package imports outside login and rejects literal WAAPI timing',()=>{
  const lint=(code:string,file='src/design/__motion_probe__.tsx')=>spawnSync(process.execPath,[join(root,'node_modules/eslint/bin/eslint.js'),'--stdin','--stdin-filename',file],{cwd:join(root,'app/pc-admin'),input:code,encoding:'utf8'});
  for(const code of ['import {motion as m} from "motion";','import {animate} from "motion/mini";','import {motion} from "framer-motion";','el.animate([], {duration:80,easing:"ease-out"});'])assert.equal(lint(code).status,1,code);
  assert.equal(lint('import {motionToken} from "./motion/tokens";').status,0);
  assert.equal(lint('import {motion} from "motion";','src/login/__motion_probe__.tsx').status,0);
});
test('Card36A production assets contain no development motion switch',async()=>{
  const assets=await filesAt(join(process.env.TS_MIGRATION_TEST_RUNTIME_ROOT??join(root,'.build/runtime'),'web/admin-workbench'));
  const scripts=assets.filter(file=>/\.(?:js|css|html)$/.test(file));assert.ok(scripts.length>0,'build production assets first');
  for(const file of scripts){const text=await readFile(file,'utf8');for(const marker of ['motion-debug','installMotionDebug','data-motion="slow"','data-motion="off"'])assert.ok(!text.includes(marker),relative(root,file)+' contains '+marker);}
});
test('Card36A compiled disclosure CSS preserves the independent rotation reset',async()=>{
  const assets=await filesAt(join(process.env.TS_MIGRATION_TEST_RUNTIME_ROOT??join(root,'.build/runtime'),'web/admin-workbench'));
  const css=(await Promise.all(assets.filter(file=>file.endsWith('.css')).map(file=>readFile(file,'utf8')))).join('\n');
  // CSS optimisation must not fold this reset into transform and expose HeroUI's second rotation.
  assert.ok(/html body :is\(\.ds-board-group,\.workbench-disclosure\) \.disclosure__indicator\s*\{\s*rotate:\s*none\s*;?\s*\}/.test(css),'compiled CSS must retain an independent rotate:none reset');
  assert.ok(/\[data-slot=disclosure-indicator\]\[data-expanded=true\]\s*\{[^}]*transform:rotate\(-180deg\)/.test(css),'expanded disclosure must have exactly the intended transform rotation');
});
