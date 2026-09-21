import {pathToFileURL} from 'node:url';
import {checkSS010} from '../src/yxx-self-service-readiness.mjs';
import {reject} from '../src/yxx-limited-write-contract.mjs';
export function main(argv=process.argv.slice(2)){
  if(argv.length===1&&argv[0]==='--help'){console.log('Usage: node scripts/yxx-self-service-readiness.mjs [--require-ready]\nOffline only. READY is technical preparation, never live authorization.');return;}
  if(argv.length>1||argv.some(arg=>arg!=='--require-ready'))reject('ARGUMENT_INVALID');
  const result=checkSS010({requireReady:argv.includes('--require-ready')});console.log(JSON.stringify(result));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)try{main();}catch{console.log(JSON.stringify({ok:false,error_code:'SS010_NOT_READY',live_authorized:false}));process.exitCode=1;}
