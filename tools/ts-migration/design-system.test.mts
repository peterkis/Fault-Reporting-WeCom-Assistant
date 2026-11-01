import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {sourceRoot} from './common.mjs';
import {designVariables} from './design-system.mjs';

const root=sourceRoot();
test('feature ESLint rejects HeroUI variants, alias imports, inline styles and legacy status classes',()=>{
  const lint=(text:string)=>spawnSync(process.execPath,[path.join(root,'node_modules/eslint/bin/eslint.js'),'--stdin','--stdin-filename','src/features/__design_probe__.tsx'],{cwd:path.join(root,'app/pc-admin'),input:text,encoding:'utf8',windowsHide:true});
  const good=lint('import {Button} from "../../design/components/Button/Button"; const label:string="保存"; const view=<Button tone="secondary" data-action="save">{label}</Button>;');
  assert.equal(good.status,0,good.stdout+good.stderr);
  for(const code of [
    '<HButton variant="secondary"/>',
    'import {Button as Foo} from "@heroui/react"; const view=<Foo/>;',
    '<div style={{color:"red"}}/>',
    '<div style={appearance}/>',
    '<div className="status-chip yellow"/>',
    '<div className={"status-chip "+state}/>',
    '<div className={`status-chip ${state}`}/>',
  ]){
    const result=lint(code);assert.equal(result.status,1,code+'\n'+result.stdout+result.stderr);assert.match(result.stdout,/no-restricted-syntax/u);
  }
});

test('design variable gate rejects undefined fallbacks and primitive palette leaks',()=>{
  const scratch=mkdtempSync(path.join(tmpdir(),'design-variable-gate-'));
  try{
    execFileSync('git',['init','--quiet',scratch],{windowsHide:true});
    const src=path.join(scratch,'app/pc-admin/src'),vendor=path.join(scratch,'node_modules/react-aria-components/dist/private');
    mkdirSync(path.join(src,'design'),{recursive:true});mkdirSync(vendor,{recursive:true});
    writeFileSync(path.join(vendor,'Popover.cjs'),readFileSync(path.join(root,'node_modules/react-aria-components/dist/private/Popover.cjs')));
    writeFileSync(path.join(src,'design/tokens.css'),':root{--gray-900:#37352f;--text-primary:var(--gray-900)}');
    const file=path.join(src,'probe.css');writeFileSync(file,'.probe{color:var(--text-primary);width:var(--trigger-width)}');designVariables(scratch);
    writeFileSync(file,'.probe{color:var(--missing,var(--text-primary))}');assert.throws(()=>designVariables(scratch),/undefined --missing/u);
    writeFileSync(file,'.probe{color:var(--gray-900)}');assert.throws(()=>designVariables(scratch),/primitive palette --gray-900/u);
  }finally{
    assert.equal(path.dirname(scratch),path.resolve(tmpdir()));assert.ok(path.basename(scratch).startsWith('design-variable-gate-'));rmSync(scratch,{recursive:true,force:true});
  }
});
