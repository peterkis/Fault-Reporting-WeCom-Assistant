import pathMigration from 'node:path';
import { fileURLToPath as migrationFilePath } from 'node:url';
const migrationRoot = migrationFilePath(new URL('../', import.meta.url));
if (!(pathMigration.basename(pathMigration.resolve(migrationRoot)) === 'runtime' && pathMigration.basename(pathMigration.dirname(pathMigration.resolve(migrationRoot))) === '.build')) {
  const { installSourceHost } = await import('../.build/tools/source-host.mjs');
  installSourceHost(migrationRoot);
}
const {validateYxxSelfService} = await import('../src/yxx-self-service-verification.mjs');
import {pathToFileURL} from 'node:url';
export function main(args=process.argv.slice(2)){
  try{if(args.length>1||args.some(a=>a!=='--require-ready'))throw Error('ARGUMENT_INVALID');
    const result=validateYxxSelfService({root:migrationRoot,requireReady:args.includes('--require-ready')});console.log(JSON.stringify(result));return result;
  }catch{console.log(JSON.stringify({ok:false,error_code:'YXX_VERIFICATION_REJECTED'}));process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main();
