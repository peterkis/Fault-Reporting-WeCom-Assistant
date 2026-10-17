import {createP2G1ProcessCluster} from './p2-g1-process-cluster.mjs';
import type {WorkbenchConfiguration} from './human-workbench-configuration.mjs';
import {workbenchRoleEnvironment} from './human-workbench-configuration.mjs';

export function createHumanWorkbenchCluster(c:WorkbenchConfiguration,{roleScriptUrl=new URL('../scripts/human-workbench-role.mjs',import.meta.url)}={}){
 const s=c.settings;
 // Only OS execution essentials are inherited. NODE_OPTIONS, model keys and old approvals cannot leak into children.
 const baseEnvironment:Record<string,string>={};
 for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','NODE_V8_COVERAGE'])if(process.env[key]!==undefined)baseEnvironment[key]=process.env[key] as string;
 return createP2G1ProcessCluster({databaseUrl:c.databaseUrl,identityHashKey:c.identityHashKey,principalIds:[],externalAuthentication:true,
  listenPort:s.listenPort,gatewayEnabled:s.transportEnabled,senderEnabled:s.transportEnabled,botId:s.bot.id,secret:c.botSecret,wsUrl:s.bot.wsUrl,
  allowedTargetHashes:[...s.bot.personTargetHashes,...s.bot.groupTargetHashes],baseEnvironment,workerHealthEvents:true,roleScriptUrl,
  roleEnvironment:role=>workbenchRoleEnvironment(c,role)});
}
