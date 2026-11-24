import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'vite';

export interface KeyEvent {
  key:string;
  ctrlKey?:boolean;
  metaKey?:boolean;
  shiftKey?:boolean;
  altKey?:boolean;
}
interface Binding {id:string; group:string; label:string; keys:readonly string[]; kind:string; route?:string}
interface ShortcutModule {
  SHORTCUTS:readonly Binding[];
  SHORTCUT_GROUPS:readonly string[];
  shortcutKeys(id:string,mac?:boolean):readonly string[];
  ariaKeyshortcuts(id:string,mac?:boolean):string;
  shortcutSeparator(id:string):string|undefined;
  matchesShortcut(event:KeyEvent,id:string,prefix?:string):boolean;
  matchesGotoPrefix(event:KeyEvent):boolean;
  isMacPlatform():boolean;
  isShortcutAvailableForPrincipal(id:string,principal:{roles:string[];[flag:string]:unknown},canCreate:boolean):boolean;
}

// The application bundles this frontend .ts file inside a minified web chunk. Build its
// public ESM entry with the same Vite toolchain for Node, without relying on chunk aliases.
async function buildShortcutModule():Promise<ShortcutModule>{
  const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd();
  const path='app/pc-admin/src/features/efficiency/shortcuts.ts';
  const manifest:unknown=JSON.parse(await readFile(new URL('../../build-manifest.json',import.meta.url),'utf8'));
  assert.ok(manifest&&typeof manifest==='object'&&'source' in manifest&&manifest.source&&typeof manifest.source==='object'&&
    'inputs' in manifest.source&&Array.isArray(manifest.source.inputs));
  const recorded=manifest.source.inputs.find(input=>input.path===path);
  assert.equal(recorded?.sha256,createHash('sha256').update(await readFile(resolve(root,path))).digest('hex'),
    'the test module and the staged browser bundle must use the same shortcuts.ts');
  const result=await build({configFile:false,root,logLevel:'error',build:{write:false,minify:false,
    lib:{entry:resolve(root,path),formats:['es']}}});
  const bundle=Array.isArray(result)?result[0]:result;
  assert.ok(bundle&&'output' in bundle);
  const entry=bundle.output.find(file=>file.type==='chunk'&&file.isEntry);
  assert.ok(entry?.type==='chunk'&&entry.imports.length===0);
  return import('data:text/javascript;base64,'+Buffer.from(entry.code).toString('base64'));
}
export const shortcuts=await buildShortcutModule();
