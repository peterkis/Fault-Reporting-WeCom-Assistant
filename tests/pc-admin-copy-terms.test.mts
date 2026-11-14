import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readdir,readFile} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';

// Card 34C: the PC workbench copy speaks to the user, not about the system (docs/ui/design-system.md 「界面文案」). Every Chinese
// string literal and JSX text in app/ and features/ is scanned for the banned technical words and for English words.
const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd();
const src=resolve(root,'app/pc-admin/src');
const BANNED=['UUID','版本号','版本','核验','副本','加密','投影','快照','读取范围','读权限','契约','幂等','命令','行版本'];
// Key names in shortcut hints.
const ENGLISH_ALLOWED=new Set(['Ctrl','Esc','Enter','Tab','Shift','Alt','Cmd']);
// Values the server still sends; the workbench compares against them and maps them to 「医小修私聊」 before showing them.
const SERVER_VALUES=new Set(['Bot 私聊','Bot 私聊来源','Bot 私聊回复','Bot 私聊规则回复','本人 Bot 私聊','发送到本人 Bot 私聊','本人的医小修私聊']);
// Download file names, never shown in the page body.
const FILE_NAMES=new Set(['报修附件.png','报修附件.jpg']);
// Directories temporarily outside the check; empty since card 34B (#187) landed and its copy was cleaned.
const PENDING_DIRECTORIES:string[]=[];
const cjk=/[\u4e00-\u9fff]/u;
const literal=/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`|[>}]([^<>{}'"`;=]*[\u4e00-\u9fff][^<>{}'"`;=]*)[<{]/gu;

async function* files(directory:string):AsyncGenerator<string>{
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=join(directory,entry.name);
    if(entry.isDirectory())yield* files(path);else if(/\.tsx?$/u.test(entry.name))yield path;
  }
}
const blank=(text:string)=>text.replace(/[^\n]/gu,' ');
/** Comments and hidden test hooks (`<p hidden …>工单版本 …</p>`) are not copy; they are blanked so line numbers stay. */
function visibleSource(source:string){
  return source.replace(/\/\*[\s\S]*?\*\//gu,blank).replace(/^\s*\/\/.*$/gmu,blank).replace(/<(\w+)\s+hidden(?:\s[^>]*)?>[\s\S]*?<\/\1>/gu,blank);
}

test('Card 34C PC workbench copy has no banned technical words or English words',async()=>{
  const findings:string[]=[];let scanned=0;
  for(const base of ['app','features'])for await(const path of files(join(src,base))){
    const name=relative(src,path).replaceAll('\\','/');
    if(PENDING_DIRECTORIES.some(directory=>name.startsWith(directory)))continue;
    const source=visibleSource(await readFile(path,'utf8'));scanned++;
    for(const match of source.matchAll(literal)){
      const text=(match.slice(1).find(Boolean)??'').trim();
      if(!cjk.test(text)||SERVER_VALUES.has(text)||FILE_NAMES.has(text))continue;
      const words=[...BANNED.filter(word=>text.includes(word)),...(/(?<![A-Za-z])ID(?![A-Za-z])/u.test(text)?['ID']:[]),
        ...[...text.replace(/\$\{[^}]*\}/gu,'').matchAll(/(?<![A-Za-z])[A-Za-z]{3,}(?![A-Za-z])/gu)].map(word=>word[0]).filter(word=>!ENGLISH_ALLOWED.has(word))];
      if(words.length)findings.push(name+':'+(source.slice(0,match.index).split('\n').length)+' 「'+text.slice(0,80)+'」 '+words.join(','));
    }
  }
  assert.ok(scanned>100,'the scan reached the workbench sources ('+scanned+')');
  assert.deepEqual(findings,[],'copy must follow 「界面文案」 in docs/ui/design-system.md');
});

// Codex review: an example in the copy must be one the input accepts. The follow-up time hint is fed to the real parser.
test('Card 34C follow-up time example is accepted by followUpInput',async()=>{
  const view=await readFile(join(src,'features/follow-up/SharedFollowUp.tsx'),'utf8');
  const example=/请填写正确的时间，例如 ([0-9-]+ [0-9:]+)。/u.exec(view)?.[1];assert.ok(example,'the hint shows an example time');
  const stub='export class ApiError extends Error{constructor(status,code){super(code);this.status=status;}}export class UnknownCommandOutcome extends Error{}export const captureWorkbenchRead=()=>()=>{};export const postTicketCommand=()=>{};export const readWorkbench=()=>{};export const decodeSharedFollowUpActive=()=>{};';
  const source=await readFile(join(src,'features/follow-up/client.ts'),'utf8');
  const output=transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022,verbatimModuleSyntax:true}}).outputText
    .replace("'../../api/client'",JSON.stringify('data:text/javascript;base64,'+Buffer.from(stub).toString('base64')));
  const client=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64')) as {followUpInput:(value:string)=>string};
  assert.equal(client.followUpInput(example),example,'the displayed example parses');
  assert.throws(()=>client.followUpInput('2026-11-12 14:30'),'minutes alone are rejected, which is why the example shows seconds');
});

