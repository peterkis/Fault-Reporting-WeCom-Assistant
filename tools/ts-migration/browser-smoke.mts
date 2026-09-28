import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceRoot } from './common.mjs';
import { verifyArtifact } from './verify-artifact.mjs';
import { testEnvironment } from './routing.mjs';
const probe = `
import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {mkdtempSync,symlinkSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
const {findSystemBrowser,launchSystemBrowser}=await import('./tests/helpers/p2-006-browser-harness.mjs');
const original=findSystemBrowser();const temp=mkdtempSync(path.join(tmpdir(),'t02-browser-path-'));
let browser;const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Synthetic T02</title><button id="ok">ready</button>');});
try{
 if(process.platform!=='win32'){const spaced=path.join(temp,'browser executable with spaces');symlinkSync(original,spaced);process.env.TS_MIGRATION_BROWSER_EXECUTABLE=spaced;}
 else {process.env.TS_MIGRATION_BROWSER_EXECUTABLE=original;assert.ok(original.includes(' '));}
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 browser=await launchSystemBrowser({url:'http://127.0.0.1:'+server.address().port,width:800,height:600});
 await browser.waitFor('document.title === "Synthetic T02"');assert.equal(await browser.evaluate('document.querySelector("#ok").textContent'),'ready');
 await browser.close();const owned=browser.ownedResourceState();assert.deepEqual(owned,{processes:0,profiles:0,commandTimers:0,sockets:0});
 console.log(JSON.stringify({status:'REAL_BROWSER_STAGED_SMOKE_PASS',platform:process.platform,spaces_in_executable:true,owned_resources:owned,external_calls:0}));
}finally{await browser?.close();if(server.listening)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));rmSync(temp,{recursive:true,force:true});}
`;
export function browserSmoke(root: string): void {
  const digest = verifyArtifact(root);
  const result = spawnSync(process.execPath, ['--input-type=module','-e',probe], { cwd:path.join(root,'.build/runtime'), env:testEnvironment(root,[]), encoding:'utf8',windowsHide:true,timeout:120_000,maxBuffer:8*1024*1024 });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  if(result.error)throw result.error;if(result.status!==0)throw new Error('MIGRATION_REAL_BROWSER_SMOKE_FAILED');
  verifyArtifact(root,digest);
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) browserSmoke(sourceRoot());
