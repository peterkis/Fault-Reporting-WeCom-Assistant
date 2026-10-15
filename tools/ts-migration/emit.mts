import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {program,sourceRoot} from './common.mjs';

/** The same strict compiler program, released before the browser build starts. */
export function emitMigrationSource(root:string):void {
  const result=program(root,'tsconfig.migration.json').emit();
  if(result.emitSkipped||result.diagnostics.length)throw new Error('MIGRATION_EMIT_FAILED');
}

export function checkMigrationTypes(root:string):void {
  program(root,'tsconfig.tools.json');
  program(root,'tsconfig.migration.json');
  program(root,'tsconfig.type-tests.json');
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if((args.length!==2&&args.length!==3)||args[0]!=='--root'||!args[1]||(args.length===3&&args[2]!=='--types'))throw new Error('MIGRATION_EMIT_INPUT_INVALID');
  const root=sourceRoot(args[1]);
  console.log('MIGRATION_EMIT_CHILD '+JSON.stringify({pid:process.pid,executable:process.execPath,argv:process.argv.slice(1),root}));
  if(args[2]==='--types')checkMigrationTypes(root);else emitMigrationSource(root);
  console.log('MIGRATION_EMIT_COMPLETED '+JSON.stringify({pid:process.pid,status:args[2]==='--types'?'COMPLETE_STRICT_TYPES_SUCCEEDED':'STRICT_EMIT_SUCCEEDED'}));
}
