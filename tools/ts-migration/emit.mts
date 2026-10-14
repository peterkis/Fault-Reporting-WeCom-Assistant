import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {program,sourceRoot} from './common.mjs';

/** The same strict compiler program, released before the browser build starts. */
export function emitMigrationSource(root:string):void {
  const result=program(root,'tsconfig.migration.json').emit();
  if(result.emitSkipped||result.diagnostics.length)throw new Error('MIGRATION_EMIT_FAILED');
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--root'||!args[1])throw new Error('MIGRATION_EMIT_INPUT_INVALID');
  const root=sourceRoot(args[1]);
  console.log('MIGRATION_EMIT_CHILD '+JSON.stringify({pid:process.pid,executable:process.execPath,argv:process.argv.slice(1),root}));
  emitMigrationSource(root);
  console.log('MIGRATION_EMIT_COMPLETED '+JSON.stringify({pid:process.pid,status:'STRICT_EMIT_SUCCEEDED'}));
}
