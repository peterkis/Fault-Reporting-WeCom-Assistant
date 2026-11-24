import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,resolve} from 'node:path';
import {test} from 'node:test';
import {createServer} from 'vite';

const root=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd();

async function filesAt(directory:string):Promise<string[]>{
  const entries=await readdir(directory,{withFileTypes:true});
  const nested=await Promise.all(entries.map(entry=>entry.isDirectory()?filesAt(join(directory,entry.name)):Promise.resolve([join(directory,entry.name)])));
  return nested.flat();
}

test('Card 39C C2.1 hover-bridge avoids scans on stable refs and compares once when the last item changes at fixed now',async t=>{
  const cacheDir=await mkdtemp(join(tmpdir(),'card39c-bridge-'));
  const server=await createServer({
    root:join(root,'tests/fixtures'),configFile:false,cacheDir,logLevel:'error',oxc:{jsx:{runtime:'automatic'}},
    optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,ws:false},
  });
  const previous=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');
  Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{configurable:true,value:true});
  t.after(async()=>{
    if(previous)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',previous);else Reflect.deleteProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT');
    await server.close();await rm(cacheDir,{recursive:true,force:true});
  });

  const mod=await server.ssrLoadModule('/card39c-bridge-probe.tsx') as {
    measureHoverBridgeStability:()=>Promise<{
      mountCompares:number[];
      mountPublishes:boolean[];
      stableCalls:number[];
      stablePublishes:boolean[];
      changedLastCalls:number[];
      changedLastPublishes:boolean[];
    }>;
  };
  const result=await mod.measureHoverBridgeStability();
  assert.deepEqual(result.mountCompares,[0]);
  assert.deepEqual(result.mountPublishes,[true]);
  assert.deepEqual(result.stableCalls,Array(10).fill(0),'10 consecutive updates with memoized items perform zero element comparisons');
  assert.deepEqual(result.stablePublishes,Array(10).fill(true));
  assert.deepEqual(result.changedLastCalls,[3],'publishBoard scans once instead of twice when the last item changes at fixed now');
  assert.deepEqual(result.changedLastPublishes,[true]);
});

test('Card 39C production assets exclude the hover-bridge test probe',async()=>{
  const assets=await filesAt(join(process.env.TS_MIGRATION_TEST_RUNTIME_ROOT??join(root,'.build/runtime'),'web/admin-workbench'));
  const scripts=assets.filter(file=>/\.(?:js|css|html)$/u.test(file));
  assert.ok(scripts.length>0,'build production assets first');
  for(const file of scripts){
    const text=await readFile(file,'utf8');
    for(const marker of ['__hoverBridgeProbe','onItemsCompare','onPublish']){
      assert.ok(!text.includes(marker),relative(root,file)+' must not contain '+marker);
    }
  }
});

test('Card 39C C1 & C2.4/C2.5 tokens, CSS ownership boundaries and documentation match server code',async()=>{
  const tokensCss=await readFile(resolve(root,'app/pc-admin/src/design/tokens.css'),'utf8');
  assert.match(tokensCss,/--owner-name-max-w:\s*calc\(var\(--fs-xs\)\s*\*\s*4\s*\+\s*var\(--space-0-5\)\)/u);
  assert.doesNotMatch(tokensCss,/--owner-name-max-w:[^;]*(?:em|rem)/u);

  const ticketCss=await readFile(resolve(root,'app/pc-admin/src/design/components/TicketCard/ticket-card.css'),'utf8');
  assert.match(ticketCss,/\.ds-ticket-owner\s*\{[^}]*max-width:\s*none;\s*flex:\s*none;/u);
  assert.match(ticketCss,/\.ds-ticket-owner:not\(\.ds-ticket-closer\)\s+\.owner-name:not\(\.sr-only\)\s*\{\s*max-width:\s*var\(--owner-name-max-w\);\s*\}/u);
  assert.match(ticketCss,/\.card-footer\s+\.ds-ticket-owner\s+\.ds-ticket-owner-placeholder\s*\{\s*max-width:\s*55%;\s*visibility:\s*hidden;\s*pointer-events:\s*none;\s*\}/u);

  const authDoc=await readFile(resolve(root,'docs/api/platform/auth-health.md'),'utf8');
  assert.match(authDoc,/400 `P2_016_INPUT_INVALID`/u);
  assert.match(authDoc,/404（`P2_016_NOT_FOUND`）/u);
  assert.match(authDoc,/按目标成员 `principal_id` 分键/u);
  assert.doesNotMatch(authDoc,/PERSON_PROFILE_NOT_FOUND/u);
  assert.doesNotMatch(authDoc,/400 `P2_016_VALIDATION_FAILED`/u);

  const designDoc=await readFile(resolve(root,'docs/ui/design-system.md'),'utf8');
  assert.match(designDoc,/统一内边距 `calc\(var\(--space-3\) \+ var\(--space-0-5\)\)`（14px）/u);
  assert.match(designDoc,/工单及拒访\/缺失状态统一 `calc\(var\(--space-16\) \* 5\)` \/ 320px/u);
});
