import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router';
import {MutationCache,QueryCache,QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {ApiError} from './api/client';
import {clearSessionAuthorization,clearTicketAuthorization} from './app/authorization';
import type {Principal} from './api/client';
import {App} from './app/App';
import './style.css';
let client:QueryClient;
const sessionPrincipal=()=>client.getQueryData<Principal>(['session'])?.principal_id;
client=new QueryClient({queryCache:new QueryCache({onError(error,query){
  if(error instanceof ApiError&&error.status===401)void clearSessionAuthorization(client,sessionPrincipal(),401,'revoked');
  else if(error instanceof ApiError&&error.status===403&&['session','board'].includes(String(query.queryKey[0])))void clearSessionAuthorization(client,sessionPrincipal(),403,'revoked');
  else if(error instanceof ApiError&&[403,404].includes(error.status)){
    if(query.queryKey[0]==='ticket-command-context'||(query.queryKey[0]==='detail'&&query.queryKey[2]==='ticket'))void clearTicketAuthorization(client,query.queryKey[1],query.queryKey[0]==='detail'?query.queryKey[3]:query.queryKey[2],error);
    else {void client.cancelQueries({queryKey:query.queryKey,exact:true});query.setState({data:undefined,dataUpdatedAt:0});if(query.queryKey[0]==='detail')void client.invalidateQueries({queryKey:['board',query.queryKey[1]],refetchType:'active'});}
  }
}}),mutationCache:new MutationCache({onError(error,_variables,_context,mutation){
  if(error instanceof ApiError&&error.status===401)return clearSessionAuthorization(client,sessionPrincipal(),401,'revoked');
  else if(error instanceof ApiError&&[403,404].includes(error.status)&&mutation.options.mutationKey?.[0]==='ticket-internal-note')return clearTicketAuthorization(client,mutation.options.mutationKey[1],mutation.options.mutationKey[2],error);
}}),defaultOptions:{queries:{networkMode:'always',retry:false,staleTime:0,refetchOnWindowFocus:false,refetchOnReconnect:false},mutations:{networkMode:'always',retry:false}}});
const root=document.getElementById('root');if(!root)throw new Error('WORKBENCH_ROOT_MISSING');
createRoot(root).render(<StrictMode><QueryClientProvider client={client}><BrowserRouter basename="/workbench/app"><App/></BrowserRouter></QueryClientProvider></StrictMode>);
