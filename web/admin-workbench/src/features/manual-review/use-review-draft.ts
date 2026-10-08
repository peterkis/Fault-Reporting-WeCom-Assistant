import {useRef} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError} from '../../api/client';
import type {Principal} from '../../api/client';
import type {CanonicalItem} from '../../../../../contracts/workbench_review_contracts';
import {useAuthorizedDraft} from '../drafts/use-note-draft';
import {DraftError} from '../drafts/encrypted-drafts';
import {clearReviewAuthorization,clearSessionAuthorization} from '../../app/authorization';
import {canonicalItem,decodeReviewCommand,reviewApi,reviewVersion,resolutions} from './client';
import type {Resolution,ReviewCommand} from './client';

export interface ReviewInput {review_id:string;choice:Resolution|'';reason:string;capture:{row_version:string;material_basis:string;canonical_item:CanonicalItem}|null}
export const emptyReviewInput=(reviewId:string):ReviewInput=>({review_id:reviewId,choice:'',reason:'',capture:null});
export const hasReviewInput=(value:ReviewInput)=>Boolean(value.choice||value.reason);
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw new DraftError('DRAFT_CORRUPT');return value as Record<string,unknown>;}
function decode(text:string,reviewId:string):{value:ReviewInput;pending:ReviewCommand|null}{
  try{
    const root=object(JSON.parse(text),['schema','value','pending']),v=object(root.value,['review_id','choice','reason','capture']);
    if(root.schema!==1||v.review_id!==reviewId||typeof v.choice!=='string'||(v.choice!==''&&!Object.hasOwn(resolutions,v.choice))
      ||typeof v.reason!=='string'||(v.reason!==''&&!/^[A-Z][A-Z0-9_]{0,63}$/u.test(v.reason)))throw new DraftError('DRAFT_CORRUPT');
    let capture:ReviewInput['capture']=null;
    if(v.capture!==null){const c=object(v.capture,['row_version','material_basis','canonical_item']);if(typeof c.material_basis!=='string'||!/^[a-f0-9]{64}$/u.test(c.material_basis))throw new DraftError('DRAFT_CORRUPT');capture={row_version:reviewVersion(c.row_version),material_basis:c.material_basis,canonical_item:canonicalItem(c.canonical_item)};}
    const pending=root.pending===null?null:decodeReviewCommand(root.pending),value:ReviewInput={review_id:reviewId,choice:v.choice as ReviewInput['choice'],reason:v.reason,capture};
    if(pending&&(!capture||pending.expected_row_version!==capture.row_version||pending.expected_material_basis!==capture.material_basis
      ||pending.resolution_code!==value.choice||pending.resolution_reason_code!==value.reason))throw new DraftError('DRAFT_CORRUPT');
    return {value,pending};
  }catch{throw new DraftError('DRAFT_CORRUPT');}
}
export function useReviewDraft({principal,item,reviewId,value,pending,onRestore,onOperation,onSensitiveClear}:{principal:Principal;item:CanonicalItem;reviewId:string;value:ReviewInput;pending:ReviewCommand|null;
  onRestore:(restored:{value:ReviewInput;pending:ReviewCommand|null})=>void;onOperation:(id:string)=>void;onSensitiveClear:()=>void}){
  const client=useQueryClient(),stage=useRef<'session'|'item'|'review'>('session');
  return useAuthorizedDraft<ReviewInput,ReviewCommand>({scope:{principal:principal.principal_id,kind:'review',id:reviewId,purpose:'manual-review'},enabled:principal.manual_review_draft_recovery_enabled,
    value,pending,emptyValue:emptyReviewInput(reviewId),hasInput:hasReviewInput,serialise:value=>JSON.stringify({schema:1,...value}),decode:text=>decode(text,reviewId),commandId:command=>command.client_command_id,
    authorize:async signal=>{
      stage.current='session';const fresh=await api.bootstrap(signal);client.setQueryData(['session'],fresh);
      if(fresh.principal_id!==principal.principal_id)throw new DraftError('DRAFT_IDENTITY_CHANGED');
      if(!fresh.manual_review_enabled||!fresh.manual_review_draft_recovery_enabled)throw new DraftError('DRAFT_DISABLED');
      stage.current='item';await api.detail(item.kind,item.id,null,signal);
      stage.current='review';const current=await reviewApi.detail(reviewId,signal);client.setQueryData(['manual-review',principal.principal_id,item.kind,item.id,reviewId],current);
      // A readable terminal Review may still have the immutable UNKNOWN command.
      return true;
    },onAuthorityFailure:error=>{
      if(error instanceof ApiError&&error.status===401)void clearSessionAuthorization(client,principal.principal_id,401,'revoked');
      else if(error instanceof ApiError&&error.status===403&&stage.current==='session')void clearSessionAuthorization(client,principal.principal_id,403,'revoked');
      else if(error instanceof ApiError&&[403,404].includes(error.status))void clearReviewAuthorization(client,principal.principal_id,reviewId,item,error);
    },onRestore,onOperation,onSensitiveClear});
}