// Codex review: beside 「核对结果」 a confirmed commit or failure only has the local draft left to clear; only an unconfirmed
// outcome says the result is unconfirmed.
test('Card 34C operation hint follows what is known',async()=>{
  const stub=(code:string)=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
  const source=await readFile(join(src,'app/DiagnosticCopy.tsx'),'utf8');
  let output=transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022,jsx:4,verbatimModuleSyntax:true}}).outputText;
  for(const [from,code] of [['react','export const useState=()=>[null,()=>{}];export const useRef=()=>({current:0});export const useEffect=()=>{};'],['lucide-react','export const Copy=()=>null;'],['@heroui/react','export const TextArea=()=>null;'],['../design/components/Button/Button','export const Button=()=>null;'],['react/jsx-runtime','export const jsx=()=>null,jsxs=()=>null,Fragment=null;']] as const)
    for(const quote of ["'",'"'])output=output.replaceAll(quote+from+quote,JSON.stringify(stub(code)));
  const module=await import(stub(output)) as {operationHint:(state:string,cleanupPending?:boolean)=>string};
  assert.match(module.operationHint('committed'),/^已提交，本机草稿还没清除完/u);
  assert.match(module.operationHint('failed'),/^上次操作没有成功，本机草稿还没清除完/u);
  for(const state of ['committed','failed'])assert.doesNotMatch(module.operationHint(state),/还没确认/u);
  assert.match(module.operationHint('unknown'),/结果还没确认/u);
  // Codex review: a known result whose reading of the current facts failed has not tried the cleanup yet.
  assert.equal(module.operationHint('committed',false),'已提交。最新内容还没加载完，点击「核对结果」。');assert.doesNotMatch(module.operationHint('failed',false),/草稿/u);
});

// Codex review: sessions and subscriptions keep a visible, stable code that is unique on screen, even when suffixes collide.
test('Card 34C short codes are the id\'s own suffix and never collide',async()=>{
  const source=await readFile(join(src,'app/short-code.ts'),'utf8');
  const output=transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022}}).outputText;
  const module=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64')) as {shortCodes:(ids:readonly string[],min?:number)=>Map<string,string>};
  const a='01a1d3bc-c109-73fb-8a3b-65db1e0aaaaa',b='01a1d3bc-c109-73fb-8a3b-75db1e0aaaaa',c='01a1d3bc-c109-73fb-8a3b-65db1e062a78';
  const codes=module.shortCodes([a,b,c]);
  assert.equal(codes.get(c),'1E062A78','a unique id keeps the eight-character suffix');
  assert.notEqual(codes.get(a),codes.get(b),'colliding suffixes grow until they differ');
  assert.equal(codes.get(a),'65DB1E0AAAAA','a shared eleven-character tail grows the code to twelve');assert.equal(codes.get(b),'75DB1E0AAAAA');
  for(const id of [a,b,c])assert.ok(id.replaceAll('-','').toUpperCase().endsWith(codes.get(id)??'#'),'each code is the id\'s own suffix');
  assert.equal(module.shortCodes([a,b,c]).get(a),codes.get(a),'the same ids give the same codes');
});

// Codex review: only the fixed channel labels are renamed; a group name containing the same words is shown as given.
test('Card 34C channel labels are renamed by exact match only',async()=>{
  const source=await readFile(join(src,'features/conversations/client.ts'),'utf8'),start=source.indexOf('const channelLabels'),end=source.indexOf('\n',source.indexOf('export function sourceLabel'));
  assert.ok(start>=0&&end>start,'the label table and function are found');
  const output=transpileModule(source.slice(start,end),{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022}}).outputText;
  const module=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64')) as {publicChannelLabel:(label:string)=>string;sourceLabel:(source:{kind:string;label:string})=>string};
  assert.equal(module.publicChannelLabel('Bot 私聊'),'医小修私聊');assert.equal(module.publicChannelLabel('Bot 私聊来源'),'医小修私聊');
  assert.equal(module.publicChannelLabel('Bot 私聊规则回复'),'医小修自动回复');assert.equal(module.publicChannelLabel('发送到本人 Bot 私聊'),'发送到本人的医小修私聊');
  assert.equal(module.publicChannelLabel('信息科 Bot 私聊交流群'),'信息科 Bot 私聊交流群','a group name is never rewritten');
  assert.equal(module.publicChannelLabel('群来源 · 回复通过私聊'),'群来源 · 回复通过私聊');
  // A group's maintained name is shown as given even when it equals a channel label; a direct source is still renamed.
  assert.equal(module.sourceLabel({kind:'group',label:'Bot 私聊来源'}),'Bot 私聊来源');assert.equal(module.sourceLabel({kind:'group',label:'企微群聊'}),'企微群聊');
  assert.equal(module.sourceLabel({kind:'direct',label:'Bot 私聊来源'}),'医小修私聊');
});
