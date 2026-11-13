import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readdir,readFile} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';

// Card 34C: the PC workbench copy speaks to the user, not about the system (docs/ui/design-system.md 「界面文案」). Every Chinese
// string literal and JSX text in app/ and features/ is scanned for the banned technical words and for English words.
const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd();
const src=resolve(root,'app/pc-admin/src');
const BANNED=['UUID','版本号','版本','核验','副本','加密','投影','快照','读取范围','读权限','契约','幂等','命令','行版本'];
// Key names in shortcut hints.
const ENGLISH_ALLOWED=new Set(['Ctrl','Esc','Enter','Tab','Shift','Alt','Cmd']);
// Values the server still sends; the workbench compares against them and maps them to 「医小修私聊」 before showing them.
const SERVER_VALUES=new Set(['Bot 私聊','Bot 私聊回复','Bot 私聊规则回复','本人 Bot 私聊','本人的医小修私聊']);
// Download file names, never shown in the page body.
const FILE_NAMES=new Set(['报修附件.png','报修附件.jpg']);
// Pending: these features are rewritten by card 34B (#187); their copy is cleaned once it lands, then this list empties.
const PENDING_DIRECTORIES=['features/ticket-unassign/','features/ticket-return-to-dispatch/','features/assignment-history/'];
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
