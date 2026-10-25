import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const BACKEND_LAYOUT_BASE='d3b7fda4f2cfb4291f550a9ed0952812dcf9a18f';
export const SHARED_MODULES=Object.freeze(['workbench-search-contracts','workbench-web-report-browser-contracts','workbench-incident-delivery-authority']);
export const PC_CONTRACTS=Object.freeze(['workbench-assignment-history-browser-contracts','workbench-board-action-browser-contracts','workbench-follow-browser-contracts','workbench-incident-delivery-browser-contracts','workbench-manual-report-browser-contracts','workbench-manual-self-handling-browser-contracts','workbench-notification-exception-browser-contracts','workbench-reminder-browser-contracts']);
export const PC_MODULES=Object.freeze([...PC_CONTRACTS.map(name=>'app/pc-admin/src/contracts/'+name+'.mts'),'app/pc-admin/src/realtime/workbench-realtime-client.mts']);

// Physical placement cannot grant a new legacy exemption. These rules also map
// a resurrected MJS to its original identity before consulting fixed history.
export function logicalSource(file:string):string {
  if(file.startsWith('app/server/'))return file.slice('app/server/'.length);
  const extension=/\.(?:mts|mjs)$/u.exec(file)?.[0];
  if(extension){
    for(const name of SHARED_MODULES)if(file==='shared/'+name+extension)return 'src/'+name+extension;
    for(const name of PC_CONTRACTS)if(file==='app/pc-admin/src/contracts/'+name+extension)return 'src/'+name+extension;
    if(file==='app/pc-admin/src/realtime/workbench-realtime-client'+extension)return 'src/workbench-realtime-client'+extension;
  }
  return file;
}
export function physicalSource(file:string):string {
  if(!/^(?:src|scripts)\//u.test(file))return file;
  const extension=/\.(?:mts|mjs)$/u.exec(file)?.[0];
  if(extension&&file.startsWith('src/')){
    const name=file.slice(4,-extension.length);
    if(SHARED_MODULES.includes(name))return 'shared/'+name+extension;
    if(PC_CONTRACTS.includes(name))return 'app/pc-admin/src/contracts/'+name+extension;
    if(name==='workbench-realtime-client')return 'app/pc-admin/src/realtime/'+name+extension;
  }
  return 'app/server/'+file;
}
export function isProductionSource(file:string):boolean {
  return /^(?:app\/server\/(?:src|scripts)|shared)\//u.test(file)
    || /^app\/pc-admin\/src\/.+\.(?:mts|mjs)$/u.test(file)
    || /^app\/pc-admin\/src\/(?:contracts|realtime)\/.+\.(?:js|cjs)$/u.test(file);
}
// Compare executable changes against historical policy using the same logical
// module/resource locations. Only relative specifiers change, never statements.
export function canonicalSourceText(file:string,text:string):string {
  const logical=logicalSource(file),source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
  const edits:{start:number;end:number;text:string}[]=[];
  const printer=ts.createPrinter({removeComments:true});
  const visit=(node:ts.Node):void=>{
    // This exact source-load guard retains the old roots and adds their new
    // placement. Compare its logical policy; other regexp edits remain changes.
    if(node.kind===ts.SyntaxKind.RegularExpressionLiteral&&node.getText(source)===String.raw`/^(?:(?:app\/server\/)?(?:src|scripts)|tests)\//u`){
      edits.push({start:node.getStart(source),end:node.end,text:String.raw`/^(?:src|scripts|tests)\//u`});
    }
    const sourceGuard=String.raw`loadedFile.startsWith('src/') || loadedFile.startsWith('app/server/src/') || loadedFile.startsWith('shared/') || /^app\/pc-admin\/src\/.+\.mts$/u.test(loadedFile)`;
    if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.BarBarToken&&printer.printNode(ts.EmitHint.Unspecified,node,source)===sourceGuard){
      edits.push({start:node.getStart(source),end:node.end,text:"loadedFile.startsWith('src/')"});
    }
    let literal:ts.StringLiteralLike|ts.TemplateHead|undefined;
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteralLike(node.moduleSpecifier))literal=node.moduleSpecifier;
    if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0]))literal=node.arguments[0];
    if(ts.isNewExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='URL'&&node.arguments?.[1]?.getText(source)==='import.meta.url'){
      let first:ts.Node|undefined=node.arguments[0];while(first&&ts.isBinaryExpression(first))first=first.left;
      if(first&&ts.isTemplateExpression(first))literal=first.head;
      else if(first&&ts.isStringLiteralLike(first))literal=first;
    }
    if(literal?.text.startsWith('.')){
      const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(file),literal.text));
      const target=logicalSource(resolved);
      let specifier=path.posix.relative(path.posix.dirname(logical),target);
      if(!specifier.startsWith('.'))specifier='./'+specifier;
      if(literal.text.endsWith('/')&&!specifier.endsWith('/'))specifier+='/';
      if(specifier!==literal.text)edits.push({start:literal.getStart(source)+1,end:literal.end-(literal.kind===ts.SyntaxKind.TemplateHead?2:1),text:specifier});
    }
    ts.forEachChild(node,visit);
  };
  visit(source);
  for(const edit of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,edit.start)+edit.text+text.slice(edit.end);
  return text;
}
export function assertBackendLayout(root:string,files:readonly string[],baselineFiles:readonly string[]):void {
  const mappingFile=path.join(root,'tools/ts-migration/backend-layout.json');
  if(!existsSync(mappingFile)){
    if(files.some(isProductionSource))throw new Error('MIGRATION_LAYOUT_MAPPING_REQUIRED');
    return; // An independent fixed historical checkout has its own old policy.
  }
  const value:unknown=JSON.parse(readFileSync(mappingFile,'utf8'));
  if(!value||typeof value!=='object'||!('schema_version' in value)||value.schema_version!==1||!('baseline' in value)||value.baseline!==BACKEND_LAYOUT_BASE||!('files' in value)||!Array.isArray(value.files))throw new Error('MIGRATION_LAYOUT_MAPPING_INVALID');
  const expected=baselineFiles.filter(file=>file!=='src/bot-reporter-static.mts').sort();
  const sources:string[]=[],targets:string[]=[];
  for(const item of value.files){
    if(!item||typeof item!=='object'||!('source' in item)||typeof item.source!=='string'||!('target' in item)||typeof item.target!=='string'
      ||item.target!==physicalSource(item.source)||logicalSource(item.target)!==item.source)throw new Error('MIGRATION_LAYOUT_MAPPING_INVALID');
    sources.push(item.source);targets.push(item.target);
  }
  if(expected.length!==382||JSON.stringify([...sources].sort())!==JSON.stringify(expected)||new Set(targets).size!==targets.length)throw new Error('MIGRATION_LAYOUT_MAPPING_INVALID');
  if(files.some(file=>/^(?:src|scripts)\//u.test(file))||existsSync(path.join(root,'src'))||existsSync(path.join(root,'scripts')))throw new Error('MIGRATION_OLD_SOURCE_ROOT');
  // The forward map records placement. A later approved MJS-to-MTS conversion
  // keeps that identity; an already typed source cannot move back to MJS.
  if(targets.some(file=>!files.includes(file)&&!(file.endsWith('.mjs')&&files.includes(file.slice(0,-4)+'.mts'))))throw new Error('MIGRATION_LAYOUT_SOURCE_MISSING');
  const logical=new Set<string>();
  for(const file of files.filter(isProductionSource)){
    const identity=logicalSource(file).replace(/\.mts$/u,'.mjs');
    if(logical.has(identity))throw new Error('MIGRATION_DUPLICATE_LOGICAL_SOURCE');
    logical.add(identity);
  }
}
export function assertSharedBoundary(root:string,files:readonly string[]):void {
  for(const file of files.filter(file=>file.startsWith('shared/')&&file.endsWith('.mts'))){
    const source=ts.createSourceFile(file,readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true);
    const allowed=(specifier:string):boolean=>specifier.startsWith('.')&&path.resolve(path.dirname(path.join(root,file)),specifier).startsWith(path.resolve(root,'shared')+path.sep);
    const visit=(node:ts.Node):void=>{
      if(ts.isImportEqualsDeclaration(node)&&!node.isTypeOnly&&ts.isExternalModuleReference(node.moduleReference))throw new Error('MIGRATION_SHARED_RUNTIME_DEPENDENCY: '+file);
      if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)){
        const typeOnly=ts.isImportDeclaration(node)?node.importClause?.isTypeOnly===true:node.isTypeOnly;
        if(!typeOnly&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)&&!allowed(node.moduleSpecifier.text))throw new Error('MIGRATION_SHARED_RUNTIME_DEPENDENCY: '+file);
      }
      if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require'))throw new Error('MIGRATION_SHARED_RUNTIME_DEPENDENCY: '+file);
      ts.forEachChild(node,visit);
    };
    visit(source);
  }
}
