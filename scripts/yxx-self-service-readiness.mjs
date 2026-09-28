import pathMigration from 'node:path';
import { fileURLToPath as migrationFilePath } from 'node:url';
const migrationRoot = migrationFilePath(new URL('../', import.meta.url));
if (!(pathMigration.basename(pathMigration.resolve(migrationRoot)) === 'runtime' && pathMigration.basename(pathMigration.dirname(pathMigration.resolve(migrationRoot))) === '.build')) {
  const { installSourceHost } = await import('../.build/tools/source-host.mjs');
  installSourceHost(migrationRoot);
}
const {checkSS010} = await import('../src/yxx-self-service-readiness.mjs');
const {reject} = await import('../src/yxx-limited-write-contract.mjs');
import {pathToFileURL} from 'node:url';
export function main(argv=process.argv.slice(2)){
  if(argv.length===1&&argv[0]==='--help'){console.log('Usage: node scripts/yxx-self-service-readiness.mjs [--require-ready]\nOffline only. READY is technical preparation, never live authorization.');return;}
  if(argv.length>1||argv.some(arg=>arg!=='--require-ready'))reject('ARGUMENT_INVALID');
  const result=checkSS010({root:migrationRoot,requireReady:argv.includes('--require-ready')});console.log(JSON.stringify(result));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)try{main();}catch{console.log(JSON.stringify({ok:false,error_code:'SS010_NOT_READY',live_authorized:false}));process.exitCode=1;}
