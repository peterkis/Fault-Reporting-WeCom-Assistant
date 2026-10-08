import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router';
import {MutationCache,QueryCache,QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {ApiError} from './api/client';
import type {Principal} from './api/client';
import {clearSessionAuthorization,clearItemAuthorization,clearReviewAuthorization} from './app/authorization';
import {attachmentParentDenied} from './features/attachments/client';
import {clearSourceGroupAuthorization} from './features/source-groups/authority';
import {App} from './app/App';
import './style.css';
let client:QueryClient;
const sessionPrincipal=()=>client.getQueryData<Principal>(['session'])?.principal_id;
client=new QueryClient({queryCache:new QueryCache({onError(error,query){
  if(error instanceof ApiError&&error.status===401)void clearSessionAuthorization(client,sessionPrincipal(),401,'revoked');
  else if(error instanceof ApiError&&error.status===403&&['session','board'].includes(String(query.queryKey[0])))void clearSessionAuthorization(client,sessionPrincipal(),403,'revoked');
  else if(error instanceof ApiError&&[403,404].includes(error.status)){
    if(query.queryKey[0]==='source-groups')void clearSourceGroupAuthorization(client,query.queryKey[1],error);
    else if(['ticket-command-context','ticket-related-conversations'].includes(String(query.queryKey[0])))void clearItemAuthorization(client,query.queryKey[1],'ticket',query.queryKey[2],error);
    else if(query.queryKey[0]==='manual-review'&&typeof query.queryKey[1]==='string'&&typeof query.queryKey[3]==='string'&&typeof query.queryKey[4]==='string'&&(query.queryKey[2]==='ticket'||query.queryKey[2]==='review'||query.queryKey[2]==='intake'))void clearReviewAuthorization(client,query.queryKey[1],query.queryKey[4],{kind:query.queryKey[2],id:query.queryKey[3]},error);
    else if(query.queryKey[0]==='detail'||(query.queryKey[0]==='attachments'&&attachmentParentDenied(error)))void clearItemAuthorization(client,query.queryKey[1],query.queryKey[2],query.queryKey[3],error);
    else {void client.cancelQueries({queryKey:query.queryKey,exact:true});query.setState({data:undefined,dataUpdatedAt:0});if(query.queryKey[0]==='detail')void client.invalidateQueries({queryKey:['board',query.queryKey[1]],refetchType:'active'});}
  }
}}),mutationCache:new MutationCache({onError(error,_variables,_context,mutation){
  if(error instanceof ApiError&&error.status===401)return clearSessionAuthorization(client,sessionPrincipal(),401,'revoked');
  else if(error instanceof ApiError&&[403,404].includes(error.status)&&mutation.options.mutationKey&&['ticket-internal-note','ticket-self-handling','ticket-completion'].includes(String(mutation.options.mutationKey[0])))return clearItemAuthorization(client,mutation.options.mutationKey[1],'ticket',mutation.options.mutationKey[2],error);
  else if(error instanceof ApiError&&[403,404].includes(error.status)&&mutation.options.mutationKey?.[0]==='manual-review-command'){
    const key=mutation.options.mutationKey;if(typeof key[1]==='string'&&typeof key[3]==='string'&&typeof key[4]==='string'&&(key[2]==='ticket'||key[2]==='review'||key[2]==='intake'))return clearReviewAuthorization(client,key[1],key[4],{kind:key[2],id:key[3]},error);
  }
  else if(attachmentParentDenied(error)&&mutation.options.mutationKey?.[0]==='attachment-download')return clearItemAuthorization(client,mutation.options.mutationKey[1],mutation.options.mutationKey[2],mutation.options.mutationKey[3],error);
  else if(error instanceof ApiError&&[403,404].includes(error.status)&&mutation.options.mutationKey?.[0]==='source-group-name')return clearSourceGroupAuthorization(client,mutation.options.mutationKey[1],error);
}}),defaultOptions:{queries:{networkMode:'always',retry:false,staleTime:0,refetchOnWindowFocus:false,refetchOnReconnect:false},mutations:{networkMode:'always',retry:false}}});
const root=document.getElementById('root');if(!root)throw new Error('WORKBENCH_ROOT_MISSING');
createRoot(root).render(<StrictMode><QueryClientProvider client={client}><BrowserRouter basename="/workbench/app"><App/></BrowserRouter></QueryClientProvider></StrictMode>);
