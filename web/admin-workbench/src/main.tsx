import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router';
import {MutationCache,QueryCache,QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {ApiError} from './api/client';
import {useUiStore} from './app/ui-store';
import {App} from './app/App';
import {clearSourceGroupAuthorization} from './features/source-groups/authority';
import './style.css';
let client:QueryClient;
async function clearTicketAuthorization(principal:unknown,ticketId:unknown,error:ApiError){
  const matches=(key:readonly unknown[])=>key[1]===principal&&((key[0]==='detail'&&key[2]==='ticket'&&key[3]===ticketId)||(key[0]==='ticket-command-context'&&key[2]===ticketId));
  await client.cancelQueries({predicate:query=>matches(query.queryKey)},{revert:false});
  for(const query of client.getQueryCache().findAll({predicate:query=>matches(query.queryKey)}))query.setState({data:undefined,dataUpdatedAt:0,error,status:'error',fetchStatus:'idle'});
  void client.invalidateQueries({queryKey:['board',principal],refetchType:'active'});
}
client=new QueryClient({queryCache:new QueryCache({onError(error,query){
  if(error instanceof ApiError&&error.status===401){useUiStore.getState().failSession(401);void client.cancelQueries();client.clear();}
  else if(error instanceof ApiError&&error.status===403&&['session','board'].includes(String(query.queryKey[0]))){useUiStore.getState().failSession(403);void client.cancelQueries();client.clear();}
  else if(error instanceof ApiError&&[403,404].includes(error.status)){
    if(query.queryKey[0]==='source-groups')void clearSourceGroupAuthorization(client,query.queryKey[1],error);
    else if(query.queryKey[0]==='ticket-command-context'||(query.queryKey[0]==='detail'&&query.queryKey[2]==='ticket'))void clearTicketAuthorization(query.queryKey[1],query.queryKey[0]==='detail'?query.queryKey[3]:query.queryKey[2],error);
    else {void client.cancelQueries({queryKey:query.queryKey,exact:true});query.setState({data:undefined,dataUpdatedAt:0});if(query.queryKey[0]==='detail')void client.invalidateQueries({queryKey:['board',query.queryKey[1]],refetchType:'active'});}
  }
}}),mutationCache:new MutationCache({onError(error,_variables,_context,mutation){
  if(error instanceof ApiError&&error.status===401){useUiStore.getState().failSession(401);void client.cancelQueries();client.clear();}
  else if(error instanceof ApiError&&[403,404].includes(error.status)&&mutation.options.mutationKey&&['ticket-internal-note','ticket-self-handling'].includes(String(mutation.options.mutationKey[0])))return clearTicketAuthorization(mutation.options.mutationKey[1],mutation.options.mutationKey[2],error);
  else if(error instanceof ApiError&&[403,404].includes(error.status)&&mutation.options.mutationKey?.[0]==='source-group-name')return clearSourceGroupAuthorization(client,mutation.options.mutationKey[1],error);
}}),defaultOptions:{queries:{networkMode:'always',retry:false,staleTime:0,refetchOnWindowFocus:false,refetchOnReconnect:false},mutations:{networkMode:'always',retry:false}}});
const root=document.getElementById('root');if(!root)throw new Error('WORKBENCH_ROOT_MISSING');
createRoot(root).render(<StrictMode><QueryClientProvider client={client}><BrowserRouter basename="/workbench/app"><App/></BrowserRouter></QueryClientProvider></StrictMode>);
