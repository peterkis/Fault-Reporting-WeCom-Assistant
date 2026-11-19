import {readDiagnostics} from '../design/components/ErrorState/ErrorState';
import type {ReadDiagnostics} from '../design/components/ErrorState/ErrorState';

/** Adapt existing read metadata for copying. Missing facts are never synthesized. */
export function copiedReadDiagnostics(error:unknown,updatedAt=0):ReadDiagnostics & Record<string,unknown>{
  const value=readDiagnostics(error,updatedAt);
  return {...value,requestId:value.requestIdSource==='unavailable'?'未提供':value.requestId,
    time:updatedAt>0?value.time:'未提供',
    code:error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'?error.code:'未提供'};
}
