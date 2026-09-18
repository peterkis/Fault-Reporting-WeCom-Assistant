import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { readYxxLocalValidationScope } from '../src/yxx-self-service-validation-scope.mjs';

test('SS-008 local successor never suppresses state, migration or historical evidence drift',()=>{
  const root=process.cwd(),temporaryRoot=path.resolve(root,'tmp');mkdirSync(temporaryRoot,{recursive:true});
  const directory=mkdtempSync(path.join(temporaryRoot,'ss008-governance-'));
  assert.ok(directory.startsWith(temporaryRoot+path.sep));
  const git=args=>execFileSync('git',args,{cwd:root,windowsHide:true,stdio:'pipe'});
  git(['worktree','add','--detach',directory,'77435e7']);
  try{
    const scopePath='plans/yxx-self-service-validation-scope.json';
    writeFileSync(path.join(directory,scopePath),readFileSync(path.join(root,scopePath)));
    assert.equal(readYxxLocalValidationScope(directory).status,'LOCAL_IMPLEMENTATION_AND_VALIDATION');
    for(const file of ['plans/current_phase.json','database/migrations/033_yxx_self_service_intake.sql',
      'evidence/p2-g2-yxx-entry-creation-v2-parent-report.json',scopePath]){
      const target=path.join(directory,file),original=readFileSync(target);
      try{
        writeFileSync(target,file===scopePath?JSON.stringify({...JSON.parse(original),live_authorized:true}):Buffer.concat([original,Buffer.from('\nDRIFT\n')]));
        assert.throws(()=>readYxxLocalValidationScope(directory),undefined,file);
      }finally{writeFileSync(target,original);}
    }
    const extra=path.join(directory,'database/migrations/unregistered.tmp');
    try{writeFileSync(extra,'unregistered');assert.throws(()=>readYxxLocalValidationScope(directory));}finally{unlinkSync(extra);}
    assert.equal(readYxxLocalValidationScope(directory).migration_files.length,readYxxLocalValidationScope(root).migration_files.length);
  }finally{git(['worktree','remove','--force',directory]);}
});
