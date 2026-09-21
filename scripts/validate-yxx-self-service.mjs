import {pathToFileURL} from 'node:url';
import {validateYxxSelfService} from '../src/yxx-self-service-verification.mjs';
export function main(args=process.argv.slice(2)){
  try{if(args.length>1||args.some(a=>a!=='--require-ready'))throw Error('ARGUMENT_INVALID');
    const result=validateYxxSelfService({requireReady:args.includes('--require-ready')});console.log(JSON.stringify(result));return result;
  }catch{console.log(JSON.stringify({ok:false,error_code:'YXX_VERIFICATION_REJECTED'}));process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main();
