import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router';
import {QueryCache,QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {ApiError} from './api/client';
import {useUiStore} from './app/ui-store';
import {App} from './app/App';
import './style.css';
let client:QueryClient;
client=new QueryClient({queryCache:new QueryCache({onError(error){
  if(error instanceof ApiError&&error.status===401){useUiStore.getState().expireSession();void client.cancelQueries();client.clear();}
}}),defaultOptions:{queries:{networkMode:'always',retry:false,staleTime:0,refetchOnWindowFocus:false,refetchOnReconnect:false},mutations:{retry:false}}});
const root=document.getElementById('root');if(!root)throw new Error('WORKBENCH_ROOT_MISSING');
createRoot(root).render(<StrictMode><QueryClientProvider client={client}><BrowserRouter basename="/workbench/app"><App/></BrowserRouter></QueryClientProvider></StrictMode>);
