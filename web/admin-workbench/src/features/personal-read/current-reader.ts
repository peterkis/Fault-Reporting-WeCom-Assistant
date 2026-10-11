import type {QueryClient} from '@tanstack/react-query';
import {api,ApiError} from '../../api/client';
import type {Principal} from '../../api/client';
import {clearSessionAuthorization} from '../../app/authorization';
export async function verifyCurrentReader(principal:Principal,client:QueryClient,signal:AbortSignal):Promise<Principal|null>{
  let fresh:Principal;
  try{fresh=await api.bootstrap(signal);}
  catch(error){if(error instanceof ApiError&&[401,403].includes(error.status)){await clearSessionAuthorization(client,principal.principal_id,error.status as 401|403,'revoked');return null;}throw error;}
  if(fresh.principal_id!==principal.principal_id){await clearSessionAuthorization(client,principal.principal_id,undefined,'revoked','当前账号已变化，请重新核验工作台。');return null;}
  return fresh.personal_read_enabled?fresh:null;
}
