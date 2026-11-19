import {createHash} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {createSourceFile,forEachChild,isCallExpression,isIdentifier,isJsxAttribute,isJsxElement,isJsxExpression,isJsxFragment,isStringLiteral,ScriptKind,ScriptTarget,SyntaxKind} from 'typescript';
import type {JsxElement,Node,SourceFile} from 'typescript';

export interface PlainState {file:string;line:number;kind:'jsx-p'|'dom-p';sha256:string;fragment:string}
const statusText=/正在|加载中|读取中|读取失败|加载失败|连接失败|没有读出来|未更新|暂不可读|暂不可用|只读|没有.{0,12}权限|\b(?:loading|failed|error)\b/iu;
const statusExpression=/\b(?:errorMessage|error|failure|refreshError|cleanupError|searchMessage|message|outcome|notice)\b/u;
function hidden(node:Node,source:SourceFile):boolean{
  for(let parent:Node|undefined=node;parent;parent=parent.parent){
    if(isJsxElement(parent)&&parent.openingElement.attributes.properties.some(attribute=>isJsxAttribute(attribute)&&attribute.name.getText(source)==='hidden'&&(!attribute.initializer||isJsxExpression(attribute.initializer)&&attribute.initializer.expression?.kind===SyntaxKind.TrueKeyword)))return true;
  }
  return false;
}
function stateParagraph(node:JsxElement,source:SourceFile):boolean{
  const attributes=node.openingElement.attributes.getText(source);
  if(/\brole\s*=/u.test(attributes)&&/alert|status/u.test(attributes))return true;
  const body=node.children.map(child=>child.getText(source)).join('');
  if(statusText.test(body)||statusExpression.test(body))return true;
  if(node.children.some(child=>isJsxExpression(child)&&child.expression&&isIdentifier(child.expression)))return true;
  let parent=node.parent;
  while(parent&&!isJsxElement(parent)){
    if(!isJsxFragment(parent)&&/isPending|isLoading|isError/u.test(parent.getText(source).slice(0,180)))return true;
    parent=parent.parent;
  }
  return Boolean(parent&&isJsxElement(parent)&&/\brole\s*=/u.test(parent.openingElement.attributes.getText(source))&&/alert|status/u.test(parent.openingElement.attributes.getText(source)));
}
export function plainStatesFromSource(file:string,text:string):PlainState[]{
  const source=createSourceFile(file,text,ScriptTarget.Latest,true,file.endsWith('.tsx')?ScriptKind.TSX:ScriptKind.TS),found:PlainState[]=[];
  const add=(node:Node,kind:PlainState['kind'])=>{
    const fragment=node.getText(source).replace(/\s+/gu,' ').trim();
    found.push({file,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,kind,fragment,sha256:createHash('sha256').update(fragment).digest('hex')});
  };
  const visit=(node:Node)=>{
    if(isJsxElement(node)&&node.openingElement.tagName.getText(source)==='p'&&!hidden(node,source)&&stateParagraph(node,source))add(node,'jsx-p');
    if(isCallExpression(node)&&node.expression.getText(source)==='document.createElement'&&node.arguments[0]&&isStringLiteral(node.arguments[0])&&node.arguments[0].text==='p')add(node,'dom-p');
    forEachChild(node,visit);
  };
  visit(source);return found;
}
export async function scanPlainStates(src:string):Promise<PlainState[]>{
  const found:PlainState[]=[];
  async function visit(directory:string):Promise<void>{
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const path=join(directory,entry.name);
      if(entry.isDirectory())await visit(path);
      else if(/\.tsx?$/u.test(entry.name)&&!/\.(?:test|spec)\./u.test(entry.name))found.push(...plainStatesFromSource(relative(src,path).replaceAll('\\','/'),await readFile(path,'utf8')));
    }
  }
  await visit(src);return found;
}
