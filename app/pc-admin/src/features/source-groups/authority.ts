import type {QueryClient} from '@tanstack/react-query';
import type {ApiError} from '../../api/client';
import {useUiStore} from '../../app/ui-store';

export async function clearSourceGroupAuthorization(client:QueryClient,principal:unknown,error:ApiError){
  if(error.status===401){useUiStore.getState().failSession(401);await client.cancelQueries();client.clear();return;}
  const matches=(key:readonly unknown[])=>key[0]==='source-groups'&&key[1]===principal;
  await client.cancelQueries({predicate:query=>matches(query.queryKey)},{revert:false});
  for(const query of client.getQueryCache().findAll({predicate:query=>matches(query.queryKey)}))query.setState({data:undefined,dataUpdatedAt:0,error,status:'error',fetchStatus:'idle'});
  for(const mutation of client.getMutationCache().findAll({predicate:mutation=>mutation.options.mutationKey?.[0]==='source-group-name'&&mutation.options.mutationKey[1]===principal}))client.getMutationCache().remove(mutation);
  void client.invalidateQueries({queryKey:['session']});
  void client.invalidateQueries({queryKey:['board',principal]});
  void client.invalidateQueries({queryKey:['detail',principal]});
}
