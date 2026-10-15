import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {archiveScreenshots} from './run-tests.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXmQAAAAASUVORK5CYII=','base64');
function fixture(run:(source:string,output:string)=>void):void {
  const source=path.join(tmpdir(),'web01-ui-'+randomUUID()),output=mkdtempSync(path.join(tmpdir(),'t40-screenshot-test-'));
  mkdirSync(source);
  try{run(source,output);}finally{
    for(const p of [source,output]){assert.equal(path.dirname(path.resolve(p)),path.resolve(tmpdir()));rmSync(p,{recursive:true,force:true});}
  }
}
function receipt(file:string,bytes=png,sha256=createHash('sha256').update(bytes).digest('hex')):string {
  return '# WEB01_BROWSER '+JSON.stringify({screenshots:[{file,width:1,height:1,sha256}]})+'\n';
}
test('T40 original first fixed screenshot names archive their real bytes and retain ancillary diagnostics',()=>{
  for(const name of ['new-board-1280.png','reminder-muted-1280.png','reminder-located-1280.png','failure-1280.png'])fixture((source,output)=>{
    const file=path.join(source,name),diagnostic=path.join(source,'failure.json');writeFileSync(file,png);writeFileSync(diagnostic,'{"diagnostic":"retained"}');
    const result=archiveScreenshots(receipt(file),output,'first');assert.equal(result.length,1);
    assert.deepEqual(readFileSync(path.join(output,'first-screenshot-1.png')),png);assert.equal(existsSync(file),false);
    assert.equal(readFileSync(diagnostic,'utf8'),'{"diagnostic":"retained"}');
  });
});
test('T40 screenshot calibration still rejects unlisted names and nonowned directory shapes',()=>{
  fixture((source,output)=>{const file=path.join(source,'arbitrary-1280.png');writeFileSync(file,png);assert.throws(()=>archiveScreenshots(receipt(file),output,'bad'),/MIGRATION_SCREENSHOT_OUTSIDE_OWNED_TEMP/u);assert.equal(existsSync(file),true);});
  fixture((source,output)=>{const file=path.join(output,'failure-1280.png');writeFileSync(file,png);assert.throws(()=>archiveScreenshots(receipt(file),output,'bad'),/MIGRATION_SCREENSHOT_OUTSIDE_OWNED_TEMP/u);assert.equal(existsSync(file),true);});
});
test('T40 screenshot calibration still rejects hash or PNG tampering and duplicate receipt paths',()=>{
  for(const corrupt of ['hash','png','duplicate'])fixture((source,output)=>{
    const file=path.join(source,'new-board-1280.png'),bytes=corrupt==='png'?Buffer.alloc(25):png;writeFileSync(file,bytes);
    const row=receipt(file,bytes,corrupt==='hash'?'0'.repeat(64):undefined);
    assert.throws(()=>archiveScreenshots(corrupt==='duplicate'?row+row:row,output,'bad'),/MIGRATION_SCREENSHOT_INVALID/u);
    assert.equal(existsSync(file),true);
  });
});
