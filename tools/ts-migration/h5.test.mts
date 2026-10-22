import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import {buildH5,typecheckH5} from './web.mjs';
import {controlledBuildRoot,h5OutputFiles,h5StartupMetrics,hash,identity,inputs,mappings,record,sourceRoot,type BuildManifest} from './common.mjs';
import {verifyArtifact} from './verify-artifact.mjs';
import {testEnvironment,type Entry} from './routing.mjs';

test('media test tools are explicit, absolute and forwarded only to registered consumers',()=>{
 const entry:Entry={path:'tests/yxx-h5-media.test.mts',mode:'STAGED_RUNTIME',node_flags:[],requires_database:false,requires_browser:false,requires_powershell:false,requires_pyyaml:false,requires_ffmpeg:true};
 const ffmpeg=path.resolve('controlled/ffmpeg'),ffprobe=path.resolve('controlled/ffprobe');
 const input={H5_MEDIA_FFMPEG:ffmpeg,H5_MEDIA_FFPROBE:ffprobe,APP_SECRET:'synthetic-canary'};
 const selected=testEnvironment(original,[entry],input);assert.equal(selected.H5_MEDIA_FFMPEG,ffmpeg);assert.equal(selected.H5_MEDIA_FFPROBE,ffprobe);assert.equal(selected.APP_SECRET,undefined);
 assert.equal(testEnvironment(original,[],input).H5_MEDIA_FFMPEG,undefined);
 for(const value of [{},{H5_MEDIA_FFMPEG:ffmpeg},{...input,H5_MEDIA_FFPROBE:'relative/ffprobe'}])assert.throws(()=>testEnvironment(original,[entry],value),/MIGRATION_H5_MEDIA_TOOL_REQUIRED/u);
});

