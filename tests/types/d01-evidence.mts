import {evidenceHash, verifyYxxReceipts} from '../../src/yxx-self-service-verification.mjs';
import {readYxxLocalValidationScope} from '../../src/yxx-self-service-validation-scope.mjs';
import {checkSS010} from '../../src/yxx-self-service-readiness.mjs';
import {createG2ControlRecorder} from '../../src/p2-g2-control-evidence.mjs';

export function d01TypeBoundaries(root:string,input:unknown):void {
  evidenceHash('known bytes');
  // @ts-expect-error -- Unvalidated JSON is not byte content for a digest.
  evidenceHash(input);
  const receipts=verifyYxxReceipts('catalog',input);
  // @ts-expect-error -- Receipt validation does not validate unrelated scalar fields.
  const inventedString:string=receipts[0]?.unvalidated_field;
  void inventedString;
  // @ts-expect-error -- Catalog validation does not prove capacity-specific profiles exist.
  const inventedProfiles=receipts[0]?.profiles;
  void inventedProfiles;
  const scope=readYxxLocalValidationScope(root);
  if(scope){const disabled:false=scope.live_authorized;void disabled;}
  const result=checkSS010({root});
  const status:'STRUCTURE_VALID_NOT_READY'|'READY_FOR_LIMITED_WRITE_LIVE'=result.status;
  void status;
  const recorder=createG2ControlRecorder({file:root,manifest:input});
  const packet=recorder.append({scenario_id:'G2-F01',role:'GATEWAY',action:'disconnect',started_physical_epoch_ms:input,state:{gateway_authenticated:false,worker_ready:true,process_count:3}});
  // @ts-expect-error -- A regex coercion does not prove the original timestamp is a string.
  const stamp:string=packet.started_physical_epoch_ms;
  void stamp;
}
