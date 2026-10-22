import ts from 'typescript';
import {compileMessageOrThrow} from '@lingui/message-utils/compileMessage';
import type {Messages} from '@lingui/core';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const files={translation:'src/i18n.ts',auth:'src/components/auth-messages.ts',command:'src/components/command-messages.ts',help:'src/components/help-messages.ts',voice:'src/components/voice-messages.ts',interaction:'src/components/interaction-messages.ts',workspace:'src/components/workspace-messages.ts'} as const;
const namespaces=['translation','auth','command','help','voice','interaction','workspace'] as const;
export type Namespace=keyof typeof files;
/** Compare required values in the official output, including ICU branches and quoting. */
function parameters(message:unknown):string{
 const names=new Set<string>();
 function visit(tokens:unknown):void{
  if(!Array.isArray(tokens))return;
  for(const value of tokens){
   if(!Array.isArray(value))continue;
   const[name,,choices]:readonly unknown[]=value;if(typeof name==='string')names.add(name);
   if(choices!==null&&typeof choices==='object')for(const branch of Object.values(choices))visit(branch);
  }
 }
 visit(message);return JSON.stringify([...names].sort());
}
/** Build/test boundary only. Browser modules receive official compiled data. */
export function compileH5Catalog(source:string,namespace:Namespace):{en:Messages;zh:Messages}{
 const ast=ts.createSourceFile(files[namespace],source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),result:{en:Messages;zh:Messages}={en:{},zh:{}};
 for(const language of ['en','zh']as const){
  const declarations=ast.statements.filter(ts.isVariableStatement).flatMap(statement=>(statement.declarationList.flags&ts.NodeFlags.Const)?statement.declarationList.declarations:[]).filter(node=>ts.isIdentifier(node.name)&&node.name.text===language),declaration=declarations[0];
  if(declarations.length!==1||!declaration?.initializer)throw new Error('H5_CATALOG_LITERAL_REQUIRED');
  let object=declaration.initializer;while(ts.isSatisfiesExpression(object)||ts.isAsExpression(object)||ts.isParenthesizedExpression(object))object=object.expression;
  if(!ts.isObjectLiteralExpression(object))throw new Error('H5_CATALOG_LITERAL_REQUIRED');
  for(const property of object.properties){
   if(!ts.isPropertyAssignment(property)||!ts.isStringLiteralLike(property.initializer)||(!ts.isIdentifier(property.name)&&!ts.isStringLiteralLike(property.name)))throw new Error('H5_CATALOG_STRING_REQUIRED');
   const id=namespace+':'+property.name.text;if(Object.hasOwn(result[language],id))throw new Error('H5_CATALOG_DUPLICATE_ID');
   const message=property.initializer.text.replace(/\{\{\s*([\w]+)\s*\}\}/gu,'{$1}');if(/\{\{|\}\}/u.test(message))throw new Error('H5_CATALOG_INTERPOLATION_INVALID');
   result[language][id]=compileMessageOrThrow(message);
  }
 }
 const keys=Object.keys(result.en);
 if(keys.length===0||keys.length!==Object.keys(result.zh).length||keys.some(id=>!Object.hasOwn(result.zh,id)))throw new Error('H5_CATALOG_KEYS_MISMATCH');
 for(const id of keys)if(parameters(result.en[id])!==parameters(result.zh[id]))throw new Error('H5_CATALOG_PARAMETERS_MISMATCH');
 return result;
}
export function catalogModuleCode(source:string,namespace:Namespace):string{const catalog=compileH5Catalog(source,namespace);return'export const en='+JSON.stringify(catalog.en)+';\nexport const zh='+JSON.stringify(catalog.zh)+';\n';}
/** Vite and the existing Node source loader use this same compiler. */
export function h5Catalogs(h5Root:string){
 const specifiers=new Map(namespaces.map(namespace=>['virtual:yxx-i18n/'+namespace,{namespace,file:path.resolve(h5Root,files[namespace])}]));
 return{name:'h5-official-lingui-catalogs',enforce:'pre'as const,
  resolveId(id:string):string|null{return specifiers.has(id)?'\0'+id:null;},
  async load(this:{addWatchFile(file:string):void},id:string):Promise<string|null>{if(!id.startsWith('\0'))return null;const item=specifiers.get(id.slice(1));if(!item)return null;this.addWatchFile(item.file);return catalogModuleCode(await readFile(item.file,'utf8'),item.namespace);}
 };
}