const original=sourceRoot();
function put(root:string,file:string,value:string|Uint8Array):void {
  const target=path.join(root,file); mkdirSync(path.dirname(target),{recursive:true}); writeFileSync(target,value);
}
function alter(root:string,file:string,value:string|Uint8Array,check:()=>void):void {
  const previous=readFileSync(path.join(root,file)); put(root,file,value);
  try { check(); } finally { put(root,file,previous); }
}
function fixture():string {
  const root=mkdtempSync(path.join(tmpdir(),'h5-artifact-test-'));
  // Share the complete immutable object history, but do not copy or build the
  // application's backend. Production/history guards run without exceptions.
  execFileSync('git',['clone','--quiet','--shared','--no-checkout',original,root],{windowsHide:true,stdio:'pipe'});
  symlinkSync(path.join(original,'node_modules'),path.join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
  put(root,'.gitignore','node_modules/\n.build/\n');
  for(const file of ['package.json','package-lock.json']) copyFileSync(path.join(original,file),path.join(root,file));
  put(root,'tools/ts-migration/resources.json',JSON.stringify({schema_version:1,files:['package.json','package-lock.json']}));
  const dev=record(record(JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')) as unknown).devDependencies);
  const webCompiler=record(JSON.parse(readFileSync(path.join(original,'node_modules/typescript-web/package.json'),'utf8')) as unknown);
  put(root,'h5/package.json',JSON.stringify({name:'synthetic-h5-artifact',private:true,type:'module',dependencies:{react:dev.react,'react-dom':dev['react-dom']},devDependencies:{vite:dev.vite,typescript:webCompiler.version}}));
  put(root,'h5/tsconfig.json',JSON.stringify({compilerOptions:{target:'ES2022',lib:['ES2022','DOM','DOM.Iterable'],module:'ESNext',moduleResolution:'Bundler',jsx:'react-jsx',strict:true,skipLibCheck:true,noUncheckedIndexedAccess:true,exactOptionalPropertyTypes:true,useUnknownInCatchVariables:true,noEmit:true,noEmitOnError:true,verbatimModuleSyntax:true,forceConsistentCasingInFileNames:true,types:['vite/client']},include:['src','vite.config.ts'],exclude:['src/dev']}));
  put(root,'h5/vite.config.ts',"import {defineConfig} from 'vite'; export default defineConfig({base:'/wecom/yixiaoxiu/',build:{manifest:true,sourcemap:false,assetsInlineLimit:0}});\n");
  put(root,'h5/index.html','<!doctype html><html lang="zh-CN"><head><title>H5 artifact fixture</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
  put(root,'h5/src/main.tsx',"import {createRoot} from 'react-dom/client'; import {Screen} from './screen'; import './style.css'; const root=document.getElementById('root'); if(root)createRoot(root).render(<Screen/>); document.body.addEventListener('fixture-native',()=>import('./bridge.native').then(module=>module.activate())); if(import.meta.env.DEV)void import('./dev/preview');\n");
  put(root,'h5/src/bridge.native.ts',"export function activate(){document.documentElement.dataset.bridge='ready';}\n");
  put(root,'h5/src/screen.tsx',"import logo from './logo.svg'; export function Screen(){return <main><img src={logo} alt=\"synthetic\"/>H5 production</main>;}\n");
  put(root,'h5/src/style.css','main{display:block;color:#123456}');
  put(root,'h5/src/logo.svg','<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>');
  put(root,'h5/src/dev/preview.ts','export const fixture="H5_SYNTHETIC_PREVIEW_MUST_NOT_SHIP";');
  put(root,'h5/public/assets/support.svg','<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle r="3" cx="4" cy="4"/></svg>');
  put(root,'h5/public/assets/icon.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+1sAAAAASUVORK5CYII=','base64'));
  put(root,'h5/docs/prototype/private.html','SYNTHETIC_DESIGN_ONLY');
  put(root,'h5/design-baseline/original.html','SYNTHETIC_BASELINE_ONLY');
  return root;
}
function stage(root:string):void {
  const runtime=path.join(controlledBuildRoot(root),'runtime'),map=mappings(root),source=identity(root);
  const manifest:BuildManifest={schema_version:1,status:'STAGED_NOT_ACTIVATED',node_major:24,compiler:ts.version,source,typed_implementations:[],unchecked_legacy:[],declaration_inputs:[],outputs:[]};
  for(const item of map){
    const from=path.join(root,item.kind==='WEB'?'.build/emit/'+item.path:item.source);
    const bytes=readFileSync(from); put(runtime,item.path,bytes); manifest.outputs.push({...item,sha256:hash(bytes)});
  }
  const text=JSON.stringify(manifest,null,2)+'\n';
  put(runtime,'build-manifest.json',text);
  put(root,'.build/artifact-proof.json',JSON.stringify({manifest_sha256:hash(text),source_input_hash:source.input_hash})+'\n');
}

test('H5 Tailwind scanning uses production sources and ignores design and DEV changes',()=>{
  const root=fixture();
  try{
    const dev=record(record(JSON.parse(readFileSync(path.join(original,'package.json'),'utf8')) as unknown).devDependencies);
    const pkg=record(JSON.parse(readFileSync(path.join(root,'h5/package.json'),'utf8')) as unknown);
    put(root,'h5/package.json',JSON.stringify({...pkg,devDependencies:{...record(pkg.devDependencies),tailwindcss:dev.tailwindcss,'@tailwindcss/vite':dev['@tailwindcss/vite']}}));
    put(root,'h5/vite.config.ts',"import {defineConfig} from 'vite'; import tailwindcss from '@tailwindcss/vite'; export default defineConfig({base:'/wecom/yixiaoxiu/',plugins:[tailwindcss()],build:{manifest:true,sourcemap:false,assetsInlineLimit:0}});\n");
    // Use the actual product's scan declarations so removing its boundary breaks this test.
    const scope=readFileSync(path.join(original,'h5/src/styles.css'),'utf8').split(/\r?\n/u).filter(line=>/^@(?:import "tailwindcss"|source )/u.test(line)).join('\n');
    put(root,'h5/src/style.css',scope+'\nmain{display:block;color:#123456}');
    put(root,'h5/src/screen.tsx','export function Screen(){return <main className="w-[347px]">H5 production</main>;}');
    buildH5(root);
    const snapshot=()=>h5OutputFiles(root).map(file=>({file,sha256:hash(readFileSync(path.join(root,'.build/emit/h5',file)))}));
    const before=snapshot();
    const css=h5OutputFiles(root).find(file=>file.endsWith('.css'));assert.ok(css);
    assert.match(readFileSync(path.join(root,'.build/emit/h5',css),'utf8'),/347px/u);
    put(root,'h5/docs/prototype/private.html','<div class="w-[941px]"></div>');
    put(root,'h5/design-baseline/original.html','<div class="w-[942px]"></div>');
    put(root,'h5/src/dev/preview.ts','export const fixture="w-[943px]";');
    put(root,'web/unrelated-page.html','<div class="w-[944px]"></div>');
    buildH5(root);
    assert.deepEqual(snapshot(),before);
    assert.doesNotMatch(readFileSync(path.join(root,'.build/emit/h5',css),'utf8'),/94[1-4]px/u);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('H5 release inputs, strict React sources, and controlled Vite assets share the formal artifact',async t=>{
  const root=fixture();
  try {
    await t.test('source identity includes production TSX/styles/assets/config/dependencies and excludes design/preview originals',()=>{
      const files=inputs(root).map(file=>file.path);
      for(const file of ['h5/src/main.tsx','h5/src/screen.tsx','h5/src/style.css','h5/src/logo.svg','h5/public/assets/icon.png','h5/index.html','h5/package.json','h5/tsconfig.json','h5/vite.config.ts','package-lock.json'])assert.ok(files.includes(file),file);
      for(const file of ['h5/docs/prototype/private.html','h5/design-baseline/original.html','h5/src/dev/preview.ts'])assert.ok(!files.includes(file),file);
      const before=identity(root).input_hash;
      alter(root,'h5/src/style.css','main{color:red}',()=>assert.notEqual(identity(root).input_hash,before));
      alter(root,'h5/docs/prototype/private.html','SYNTHETIC_DESIGN_CHANGED',()=>assert.equal(identity(root).input_hash,before));
    });
    await t.test('a real production Vite build stages hashed scripts/styles and same-origin image assets without preview code',()=>{
      buildH5(root);
      const files=h5OutputFiles(root);
      assert.ok(files.some(file=>/^assets\/.+\.js$/u.test(file)));
      assert.ok(files.some(file=>/^assets\/bridge\.native-[A-Za-z0-9_-]+\.js$/u.test(file)));
      assert.ok(files.some(file=>/^assets\/.+\.css$/u.test(file)));
      assert.ok(files.includes('assets/icon.png'));
      assert.ok(files.includes('assets/support.svg'));
      const html=readFileSync(path.join(root,'.build/emit/h5/index.html'),'utf8');
      assert.match(html,/\/wecom\/yixiaoxiu\/assets\//u);
      for(const file of files.filter(file=>file.endsWith('.js')))assert.doesNotMatch(readFileSync(path.join(root,'.build/emit/h5',file),'utf8'),/H5_SYNTHETIC_PREVIEW_MUST_NOT_SHIP/u);
      stage(root); assert.match(verifyArtifact(root),/^[a-f0-9]{64}$/u);
      const outputs=mappings(root);
      assert.ok(outputs.some(file=>file.kind==='WEB'&&file.path==='h5/assets/icon.png'));
      assert.ok(outputs.every(file=>!file.path.includes('/docs/')&&!file.path.includes('design-baseline')&&!file.path.includes('/dev/')));
      const dependency=record(JSON.parse(readFileSync(path.join(root,'.build/runtime/h5/dependency-inventory.json'),'utf8')) as unknown);
      assert.equal(dependency.lock_sha256,hash(readFileSync(path.join(root,'package-lock.json'))));
    });
    await t.test('source or staged H5 asset drift is rejected by the existing artifact verifier',()=>{
      alter(root,'h5/src/style.css','main{color:red}',()=>assert.throws(()=>verifyArtifact(root),/MIGRATION_INPUT_DRIFT/u));
      alter(root,'.build/runtime/h5/assets/icon.png',Buffer.from('tampered'),()=>assert.throws(()=>verifyArtifact(root),/MIGRATION_OUTPUT_TAMPERED/u));
      const script=h5OutputFiles(root).find(file=>file.endsWith('.js'));assert.ok(script);
      alter(root,'.build/emit/h5/'+script,'// changed emitted script',()=>assert.throws(()=>verifyArtifact(root),/H5_(?:OUTPUT|REPRESENTATION)_DRIFT/u));
    });
    await t.test('out-of-scope production TSX fails even when the narrowed program compiles',()=>{
      const config=record(JSON.parse(readFileSync(path.join(root,'h5/tsconfig.json'),'utf8')) as unknown);
      alter(root,'h5/tsconfig.json',JSON.stringify({...config,include:['src/main.tsx','src/screen.tsx','vite.config.ts']}),()=>{
        put(root,'h5/src/not-imported.tsx','export function Missing(){return <div>Must also be checked</div>;}');
        try{assert.throws(()=>typecheckH5(root),/H5_UNCHECKED_SOURCE/u);}finally{rmSync(path.join(root,'h5/src/not-imported.tsx'));}
      });
    });
    await t.test('TSX type errors, disabled strictness, and dependency drift fail before release emission',()=>{
      alter(root,'h5/src/screen.tsx','export function Screen(){const count:number="wrong";return <main>{count}</main>;}',()=>assert.throws(()=>typecheckH5(root),/MIGRATION_COMMAND_FAILED/u));
      const config=record(JSON.parse(readFileSync(path.join(root,'h5/tsconfig.json'),'utf8')) as unknown);
      alter(root,'h5/tsconfig.json',JSON.stringify({...config,compilerOptions:{...record(config.compilerOptions),strict:false}}),()=>assert.throws(()=>typecheckH5(root),/H5_STRICT_FLAG_REQUIRED/u));
      const pkg=record(JSON.parse(readFileSync(path.join(root,'h5/package.json'),'utf8')) as unknown);
      alter(root,'h5/package.json',JSON.stringify({...pkg,devDependencies:{...record(pkg.devDependencies),vite:'0.0.0'}}),()=>assert.throws(()=>typecheckH5(root),/H5_DEPENDENCY_LOCK_DRIFT/u));
    });
    await t.test('manifest path traversal, hidden documents, development chunks, and orphan scripts cannot enter runtime mappings',()=>{
      const manifestPath='.build/emit/h5/.vite/manifest.json';
      const manifest=record(JSON.parse(readFileSync(path.join(root,manifestPath),'utf8')) as unknown);
      const entry=Object.entries(manifest).find(([,value])=>record(value).isEntry===true); assert.ok(entry);
      for(const value of ['../escape.js','/assets/escape.js','assets/%2e%2e.js','assets/.secret.js'])alter(root,manifestPath,JSON.stringify({...manifest,[entry[0]]:{...record(entry[1]),file:value}}),()=>assert.throws(()=>mappings(root),/H5_MANIFEST_ASSET_INVALID/u));
      alter(root,manifestPath,JSON.stringify({...manifest,'src/dev/preview.ts':entry[1]}),()=>assert.throws(()=>mappings(root),/H5_NON_PRODUCTION_OUTPUT/u));
      for(const file of ['.secret.txt','docs/private.html','assets/preview.js','assets/orphan.js']){
        put(root,'.build/emit/h5/'+file,'SYNTHETIC_UNDECLARED');
        try{assert.throws(()=>mappings(root),/H5_(?:BUILD_OUTPUT_INVALID|UNDECLARED_ASSET)/u);}finally{rmSync(path.join(root,'.build/emit/h5',file));}
      }
    });
    await t.test('public files are limited to declared image/font assets with original bytes',()=>{
      for(const file of ['private.html','.secret','assets/runtime.js','assets/preview.png']){
        put(root,'h5/public/'+file,'SYNTHETIC_NOT_PUBLIC');
        try{assert.throws(()=>h5OutputFiles(root),/H5_PUBLIC_ASSET_INVALID/u);}finally{rmSync(path.join(root,'h5/public',file));}
      }
      alter(root,'.build/emit/h5/assets/icon.png',Buffer.from('changed'),()=>assert.throws(()=>h5OutputFiles(root),/H5_PUBLIC_ASSET_INVALID/u));
      alter(root,'.build/emit/h5/asset-inventory.json','[]',()=>assert.throws(()=>h5OutputFiles(root),/H5_ASSET_INVENTORY_DRIFT/u));
    });
    await t.test('compressed sidecars and startup dependency costs remain verified artifact outputs',()=>{
      const files=h5OutputFiles(root),scripts=files.filter(file=>file.endsWith('.js'));
      for(const script of scripts)for(const suffix of ['.gz','.br'])assert.ok(files.includes(script+suffix),script+suffix);
      assert.ok(files.includes('startup-metrics.json'));
      const metrics=h5StartupMetrics(root);assert.ok(metrics.initial.files.length>0);assert.ok(metrics.initial.gzip<=120*1024);
      assert.deepEqual(JSON.parse(readFileSync(path.join(root,'.build/emit/h5/startup-metrics.json'),'utf8')) as unknown,metrics);
      const compressed=scripts[0]+'.gz';
      alter(root,'.build/emit/h5/'+compressed,Buffer.from('tampered compressed bytes'),()=>assert.throws(()=>h5OutputFiles(root),/H5_REPRESENTATION_DRIFT/u));
      alter(root,'.build/runtime/h5/'+compressed,Buffer.from('tampered staged bytes'),()=>assert.throws(()=>verifyArtifact(root),/MIGRATION_OUTPUT_TAMPERED/u));
      alter(root,'.build/emit/h5/startup-metrics.json','{}',()=>assert.throws(()=>h5OutputFiles(root),/H5_STARTUP_METRICS_DRIFT/u));
      put(root,'.build/emit/h5/assets/unregistered.js.gz',Buffer.from('SYNTHETIC_UNDECLARED'));
      try{assert.throws(()=>h5OutputFiles(root),/H5_UNDECLARED_ASSET/u);}finally{rmSync(path.join(root,'.build/emit/h5/assets/unregistered.js.gz'));}
    });
  } finally {
    assert.equal(path.dirname(root),tmpdir()); assert.ok(path.basename(root).startsWith('h5-artifact-test-'));
    rmSync(root,{recursive:true,force:true});
  }
});

test('startup metrics count all initial and route imports once, including the standalone theme script',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'h5-artifact-test-')),out='.build/emit/h5/';
  try{
    put(root,out+'index.html','<script src="/wecom/yixiaoxiu/assets/prepaint-Ab123.js"></script><script type="module" src="/wecom/yixiaoxiu/assets/main-Ab123.js"></script>');
    put(root,out+'.vite/manifest.json',JSON.stringify({
      'index.html':{file:'assets/main-Ab123.js',imports:['_shared.js'],isEntry:true},
      '_shared.js':{file:'assets/shared-Ab123.js'},
      'src/pages/Home.tsx':{file:'assets/home-Ab123.js',imports:['_shared.js','_widget.js']},
      '_widget.js':{file:'assets/widget-Ab123.js',imports:['_shared.js']},
    }));
    for(const file of ['prepaint','main','shared','home','widget'])put(root,out+'assets/'+file+'-Ab123.js','export const '+file+'='+JSON.stringify(file.repeat(1000))+';');
    const metrics=h5StartupMetrics(root);assert.deepEqual(metrics.initial.files,['assets/main-Ab123.js','assets/prepaint-Ab123.js','assets/shared-Ab123.js']);
    assert.equal(metrics.routes[0]?.files.length,5);assert.ok((metrics.routes[0]?.gzip??0)>metrics.initial.gzip);
    assert.equal(metrics.routes[0]?.gzip,metrics.assets.reduce((sum,asset)=>sum+asset.gzip,0));
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('actual theme build emits one small synchronous hashed script and a deferred application module',()=>{
  const root=fixture();
  try{
    // The real product deliberately disables Vite's public directory. These two
    // synthetic public assets belong only to the generic artifact fixture.
    for(const file of ['assets/support.svg','assets/icon.png'])rmSync(path.join(root,'h5/public',file));
    for(const file of ['h5/vite.config.ts','h5/compile-i18n.ts','h5/src/prepaint.ts']){mkdirSync(path.dirname(path.join(root,file)),{recursive:true});copyFileSync(path.join(original,file),path.join(root,file));}
    put(root,'h5/index.html','<!doctype html><html><head><meta name="theme-color" content="#faf9f8"><!--h5-prepaint--></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
    buildH5(root);
    const html=readFileSync(path.join(root,'.build/emit/h5/index.html'),'utf8'),scripts=[...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/gu)];
    assert.equal(scripts.length,2);assert.ok(scripts.some(match=>/^<script src="\/wecom\/yixiaoxiu\/assets\/prepaint-[a-f0-9]{16}\.js"><\/script>$/u.test(match[0]+'</script>')));
    assert.doesNotMatch(html,/blocking="render"/u);
    const theme=h5StartupMetrics(root).assets.find(asset=>asset.file.startsWith('assets/prepaint-'));assert.ok(theme);assert.ok(theme.gzip<=2048);
    const bytes=readFileSync(path.join(root,'.build/emit/h5',theme.file),'utf8');assert.doesNotMatch(bytes,/\b(?:import|export)\s/u);assert.match(bytes,/ColorScheme/u);
    assert.ok(html.indexOf('prepaint-')<html.indexOf('</head>'));
    h5OutputFiles(root);
  }finally{rmSync(root,{recursive:true,force:true});}
});
