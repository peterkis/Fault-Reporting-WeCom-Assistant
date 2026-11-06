import {createHash} from 'node:crypto';
import ts from 'typescript';
import type {Plugin} from 'vite';

const chunk='/react-router/dist/production/chunk-Q34X6AWR.mjs';
const digest='6fcc8451f3539d8abefff179f823262f1fae7702659bba36f75f87652ea16f41';
const names=['Link','NavLink','Form'];
/** Production forwardRef only creates a component object. Keep its adjacent
 * metadata write with that object so unused framework components can be removed. */
export function annotateRouterComponents(code:string):string{
 if(createHash('sha256').update(code).digest('hex')!==digest)throw Error('H5_ROUTER_PURITY_INPUT_CHANGED');
 const source=ts.createSourceFile('router.mjs',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),edits:{start:number;end:number;text:string;name:string}[]=[];
 for(let index=0;index<source.statements.length-1;index++){
  const statement=source.statements[index],next=source.statements[index+1];
  if(!statement||!next||!ts.isVariableStatement(statement)||(statement.declarationList.flags&(ts.NodeFlags.Let|ts.NodeFlags.Const))!==0||statement.declarationList.declarations.length!==1||!ts.isExpressionStatement(next))continue;
  const declaration=statement.declarationList.declarations[0],assignment=next.expression;
  if(!declaration||!ts.isIdentifier(declaration.name)||!names.includes(declaration.name.text)||!declaration.initializer||!ts.isCallExpression(declaration.initializer))continue;
  const name=declaration.name.text,call=declaration.initializer,callee=call.expression,render=call.arguments[0];
  if(!ts.isPropertyAccessExpression(callee)||!ts.isIdentifier(callee.expression)||callee.expression.text!=='React10'||callee.name.text!=='forwardRef'||call.arguments.length!==1||!render||(!ts.isFunctionExpression(render)&&!ts.isArrowFunction(render)))continue;
  if(!ts.isBinaryExpression(assignment)||assignment.operatorToken.kind!==ts.SyntaxKind.EqualsToken||!ts.isPropertyAccessExpression(assignment.left)||!ts.isIdentifier(assignment.left.expression)||assignment.left.expression.text!==name||assignment.left.name.text!=='displayName'||!ts.isStringLiteral(assignment.right)||assignment.right.text!==name)continue;
  const start=statement.getStart(source),end=next.end;
  edits.push({start,end,name,text:`var ${name}=/* @__PURE__ */(()=>{${code.slice(start,end)}return ${name};})();`});
 }
 if(edits.length!==names.length||names.some(name=>!edits.some(edit=>edit.name===name)))throw Error('H5_ROUTER_PURITY_SHAPE_CHANGED');
 for(const edit of edits.sort((a,b)=>b.start-a.start))code=code.slice(0,edit.start)+edit.text+code.slice(edit.end);
 return code;
}
export function routerComponentPurity():Plugin{
 let matched=false;
 return{name:'h5-router-component-purity',apply:'build',enforce:'pre',buildStart(){matched=false;},transform(code,id){if(!id.replace(/\\/g,'/').endsWith(chunk))return;const output=annotateRouterComponents(code);matched=true;return{code:output,map:null};},generateBundle(){if(!matched)throw Error('H5_ROUTER_PURITY_CHUNK_MISSING');}};
}
