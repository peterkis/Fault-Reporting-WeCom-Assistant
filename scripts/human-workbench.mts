import {pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline';
import {readHumanWorkbenchConfiguration,configurationError} from '../src/human-workbench-configuration.mjs';
import {createHumanWorkbenchCluster} from '../src/human-workbench-cluster.mjs';

export async function main(argv=process.argv.slice(2),{env=process.env,roleScriptUrl}:{env?:NodeJS.ProcessEnv;roleScriptUrl?:URL}={}){
 if(argv.length!==1||!['--check','--start'].includes(argv[0]??''))configurationError('arguments');
 const c=readHumanWorkbenchConfiguration(env,{isolatedBoundaries:roleScriptUrl!==undefined});
 if(argv[0]==='--check'){console.log(JSON.stringify({profile:c.enabled?'human-v1':null,enabled:c.enabled,configuration_valid:true,network_started:false,...(c.enabled?{transport_enabled:c.settings.transportEnabled,roles:['APP','WORKER','GATEWAY']}:{})}));return;}
 if(!c.enabled)configurationError('WORKBENCH_RUNTIME_PROFILE');
 if(roleScriptUrl&&c.settings.memberEntry.validationProfile!=='ISOLATED_TEST')configurationError('isolatedBoundaries');
 const cluster=createHumanWorkbenchCluster(c,roleScriptUrl?{roleScriptUrl}:{});let stopped:Promise<Awaited<ReturnType<typeof cluster.stop>>>|undefined;
 const input=createInterface({input:process.stdin});
 const stop=()=>stopped??=(async()=>{input.close();const result=await cluster.stop();console.log(JSON.stringify({event:'stopped',...result}));return result;})();
 input.on('line',line=>{if(line.trim()==='stop')void stop();});
 process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
 try{const started=await cluster.start();console.log(JSON.stringify({event:'ready',profile:'human-v1',process_count:3,transport_enabled:c.settings.transportEnabled}));return {...started,stop};}
 catch(error){await stop();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main().catch(error=>{
 console.error(error instanceof Error&&/^HUMAN_WORKBENCH_(?:CONFIG_INVALID|SCHEMA_REQUIRED):[A-Za-z0-9_.,]+$/u.test(error.message)?error.message:'HUMAN_WORKBENCH_START_FAILED');process.exitCode=1;
});
