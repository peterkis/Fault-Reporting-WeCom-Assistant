import type {G2FaultId} from './p2-g2-validation-config.mjs';
interface ControlInput {scenario_id:string;role:string;action:string;started_physical_epoch_ms:unknown;state:{gateway_authenticated?:unknown;worker_ready?:unknown;process_count?:unknown}}
import { openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { validateG2Manifest, failG2 } from './p2-g2-validation-config.mjs';
import { g2SourceBinding } from './p2-g2-evidence-files.mjs';

export function createG2ControlRecorder({file,manifest}: {file:string;manifest:unknown}){
  const checkedManifest=validateG2Manifest(manifest);const fd=openSync(file,'ax',0o600);let sequence=0,closed=false;
  return Object.freeze({append({scenario_id,role,action,started_physical_epoch_ms,state}: ControlInput){
    if(closed||!checkedManifest.scope.allowed_faults.includes(scenario_id as G2FaultId)
      ||!(scenario_id==='G2-F01'&&role==='GATEWAY'&&['disconnect','reconnect'].includes(action)
        ||scenario_id==='G2-F02'&&['APP','WORKER'].includes(role)&&['stop','restart'].includes(action))
      ||!/^\d{13}$/u.test(started_physical_epoch_ms as string)||typeof state?.gateway_authenticated!=='boolean'||typeof state.worker_ready!=='boolean'
      ||!Number.isInteger(state.process_count)||(state.process_count as number)<0||(state.process_count as number)>3)failG2('CONTROL_EVIDENCE_INVALID');
    const packet={schema_version:1,kind:'G2_CONTROL_PACKET',...g2SourceBinding(checkedManifest),
      sequence:++sequence,scenario_id,role,action,started_physical_epoch_ms,physical_epoch_ms:String(Date.now()),
      gateway_authenticated:state.gateway_authenticated,worker_ready:state.worker_ready,process_count:state.process_count};
    const bytes=Buffer.from(JSON.stringify(packet)+'\n');let offset=0;
    while(offset<bytes.length)offset+=writeSync(fd,bytes,offset,bytes.length-offset);fsyncSync(fd);return packet;
  },close(){if(!closed){closed=true;closeSync(fd);}}});
}
